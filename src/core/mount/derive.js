// dsh-skill-manager — 挂载推导与工作区投影（挂载与同步.md「DSH skill 根与工作区事实」
// 「工作区投影」「挂载推导」；DSR-015 mount 层，DSR-017 junction-only 收敛）。
//
// 纯函数域：settings 意图（groups 挂载规则展平 + skills 组归属/禁用）与当前
// 工作区投影进来，期望集 {skill -> [target]} 出去；不落 storage、不碰文件系统。
// 目标只有 dsh 一个应用（app 字段随 synced 表退役，DSR-017）；工作区信息每次
// 现算自 workspaceRegistry 投影，无镜像归一（mirrorWorkspaceProjects 已删除）。

import { join } from 'node:path'
import { SkillManagerError } from '../base/errors.js'
import { DEFAULT_GROUP } from '../model/intent.js'

/** 挂载目标键（对账结果、行状态与 UI 共用）。global 的 project 归一为 'global' 段。 */
export const targetKey = (t) => `${t.scope}|${t.project ?? 'global'}`

/**
 * 全局 skill 根（挂载与同步.md）：真实路径一律由 Host 经
 * `ctx.dshHomePath('skills')` 注入为 globalRootPath；此无参回退
 * `~/.dsh/skills` 仅为纯函数测试保留，不得用于真实物化路径。
 */
export function globalRoot(globalRootPath) {
  if (typeof globalRootPath === 'string' && globalRootPath !== '') return globalRootPath
  return join('~', '.dsh', 'skills')
}

/** 活动工作区投影 → { workspaceId -> {workspaceId, title, path} }（重复/缺段以 workspace-unavailable 拒绝）。 */
export function projectWorkspaces(list) {
  const byId = new Map()
  for (const ws of Array.isArray(list) ? list : []) {
    const workspaceId = typeof ws?.id === 'string' ? ws.id : ''
    const path = typeof ws?.path === 'string' ? ws?.path : ''
    if (workspaceId === '' || path === '') {
      throw new SkillManagerError('workspace-unavailable', '工作区注册表返回了缺少 id 或 path 的条目', true, [
        { label: '异常条目形状', value: JSON.stringify(ws) },
      ])
    }
    if (byId.has(workspaceId)) {
      throw new SkillManagerError('workspace-unavailable', `工作区注册表返回了重复 id：${workspaceId}`, true, [
        { label: '重复的工作区 id', value: workspaceId },
      ])
    }
    byId.set(workspaceId, {
      workspaceId,
      title: typeof ws?.title === 'string' && ws.title !== '' ? ws.title : workspaceId,
      path,
    })
  }
  return byId
}

/** 一个目标对应的实际目录（含工作区缺失/根未注入时返回 undefined）。 */
export function targetDir(t, { workspacesById, globalRootPath }) {
  if (t.scope === 'global') {
    return typeof globalRootPath === 'string' && globalRootPath !== '' ? globalRootPath : undefined
  }
  const ws = t.project == null ? undefined : workspacesById.get(t.project)
  return ws === undefined ? undefined : join(ws.path, '.dsh', 'skills')
}

/**
 * 挂载推导（挂载与同步.md「挂载推导」）。
 * @param {object} input
 * @param {Map<string,string>} input.memberships 参与推导的 skill（未禁用未缺失）：dir → 组名
 * @param {Array<{group,scope,project}>} input.mounts settings 意图展平出的挂载规则
 * @param {Map<string,object>} input.workspacesById 活动工作区投影
 * @param {string} input.globalRootPath Host 注入的全局根
 * @returns {{ desired: Map<string, Array<{scope, project}>>, warnings: string[] }}
 */
export function deriveDesired({ memberships, mounts, workspacesById, globalRootPath }) {
  const warnings = []
  const flatMounts = Array.isArray(mounts) ? mounts : []
  // 失效工作区引用报告（R-12）：与组内是否有成员无关，先按规则全集报，按文案去重。
  const seenWarnings = new Set()
  for (const m of flatMounts) {
    if (m?.scope === 'project' && typeof m.project === 'string' && m.project !== '' && !workspacesById.has(m.project)) {
      const warning = `未匹配工作区：组「${m.group}」引用的工作区 ${m.project} 不在当前投影中`
      if (!seenWarnings.has(warning)) {
        seenWarnings.add(warning)
        warnings.push(warning)
      }
    }
  }
  const desired = new Map()
  for (const skill of memberships.keys()) {
    const group = memberships.get(skill) ?? DEFAULT_GROUP
    const targets = []
    for (const m of flatMounts) {
      if (m?.group !== group) continue
      const scope = m.scope === 'project' ? 'project' : m.scope === 'global' ? 'global' : null
      if (scope === null) continue // 形状非法的挂载项：跳过（对账容忍）
      if (typeof m.project !== 'string' || m.project === '') {
        if (scope === 'global') {
          if (!targets.some((t) => targetKey(t) === targetKey({ scope, project: null }))) targets.push({ scope, project: null })
        }
        continue // project 作用域缺 project 键：非法，跳过
      }
      if (scope === 'project' && !workspacesById.has(m.project)) continue // 失效引用不产生期望目标（上方已报告）
      const t = { scope, project: scope === 'project' ? m.project : null }
      if (!targets.some((x) => targetKey(x) === targetKey(t))) targets.push(t)
    }
    desired.set(skill, targets)
  }
  return { desired, warnings }
}
