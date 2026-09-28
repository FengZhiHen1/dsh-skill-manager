// nav-icon — 设置导航图标补丁：改画设置面板里「技能」那一行的图标。
//
// 边界：宿主外壳按 section id 硬编码图标且未开放注册（`SettingsRoot.tsx` 的 `navIcon(id)`
// 是封闭清单，`settings.section` 没有 icon 字段），只能就地改 DOM 节点。
//
// 0.1.7 换代（原样沿用旧几何会静默失真）：宿主图标体系整体重绘 + size-neutral 改名——
// 旧 75 个带尺寸后缀的导出全灭，技能图标从「16px 实心书+星」改为「17px 描边几何」，
// 故此处手抄的 path 数据必须同步换代，否则导航行会显示一枚与外壳其余项不同代的旧图标。
// 现行几何 = 宿主 `IconSkillOutlineRegular/Medium`（ui-primitives/src/icons/index.tsx:1213-1230，
// 同一 `IconSkillOutlineArtwork`）。weight 取 Medium（1.3px）：决策笔记
// （.agents/notes/implemented/architecture/2026-09-16-size-neutral-product-icon-weights.md）
// 明确「设置触发与导航图标」属 Medium 的既定用途，本行要与导航条其余项同权重。
// 参考：插件运行时.md「Client 入口」；知识库 client/15 §5。
//
// 「技能」的默认齿轮与「通用」撞图标，故改写其 svg 子节点为 skill 轮廓图标。
// 宿主 DOM 结构变化导致找不到目标时静默保持原图标，不影响任何功能。
const STROKE_WIDTH = 1.3
// fill/stroke 逐条照抄宿主：第 3 条是实心块，其余三条是描边。
const SKILL_ICON_PATHS = [
  { d: 'M4.57788 5.77124H10.7029', mode: 'stroke' },
  { d: 'M4.57788 8.89819H7.91879', mode: 'stroke' },
  { d: 'M12.1404 1.19446C12.9442 1.19446 13.6404 1.81999 13.6404 2.64465V8.89856H12.6404V2.64465C12.6404 2.42015 12.4411 2.19446 12.1404 2.19446H3.14038C2.83968 2.19446 2.64038 2.42015 2.64038 2.64465V13.0929C2.64082 13.3172 2.84001 13.5421 3.14038 13.5421H8.88159V14.5421H3.14038C2.33675 14.5421 1.6408 13.9172 1.64038 13.0929V2.64465C1.64038 1.81999 2.33651 1.19446 3.14038 1.19446H12.1404Z', mode: 'fill' },
  { d: 'M12.0051 15.1056C12.0051 13.6395 10.8166 12.451 9.35059 12.451C10.8166 12.451 12.0051 11.2626 12.0051 9.79651C12.0051 11.2626 13.1936 12.451 14.6597 12.451C13.1936 12.451 12.0051 13.6395 12.0051 15.1056Z', mode: 'stroke' },
]

const SVG_NS = 'http://www.w3.org/2000/svg'

function patchSkillsNavIcon() {
  for (const label of document.querySelectorAll('span[class*="navLabel"]')) {
    if (label.textContent !== '技能') continue
    const cell = label.closest('button')
    const svg = cell ? cell.querySelector('svg') : null
    if (!svg) continue
    // 已是目标图标则跳过（React 重渲染还原内容时会自动重新改写）
    const first = svg.firstElementChild
    if (first && first.tagName === 'path' && first.getAttribute('d') === SKILL_ICON_PATHS[0].d) continue
    // 保留 svg 节点本身（React 持有其引用），仅改写子节点；viewBox/描边宽度同步成宿主现行值。
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    svg.setAttribute('viewBox', '0 0 17 17')
    svg.setAttribute('stroke-width', String(STROKE_WIDTH))
    for (const { d, mode } of SKILL_ICON_PATHS) {
      const path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('d', d)
      if (mode === 'fill') {
        path.setAttribute('fill', 'currentColor')
      } else {
        path.setAttribute('stroke', 'currentColor')
        path.setAttribute('fill', 'none')
      }
      svg.appendChild(path)
    }
  }
}

/**
 * 监听 DOM 变化重画导航图标，返回 disposer。
 * 设置面板为模态挂载，导航行随开关反复出现，故用 MutationObserver 跟随。
 */
export function observeSkillsNavIcon() {
  patchSkillsNavIcon()
  const observer = new MutationObserver((mutations) => {
    // 仅在有新节点挂载时扫描，避免聊天流式文本等纯文本变更触发无谓查询
    if (mutations.some((m) => m.addedNodes.length > 0)) patchSkillsNavIcon()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}
