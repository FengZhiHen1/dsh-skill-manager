// dsh-skill-manager — 挂载状态与 DSH 工作区兼容镜像（workshop-files.md state.json；mount-sync.md）。
// 只维护 app=dsh 的条目与记录；claude 等既有 App 条目只读，任何插件操作不得改动（R-04）。

import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { WorkshopError } from './errors.js'
import { readJson, writeJson } from './workshop.js'

const STATE_REL = 'distributor/state.json'
const APPS_REL = 'distributor/apps.json'

/** dsh App 条目（首次访问已配置车间时追加，mount-sync.md）。 */
export const DSH_APP = {
  skills_dir: '~/.dsh/skills',
  project_dir: '.dsh/skills',
  enabled: true,
}

/** state.json：缺失按空骨架；v0.1 旧格式（{"skills": …}）迁移到组挂载模型。 */
export async function loadState(root) {
  const data = await readJson(root, STATE_REL)
  if (data === null) return { projects: {}, mounts: [], synced: {}, proxy: null }
  if (typeof data !== 'object' || data === null) {
    throw new WorkshopError('workshop-corrupt', 'distributor/state.json 形状非法')
  }
  if ('skills' in data) {
    // v0.1 旧格式迁移（workshop-files.md：按 distributor 参考实现保持，仅 dsh 条目）
    return migrateLegacyState(data)
  }
  return {
    projects: typeof data.projects === 'object' && data.projects !== null ? data.projects : {},
    mounts: Array.isArray(data.mounts) ? data.mounts : [],
    synced: typeof data.synced === 'object' && data.synced !== null ? data.synced : {},
    proxy: data.proxy ?? null,
  }
}

/** v0.1 旧格式 → 组挂载模型（仅 app=dsh 条目）。 */
export function migrateLegacyState(old) {
  const synced = {}
  for (const [name, rec] of Object.entries(old.skills ?? {})) {
    const entries = []
    for (const [app, srec] of Object.entries(rec?.synced ?? {})) {
      if (app !== 'dsh') continue // 其他 App 条目只读展示，不迁移
      entries.push({
        app,
        scope: 'global',
        project: null,
        method: srec?.method ?? 'junction',
        dir: null,
      })
    }
    if (entries.length > 0) synced[name] = entries
  }
  const mounts = Object.keys(synced).length > 0
    ? [{ group: '默认', app: 'dsh', scope: 'global', project: null }]
    : []
  return { projects: {}, mounts, synced, proxy: null }
}

/** 全新 state 的默认挂载种子：dsh 启用时默认组挂载到 dsh 全局（workshop-files.md）。 */
export function defaultSeedMounts(apps) {
  if (!apps || !apps.dsh || apps.dsh.enabled === false) return []
  return [{ group: '默认', app: 'dsh', scope: 'global', project: null }]
}

/** state.json 是否缺失（区分「全新车间」与「用户清空挂载」）。 */
export async function stateFileMissing(root) {
  try {
    const info = await stat(join(root, 'distributor', 'state.json'))
    return !info.isFile()
  } catch {
    return true
  }
}

export async function saveState(root, state) {
  await writeJson(root, STATE_REL, state)
}

/** apps.json：不存在 dsh 键则追加（保持其他 App 条目原样）。 */
export async function ensureDshApp(root) {
  const data = await readJson(root, APPS_REL)
  const apps = data !== null && typeof data.apps === 'object' && data.apps !== null ? data.apps : {}
  if (apps.dsh) return data
  apps.dsh = { ...DSH_APP }
  await writeJson(root, APPS_REL, { apps })
  return { apps }
}

/**
 * 将 Host 工作区实体投影成插件使用的稳定、可序列化形状。
 * `workspaceRegistry` 已提供规范化路径；这里仅拒绝缺少关键字段的服务异常，
 * 绝不从浏览器或请求体接收路径。
 */
export function normalizeWorkspaceProjects(workspaces) {
  if (!Array.isArray(workspaces)) {
    throw new WorkshopError('workspace-unavailable', 'DSH 工作区注册表返回了无效数据')
  }
  const seen = new Set()
  return workspaces.map((workspace) => {
    const workspaceId = typeof workspace?.id === 'string' ? workspace.id : ''
    const path = typeof workspace?.path === 'string' ? workspace.path : ''
    if (workspaceId === '' || path === '') {
      throw new WorkshopError('workspace-unavailable', 'DSH 工作区注册表缺少 id 或路径')
    }
    if (seen.has(workspaceId)) {
      throw new WorkshopError('workspace-unavailable', `DSH 工作区注册表存在重复 id：${workspaceId}`)
    }
    seen.add(workspaceId)
    return {
      workspaceId,
      title: typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : workspaceId,
      path,
    }
  })
}

/** Windows 路径不区分大小写；此比较只用于旧手工项目到已规范化工作区的迁移。 */
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
        throw new WorkshopError('workspace-migration-conflict', `Skill「${skill}」的项目同步记录无法安全合并：${key}`)
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
 * 用当前 Host 注册表刷新 CLI 兼容镜像，并将旧手工键按路径原子迁移到 workspaceId。
 * 没有当前工作区匹配的旧记录保留为只读遗留项；调用方据此禁止新物化和普通摘链。
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

  // 迁移前先检查同一目标的既有 synced 记录是否可安全合并；失败时尚未写入 state。
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
  if (typeof group !== 'string' || group === '') throw new WorkshopError('bad-mount', '挂载必须指定组')
  if (app !== 'dsh') throw new WorkshopError('bad-mount', '本插件只管理 dsh 挂载')
  if (scope !== 'global' && scope !== 'project') throw new WorkshopError('bad-mount', 'scope 只能是 global 或 project')
  if (scope === 'project') {
    if (typeof project !== 'string' || !workspaceIds.has(project)) {
      throw new WorkshopError('workspace-not-found', `DSH 工作区「${project}」不存在或已移除`)
    }
  } else if (project !== undefined && project !== null) {
    throw new WorkshopError('bad-mount', 'global 挂载不能携带项目')
  }
  const appEntry = apps[app]
  if (!appEntry || appEntry.enabled === false) throw new WorkshopError('bad-mount', `App「${app}」未启用`)
  return mount
}

export function addMount(state, mount) {
  const key = (m) => `${m.group}|${m.app}|${m.scope}|${m.project ?? ''}`
  if (state.mounts.some((m) => key(m) === key(mount))) {
    throw new WorkshopError('mount-exists', '该挂载规则已存在')
  }
  state.mounts.push({ ...mount })
  return state
}

export function removeMount(state, mount) {
  const before = state.mounts.length
  state.mounts = state.mounts.filter(
    (m) => !(m.group === mount.group && m.app === mount.app && m.scope === mount.scope && (m.project ?? '') === (mount.project ?? '')),
  )
  if (state.mounts.length === before) throw new WorkshopError('mount-not-found', '挂载规则不存在')
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
