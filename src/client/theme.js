// dsh-skill-manager — Client 主题 token 与样式基元（插件运行时.md「样式」：全部走 --dsw-alias-* token，不注入全局样式表）。
// 自旧根 client.js 基元段搬位（P6），色值零硬编码；组件层直接展开这些对象为内联 style。

export const T = {
  bgBase: 'var(--dsw-alias-bg-base)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2)',
  bgLayer3: 'var(--dsw-alias-bg-layer-3)',
  bgModulePlatform: 'var(--dsw-alias-bg-module-platform)',
  borderL1: 'var(--dsw-alias-border-l1)',
  borderL2: 'var(--dsw-alias-border-l2)',
  brand: 'var(--dsw-alias-brand-primary)',
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  labelTertiary: 'var(--dsw-alias-label-tertiary)',
  labelDimmed: 'var(--dsw-alias-label-dimmed)',
  success: 'var(--dsw-alias-state-success-primary)',
  error: 'var(--dsw-alias-state-error-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
}

/** token 色晕卡（状态点/提示条共用）：色相随状态 token，底色 color-mix 透明晕。 */
export const badgeStyle = (color) => ({
  color,
  background: `color-mix(in srgb, ${color} 15%, transparent)`,
})

/** 状态徽章（DSR-008）：原生 pending pill 几何（高 ~19px、圆角 999、11px）。正常态灰底灰字，可更新深色字，仅真警告用彩色。 */
export const pillBase = {
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: 11,
  lineHeight: '17px',
  background: T.bgModulePlatform,
  color: T.labelSecondary,
  whiteSpace: 'nowrap',
}
export const statusPillStyle = (kind) => {
  if (kind === 'updatable') return { ...pillBase, color: T.labelPrimary, fontWeight: 500 }
  if (kind === 'warn') return { ...pillBase, ...badgeStyle(T.warn) }
  if (kind === 'error') return { ...pillBase, ...badgeStyle(T.error) }
  return pillBase
}

export const S = {
  row: { display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', border: `1px solid ${T.borderL1}`, borderRadius: 12, marginBottom: 8, fontSize: 13 },
  select: { padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.borderL1}`, background: T.bgBase, color: T.labelPrimary, fontSize: 12 },
  panel: { padding: '10px 12px' },
  error: { color: T.error, fontSize: 12, padding: '6px 8px' },
  muted: { color: T.labelSecondary, fontSize: 12 },
  guide: { padding: '24px 16px', textAlign: 'center', color: T.labelSecondary, fontSize: 13 },
  dangerText: { color: T.error },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
}

// 视觉基元（插件运行时.md「视图设计」：白底描边卡 / 浅底卡 / 状态点）
export const cardStyle = { border: `1px solid ${T.borderL1}`, borderRadius: 12, background: T.bgLayer3 }
export const subCardStyle = { borderRadius: 10, background: T.bgModulePlatform }
export const dotStyle = (color) => ({ width: 7, height: 7, borderRadius: 4, background: color, flex: 'none' })
export const sectionHead = { fontSize: 14, fontWeight: 600, color: T.labelPrimary }
export const cardTitle = { fontSize: 13, fontWeight: 600, color: T.labelPrimary }
export const noteText = { fontSize: 11, color: T.labelSecondary }
export const dividerStyle = { height: 1, background: T.borderL1, flex: 'none' }
