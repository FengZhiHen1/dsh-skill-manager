// index — Client 入口：装配技能页与配置卡两槽位，挂导航图标补丁。
//
// 边界：宿主加载的是 dist/client.js 产物；本文件导出 inject 与 apply 两项。
// 参考：插件运行时.md「Client 入口」；DSR-014/016、知识库 03 §7 第 3 条。
import { createCall } from './api.js'
import { SkillsSection } from './section.jsx'
import { SkillManagerCard } from './card.jsx'
import { observeSkillsNavIcon } from './nav-icon.js'

// 构建：esbuild 打成单文件产物；导出由 __ModuleLoader__ 工厂契约包裹。
// `remote.settings` 是**必需**的：写后裁定要独立读一次 settings.describe（core/model/verdict.js）。
// 客户端 remote 命名空间按"traced service"暴露，取属性前必须在 inject 里声明（否则运行时抛
// `cannot get property "remote.settings" without inject`）——与一方 Client 插件同一约定。
export const inject = ['slots', 'workspaces', 'uiWorkspace', 'settingsScope', 'remote', 'remote.settings', 'connection']

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

  /**
   * Host 权威读：独立于镜像的一次 settings.describe，取本命名空间某字段的解析值。
   * 写后裁定用它（core/model/verdict.js 的 writeVerdict）——镜像快照只回折"最新一笔写"的回执，
   * 被后续写超越的那一笔读到的仍是旧值，比对会把已落盘的写误报成被拒（2026-09-14 现场实证）。
   * @param {string} field 字段名
   * @returns {Promise<{value: unknown, error: string|null}>} error 非空 = 读失败（裁定落 unknown，
   *   失败原因随修复提示词上屏，不猜"被拒"）
   */
  const readConfigField = async (field) => {
    try {
      const response = await ctx.remote.settings.describe()
      if (!response || response.ok !== true) {
        const reason = response && response.error && response.error.message ? response.error.message : 'settings.describe 未成功应答'
        return { value: undefined, error: String(reason) }
      }
      const namespaces = response.value && Array.isArray(response.value.namespaces) ? response.value.namespaces : []
      const row = namespaces.find((candidate) => candidate && candidate.ns === 'skill-manager')
      const value = row && row.value
      if (!value || typeof value !== 'object') return { value: undefined, error: '权威值里没有 skill-manager 命名空间' }
      return { value: value[field], error: null }
    } catch (error) {
      return { value: undefined, error: error?.message ?? String(error) }
    }
  }

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
        { name: 'settings.section', id: 'skills', order: 16, label: '技能', inject: () => ({ call, workspaces, scope, subscribeSkillSettings, readConfigField }) },
        SkillsSection,
      ),
    )
    const offCard = ctx.slots.inject('settings.plugin.item', () =>
      ctx.slots.register(
        // rc.7 起该槽为 keyed：key = 本卡片编辑的 settings 命名空间
        // 卡片只需要 scope + uiWorkspace（目录选择器在 uiWorkspace 面上，不在 workspaces 面上）
        { name: 'settings.plugin.item', key: 'skill-manager', inject: () => ({ scope, uiWorkspace, readConfigField }) },
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
