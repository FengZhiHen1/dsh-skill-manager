// derive — 挂载推导与工作区投影：settings 意图与工作区投影进，期望集 {skill -> [target]} 出。
//
// 边界：纯函数域，不落 storage、不碰文件系统；目标宿主为 dsh / pi 两个（pi 根不可用时其目标不产期望）。
// 工作区信息每次现算自 workspaceRegistry 投影，不做镜像归一。
// 参考：挂载与同步.md「DSH skill 根与工作区事实」「工作区投影」「挂载推导」；DSR-015、DSR-017、DSR-019。

import { join } from 'node:path'
import { SkillManagerError } from '../base/errors.js'
import { DEFAULT_GROUP, DEFAULT_HOSTS, HOSTS } from '../model/intent.js'

/** 挂载目标键（对账结果、行状态与 UI 共用）：`host:scope|project`，global 的 project 归一为 'global' 段。 */
export const targetKey = (t) => `${t.host ?? 'dsh'}:${t.scope}|${t.project ?? 'global'}` // quality-floor: ignore docstring-promise 箭头函数体无 throw（纯模板拼接）；扫描器把后续函数的 throw 误挂到本符号

/**
 * 活动工作区投影 → { workspaceId -> {workspaceId, title, path} }。
 * @throws {SkillManagerError} workspace-unavailable — 条目缺 id/path 或重复 id（注册表异常形状）
 */
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

/**
 * 一个目标对应的实际目录（含工作区缺失/根未注入时返回 undefined）。
 * dsh：global → Host 注入的 $DSH_HOME/skills；project → <工作区>/.dsh/skills。
 * pi ：global → 探测/配置出的 <piAgentDir>/skills；project → <工作区>/.pi/skills。
 * piSkillsRoot 为 null（pi 不可用）时 pi 全局目标无目录。
 */
export function targetDir(t, { workspacesById, globalRootPath, piSkillsRoot = null }) {
  const host = t.host ?? 'dsh'
  if (t.scope === 'global') {
    if (host === 'pi') return typeof piSkillsRoot === 'string' && piSkillsRoot !== '' ? piSkillsRoot : undefined
    return typeof globalRootPath === 'string' && globalRootPath !== '' ? globalRootPath : undefined
  }
  const ws = t.project == null ? undefined : workspacesById.get(t.project)
  return ws === undefined ? undefined : join(ws.path, host === 'pi' ? '.pi' : '.dsh', 'skills')
}

/**
 * 挂载推导：把组的挂载规则按宿主展开应用到组内每个 skill，产出期望集与失效引用告警。
 * hosts 缺省回落 ['dsh']（存量兼容）；pi 宿主在 pi 根不可用时跳过并按组告警一次。
 * @param {object} input
 * @param {Map<string,string>} input.memberships 参与推导的 skill（未禁用未缺失）：dir → 组名
 * @param {Array<{group,scope,project,hosts?}>} input.mounts settings 意图展平出的挂载规则
 * @param {Map<string,object>} input.workspacesById 活动工作区投影
 * @param {string} input.globalRootPath Host 注入的全局根
 * @param {string|null} input.piSkillsRoot pi 用户级 skills 根；null = pi 不可用
 * @returns {{ desired: Map<string, Array<{host, scope, project}>>, warnings: string[] }}
 */
export function deriveDesired({ memberships, mounts, workspacesById, globalRootPath, piSkillsRoot = null }) {
  const warnings = []
  const flatMounts = Array.isArray(mounts) ? mounts : []
  const piAvailable = typeof piSkillsRoot === 'string' && piSkillsRoot !== ''
  // 失效引用报告：与组内是否有成员无关，先按规则全集报，按文案去重。
  const seenWarnings = new Set()
  const warnOnce = (warning) => {
    if (!seenWarnings.has(warning)) {
      seenWarnings.add(warning)
      warnings.push(warning)
    }
  }
  for (const m of flatMounts) {
    if (m?.scope === 'project' && typeof m.project === 'string' && m.project !== '' && !workspacesById.has(m.project)) {
      warnOnce(`未匹配工作区：组「${m.group}」引用的工作区 ${m.project} 不在当前投影中`)
    }
    if (!piAvailable && Array.isArray(m?.hosts) && m.hosts.includes('pi')) {
      warnOnce(`pi 不可用：组「${m.group}」的 pi 挂载未生效（未勾选接管或探测不到 pi，可在插件卡片勾选接管 pi agent）`)
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
        if (scope !== 'global') continue // project 作用域缺 project 键：非法，跳过
      } else if (scope === 'project' && !workspacesById.has(m.project)) continue // 失效引用不产生期望目标（上方已报告）
      // 宿主展开：hosts 缺省回落 ['dsh']；全部非法或为空 = 死规则，跳过（写路径已拦，对账容忍）
      const hosts = (Array.isArray(m.hosts) ? m.hosts : DEFAULT_HOSTS).filter((h) => HOSTS.includes(h))
      for (const host of hosts) {
        if (host === 'pi' && !piAvailable) continue // 上方已按组报告
        const t = { host, scope, project: scope === 'project' ? m.project : null }
        if (!targets.some((x) => targetKey(x) === targetKey(t))) targets.push(t)
      }
    }
    desired.set(skill, targets)
  }
  return { desired, warnings }
}
