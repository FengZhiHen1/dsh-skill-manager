// dsh-skill-manager — storage 域声明与存取门面。
//
// 权威语义见 docs/design/dsh-skill-manager/technical-details/storage-model.md：
// - 全部管理状态存于 DSH storage 域 `skill_manager`（json 后端落盘
//   $DSH_HOME/storages/skill_manager.json）；配置目录内不出现任何状态文件。
// - 表：skills / groups / mounts / synced / projects / check_cache / backups。
// - 域读为内存同步读；写经域写链持久化先行（put/delete/update 均为异步）。
//
// 本模块是唯一接触 @deepseek-ai/dsh-storage-domain 与 zod 的地方；其余模块
// 只依赖 createStore 返回的门面。测试用 createStore(fakeDomain) 注入内存假
// 句柄（fakeDomain.table(name) 返回带同步 get/entries/keys 与异步
// put/delete/update 的对象），不依赖真实 storage 服务。

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const skillRecord = z.object({
  origin: z.enum(['github', 'local', 'self']),
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  path_in_repo: z.string().nullable(),
  content_hash: z.string().nullable(),
  origin_path: z.string().nullable(),
  installed_at: z.string(),
  disabled: z.boolean(),
  group: z.string(),
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
  // at 是物化时间（storage-model.md「synced 表」）；早期写入端漏写导致存量记录
  // 缺此字段，而 storage-domain 仅在打开时对每条存量记录做 zod 校验，必填会
  // 让整域打不开。改可选：新记录由 sync.js 补齐，旧记录放行；无逻辑读取 at。
  at: z.string().optional(),
  // hash 是 copy 物化时的内容哈希（mount-sync.md「物化」）：仅哈希一致（未被
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

/** 域声明（storage-model.md「storage 域形状」）。 */
export const skillManagerSpec = defineDomain({
  name: 'skill_manager',
  version: 1,
  tables: {
    skills: domainTable(skillRecord),
    groups: domainTable(groupRecord),
    mounts: domainTable(mountRecord),
    synced: domainTable(syncedRecord),
    projects: domainTable(projectRecord),
    check_cache: domainTable(checkRecord),
    backups: domainTable(backupRecord),
  },
})

/** 挂载规则键：`<group>|<app>|<scope>|<project 或空>`。 */
export function mountKey(mount) {
  return `${mount.group}|${mount.app}|${mount.scope}|${mount.project ?? ''}`
}

/** 物化记录键：`<name>|<app>|<scope>|<project 或 global>`。 */
export function syncedKey(name, target) {
  return `${name}|${target.app}|${target.scope}|${target.project ?? 'global'}`
}

/** 备份 id：`<安装名>-<时间戳紧凑串>`（storage-model.md backups 表）。 */
export function backupId(name, at = new Date()) {
  const stamp = at.toISOString().replace(/[-:.TZ]/g, '')
  return `${name}-${stamp}`
}

/**
 * 在 Host apply 内打开域并返回门面；调用方负责把 close 挂进 ctx.effect。
 * @param {object} ctx Host 插件上下文（须注入 storage 服务）
 */
export async function openStore(ctx) {
  const domain = await ctx.storage.domain.open(skillManagerSpec)
  return createStore(domain)
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

    getGroup: (name) => table('groups').get(name),
    groupEntries: () => [...table('groups').entries()],
    putGroup: (name, record) => table('groups').put(name, record),
    deleteGroup: (name) => table('groups').delete(name),

    mountEntries: () => [...table('mounts').entries()],
    putMount: (mount) => table('mounts').put(mountKey(mount), mount),
    deleteMount: (mount) => table('mounts').delete(mountKey(mount)),

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
