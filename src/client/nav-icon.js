// dsh-skill-manager — 设置导航图标补丁（插件运行时.md L189：宿主外壳按 section id 硬编码图标，未开放注册）。
// 「技能」默认齿轮与「通用」撞图标；客户端找到本插件导航行，把齿轮 svg 就地改写为 ✦ 星形。
// 宿主 DOM 结构变化导致找不到目标时静默保持原图标，不影响任何功能。

const NAV_STAR_PATH = 'M8 1.6 L9.85 6.15 L14.4 8 L9.85 9.85 L8 14.4 L6.15 9.85 L1.6 8 L6.15 6.15 Z'

function patchSkillsNavIcon() {
  for (const label of document.querySelectorAll('span[class*="navLabel"]')) {
    if (label.textContent !== '技能') continue
    const cell = label.closest('button')
    const svg = cell ? cell.querySelector('svg') : null
    if (!svg) continue
    // 已是星形则跳过（React 重渲染还原内容时会自动重新改写）
    const first = svg.firstElementChild
    if (first && first.tagName === 'path' && first.getAttribute('d') === NAV_STAR_PATH) continue
    // 保留 svg 节点本身（React 持有其引用），仅改写子节点
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', NAV_STAR_PATH)
    path.setAttribute('fill', 'currentColor')
    svg.appendChild(path)
  }
}

/** 设置面板为模态挂载，导航行随面板开关反复出现，用 MutationObserver 跟随；返回 disposer。 */
export function observeSkillsNavIcon() {
  patchSkillsNavIcon()
  const observer = new MutationObserver((mutations) => {
    // 仅在有新节点挂载时扫描，避免聊天流式文本等纯文本变更触发无谓查询
    if (mutations.some((m) => m.addedNodes.length > 0)) patchSkillsNavIcon()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}
