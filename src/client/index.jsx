// index — Client 入口：装配技能页与配置卡两槽位，挂导航图标补丁。
//
// 边界：宿主加载的是 dist/client.js 产物；本文件导出 inject 与 apply 两项。
// 参考：插件运行时.md「Client 入口」；DSR-014/016、知识库 03 §7 第 3 条。
import { createCall } from './api.js'
import { SkillsSection } from './section.jsx'
import { SkillManagerCard } from './card.jsx'
import { observeSkillsNavIcon } from './nav-icon.js'

// 构建：esbuild 打成单文件产物；导出由 __ModuleLoader__ 工厂契约包裹。
export const inject = ['slots', 'workspaces', 'uiWorkspace', 'settingsScope', 'remote', 'connection']

/**
 * Client apply：建调用门面与配置变更总线，注册技能页与配置卡两槽位。
 * 另订阅 settings 文档事件驱动技能页刷新，并挂导航图标补丁。
 * 所有 disposer 随本 fiber 处置，卸载即清理。
 */
export function apply(ctx) {
  const call = createCall(ctx)
  const workspaces = ctx.workspaces
  const uiWorkspace = ctx.uiWorkspace
  const scope = ctx.settingsScope.bind({ namespace: 'skill-manager' })

  // 配置变更通知总线：卡片保存/重置 skillsDir → 技能页自动刷新。
  // 事件源是下方转发的 settings/document-updated。
  // 监听集合持有在 apply 闭包而非模块顶层，避免跨 fiber 重载与 HMR 泄漏。
  const settingsListeners = new Set()
  const subscribeSkillSettings = (fn) => {
    settingsListeners.add(fn)
    return () => settingsListeners.delete(fn)
  }
  const bumpSkillSettings = () => {
    for (const fn of [...settingsListeners]) fn()
  }

  ctx.effect(() => {
    const offSection = ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        { name: 'settings.section', id: 'skills', order: 16, label: '技能', inject: () => ({ call, workspaces, scope, subscribeSkillSettings }) },
        SkillsSection,
      ),
    )
    const offCard = ctx.slots.inject('settings.plugin.item', () =>
      ctx.slots.register(
        // rc.7 起该槽为 keyed：key = 本卡片编辑的 settings 命名空间
        // 卡片只需要 scope + uiWorkspace（目录选择器在 uiWorkspace 面上，不在 workspaces 面上）
        { name: 'settings.plugin.item', key: 'skill-manager', inject: () => ({ scope, uiWorkspace }) },
        SkillManagerCard,
      ),
    )
    // 配置变更（卡片保存/重置 skillsDir）→ 技能页自动刷新，无需手动点「刷新」
    const offSettings = ctx.remote.$on('settings/document-updated', (ns) => {
      if (ns === 'skill-manager') bumpSkillSettings()
    })
    const offNavIcon = observeSkillsNavIcon()
    return () => { offSection(); offCard(); offSettings(); offNavIcon() }
  }, 'dsh-skill-manager: settings slots')
}
