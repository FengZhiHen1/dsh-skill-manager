// settings — settings 命名空间注册：全包唯一的 @deepseek-ai/dsh-settings 接点。
//
// 边界：schema 与形式校验在 core/model/intent.js，本层只做平台接线。
// 兼容：settingsNamespace() 品牌助手在 dsh-settings ≥0.1.2 已撤（register 直接收字符串），
// 0.1.1 代 register 运行时同样直收字符串（brand 仅类型层标记）——故两代都传纯字符串。
// 参考：插件运行时.md「配置即意图」；DSR-015。
import { CONFIG_NS, configSchema, validateConfigIntent } from '../core/model/intent.js'

/**
 * 注册 settings 命名空间并返回 scope。
 * 校验刻意只做形式检查：目录是否存在属运行时条件，由 requireDir 拦。
 * 跨字段引用（组与工作区是否存在）交给对账层容忍回落，不在写路径拒绝。
 */
export function registerConfig(ctx) {
  return ctx.settings.register(CONFIG_NS, configSchema(), {
    validate: validateConfigIntent,
  })
}
