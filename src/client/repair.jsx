// dsh-skill-manager — 修复提示词统一组件（DSR-018 / R-17 / AC-15；插件运行时.md L186）。
// 三处呈现面共用：RPC 操作失败（Host 下发 repair facts）、settings 校验拒绝（本地上下文）、
// 行状态「挂载失败」展开面（本地现场）。文案模板归 Client（刷新即生效），Host 只供事实。
import { useState, useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { T } from './theme.js'

/** 剪贴板写入（clipboard API 失败回退 execCommand）。 */
export function copyText(text) {
  const fallback = () => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* 忽略 */ }
    document.body.removeChild(ta)
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(fallback)
  } else {
    fallback()
  }
}

/** repair 为 null（transport 失败等）时的本地兜底 facts：保证任何失败都有复制入口。 */
export function fallbackRepair({ operation = 'unknown', code = 'internal', message = '' } = {}) {
  const transport = code === 'transport'
  return {
    operation,
    summary: transport
      ? '与 Host 的 RPC 通道失败：请求未能送达或应答无法解析（可能未认证、被围栏拒绝或实例失联）。'
      : `操作失败（${code}）。`,
    facts: message ? [{ label: '通道错误', value: message }] : [],
    recommendation: transport
      ? ['刷新页面后重试一次（客户端与 Host 版本可能不一致）', '确认 DSH 实例仍在运行且本插件已加载', '把本提示词交给本地 Agent：只读检查插件加载日志与 settings.yaml 的 skill-manager 段']
      : ['先原样重试一次（偶发失败可能自行恢复）', '仍失败时把本提示词交给本地 Agent：只读排查上下文涉及的路径与配置；任何写操作须先向用户确认'],
  }
}

/**
 * 统一模板组装完整修复提示词（纯文本，交本地 Agent 使用）。
 * @param {{ root?: string, code?: string, message?: string, repair?: object|null }} input
 */
export function buildRepairPrompt({ root, code, message, repair }) {
  const r = repair && typeof repair === 'object' ? repair : fallbackRepair({ operation: code, code, message })
  const lines = [
    `任务：修复 DSH 插件 dsh-skill-manager 的操作失败（${r.operation || code || 'unknown'}）。`,
    '',
    `错误码：${code || r.operation || 'unknown'}`,
    `错误消息：${message || r.summary || '（无）'}`,
    `问题概述：${r.summary || '（无）'}`,
    `配置目录（skillsDir）：${root || '（未知，请从 $DSH_HOME/settings.yaml 的 skill-manager 段读取）'}`,
    '',
    '上下文清单：',
  ]
  const facts = Array.isArray(r.facts) ? r.facts : []
  if (facts.length === 0) lines.push('- （无附加事实）')
  for (const f of facts) lines.push(`- ${f.label}：${f.value}`)
  const rec = Array.isArray(r.recommendation) ? r.recommendation : []
  if (rec.length > 0) {
    lines.push('', '推荐处理方案：')
    rec.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
  }
  lines.push('', '要求：排查仅做只读检查；任何写/删操作前必须先向用户确认方案。')
  return lines.join('\n')
}

/** 一键复制按钮：复制成功短暂回显「已复制」。 */
export function RepairCopy({ text, label = '复制修复提示词' }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => { copyText(text); setCopied(true) }}
      style={{ fontSize: 11, padding: '2px 8px', whiteSpace: 'nowrap' }}
    >
      {copied ? '已复制' : label}
    </Button>
  )
}

/** 行状态「挂载失败」的本地 repair facts（行级现场 Host 不下发 repair 对象，事实由 Client 组装）。 */
export const MOUNT_ISSUE_META = {
  'link-missing': {
    summary: '期望的挂载链接缺失：对账未能在该目标建立 junction。',
    recommendation: ['确认目标根目录可写（DSH 全局根或工作区 .dsh/skills）', '点工具条「↻ 刷新」再触发一次对账', '持续失败时把本提示词交给本地 Agent 只读排查目标卷与权限'],
  },
  'target-occupied': {
    summary: '挂载目标被真实目录占用（含旧版本复制物化的遗留）；按只读红线插件不触碰它。',
    recommendation: ['打开占用目录确认内容：旧版残留或一次性目录，自行备份后删除', '删除后点「↻ 刷新」触发对账，空闲目标自动重建 junction', '若是有意保留的本地遮蔽版本，可不处理——DSH 以项目内本地版为准'],
  },
  'wrong-target': {
    summary: '挂载目标是链接但指向库外；视为他人资产，不夺取。',
    recommendation: ['确认该链接用途；确属残留再手工删除，然后点「↻ 刷新」对账重建', '指向本库内他处的旧链接会在对账时自动摘除重建，无需人工'],
  },
  'orphan-link': {
    summary: '存在指向本配置目录、但已不在挂载期望集中的链接（分组移除/禁用/出库后残留对账未收敛，或跨库改配的孤儿）。',
    recommendation: ['点「↻ 刷新」触发对账：归属本插件且不在期望集的链接会被自动摘除', '改配过 skillsDir 时旧库链接按约定保留为孤儿，可手工清理'],
  },
}

/** 组装行级/孤儿挂载现场的 repair facts（与 Host buildRepair 同形状，前端模板）。 */
export function mountIssueRepair(issue, { name, targetLabel, path, root }) {
  const meta = MOUNT_ISSUE_META[issue] || { summary: `挂载状态异常（${issue}）。`, recommendation: ['点「↻ 刷新」重试对账', '把本提示词交给本地 Agent 只读排查'] }
  const facts = [
    { label: 'Skill', value: String(name ?? '') },
    { label: '目标', value: String(targetLabel ?? issue ?? '') },
  ]
  if (path) facts.push({ label: '现场路径', value: String(path) })
  if (root) facts.push({ label: '配置目录', value: String(root) })
  return { operation: 'mount-inspect', summary: meta.summary, facts, recommendation: meta.recommendation }
}

/** settings 校验被拒的本地 repair facts（DSR-018：该呈现面 Host 不参与，上下文在 Client 手里）。 */
export function settingsRejectedRepair(field, attempted, current, root) {
  return {
    operation: 'settings.set',
    summary: `配置「${field}」被 settings 校验拒绝，已回滚为当前值。`,
    facts: [
      { label: '被拒绝的字段', value: String(field) },
      { label: '尝试写入的值', value: JSON.stringify(attempted ?? null) },
      { label: '当前生效的值', value: JSON.stringify(current ?? null) },
      { label: '配置目录', value: String(root || '（未配置）') },
    ],
    recommendation: [
      '组名：1–30 字符，「默认」「全部」为保留字，不含 / \\ : * ? " < > | 与控制字符',
      'skillsDir：非空时必须是绝对路径',
      '请检查 $DSH_HOME/settings.yaml 的 skill-manager 段与插件 src/core/model/intent.js 的 validate 规则，修正后重试',
    ],
  }
}
