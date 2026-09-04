// dsh-skill-manager — 稳定的业务错误类型。
//
// 所有业务失败都抛出 SkillManagerError，HTTP 层把它翻译成统一信封
// { ok:false, error: { code, message, retryable } }（见 src/core/service.js）。
// 未知异常由 service.js 归类为 internal，不冒泡杀死 Host。

export class SkillManagerError extends Error {
  /** 稳定错误码（见 需求.md R-19 与 插件运行时.md 错误协议）。 */
  code
  /** 是否值得重试（网络类错误为 true）。 */
  retryable

  constructor(code, message, retryable = false) {
    super(message)
    this.name = 'SkillManagerError'
    this.code = code
    this.retryable = retryable
  }
}

/** 未配置本地 skill 目录的统一错误（需求.md R-22）。 */
export const unconfigured = () =>
  new SkillManagerError(
    'skilldir-unconfigured',
    '尚未配置本地 skill 目录：请到 设置 → 插件 → skill-manager 卡片配置本地 skill 目录后使用。',
  )
