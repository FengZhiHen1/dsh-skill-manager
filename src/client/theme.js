// theme — Client 主题 token 与样式基元：色值零硬编码，全部映射 --dsw-alias-* token。
//
// 边界：不注入全局样式表，组件层直接展开这些对象为内联 style。
// 参考：插件运行时.md「Client 入口」「视图设计」；DSR-008。

/** 主题 token 表：全部映射宿主 --dsw-alias-* CSS 变量，宿主换肤即时生效（零硬编码色值）。 */
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

/**
 * 状态徽章基元：沿用原生 pending pill 的几何。
 * 高 ~19px、圆角 999、字号 11px。
 * 默认灰底灰字，可更新态深色字，真警告态才用彩色。
 */
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
/**
 * 状态徽章按态取样式：几何沿用 pillBase，只换配色。
 * updatable → 深色强调。
 * warn、error → 对应色晕。
 * 其余（ok、中性）→ 灰底基元。
 */
export const statusPillStyle = (kind) => {
  if (kind === 'updatable') return { ...pillBase, color: T.labelPrimary, fontWeight: 500 }
  if (kind === 'warn') return { ...pillBase, ...badgeStyle(T.warn) }
  if (kind === 'error') return { ...pillBase, ...badgeStyle(T.error) }
  return pillBase
}

/** 页面布局基元速查（行卡/下拉/面板/提示文本等，全部由 T token 组合）。 */
export const S = {
  row: { display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', border: `1px solid ${T.borderL1}`, borderRadius: 12, marginBottom: 8, fontSize: 13 },
  panel: { padding: '10px 12px' },
  /** 高密度列表行（容器卡 + 分隔线用法）：比 S.row 描边卡轻，行内不再带边框。 */
  listRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 13 },
  /** 筛选器触发钮（宿主 Menu 的 anchor）：浅底小圆角，与工具条输入框同高。 */
  filterTrigger: { display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: T.bgModulePlatform, borderRadius: 8, padding: '5px 10px', font: 'inherit', fontSize: 12, color: T.labelPrimary, cursor: 'pointer' },
  muted: { color: T.labelSecondary, fontSize: 12 },
  guide: { padding: '24px 16px', textAlign: 'center', color: T.labelSecondary, fontSize: 13 },
  dangerText: { color: T.error },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
}

// 视觉基元：白底描边卡、浅底卡、状态点。
/** 白底描边卡（页签内容卡、行分组容器）。 */
export const cardStyle = { border: `1px solid ${T.borderL1}`, borderRadius: 12, background: T.bgLayer3 }
/** 浅底子卡（卡内嵌信息块）。 */
export const subCardStyle = { borderRadius: 10, background: T.bgModulePlatform }
/** 状态点（配 badgeStyle 使用；调用方传 T.success 等色 token）。 */
export const dotStyle = (color) => ({ width: 7, height: 7, borderRadius: 4, background: color, flex: 'none' })
/** 段标题（14px 半粗）。 */
export const sectionHead = { fontSize: 14, fontWeight: 600, color: T.labelPrimary }
/** 卡标题（13px 半粗）。 */
export const cardTitle = { fontSize: 13, fontWeight: 600, color: T.labelPrimary }
/** 次要说明文本（11px 灰）。 */
export const noteText = { fontSize: 11, color: T.labelSecondary }
/** 分隔线（1px 描边色，flex 容器内不伸缩）。 */
export const dividerStyle = { height: 1, background: T.borderL1, flex: 'none' }
/** 纵向导航项基元（分组栏行）：通宽文字钮，激活态浅底深字。 */
export const navItemStyle = { display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 10px', border: 'none', borderRadius: 8, background: 'transparent', font: 'inherit', fontSize: 13, cursor: 'pointer', color: T.labelSecondary }
/** 导航项激活态（叠加在 navItemStyle 上）。 */
export const navItemActiveStyle = { background: T.bgModulePlatform, color: T.labelPrimary, fontWeight: 500 }
