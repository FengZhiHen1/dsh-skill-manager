// page-specs — 配置页的字段转换规格：存储值 ↔ 草稿文本，以及「这份草稿算不算本字段接受的值」。
//
// 边界：**浏览器安全**——只依赖同层的 config-fields.js（零平台 import），故可被 client bundle
//       打包，也可在裸 node 下单测。反例理由同 model/intent.js：那个模块读文件系统，进不了浏览器，
//       所以字段名抽到了 config-fields.js（两边共用的单一事实源）。
//
// 形状对齐 `@deepseek-ai/dsh-client-ui-primitives` 的 `SettingsFieldSpec`：
//   { field, format(value) -> string, parse(text) -> { kind:'set', value } | { kind:'clear' } | undefined }
// `parse` 返回 undefined 表示「这份草稿不是本字段接受的值」——官方表单把它记为 `invalid`
// 并**阻止保存**，而不是悄悄丢弃编辑。空串一律是 `clear`（卸掉用户层覆盖、回落组合层），
// 与官方 `settingsTextField` 同语义；对本插件等价，因为 `skillsDir` 的 schema 默认就是空串。
// 参考：knowledge/client/15 §4.1、host/07 §2；DSR-025、DSR-026。

import { SKILLS_DIR_FIELD, PI_FIELD } from './config-fields.js'

/**
 * 自由文本字段：空草稿 = 清除（回落组合层），其余原样（trim 后）写入。
 * 刻意不做「必须是绝对路径」的客户端预检：那条约束的权威在 Host（`validateConfigIntent`
 * 挂在 `internal/config` 上），客户端只做形状互转；越界由 Host 拒绝并回读——官方表单模型
 * 的既有姿态正是「Host 是唯一权威，保存后从 section 回读而不是本地预测」。
 */
export const skillsDirSpec = {
  field: SKILLS_DIR_FIELD,
  format: (value) => (typeof value === 'string' ? value : ''),
  parse: (text) => {
    const trimmed = text.trim()
    return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
  },
}

/**
 * 布尔字段的文本化：草稿文本恒为 `'true'` / `'false'`。
 * 官方只提供 number/text 两个 spec 助手，布尔设置在各官方页里都是**自绘控件 + 自行动作**
 * （如 `SubagentModelSelectionFields` 的 checkbox + toggle 回调）。本插件要保留「改动暂存、
 * 保存才生效」的语义（与同页的 skillsDir 一致，也让两字段能进**同一次原子 mutate**），
 * 故用规格承载布尔、由自绘复选框读 `field().text`、经 `edit()` 暂存——控件自绘，
 * 写入仍走官方模型的计划与 revision 围栏。
 * 只接受 `'true'`/`'false'`（容忍大小写与首尾空白）：本字段的控件只可能产出这两个值，
 * 放宽到 on/off/1/0 属无来源的推测。
 */
export const piSpec = {
  field: PI_FIELD,
  format: (value) => (value === true ? 'true' : 'false'),
  parse: (text) => {
    const normalized = String(text).trim().toLowerCase()
    if (normalized === 'true') return { kind: 'set', value: true }
    if (normalized === 'false') return { kind: 'set', value: false }
    return undefined
  },
}

/** 配置页声明的字段规格（顺序即官方模型的暂存与计划顺序）。 */
export const CONFIG_PAGE_SPECS = [skillsDirSpec, piSpec]

/** 草稿文本是否代表「开」（自绘复选框读它决定勾选态）。 */
export const isOn = (text) => String(text).trim().toLowerCase() === 'true'
