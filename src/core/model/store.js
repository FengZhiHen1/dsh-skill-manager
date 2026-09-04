// dsh-skill-manager — storage 域投影形状与存取门面（DSR-015 model 层；DSR-017 两表收敛）。
//
// 权威语义见 docs/technical-details/目录配置与状态存储.md：
// - storage 域 `skill_manager` 是**运行时投影**，只有两表：skills（github 入库
//   元数据）与 check_cache（上游检查结果缓存）。用户意图的唯一事实源是
//   settings 命名空间；物化状态由文件系统现场现算（无 synced/projects 台账，
//   备份事实源是备份目录本身，DSR-017）。
// - 域读为内存同步读；写经域写链持久化先行（put/delete 均为异步）。
// - version 保持 1：storage-json 后端对 version 严格相等校验，bump 会让存量
//   域打不开；新 spec 未声明的旧表（synced/projects/backups 乃至 legacy 七表）
//   在首次写入时从域文件整体抹除（打开只载入声明表、写入整文档重序列化），
//   无需迁移代码（目录配置与状态存储.md「已核实事实」）。
// - legacy 七表 spec 仅供一次性迁移（src/adapter/migrate.js）读取存量意图。
//
// P1 搬位说明：defineDomain/domainTable 的 @deepseek-ai 包裹在
// src/adapter/storage.js（core 不 import @deepseek-ai/*）。
// 其余模块只依赖 createStore 返回的门面。测试用 createStore(fakeDomain) 注入
// 内存假句柄（fakeDomain.table(name) 返回带同步 get/entries/keys 与异步
// put/delete/update 的对象），不依赖真实 storage 服务。

import { z } from 'zod'

/**
 * 入库元数据（键 = 安装名）。新登记只有 origin:"github"；存量 "local"/"self"
 * 记录兼容读取并视为 self（无上游操作、无删除入口、不新登记，DSR-017）。
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

// ---- 以下三个 schema 只服务 legacy 七表 spec 的存量读取（迁移窗口），新 spec 不声明 ----

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
 * 域声明构建器（目录配置与状态存储.md「storage 域形状」）：两表，version 恒 1。
 * @param {{ defineDomain: Function, domainTable: Function }} 平台包裹（adapter 注入）
 */
export const buildSkillManagerSpec = ({ defineDomain, domainTable }) => defineDomain({
  name: 'skill_manager',
  version: 1,
  tables: {
    skills: domainTable(skillRecord),
    check_cache: domainTable(checkRecord),
  },
})

/**
 * 旧七表 spec 构建器（含 groups/mounts/synced/projects/backups 与带意图的
 * skills）——仅供一次性迁移读取存量意图；迁移完成后不再使用。
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
 * 存取门面：把域句柄（或测试假句柄）包装成业务模块使用的窄接口。
 * 读全部同步（域为内存权威）；写全部异步（持久化先行）。
 */
export function createStore(domain) {
  const table = (name) => domain.table(name)
  return {
    close: () => domain.close(),

    getSkill: (name) => table('skills').get(name),
    skillEntries: () => [...table('skills').entries()],
    putSkill: (name, record) => table('skills').put(name, record),
    deleteSkill: (name) => table('skills').delete(name),

    getCheck: (name) => table('check_cache').get(name),
    checkEntries: () => [...table('check_cache').entries()],
    putCheck: (name, record) => table('check_cache').put(name, record),
    deleteCheck: (name) => table('check_cache').delete(name),
  }
}

/**
 * 上游检查缓存读取（DSR-008 状态直显）：checkedAt + 按安装名的最近结果。
 * 只由 check/update/remove 经门面维护；读取不发网络请求。
 */
export function readCheckCache(store) {
  const results = Object.fromEntries(store.checkEntries())
  const checkedAt = Object.values(results).reduce(
    (latest, record) => (record?.checked_at > (latest ?? '') ? record.checked_at : latest),
    null,
  )
  return { checkedAt, results }
}
