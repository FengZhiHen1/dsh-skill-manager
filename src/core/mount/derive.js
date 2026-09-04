// dsh-skill-manager — 挂载推导（挂载与同步.md「挂载推导」；DSR-015 mount 层）。
// 自原 lib/sync.js 搬位（P1，逻辑未动）。activeWorkspaceIds/isLegacyProjectRecord/
// linkLocations 原为模块内私有 helper，因拆分供 mount 兄弟模块使用而导出。

import { resolve } from 'node:path'
import { globalRoot, projectRootOf } from '../model/state.js'

export const targetKey = (t) => `${t.app}|${t.scope}|${t.project ?? ''}`

/** 未显式传入时保留旧的纯函数调用语义；Host API 始终传入本次 workspaceRegistry 投影。 */
export function activeWorkspaceIds(state, workspaceIds) {
  if (workspaceIds instanceof Set) return workspaceIds
  if (Array.isArray(workspaceIds)) return new Set(workspaceIds)
  return new Set(Object.keys(state.projects ?? {}))
}

export function isLegacyProjectRecord(state, record, workspaceIds) {
  return record?.scope === 'project'
    && typeof record.project === 'string'
    && typeof state.projects?.[record.project] === 'string'
    && !workspaceIds.has(record.project)
}

/** 目标挂载点父目录（dsh 全局根或项目根）；项目路径缺失返回 undefined。 */
export function targetDirOf(state, apps, t, workspaceIds, globalRootPath) {
  if (t.app !== 'dsh') return undefined
  if (t.scope === 'global') return globalRootPath ?? globalRoot()
  if (!activeWorkspaceIds(state, workspaceIds).has(t.project ?? '')) return undefined
  const root = projectRootOf(state, t.project ?? '')
  if (root === undefined) return undefined
  const app = apps.dsh
  if (!app || typeof app.project_dir !== 'string') return undefined
  return resolve(root)
}

/** 挂载推导：{skill -> [target]} + warnings（挂载与同步.md 挂载推导）。 */
export function deriveDesired({ state, apps, groups, skills, mounts, workspaceIds }) {
  const warnings = []
  const out = new Map()
  const activeIds = activeWorkspaceIds(state, workspaceIds)
  const legacyProjectIds = new Set(Object.keys(state.projects ?? {}).filter((project) => !activeIds.has(project)))
  const groupOf = new Map()
  for (const [group, members] of Object.entries(groups)) {
    for (const m of members) groupOf.set(m, group)
  }
  for (const skill of skills) {
    const gname = groupOf.get(skill) ?? '默认'
    const targets = []
    for (const m of mounts ?? []) {
      if (m.group !== gname) continue
      const app = m.app
      if (app !== 'dsh' || !apps[app] || apps[app].enabled === false) {
        warnings.push(`挂载引用的 App 未启用或不存在: ${app}（组 ${gname}）`)
        continue
      }
      if (m.scope === 'project' && !activeIds.has(m.project)) {
        const label = legacyProjectIds.has(m.project) ? '未匹配工作区' : '不存在的工作区'
        warnings.push(`挂载引用${label}: ${m.project}（组 ${gname}）`)
        continue
      }
      const t = { app, scope: m.scope, project: m.scope === 'project' ? m.project : null }
      if (!targets.some((x) => targetKey(x) === targetKey(t))) targets.push(t)
    }
    out.set(skill, targets)
  }
  return { desired: out, warnings: [...new Set(warnings)], legacyProjectIds, workspaceIds: activeIds }
}

/** 所有可由普通对账触碰的父目录（dsh 全局根 + 当前活动工作区根）。 */
export function linkLocations(state, workspaceIds, globalRootPath) {
  const dirs = [globalRootPath ?? globalRoot()]
  for (const workspaceId of activeWorkspaceIds(state, workspaceIds)) {
    const root = projectRootOf(state, workspaceId)
    if (root !== undefined) dirs.push(root)
  }
  return dirs
}
