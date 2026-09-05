// dsh-skill-manager — Client 通用 UI 基元与对话框（插件运行时.md「视图设计」：⋯ 行菜单 DSR-008、遮罩对话框语言）。
// 按钮/输入复用 ui-primitives 原子组件；icon 为可选装饰，缺失时降级文本箭头，绝不让整卡渲染失败。
import { useEffect, useRef, useState } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { T, S, badgeStyle, dotStyle } from './theme.js'

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

/**
 * 操作结果通知条（tone 双态）：ok = 灰字一行；warn = 琥珀警示卡（与非行级警告条
 * 同一视觉语言）。批量语义下单条 skipped/失败必须经 warn 态上屏——历史上只进
 * muted 灰字，用户在长列表里等于无反馈（2026-09-05 走查反馈）。
 * @param {{ notice: {tone: 'ok'|'warn', text: string}|null }} props
 */
export function NoticeBar({ notice }) {
  if (!notice) return null
  if (notice.tone !== 'warn') return <div style={{ ...S.muted, marginBottom: 6 }}>{notice.text}</div>
  return (
    <div style={{ ...badgeStyle(T.warn), borderRadius: 10, padding: '9px 12px', marginBottom: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={dotStyle(T.warn)} />
      <span style={{ flex: 1 }}>{notice.text}</span>
    </div>
  )
}

export function useTick() {
  const [tick, setTick] = useState(0)
  return [tick, () => setTick((t) => t + 1)]
}

/** 菜单项：hover 高亮；onEnter/onClick 回传自身 rect（子菜单 fixed 定位锚点）。 */
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
      onClick={disabled ? undefined : (event) => onClick?.(event.currentTarget.getBoundingClientRect())}
      onMouseEnter={(event) => { setHover(true); if (onEnter) onEnter(event.currentTarget.getBoundingClientRect()) }}
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
 *
 * 浮层几何（2026-09-05 走查修复）：主/子菜单一律 position:fixed、锚定触发按钮
 * rect（triggerRect）。此前 absolute 锚在行卡上——宿主设置面板是定高
 * overflow:hidden 容器（.panel），分组过多时菜单超出面板底边被裁掉，且滚动时
 * 浮层随行卡移动，被裁部分永远滚不到。fixed 逃逸裁剪与滚动流：近底自动向上翻、
 * 近左自动向右翻、max-height 按可用空间封顶 + 内部滚动；任何外层滚动/缩放即
 * 关闭（trigger rect 失效，浮层不跟随文档流）。
 */
export function RowMenu({ it, groupNames, busy, onAction, onMove, onClose, triggerRect }) {
  const menuRef = useRef(null)
  const [sub, setSub] = useState(null) // {rect}：「移动到分组」项 rect，悬停/点击展开；null 收起
  useEffect(() => {
    // scroll 不冒泡，capture 才能捕获任意滚动容器（宿主 .options 等）。
    const onScroll = (event) => {
      if (menuRef.current && menuRef.current.contains(event.target)) setSub(null) // 主菜单内部滚动：子菜单不跟随，收起
      else onClose() // 外层滚动：trigger rect 失效
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [])
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 主菜单：右缘对齐触发按钮；下方空间足够则向下开，否则向上翻，高度按可用空间封顶。
  const spaceBelow = vh - triggerRect.bottom - 12
  const spaceAbove = triggerRect.top - 12
  const dropDown = spaceBelow >= Math.min(260, spaceAbove)
  const menuStyle = {
    ...menuCardStyle,
    position: 'fixed',
    right: Math.max(8, vw - triggerRect.right),
    maxHeight: Math.max(160, dropDown ? spaceBelow : spaceAbove),
    overflowY: 'auto',
    ...(dropDown ? { top: triggerRect.bottom + 6 } : { bottom: vh - triggerRect.top + 6 }),
  }
  // 子菜单：默认开在主菜单左侧（左空间不足向右翻）；纵向随菜单项，近底向上翻。
  let subStyle = null
  if (sub) {
    const openLeft = sub.rect.left > 160
    const subBelow = vh - sub.rect.top - 12
    const subAbove = sub.rect.bottom - 12
    const subDown = subBelow >= Math.min(200, subAbove)
    subStyle = {
      ...menuCardStyle,
      position: 'fixed',
      zIndex: 42,
      minWidth: 124,
      maxHeight: Math.max(140, subDown ? subBelow : subAbove),
      overflowY: 'auto',
      ...(openLeft ? { right: Math.max(8, vw - sub.rect.left + 6) } : { left: sub.rect.right + 6 }),
      ...(subDown ? { top: sub.rect.top - 7 } : { bottom: Math.max(8, vh - sub.rect.bottom - 7) }),
    }
  }
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
      <div ref={menuRef} style={menuStyle}>
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
            onEnter={(rect) => setSub({ rect })}
            onClick={(rect) => setSub((v) => (v ? null : { rect }))}
            trailing={<span style={{ color: T.labelSecondary }}>▸</span>}
          />
        )}
        {external && (
          <>
            {menuDivider}
            <MenuItem label="删除" danger disabled={busy} onClick={() => { onClose(); onAction('remove') }} />
          </>
        )}
      </div>
      {sub && subStyle && (
        <div style={subStyle}>
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
