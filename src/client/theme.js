// theme — Client 主题 token 与样式基元：色值、半径、阴影、遮罩全部映射 --dsw-* token。
//
// 边界：不注入全局样式表，组件层直接展开这些对象为内联 style。
// 参考：插件运行时.md「Client 入口」「视图设计」；DSR-008、DSR-026；knowledge/client/15 §4.1、16。

/** 主题色 token 表：全部映射宿主 --dsw-alias-* CSS 变量，宿主换肤即时生效（零硬编码色值）。 */
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
  mask: 'var(--dsw-alias-bg-mask-1)',
}

/**
 * 圆角 token 表（DSR-026）。0.1.7 起宿主把半径收成六档并在自己仓内用守卫挡离格字面量
 * （`packages/client/ui-theme/tests/radius-styles.client.spec.ts`；该守卫只扫 DSH 自己
 * `packages/client` 树内各级 `src` 目录的 CSS，**不约束第三方内联样式**——所以这是观感一致性问题，
 * 不是兼容失败；但对齐之后本插件与外壳共用同一套材料）。
 * 档位：xs 4 / sm 8 / md 12 / lg 16 / xl 20 / panel 28。
 * 归位规则（原字面量无对应档时）：
 *   - 控件/小件（图标钮、输入、菜单项、小卡）→ `sm`（官方 Menu 的项即 sm）；
 *   - 面/容器（行卡、提示条、子卡、浮层）→ `md`；
 *   - 大浮层（对话框）→ `lg`。
 * 整圆（胶囊徽章、状态点）**保持字面量**：`999`/`50%` 是形状语义不是档位，
 * 官方 `Tag.module.css`/`Switch.module.css` 同样写 `999px`/`50%`。
 */
export const R = {
  xs: 'var(--dsw-radius-xs)',
  sm: 'var(--dsw-radius-sm)',
  md: 'var(--dsw-radius-md)',
  lg: 'var(--dsw-radius-lg)',
  xl: 'var(--dsw-radius-xl)',
  panel: 'var(--dsw-radius-panel)',
}

/** 浮层阴影 token：官方 Menu/Modal 用 prominent，面板类用 panel（DSR-026 去掉硬编码 rgba）。 */
export const SHADOW = {
  panel: 'var(--dsw-elevation-panel)',
  prominent: 'var(--dsw-elevation-prominent)',
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

/** 页面布局基元速查（行卡/下拉/面板/提示文本等，全部由 T token 组合；半径走 R）。 */
export const S = {
  row: { display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', border: `1px solid ${T.borderL1}`, borderRadius: R.md, marginBottom: 8, fontSize: 13 },
  /**
   * 视图容器（管理/搜索两视图根）：左右零内缩——设置外壳 `.options` 已给 24px 页边距
   * （ui-settings-general SettingsRoot.module.css），官方各节自身不再加横向 padding；
   * 页面自加 12px 即与标准节双倍内缩（2026-09-09 走查：技能页比「插件」页窄一圈）。
   */
  panel: { padding: '10px 0' },
  /** 高密度列表行（容器卡 + 分隔线用法）：比 S.row 描边卡轻，行内不再带边框。 */
  listRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 13 },
  /** 筛选器触发钮（宿主 Menu 的 anchor）：浅底小圆角，与工具条输入框同高。 */
  filterTrigger: { display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: T.bgModulePlatform, borderRadius: R.sm, padding: '5px 10px', font: 'inherit', fontSize: 12, color: T.labelPrimary, cursor: 'pointer' },
  muted: { color: T.labelSecondary, fontSize: 12 },
  /** 未配置引导页：同 panel 口径，横向零内缩（纵向留白自管）。 */
  guide: { padding: '24px 0', textAlign: 'center', color: T.labelSecondary, fontSize: 13 },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
}

// 视觉基元：白底描边卡、浅底卡、状态点。
/** 白底描边卡（页签内容卡、行分组容器）。 */
export const cardStyle = { border: `1px solid ${T.borderL1}`, borderRadius: R.md, background: T.bgLayer3 }
/** 浅底子卡（卡内嵌信息块）。 */
export const subCardStyle = { borderRadius: R.md, background: T.bgModulePlatform }
/** 状态点（配 badgeStyle 使用；调用方传 T.success 等色 token）。整圆故用 50% 而非档位。 */
export const dotStyle = (color) => ({ width: 7, height: 7, borderRadius: '50%', background: color, flex: 'none' })
/** 段标题（14px 半粗）。 */
export const sectionHead = { fontSize: 14, fontWeight: 600, color: T.labelPrimary }
/** 卡标题（13px 半粗）。 */
export const cardTitle = { fontSize: 13, fontWeight: 600, color: T.labelPrimary }
/** 次要说明文本（11px 灰）。 */
export const noteText = { fontSize: 11, color: T.labelSecondary }
/** 分隔线（1px 描边色，flex 容器内不伸缩）。 */
export const dividerStyle = { height: 1, background: T.borderL1, flex: 'none' }
/** 纵向导航项基元（分组栏行）：通宽文字钮，激活态浅底深字。 */
export const navItemStyle = { display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 10px', border: 'none', borderRadius: R.sm, background: 'transparent', font: 'inherit', fontSize: 13, cursor: 'pointer', color: T.labelSecondary }
/** 导航项激活态（叠加在 navItemStyle 上）。 */
export const navItemActiveStyle = { background: T.bgModulePlatform, color: T.labelPrimary, fontWeight: 500 }
