// index — Client 入口：装配技能页与配置页两槽位，挂导航图标补丁。
//
// 边界：宿主加载的是 dist/client.js 产物；本文件导出 inject 与 apply 两项。
//
// 0.1.7 接线（知识库 client/15 §4/§4.1、host/07 §3；本仓库 dsh-guardrails v1.6.0 为已验证先例）：
//   - `ctx.settingsScope` 与槽位 `settings.plugin.item` **均已不存在**（新树零命中；向已删
//     slot 注册在本版加载即抛错 `slot "…" is not declared`）。插件配置改由**侧栏 Plugins 页**
//     承载，三条新接线 `plugins.item`（官方设置页专属）/ `plugins.bundle.config`（key = 包名）/
//     `plugins.row.config`（key = `<包名>#<行 id>`）。
//   - 本插件配置属于它的 loader **行**（cordis.patch.yml 的 `id: skill-manager`），故注册进
//     `plugins.row.config`，key = `dsh-skill-manager#skill-manager`；该行因此多出一个「配置」入口。
//   - 读写走 `ctx.configForms.get(ns)`。**命名空间就是 loader entry id**，即 `skill-manager`
//     （不是包名 dsh-skill-manager——那是旧代的插件自选名）。`ConfigForm` 与旧 `SettingsScope`
//     逐方法对应（`getSnapshot`/`subscribe`/`set`/`unset`），故卡片与技能页的读写代码原样沿用。
//   - 注册只在 Host 服务该命名空间期间存活（`configForms.whileServed`），未挂本行的部署
//     不会在 Plugins 页留下任何痕迹。
// 参考：插件运行时.md「Client 入口」；DSR-014/016/025、知识库 03 §7 第 3 条。
import { createCall } from './api.js'
import { SkillsSection } from './section.jsx'
import { SkillManagerCard } from './card.jsx'
import { observeSkillsNavIcon } from './nav-icon.js'

// 配置命名空间 = 本插件 loader 行的 id（见 src/core/model/intent.js CONFIG_NS 的说明）；
// `plugins.row.config` 的 key = `<包名>#<行 id>`（ui-plugin-manager/src/client/config-ledger.ts:36-38）。
const NS = 'skill-manager'
const ROW_KEY = 'dsh-skill-manager#skill-manager'

// 构建：esbuild 打成单文件产物；导出由 __ModuleLoader__ 工厂契约包裹。
// `remote.settings` 是**必需**的：写后裁定要独立读一次 settings.describe（core/model/verdict.js）。
// 客户端 remote 命名空间按"traced service"暴露，取属性前必须在 inject 里声明（否则运行时抛
// `cannot get property "remote.settings" without inject`）——与一方 Client 插件同一约定。
// `configForms` 取代旧 `settingsScope`（二者同属 ui-settings 包，服务名不同）。
export const inject = ['slots', 'workspaces', 'uiWorkspace', 'configForms', 'remote', 'remote.settings', 'connection']

/**
 * Client apply：建调用门面与配置变更总线，注册技能页与配置页两槽位。
 * 另订阅 settings 文档事件驱动技能页刷新，并挂导航图标补丁。
 * 所有 disposer 随本 fiber 处置，卸载即清理。
 */
export function apply(ctx) {
  const call = createCall(ctx)
  const workspaces = ctx.workspaces
  const uiWorkspace = ctx.uiWorkspace
  // 共享配置表单：一个 Host entry 一份，读写与 revision 围栏都由它拥有。
  // 快照形状 { status, value, base, user, revision, writable, mode }——旧 scope 语义的对应物。
  const scope = ctx.configForms.get(NS)

  /**
   * Host 权威读：独立于镜像的一次 settings.describe，取本命名空间某字段的解析值。
   * 写后裁定用它（core/model/verdict.js 的 writeVerdict）——镜像快照只回折"最新一笔写"的回执，
   * 被后续写超越的那一笔读到的仍是旧值，比对会把已落盘的写误报成被拒（2026-09-14 现场实证）。
   * 0.1.7 下它多了一层必要：`internal/config` 校验拒绝的 volatile 候选会被 loader 记 warn 并
   * **保留原引用**，而 profile patch 已落盘——正是"持久层已写、运行期未生效"的形态。
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
      const row = namespaces.find((candidate) => candidate && candidate.ns === NS)
      const value = row && row.value
      if (!value || typeof value !== 'object') return { value: undefined, error: `权威值里没有 ${NS} 命名空间` }
      return { value: value[field], error: null }
    } catch (error) {
      return { value: undefined, error: error?.message ?? String(error) }
    }
  }

  // 配置变更通知总线：配置页保存/重置 skillsDir → 技能页自动刷新。
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
    // 配置页：旧 `settings.plugin.item` 卡片已废，改挂 Plugins 页的本行配置入口。
    // 页面按 `view` 分发：'summary' 取一句话（行缺描述时的回落），'page' 取真正表单。
    const offCard = ctx.configForms.whileServed([NS], () =>
      ctx.slots.inject('plugins.row.config', () =>
        ctx.slots.register(
          { name: 'plugins.row.config', key: ROW_KEY, inject: () => ({ scope, uiWorkspace, readConfigField }) },
          SkillManagerCard,
        ),
      ),
    )
    // 配置变更（配置页保存/重置 skillsDir）→ 技能页自动刷新，无需手动点「刷新」
    const offSettings = ctx.remote.$on('settings/document-updated', (ns) => {
      if (ns === NS) bumpSkillSettings()
    })
    const offNavIcon = observeSkillsNavIcon()
    return () => { offSection(); offCard(); offSettings(); offNavIcon() }
  }, 'dsh-skill-manager: settings slots')
}
