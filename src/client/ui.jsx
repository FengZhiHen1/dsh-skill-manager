// dsh-skill-manager — Client 通用 UI 基元与对话框（插件运行时.md「视图设计」：⋯ 行菜单 DSR-008、遮罩对话框语言）。
// 按钮/输入复用 ui-primitives 原子组件；icon 为可选装饰，缺失时降级文本箭头，绝不让整卡渲染失败。
import { useState } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { T, badgeStyle } from './theme.js'

/** 防御：icon 为可选装饰，缺失时降级为文本箭头，绝不让整卡渲染失败。 */
export const ChevronIcon = typeof primitives.IconChevronDownOutline14 === 'function' ? primitives.IconChevronDownOutline14 : null

/** 行内次要按钮（ghost sm）。 */
export const GhostBtn = (props) => <Button variant="ghost" size="sm" {...props} />
/** 行内主操作按钮（outline sm）。 */
export const OutlineBtn = (props) => <Button variant="outline" size="sm" {...props} />

export function ErrorLine({ error }) {
  if (!error) return null
  return <div style={{ color: T.error, fontSize: 12, padding: '6px 8px' }}>{String(error.message || error)}</div>
}

export function useTick() {
  const [tick, setTick] = useState(0)
  return [tick, () => setTick((t) => t + 1)]
}

/** 菜单项：hover 高亮，支持悬停展开子菜单。 */
export function MenuItem({ label, danger, disabled, onClick, onEnter, trailing, children }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        padding: '7px 12px',
        borderRadius: 6,
        fontSize: 12,
        whiteSpace: 'nowrap',
        cursor: disabled ? 'default' : 'pointer',
        color: danger ? T.error : T.labelPrimary,
        background: hover && !disabled ? T.bgModulePlatform : 'transparent',
      }}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => { setHover(true); if (onEnter) onEnter() }}
      onMouseLeave={() => setHover(false)}
    >
      <span>{label}</span>
      {trailing || null}
      {children}
    </div>
  )
}

export const menuCardStyle = {
  position: 'absolute',
  zIndex: 41,
  minWidth: 150,
  background: T.bgLayer3,
  border: `1px solid ${T.borderL2}`,
  borderRadius: 12,
  boxShadow: '0 8px 24px rgba(0,0,0,.18)',
  padding: 6,
}
export const menuDivider = <div style={{ height: 1, margin: '5px 6px', background: T.borderL2 }} />

/**
 * 行操作 ⋯ 菜单，按来源分化（DSR-017/插件运行时.md L207）：
 * - github 行：立即更新 / 禁用|启用 / 移动到分组 ▸ / 删除（红色）；
 * - github 缺失行：恢复 / 删除（红色）；
 * - 自有（self/local）行：禁用|启用 / 移动到分组 ▸ ——无更新（无上游）、无删除（C-03 只读红线）。
 */
export function RowMenu({ it, groupNames, busy, onAction, onMove, onClose }) {
  const [subOpen, setSubOpen] = useState(false)
  const current = it.group || '默认'
  const allGroups = [...new Set([...groupNames, '默认'])]
  const external = it.origin === 'github'
  const pick = (group) => {
    if (group !== current) onMove(group)
    onClose()
  }
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onClose} />
      <div style={{ ...menuCardStyle, right: 4, top: 'calc(100% - 6px)' }}>
        {it.missing ? (
          <MenuItem label="恢复" disabled={busy} onClick={() => { onClose(); onAction('update') }} />
        ) : (
          <>
            {external && !it.disabled && <MenuItem label="立即更新" disabled={busy} onClick={() => { onClose(); onAction('update') }} />}
            {it.disabled
              ? <MenuItem label="启用" disabled={busy} onClick={() => { onClose(); onAction('enable') }} />
              : <MenuItem label="禁用" disabled={busy} onClick={() => { onClose(); onAction('disable') }} />}
          </>
        )}
        {!it.missing && menuDivider}
        {!it.missing && (
          <MenuItem
            label="移动到分组"
            disabled={busy}
            onEnter={() => setSubOpen(true)}
            onClick={() => setSubOpen((v) => !v)}
            trailing={<span style={{ color: T.labelSecondary }}>▸</span>}
          >
            {subOpen && (
              <div style={{ ...menuCardStyle, right: '100%', top: -7, marginRight: 6, minWidth: 124, zIndex: 42 }}>
                {allGroups.map((group) => (
                  <div
                    key={group}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '7px 12px', borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer',
                      color: group === current ? T.labelPrimary : T.labelSecondary,
                      fontWeight: group === current ? 500 : 400,
                    }}
                    onClick={(event) => { event.stopPropagation(); pick(group) }}
                  >
                    <span style={{ width: 12, color: T.labelPrimary }}>{group === current ? '✓' : ''}</span>
                    {group}
                  </div>
                ))}
              </div>
            )}
          </MenuItem>
        )}
        {external && (
          <>
            {menuDivider}
            <MenuItem label="删除" danger disabled={busy} onClick={() => { onClose(); onAction('remove') }} />
          </>
        )}
      </div>
    </>
  )
}

/** 遮罩对话框外壳（新建分组与更新确认共用同一遮罩语言）。 */
export function ModalShell({ title, width = 480, onMaskClick, children }) {
  return (
    <div
      role="presentation"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 17, 21, .42)', padding: 20 }}
      onClick={onMaskClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: `min(${width}px, 100%)`, borderRadius: 16, border: `1px solid ${T.borderL2}`, background: T.bgLayer3, color: T.labelPrimary, boxShadow: '0 18px 48px rgba(0,0,0,.28)', padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

/** 覆盖本地修改的真实遮罩对话框；不用 window.confirm，确保风险与操作范围可见。 */
export function UpdateConfirmationDialog({ name, detail, busy, onCancel, onConfirm }) {
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <ModalShell title={`更新 ${name}？`} onMaskClick={onCancel}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{`更新 ${name}？`}</div>
      <div style={{ color: T.labelSecondary, fontSize: 13, lineHeight: 1.55, marginBottom: 12 }}>{detail || '检测到与内容基线不同的本地修改。'}</div>
      <div style={{ borderRadius: 10, padding: '10px 12px', marginBottom: 14, ...badgeStyle(T.warn), fontSize: 12, lineHeight: 1.55 }}>
        更新会替换此 Skill 目录；不会自动备份本地修改。请先自行备份需要保留的内容。
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.labelSecondary, marginBottom: 16, cursor: 'pointer' }}>
        <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        <span style={{ color: T.labelPrimary }}>我已确认覆盖本地修改；继续后会刷新上游基线与 DSH 挂载。</span>
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <OutlineBtn onClick={onCancel} disabled={busy}>取消</OutlineBtn>
        <Button size="sm" onClick={onConfirm} disabled={busy || !acknowledged}>{busy ? '更新中…' : '继续更新'}</Button>
      </div>
    </ModalShell>
  )
}
