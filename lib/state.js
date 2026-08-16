// dsh-skill-manager — 挂载状态与项目注册表（workshop-files.md state.json；mount-sync.md）。
// 只维护 app=dsh 的条目与记录；claude 等既有 App 条目只读，任何插件操作不得改动（R-04）。

import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
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

const NAME_MAX = 40
const BAD_NAME = /[/\\:*?"<>|\x00-\x1f]/

export function validateProjectName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > NAME_MAX) {
    throw new WorkshopError('bad-project-name', '项目名长度必须为 1 到 40 个字符')
  }
  if (BAD_NAME.test(name)) {
    throw new WorkshopError('bad-project-name', '项目名不能包含 / \\ : * ? " < > | 与控制字符')
  }
}

export async function validateProjectPath(path) {
  if (typeof path !== 'string' || path === '' || !isAbsolute(path)) {
    throw new WorkshopError('bad-project-path', '项目路径必须是绝对路径')
  }
  try {
    const info = await stat(path)
    if (!info.isDirectory()) throw new WorkshopError('bad-project-path', `项目路径不是目录：${path}`)
  } catch (error) {
    if (error instanceof WorkshopError) throw error
    throw new WorkshopError('bad-project-path', `项目路径不存在或不可访问：${path}`)
  }
}

/** 项目注册表操作（mount-sync.md 挂载与项目操作）。 */
export const projectOps = {
  async add(state, name, path, projectPaths) {
    validateProjectName(name)
    await validateProjectPath(path)
    if (name in state.projects) throw new WorkshopError('project-exists', `项目「${name}」已存在`)
    for (const existing of Object.values(state.projects)) {
      if (existing === path) throw new WorkshopError('project-exists', `路径已被项目注册：${path}`)
    }
    void projectPaths
    state.projects[name] = path
    return state
  },

  rename(state, oldName, newName) {
    validateProjectName(newName)
    if (!(oldName in state.projects)) throw new WorkshopError('project-not-found', `项目「${oldName}」不存在`)
    if (newName in state.projects) throw new WorkshopError('project-exists', `项目「${newName}」已存在`)
    state.projects[newName] = state.projects[oldName]
    delete state.projects[oldName]
    return state
  },

  /** 改路径：调用方必须先摘除旧位置链接（mount-sync.md），再调本函数。 */
  async changePath(state, name, path) {
    validateProjectName(name)
    if (!(name in state.projects)) throw new WorkshopError('project-not-found', `项目「${name}」不存在`)
    await validateProjectPath(path)
    for (const [other, existing] of Object.entries(state.projects)) {
      if (other !== name && existing === path) {
        throw new WorkshopError('project-exists', `路径已被项目注册：${path}`)
      }
    }
    state.projects[name] = path
    return state
  },

  remove(state, name) {
    if (!(name in state.projects)) throw new WorkshopError('project-not-found', `项目「${name}」不存在`)
    delete state.projects[name]
    return state
  },
}

/** 项目被挂载引用？供删除时级联确认（R-15）。 */
export function projectReferenced(state, name) {
  return state.mounts.some((m) => m.app === 'dsh' && m.scope === 'project' && m.project === name)
}

/** 挂载规则形状校验（mount-sync.md）；组存在性由调用方（持有分组表）校验。 */
export function validateMountShape(state, apps, mount) {
  const { group, app, scope, project } = mount
  if (typeof group !== 'string' || group === '') throw new WorkshopError('bad-mount', '挂载必须指定组')
  if (app !== 'dsh') throw new WorkshopError('bad-mount', '本插件只管理 dsh 挂载')
  if (scope !== 'global' && scope !== 'project') throw new WorkshopError('bad-mount', 'scope 只能是 global 或 project')
  if (scope === 'project') {
    if (typeof project !== 'string' || !(project in state.projects)) {
      throw new WorkshopError('bad-mount', `项目「${project}」未注册`)
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

/** 项目根路径：<项目路径>/.dsh/skills。 */
export function projectRootOf(state, name) {
  const path = state.projects[name]
  if (typeof path !== 'string' || path === '') return undefined
  return join(path, '.dsh', 'skills')
}
