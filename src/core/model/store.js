// dsh-skill-manager — storage 域投影形状与存取门面（DSR-015 model 层）。
//
// 权威语义见 docs/technical-details/目录配置与状态存储.md：
// - storage 域 `skill_manager` 是**运行时投影**：用户意图（分组/挂载/禁用）
//   的唯一事实源是 settings 命名空间（settings.yaml 的 skill-manager 段），
//   域内只保留发现物与物化状态：skills（github 入库元数据）、synced（物化
//   记录）、projects（工作区镜像）、check_cache、backups。
// - groups/mounts 表已删除（意图归配置）；skills 表不再记录 disabled/group
//   意图字段；self 目录不再登记（本地 skill 即本地文件）。
// - 域读为内存同步读；写经域写链持久化先行（put/delete/update 均为异步）。
// - legacy 七表 spec 仅供一次性迁移：读旧意图（groups/mounts/
//   skills.disabled/group）投影进 settings.yaml，随后不再使用。
//
// P1 搬位说明：本文件保留 zod 记录 schema、域形状构建器、键与窄门面；
// defineDomain/domainTable 的 @deepseek-ai/dsh-storage-domain 包裹与
// openStore 移至 src/adapter/storage.js（core 不 import @deepseek-ai/*）。
// 其余模块只依赖 createStore 返回的门面。测试用 createStore(fakeDomain) 注入
// 内存假句柄（fakeDomain.table(name) 返回带同步 get/entries/keys 与异步
// put/delete/update 的对象），不依赖真实 storage 服务。

import { z } from 'zod'

/** github/local 入库元数据；self 为兼容存量记录保留（不再新登记）。 */
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
  method: z.enum(['junction', 'copy']),
  dir: z.string(),
  // at 是物化时间（目录配置与状态存储.md「synced 表」）；早期写入端漏写导致存量记录
  // 缺此字段，而 storage-domain 仅在打开时对每条存量记录做 zod 校验，必填会
  // 让整域打不开。改可选：新记录由 sync.js 补齐，旧记录放行；无逻辑读取 at。
  at: z.string().optional(),
  // hash 是 copy 物化时的内容哈希（挂载与同步.md「物化」）：仅哈希一致（未被
  // 改动）的 copy 目录允许被替换/摘除。junction 记录与早期存量记录无此字段。
  hash: z.string().optional(),
})

const projectRecord = z.object({
  path: z.string(),
})

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

const backupRecord = z.object({
  name: z.string(),
  created_at: z.string(),
})

/**
 * 域声明构建器（目录配置与状态存储.md「storage 域形状」）。version 保持 1：storage-json
 * 后端对 version 严格相等校验，bump 会让存量域打不开；未声明表在打开时被
 * 忽略，首次新 spec 写入即从文件抹除（迁移窗口期无害）。
 * @param {{ defineDomain: Function, domainTable: Function }} 平台包裹（adapter 注入）
 */
export const buildSkillManagerSpec = ({ defineDomain, domainTable }) => defineDomain({
  name: 'skill_manager',
  version: 1,
  tables: {
    skills: domainTable(skillRecord),
    synced: domainTable(syncedRecord),
    projects: domainTable(projectRecord),
    check_cache: domainTable(checkRecord),
    backups: domainTable(backupRecord),
  },
})

/**
 * 旧七表 spec 构建器（含 groups/mounts 与带意图的 skills）——仅供一次性迁移
 * （src/adapter/migrate.js）读取存量意图；迁移完成后不再使用。
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

/** 物化记录键：`<name>|<app>|<scope>|<project 或 global>`。 */
export function syncedKey(name, target) {
  return `${name}|${target.app}|${target.scope}|${target.project ?? 'global'}`
}

/** 备份 id：`<安装名>-<时间戳紧凑串>`（目录配置与状态存储.md backups 表）。 */
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

    syncedEntries: () => [...table('synced').entries()],
    putSynced: (name, target, record) => table('synced').put(syncedKey(name, target), record),
    deleteSynced: (name, target) => table('synced').delete(syncedKey(name, target)),

    getProject: (workspaceId) => table('projects').get(workspaceId),
    projectEntries: () => [...table('projects').entries()],
    putProject: (workspaceId, record) => table('projects').put(workspaceId, record),

    getCheck: (name) => table('check_cache').get(name),
    checkEntries: () => [...table('check_cache').entries()],
    putCheck: (name, record) => table('check_cache').put(name, record),
    deleteCheck: (name) => table('check_cache').delete(name),

    getBackup: (id) => table('backups').get(id),
    backupEntries: () => [...table('backups').entries()],
    putBackup: (id, record) => table('backups').put(id, record),
    deleteBackup: (id) => table('backups').delete(id),
  }
}
