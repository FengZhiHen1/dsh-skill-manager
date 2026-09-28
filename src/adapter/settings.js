// settings — 配置边界：Cordis `Config` schema、volatile 引用读取与解析前校验挂点。
//
// 边界：全包唯一接触 `@deepseek-ai/schemastery` 与 settings 服务面之处；schema 形状在
//       core/model/intent.js（本层只把实例注入进去并决定挂点）。
//
// 0.1.7 配置模型（知识库 host/07 §1-§3，本仓库 dsh-guardrails v1.6.0 为已验证先例）：
// 配置真相 = **本行 loader entry 的 Cordis `Config`**。旧注册面整体作废——`settings.yaml`
// 与 settings-file 提供方已删，`ctx.settings.register(ns, schema, { validate })` 返回的
// `SettingsScope`、浏览器侧 `ctx.settingsScope.bind`、`describeForWire`、`settings/updated`
// 在新树**均零命中**（照抄即编译失败）。现行四要素：① 插件在 `Config` 里声明全部可配置值；
// ② 即时字段加 `.volatile()`，消费者**操作时**读 `ref.get()`；③ settings 只枚举并生成表单；
// ④ 浏览器半区写 `cordis.patch.yml` 经普通 Loader 协调路径应用。
// 参考：插件运行时.md「配置即意图」；DSR-011、DSR-015、DSR-025。

import z from '@deepseek-ai/schemastery'
import { configSchema, validateConfigIntent } from '../core/model/intent.js'

/**
 * 本插件 loader 行的 Cordis 配置 schema。
 * 由 loader 在 `apply` 之前按 Standard Schema 协议校验并填默认值——非法类型在加载期抛
 * `ValidationError` 并让行挂载失败（fiber FAILED），不做静默降级。
 * 全部字段 volatile：它们都是运行时可变意图（见 core/model/intent.js 的字段说明）。
 */
export const Config = configSchema(z)

/**
 * 配置值是否为 cordis volatile 引用。
 * 鸭子类型（`typeof value.get === 'function'`）而非 import `Volatile<T>`：该协议以
 * `Symbol.for` 为身份，且平台会把「本 schema 之外的普通值」原样交给插件（对象式插件形态、
 * 手写行 config、裸 node 单测注入的普通对象）——不认这些形态就会把普通值读成 undefined。
 */
const isVolatileRef = (value) => typeof value === 'object' && value !== null && typeof value.get === 'function'

/**
 * 把 loader 解析出的 config 读成纯数据。
 * volatile 字段在运行期是引用对象，`ref.get()` 永远答最新值（设置页写入即替换其内部快照，
 * 不重挂载），故**每次调用现读**：无需 watch、无陈旧快照窗口——这正是旧代 `scope.watch`
 * 要做的事在新模型下的消失方式。
 * @param {unknown} config apply 收到的配置（非对象按空对象回落，让下游报自己的可行动错误）
 * @returns {object} 纯数据快照
 */
export function readConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return {}
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, isVolatileRef(value) ? value.get() : value]),
  )
}

/**
 * 配置只读门面。core 层只依赖 `.get()`（requireDir 取目录、piState 取开关），
 * 保留该形状让 core↔adapter 的接缝不随平台配置模型换代而变。
 * @param {unknown} config apply 收到的配置
 * @returns {{ get: () => object }}
 */
export function configReader(config) {
  return { get: () => readConfig(config) }
}

/**
 * 挂载期校验：apply 收到的是已按 schema 校验并填默认的配置，此处只补 schema 表达不了的
 * 跨字段约束（skillsDir 绝对性、组名合法性、空 hosts 死规则）。
 * 必须显式调用——`internal/config` 监听器在本行的**初次**解析时尚未注册（解析先于 apply），
 * 故初次校验只能落在这里；抛错即让行挂载失败，比把非法配置带进第一次工具调用响亮。
 * @param {unknown} config apply 收到的配置
 * @throws {Error} 见 core/model/intent.js 的 validateConfigIntent
 */
export function assertConfigValid(config) {
  validateConfigIntent(readConfig(config))
}

/**
 * 注册 volatile 热更候选的解析前校验。
 *
 * `internal/config` 是 waterfall：监听器**必须**调用 `next()`，返回值即后续使用的配置
 * （本层只校验、不改编排，故原样返回）。候选是**原始** config（未经 schema 归一，与
 * llm-pi-ai 的用法一致），schema 归一发生在本 waterfall 之后。
 * `this !== ctx.fiber` 表示是别的 fiber 在解析自己的配置，不属本行，直接放行。
 *
 * 抛错的后果（vendor/loader/src/config/entry.ts `_commitVolatile`）：候选被拒、**运行中
 * 的引用不动**，loader 记一条 warn，原始 config 保留到下次激活。⇒ 设置页那一笔写在
 * 持久层已落盘、但运行期未生效；这正是 DSR-024「写后裁定以 Host 权威值为准」要抓的形态。
 * @param {object} ctx Host 插件上下文
 */
export function installConfigValidation(ctx) {
  ctx.on('internal/config', function (_raw, next) {
    const candidate = next()
    if (this !== ctx.fiber) return candidate
    validateConfigIntent(candidate)
    return candidate
  })
}
