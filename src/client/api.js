// dsh-skill-manager — Client→Host 传输层（插件运行时.md「RPC 传输」DSR-014；connection 通道）。
// 统一信封：ctx.connection.rpc.call('/skill-manager', endpoint, payload, signal) 对 2xx 解析出
// Host 的平台 Result {ok:true,value}|{ok:false,error:{code,message,details:{retryable,repair}}}；
// transport 失败（401/403/500/断连/超时）由 rpc.call 抛 Error('transport failure …HTTP nnn')。
// 两者都在 createCall 收口成 RpcError（code/message/retryable/repair 挂在 error 上），UI 层只认 RpcError。

/** RPC 通道名（Host 侧 src/adapter/index.js 经 connection.rpc.handle 注册同名 channel）。 */
export const CHANNEL = '/skill-manager'

/** 超时两档（插件运行时.md 生命周期表：网络请求 AbortController，API 15s / 下载 90s）。 */
const API_TIMEOUT_MS = 15_000
/**
 * add/update 在 Host 侧走 zipball 下载（base/net.js 90s 预算），且 dispatch
 * 刻意不透传 signal——断连后写仍会跑完；客户端若 15s 先 abort，会造成
 * 「UI 显示失败、库里实际已写入」的危险假象，故下载档端点用 90s。
 */
const DOWNLOAD_TIMEOUT_MS = 90_000
const DOWNLOAD_ENDPOINTS = new Set(['add', 'update'])

/** 方法三分类（调度语义在 Host，这里仅用于超时与呈现参考）。 */
export const READ = new Set(['overview', 'warm', 'backups'])
export const NET = new Set(['check', 'search', 'repo-skills'])
export const WRITE = new Set(['add', 'update', 'remove', 'restore', 'sync'])

/** 业务/传输统一错误形状：UI catch 后读 code / retryable / repair 决定呈现与复制入口。 */
export class RpcError extends Error {
  /** @type {string} 稳定错误码（Host errors.js 码表；transport = 通道层失败） */
  code
  /** @type {boolean} Host details.retryable（transport 一律视为可重试） */
  retryable
  /** @type {{operation:string,summary:string,facts:Array<{label:string,value:string}>,recommendation:string[]}|null} */
  repair

  constructor(message, { code = 'internal', retryable = false, repair = null } = {}) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.retryable = retryable
    this.repair = repair
  }
}

/** transport 异常（rpc.call 抛出的裸 Error / AbortError）→ RpcError 归一，repair 由调用面本地兜底。 */
export function toTransportError(error, endpoint, budgetMs = API_TIMEOUT_MS) {
  if (error instanceof RpcError) return error
  const aborted = error instanceof DOMException ? error.name === 'AbortError' : Boolean(error && error.name === 'AbortError')
  const message = aborted
    ? `调用 ${endpoint} 超时（${budgetMs / 1000}s）：Host 可能正忙或已失联。`
    : `与 Host 的 RPC 通道失败（${endpoint}）：${error && error.message ? error.message : String(error)}`
  const err = new RpcError(message, { code: 'transport', retryable: true, repair: null })
  return err
}

/**
 * 创建调用门面（旧 fetch('/skill-manager/api') 信封通道的替代品）。
 * @param {{ connection: { rpc: { call: Function } } }} ctx Client 插件上下文（inject 含 connection）
 * @returns {(endpoint: string, payload?: object) => Promise<unknown>} 成功返回 value；失败抛 RpcError
 */
export function createCall(ctx) {
  return async (endpoint, payload = {}) => {
    const budget = DOWNLOAD_ENDPOINTS.has(endpoint) ? DOWNLOAD_TIMEOUT_MS : API_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), budget)
    let result
    try {
      result = await ctx.connection.rpc.call(CHANNEL, endpoint, payload, controller.signal)
    } catch (error) {
      throw toTransportError(error, endpoint, budget)
    } finally {
      clearTimeout(timer)
    }
    if (result && typeof result === 'object' && result.ok === true) return result.value
    const failure = result && typeof result === 'object' && result.error ? result.error : {}
    const details = failure.details && typeof failure.details === 'object' ? failure.details : {}
    throw new RpcError(failure.message || '请求失败', {
      code: failure.code || 'internal',
      retryable: details.retryable === true,
      repair: details.repair && typeof details.repair === 'object' ? details.repair : null,
    })
  }
}
