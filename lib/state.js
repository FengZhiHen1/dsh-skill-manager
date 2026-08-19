// dsh-skill-manager — 挂载状态与 DSH 工作区镜像（storage-model.md 域表；mount-sync.md）。
// 只维护 app=dsh 的条目与记录（R-04）；状态全部经 store 门面读写 storage 域。

import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { SkillManagerError } from './errors.js'

/** dsh App 条目语义（mount-sync.md「dsh App 语义」）。 */
export const DSH_APP = {
  skills_dir: '~/.dsh/skills',
  project_dir: '.dsh/skills',
  enabled: true,
}

const emptyState = () => ({ projects: {}, mounts: [], synced: {}, proxy: null })

function assertStore(store) {
  if (!store || typeof store.projectEntries !== 'function' || typeof store.mountEntries !== 'function') {
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
  state.mounts = store.mountEntries().map(([, record]) => ({ ...record }))
  for (const [key, record] of store.syncedEntries()) {
    const target = parseSyncedKey(key)
    if (!target || !record) continue
    const item = { app: target.app, scope: target.scope, project: target.project, ...record }
    ;(state.synced[target.name] ??= []).push(item)
  }
  return state
}

/** 把挂载状态投影写回 storage 域（mounts/synced 全量重写，projects 只增）。 */
export async function saveState(store, state) {
  assertStore(store)
  for (const [, mount] of store.mountEntries()) await store.deleteMount(mount)
  for (const mount of Array.isArray(state.mounts) ? state.mounts : []) {
    await store.putMount({ ...mount, project: mount.project ?? null })
  }
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
 * 全新域的默认挂载种子：域完全为空（无 skill、无组、无挂载）时补一条
 * 「默认 组 → dsh 全局」规则，使首个入库的 skill 开箱即生效；一旦域内
 * 有任何内容（含用户清空挂载后仍有 skill 的现场）不再种子。
 */
export async function ensureSeedMounts(store) {
  assertStore(store)
  if (store.skillEntries().length > 0 || store.groupEntries().length > 0 || store.mountEntries().length > 0) return
  await store.putMount({ group: '默认', app: 'dsh', scope: 'global', project: null })
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

function dedupeMounts(mounts) {
  const seen = new Set()
  return mounts.filter((mount) => {
    const key = `${mount?.group ?? ''}|${mount?.app ?? ''}|${mount?.scope ?? ''}|${mount?.project ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

/**
 * 用当前 Host 注册表刷新工作区镜像：活动键写入/更新，可按路径匹配到活动
 * 工作区的旧键归一；未匹配旧记录保留为只读遗留项。
 */
export function mirrorWorkspaceProjects(state, workspaceProjects) {
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
  const remappedMounts = (Array.isArray(state.mounts) ? state.mounts : []).map((mount) => (
    mount?.scope === 'project' && typeof mount.project === 'string'
      ? { ...mount, project: remapProject(mount.project) }
      : mount
  ))
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
  state.mounts = dedupeMounts(remappedMounts)
  state.synced = dedupeSynced(remappedSynced)

  const activeIds = new Set(active.map((workspace) => workspace.workspaceId))
  const mountCount = new Map(active.map((workspace) => [workspace.workspaceId, 0]))
  const syncedCount = new Map(active.map((workspace) => [workspace.workspaceId, 0]))
  for (const mount of state.mounts) {
    if (mount?.scope === 'project' && activeIds.has(mount.project)) {
      mountCount.set(mount.project, (mountCount.get(mount.project) ?? 0) + 1)
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
      mountCount: state.mounts.filter((mount) => mount?.scope === 'project' && mount.project === project).length,
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

/** 挂载规则形状校验（mount-sync.md）；组存在性由调用方（持有分组表）校验。 */
export function validateMountShape(state, apps, mount, workspaceIds = new Set(Object.keys(state.projects ?? {}))) {
  const { group, app, scope, project } = mount
  if (typeof group !== 'string' || group === '') throw new SkillManagerError('bad-mount', '挂载必须指定组')
  if (app !== 'dsh') throw new SkillManagerError('bad-mount', '本插件只管理 dsh 挂载')
  if (scope !== 'global' && scope !== 'project') throw new SkillManagerError('bad-mount', 'scope 只能是 global 或 project')
  if (scope === 'project') {
    if (typeof project !== 'string' || !workspaceIds.has(project)) {
      throw new SkillManagerError('workspace-not-found', `DSH 工作区「${project}」不存在或已移除`)
    }
  } else if (project !== undefined && project !== null) {
    throw new SkillManagerError('bad-mount', 'global 挂载不能携带项目')
  }
  const appEntry = apps[app]
  if (!appEntry || appEntry.enabled === false) throw new SkillManagerError('bad-mount', `App「${app}」未启用`)
  return mount
}

export function addMount(state, mount) {
  const key = (m) => `${m.group}|${m.app}|${m.scope}|${m.project ?? ''}`
  if (state.mounts.some((m) => key(m) === key(mount))) {
    throw new SkillManagerError('mount-exists', '该挂载规则已存在')
  }
  state.mounts.push({ ...mount })
  return state
}

export function removeMount(state, mount) {
  const before = state.mounts.length
  state.mounts = state.mounts.filter(
    (m) => !(m.group === mount.group && m.app === mount.app && m.scope === mount.scope && (m.project ?? '') === (mount.project ?? '')),
  )
  if (state.mounts.length === before) throw new SkillManagerError('mount-not-found', '挂载规则不存在')
  return state
}

/** 全局根路径：~/.dsh/skills（DSH skill 根事实，mount-sync.md）。 */
export function globalRoot() {
  return join(homedir(), '.dsh', 'skills')
}

/** 工作区 Skill 根路径：<workspace.path>/.dsh/skills。 */
export function projectRootOf(state, workspaceId) {
  const path = state.projects[workspaceId]
  if (typeof path !== 'string' || path === '') return undefined
  return join(path, '.dsh', 'skills')
}
