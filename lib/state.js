// dsh-skill-manager — 挂载状态与 DSH 工作区镜像（目录配置与状态存储.md 域表；挂载与同步.md）。
// 意图（挂载规则）来自 settings 配置；本模块只处理运行时投影：synced 物化
// 记录、projects 工作区镜像。

import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { SkillManagerError } from './errors.js'

/** dsh App 条目语义（挂载与同步.md「dsh App 语义」）。 */
export const DSH_APP = {
  skills_dir: '~/.dsh/skills',
  project_dir: '.dsh/skills',
  enabled: true,
}

const emptyState = () => ({ projects: {}, synced: {} })

function assertStore(store) {
  if (!store || typeof store.projectEntries !== 'function' || typeof store.syncedEntries !== 'function') {
    throw new TypeError('state requires a storage store facade')
  }
}

function parseSyncedKey(key) {
  const parts = String(key).split('|')
  if (parts.length < 4) return null
  const [name, app, scope, project] = parts
  // 仅 global 作用域把 'global'/空 归一为 null（哨兵，对偶 store.js syncedKey
  // 的 `?? 'global'`）；project 作用域的 'global' 是真实工作区 id，不得误还原。
  const isGlobalSentinel = scope === 'global' && (project === 'global' || project === '')
  return { name, app, scope, project: isGlobalSentinel ? null : project }
}

/** 从 storage 域读出挂载状态投影（synced 按 skill 名分组，与推导/对账同形）。 */
export async function loadState(store) {
  assertStore(store)
  const state = emptyState()
  for (const [id, record] of store.projectEntries()) {
    if (record && typeof record.path === 'string') state.projects[id] = record.path
  }
  for (const [key, record] of store.syncedEntries()) {
    const target = parseSyncedKey(key)
    if (!target || !record) continue
    const item = { app: target.app, scope: target.scope, project: target.project, ...record }
    ;(state.synced[target.name] ??= []).push(item)
  }
  return state
}

/** 把挂载状态投影写回 storage 域（synced 全量重写，projects 只增）。 */
export async function saveState(store, state) {
  assertStore(store)
  for (const [key] of store.syncedEntries()) {
    const target = parseSyncedKey(key)
    if (target) await store.deleteSynced(target.name, target)
  }
  for (const [name, records] of Object.entries(state.synced ?? {})) {
    for (const record of Array.isArray(records) ? records : []) {
      const target = { app: record.app, scope: record.scope, project: record.project ?? null }
      const { app, scope, project, ...stored } = record
      await store.putSynced(name, target, stored)
    }
  }
  for (const [id, path] of Object.entries(state.projects ?? {})) {
    if (typeof path === 'string' && path !== '') await store.putProject(id, { path })
  }
}

/**
 * 上游检查缓存（DSR-008 状态直显）：checkedAt + 按 skill 目录名的最近检查结果。
 * 只由 check/update/remove 维护；library 读取并随列表下发，页面打开不发网络请求。
 */
export async function loadCheckCache(store) {
  assertStore(store)
  const results = Object.fromEntries(store.checkEntries().map(([name, record]) => [name, record]))
  const checkedAt = Object.values(results).reduce(
    (latest, record) => (record?.checked_at > (latest ?? '') ? record.checked_at : latest),
    null,
  )
  return { checkedAt, results }
}

export async function saveCheckCache(store, cache) {
  assertStore(store)
  for (const [name] of store.checkEntries()) await store.deleteCheck(name)
  for (const [name, record] of Object.entries(cache?.results ?? {})) await store.putCheck(name, record)
}

/**
 * 将 Host 工作区实体投影成插件使用的稳定、可序列化形状。
 * `workspaceRegistry` 已提供规范化路径；这里仅拒绝缺少关键字段的服务异常，
 * 绝不从浏览器或请求体接收路径。
 */
export function normalizeWorkspaceProjects(workspaces) {
  if (!Array.isArray(workspaces)) {
    throw new SkillManagerError('workspace-unavailable', 'DSH 工作区注册表返回了无效数据')
  }
  const seen = new Set()
  return workspaces.map((workspace) => {
    const workspaceId = typeof workspace?.id === 'string' ? workspace.id : ''
    const path = typeof workspace?.path === 'string' ? workspace.path : ''
    if (workspaceId === '' || path === '') {
      throw new SkillManagerError('workspace-unavailable', 'DSH 工作区注册表缺少 id 或路径')
    }
    if (seen.has(workspaceId)) {
      throw new SkillManagerError('workspace-unavailable', `DSH 工作区注册表存在重复 id：${workspaceId}`)
    }
    seen.add(workspaceId)
    return {
      workspaceId,
      title: typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : workspaceId,
      path,
    }
  })
}

/** Windows 路径不区分大小写；此比较只用于遗留项目键到已规范化工作区的匹配。 */
function pathKey(path) {
  if (typeof path !== 'string' || path === '') return ''
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function targetKey(record) {
  return `${record.app ?? ''}|${record.scope ?? ''}|${record.project ?? ''}`
}

function dedupeSynced(synced) {
  const next = {}
  for (const [skill, records] of Object.entries(synced)) {
    if (!Array.isArray(records)) {
      next[skill] = records
      continue
    }
    const seen = new Set()
    next[skill] = records.filter((record) => {
      const key = targetKey(record)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  return next
}

function assertSafeSyncedMerge(synced) {
  for (const [skill, records] of Object.entries(synced)) {
    if (!Array.isArray(records)) continue
    const seen = new Map()
    for (const record of records) {
      const key = targetKey(record)
      const previous = seen.get(key)
      if (!previous) {
        seen.set(key, record)
        continue
      }
      const sameMethod = (previous.method ?? '') === (record.method ?? '')
      const previousDir = pathKey(previous.dir)
      const currentDir = pathKey(record.dir)
      const compatibleDir = previousDir === '' || currentDir === '' || previousDir === currentDir
      if (!sameMethod || !compatibleDir) {
        throw new SkillManagerError('workspace-migration-conflict', `Skill「${skill}」的项目同步记录无法安全合并：${key}`)
      }
    }
  }
}

/**
 * 用当前 Host 注册表刷新工作区镜像：活动键写入/更新，可按路径匹配到活动
 * 工作区的旧键归一；未匹配旧记录保留为只读遗留项。
 * @param {object} state 挂载状态投影（projects/synced）
 * @param {Array} workspaceProjects 规范化工作区列表
 * @param {Array<{group, scope, project}>} configMounts 配置意图挂载（展平），
 *        用于「N 个组使用」统计
 */
export function mirrorWorkspaceProjects(state, workspaceProjects, configMounts = []) {
  const active = normalizeWorkspaceProjects(workspaceProjects)
  const activeById = new Map(active.map((workspace) => [workspace.workspaceId, workspace]))
  const activeByPath = new Map(active.map((workspace) => [pathKey(workspace.path), workspace.workspaceId]))
  const originalProjects = state.projects && typeof state.projects === 'object' ? state.projects : {}
  const remap = new Map()

  for (const [project, path] of Object.entries(originalProjects)) {
    if (activeById.has(project) || typeof path !== 'string') continue
    const workspaceId = activeByPath.get(pathKey(path))
    if (workspaceId !== undefined) remap.set(project, workspaceId)
  }

  const remapProject = (project) => remap.get(project) ?? project
  const remappedSynced = {}
  for (const [skill, records] of Object.entries(state.synced && typeof state.synced === 'object' ? state.synced : {})) {
    remappedSynced[skill] = Array.isArray(records)
      ? records.map((record) => (
        record?.scope === 'project' && typeof record.project === 'string'
          ? { ...record, project: remapProject(record.project) }
          : record
      ))
      : records
  }

  // 合并前先检查同一目标的既有 synced 记录是否可安全合并；失败时尚未写入 state。
  assertSafeSyncedMerge(remappedSynced)

  // 先保留未匹配旧项，再覆写所有活动工作区镜像，确保 title 永不写入持久项目键。
  const projects = {}
  for (const [project, path] of Object.entries(originalProjects)) {
    if (remap.has(project) || activeById.has(project)) continue
    projects[project] = path
  }
  for (const workspace of active) projects[workspace.workspaceId] = workspace.path

  state.projects = projects
  state.synced = dedupeSynced(remappedSynced)

  const activeIds = new Set(active.map((workspace) => workspace.workspaceId))
  const mountCount = new Map(active.map((workspace) => [workspace.workspaceId, 0]))
  const syncedCount = new Map(active.map((workspace) => [workspace.workspaceId, 0]))
  const mountGroups = new Map()
  for (const mount of configMounts) {
    if (mount?.scope === 'project' && activeIds.has(mount.project)) {
      const key = `${mount.project}\0${mount.group}`
      if (!mountGroups.has(key)) {
        mountGroups.set(key, true)
        mountCount.set(mount.project, (mountCount.get(mount.project) ?? 0) + 1)
      }
    }
  }
  for (const records of Object.values(state.synced)) {
    if (!Array.isArray(records)) continue
    for (const record of records) {
      if (record?.scope === 'project' && activeIds.has(record.project)) {
        syncedCount.set(record.project, (syncedCount.get(record.project) ?? 0) + 1)
      }
    }
  }
  const workspaceSnapshot = active.map((workspace) => ({
    ...workspace,
    mountCount: mountCount.get(workspace.workspaceId) ?? 0,
    syncedCount: syncedCount.get(workspace.workspaceId) ?? 0,
  }))
  const legacyProjects = Object.entries(state.projects)
    .filter(([workspaceId, path]) => !activeIds.has(workspaceId) && typeof path === 'string')
    .map(([project, path]) => ({
      project,
      path,
      status: 'workspace-unmatched',
      mountCount: mountCount.get(project) ?? 0,
      syncedCount: Object.values(state.synced).reduce((count, records) => (
        count + (Array.isArray(records) ? records.filter((record) => record?.scope === 'project' && record.project === project).length : 0)
      ), 0),
    }))

  return {
    workspaceProjects: workspaceSnapshot,
    legacyProjects,
    workspaceIds: activeIds,
  }
}

/**
 * 全局根路径（DSH skill 根事实，挂载与同步.md）。
 * 生产环境必须传入 DSH home（Host `ctx.dshHomePath('skills')` 的解析来源），
 * 与 dsh-skill-filesystem 的 resolveDshHome 对齐；无参回退 `~/.dsh/skills`
 * 仅为纯函数测试与旧调用保留，不可用于真实物化路径。
 */
export function globalRoot(dshHome) {
  if (typeof dshHome === 'string' && dshHome !== '') return join(dshHome, 'skills')
  return join(homedir(), '.dsh', 'skills')
}

/** 工作区 Skill 根路径：<workspace.path>/.dsh/skills。 */
export function projectRootOf(state, workspaceId) {
  const path = state.projects[workspaceId]
  if (typeof path !== 'string' || path === '') return undefined
  return join(path, '.dsh', 'skills')
}
