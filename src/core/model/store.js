// store — storage 域投影形状与存取门面：两表 schema、spec 构建器与窄接口。
//
// 边界：core 不 import @deepseek-ai/*；域声明的平台包裹在 adapter 层。
// 边界：域只是运行时投影，意图唯一事实源在 settings，物化状态文件系统现算。
// 参考：目录配置与状态存储.md「storage 域形状」「已核实事实」；DSR-008/015/017。

import { z } from 'zod'

/**
 * 入库元数据（键 = 安装名）。新登记只有 origin:"github"；
 * 存量 "local"/"self" 记录兼容读取并视为 self。
 * 视为 self 的含义：无上游操作、无删除入口、不新登记。
 * origin_path 仅供旧记录通过校验，不再写入。
 */
const skillRecord = z.object({
  origin: z.enum(['github', 'local', 'self']),
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  path_in_repo: z.string().nullable(),
  content_hash: z.string().nullable(),
  origin_path: z.string().nullable(),
  installed_at: z.string(),
})

/** 最近一次上游检查结果（键 = 安装名），只收 origin:"github" 条目。 */
const checkRecord = z.object({
  checked_at: z.string(),
  repo: z.string(),
  branch: z.string().nullable(),
  current: z.string().nullable(),
  latest: z.string().nullable(),
  status: z.string(),
  reason: z.string().nullable(),
  via: z.string().nullable(),
  updatable: z.boolean(),
  reachable: z.boolean(),
  locally_modified: z.boolean(),
  baseline_missing: z.boolean(),
  missing: z.boolean(),
})

/**
 * 挂载归属登记（DSR-022 B 案）：键 = 链接绝对路径（归一口径见 mount/registry.js 的 managedKey），
 * 值 = 建链事实。**摘除权只由本表授予**——「这条链接是本 HOME 建的」不再有第二处事实源。
 * 键名沿用域内 snake_case 风格（installed_at/content_hash 同族），故用 op_id 而非 opId；
 * 记录里不存 entry/挂载根信息——它撞台账的 entry（入口）语义，且完全可由键路径反推。
 */
const managedLinkRecord = z.object({
  target: z.string().nullable(),
  skill: z.string(),
  created_at: z.string(),
  op_id: z.string().nullable(),
})

// ---- 以下 schema 仅服务 legacy 七表 spec 的存量读取，新 spec 不声明 ----

const groupRecord = z.object({
  created_at: z.string(),
})

const mountRecord = z.object({
  group: z.string(),
  app: z.string(),
  scope: z.enum(['global', 'project']),
  project: z.string().nullable(),
})

const syncedRecord = z.object({
  method: z.string(),
  dir: z.string(),
  at: z.string().optional(),
  hash: z.string().optional(),
})

const projectRecord = z.object({
  path: z.string(),
})

const backupRecord = z.object({
  name: z.string(),
  created_at: z.string(),
})

/**
 * 域声明构建器：storage 域 skill_manager 三表（skills/check_cache/managed_links），version 恒 1。
 * version 不能 bump：storage-json 后端对 version 严格相等校验，bump 会让存量域打不开。
 * 新 spec 未声明的旧表（synced/projects/backups 乃至 legacy 七表）在首次写入时整体抹除。
 * 抹除机制：打开只载入声明表，写入整文档重序列化，故无需清场代码。
 * 无 synced/projects 台账表；备份事实源是备份目录本身。
 * @param {{ defineDomain: Function, domainTable: Function }} 平台包裹（adapter 注入）
 */
export const buildSkillManagerSpec = ({ defineDomain, domainTable }) => defineDomain({
  name: 'skill_manager',
  version: 1,
  tables: {
    skills: domainTable(skillRecord),
    check_cache: domainTable(checkRecord),
    managed_links: domainTable(managedLinkRecord),
  },
})

/**
 * legacy 七表 spec 构建器：含 groups/mounts/synced/projects/backups 与带意图 skills。
 * 仅供 adapter 层一次性读取存量意图；兼容导入完成后不再使用。
 * @param {{ defineDomain: Function, domainTable: Function }} 平台包裹（adapter 注入）
 */
export const buildLegacySkillManagerSpec = ({ defineDomain, domainTable }) => defineDomain({
  name: 'skill_manager',
  version: 1,
  tables: {
    skills: domainTable(skillRecord.extend({ disabled: z.boolean(), group: z.string() })),
    groups: domainTable(groupRecord),
    mounts: domainTable(mountRecord),
    synced: domainTable(syncedRecord),
    projects: domainTable(projectRecord),
    check_cache: domainTable(checkRecord),
    backups: domainTable(backupRecord),
  },
})

/** 备份目录 id：`<安装名>-<时间戳紧凑串>`（备份事实源 = 目录 + _backup_meta.json）。 */
export function backupId(name, at = new Date()) {
  const stamp = at.toISOString().replace(/[-:.TZ]/g, '')
  return `${name}-${stamp}`
}

/**
 * 存取门面：把域句柄或测试假句柄包装成业务模块使用的窄接口。
 * 读全部同步（域为内存权威）；写全部异步（put/delete 均持久化先行）。
 * 其余模块只依赖本门面，不直接持有域句柄，也不依赖真实 storage 服务。
 * 假句柄契约：table(name) 返回同步 get/entries/keys 与异步 put/delete/update 的对象。
 */
export function createStore(domain) {
  const table = (name) => domain.table(name)
  return {
    close: () => domain.close(),

    getSkill: (name) => table('skills').get(name),
    skillEntries: () => [...table('skills').entries()],
    putSkill: (name, record) => table('skills').put(name, record),
    deleteSkill: (name) => table('skills').delete(name),

    // 挂载归属登记（DSR-022 B 案）：只经 mount/registry.js 使用，业务层不直接碰表键。
    linkEntries: () => [...table('managed_links').entries()],
    getLink: (key) => table('managed_links').get(key),
    putLink: (key, record) => table('managed_links').put(key, record),
    deleteLink: (key) => table('managed_links').delete(key),

    getCheck: (name) => table('check_cache').get(name),
    checkEntries: () => [...table('check_cache').entries()],
    putCheck: (name, record) => table('check_cache').put(name, record),
    deleteCheck: (name) => table('check_cache').delete(name),
  }
}

/**
 * 上游检查缓存读取（状态直显口径）：返回 checkedAt 与按安装名的最近结果。
 * 缓存只由 check/update/remove 经门面维护。
 * 读取不发网络请求。
 */
export function readCheckCache(store) {
  const results = Object.fromEntries(store.checkEntries())
  const checkedAt = Object.values(results).reduce(
    (latest, record) => (record?.checked_at > (latest ?? '') ? record.checked_at : latest),
    null,
  )
  return { checkedAt, results }
}
