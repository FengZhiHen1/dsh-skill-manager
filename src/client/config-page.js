// config-page — 配置页控制器：把官方设置表单模型桥到本行配置的 `ConfigForm` 上。
//
// 边界：不渲染、不碰 DOM、不直接读写传输；只负责「字段规格 + 快照投影 + 动作面」三段。
// 形态逐段对齐官方伴生页（`ui-settings-shell/src/client/shell-card-controller.ts` 的
// `ShellCardController`）：同一个 `SettingsFormModel`、同样的 `bind(project)` / `actions()` /
// `inject()` 结构。这样草稿暂存、revision 围栏、保存后回读、离开页面丢弃全部由官方模型承担，
// 本插件不再自写草稿状态机。
//
// 为什么用 `hooks` 舱：槽位注入面的 `hooks` 是**保留键**——渲染器把它的成员拆成
// `use<成员名>` selector hook 注入组件 props，`hooks` 键本身永不到达组件。页面下发的
// `form` prop 是一次性快照，实时重渲染必须来自这里绑定的快照 store。
// 参考：knowledge/client/15 §4.1；DSR-025、DSR-026。

import { SettingsFormModel } from '@deepseek-ai/dsh-client-ui-primitives'
import { CONFIG_PAGE_SPECS } from '../core/model/page-specs.js'

/**
 * 本行配置页的控制器（一个实例一份，随 fiber 处置）。
 * @param {object} scope 本行命名空间的共享 `ConfigForm`（`ctx.configForms.get(CONFIG_NS)`）
 */
export class ConfigPageController {
  constructor(scope) {
    this.form = new SettingsFormModel(scope, CONFIG_PAGE_SPECS)
    // 投影 = 官方 shell 态（available/writable/dirty/invalid/saving/failed）逐字段状态拼装；
    // 每次 scope 变更或草稿变更都由模型重跑一次（bind 把 project 挂进模型的发布链）。
    this.store = this.form.bind(() => this.projection())
  }

  /** 组件通过 `useConfigPage(selector)` 读到的快照。 */
  projection() {
    return {
      ...this.form.shell(),
      skillsDir: this.form.field('skillsDir'),
      pi: this.form.field('pi'),
    }
  }

  /** 槽位注册时注入的面：`hooks`（保留舱）+ 官方模型的四个动作。 */
  inject() {
    return { hooks: { configPage: this.store }, ...this.form.actions() }
  }

  /** 释放模型的 scope 订阅。 */
  dispose() {
    this.form.dispose()
  }
}
