// dsh-skill-manager — settings 命名空间注册（插件运行时.md「配置即意图」；DSR-015 adapter 接缝）。
// 全包唯一的 @deepseek-ai/dsh-settings import 点；schema 与形式校验在 core/model/intent.js。
// 原 registerConfig 自 lib/dir.js 搬入（P1 搬位不改语义）。

import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { CONFIG_NS, configSchema, validateConfigIntent } from '../core/model/intent.js'

/**
 * Register the settings namespace. Validation is deliberately form-only:
 * directory existence is a runtime condition handled by requireDir(), and
 * cross-field references (group/workspace existence) are tolerated by the
 * reconciler instead of rejecting writes.
 */
export function registerConfig(ctx) {
  const ns = settingsNamespace(CONFIG_NS)
  return ctx.settings.register(ns, configSchema(), {
    validate: validateConfigIntent,
  })
}
