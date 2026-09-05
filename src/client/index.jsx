// dsh-skill-manager — Client 入口（插件运行时.md「Client 入口」L163-191；DSR-014/016）。
// 导出 { inject, apply }（esbuild 产 dist/client.js，__ModuleLoader__ 工厂契约包裹）；
// 注册两槽位（settings.section=技能页 / settings.plugin.item=keyed 配置卡），订阅 settings 文档事件驱动技能页刷新，
// 挂导航图标补丁；全部 disposer 进 Fiber effect，卸载即清理。

import { createCall } from './api.js'
import { SkillsSection, bumpSkillSettings } from './section.jsx'
import { SkillManagerCard } from './card.jsx'
import { observeSkillsNavIcon } from './nav-icon.js'

export const inject = ['slots', 'workspaces', 'uiWorkspace', 'settingsScope', 'remote', 'connection']

export function apply(ctx) {
  const call = createCall(ctx)
  const workspaces = ctx.workspaces
  const uiWorkspace = ctx.uiWorkspace
  const scope = ctx.settingsScope.bind({ namespace: 'skill-manager' })

  ctx.effect(() => {
    const offSection = ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        { name: 'settings.section', id: 'skills', order: 16, label: '技能', inject: () => ({ call, workspaces, scope }) },
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
