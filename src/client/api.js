// api — Client→Host 传输层：统一收口业务失败与 transport 失败为 RpcError。
//
// 边界：调度语义在 Host，本层只管超时与错误归一；UI 层只认 RpcError。
// 入站载荷经 core/model/contract.js 校验：脏数据落成 contract-violation 显式态，不进渲染层。
// 参考：插件运行时.md「RPC 传输」「生命周期与副作用清单」；DSR-014。

import { ContractError, parseEndpointPayload } from '../core/model/contract.js'

/** RPC 通道名，Host 侧经 connection.rpc.handle 注册同名 channel。 */
export const CHANNEL = '/skill-manager'

/** 超时两档：API 请求 15s、下载 90s，经 AbortController 计时中断。 */
const API_TIMEOUT_MS = 15_000
/**
 * 下载档超时 90s：add/update 在 Host 侧走 zipball 下载，预算同为 90s。
 * dispatch 刻意不透传 signal，断连后 Host 写入仍会跑完——
 * 因此超时按「未知」呈现（措辞见 toTransportError / repair.jsx），不谎称失败。
 */
const DOWNLOAD_TIMEOUT_MS = 90_000
const DOWNLOAD_ENDPOINTS = new Set(['add', 'update'])

/** 业务/传输统一错误形状：UI catch 后读 code / retryable / repair 决定呈现与复制入口。 */
export class RpcError extends Error {
  /** @type {string} 稳定错误码，取自 Host 侧错误码表；transport = 通道层失败 */
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
  const aborted = Boolean(error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  const message = aborted
    ? `调用 ${endpoint} 超时（${budgetMs / 1000}s）：结果未知——signal 不透传，Host 写操作不被客户端取消打断，请刷新核对现场后再决定是否重试。`
    : `与 Host 的 RPC 通道失败（${endpoint}）：${error && error.message ? error.message : String(error)}`
  const err = new RpcError(message, { code: 'transport', retryable: true, repair: null })
  return err
}

/**
 * 创建调用门面：经 connection.rpc 调端点，成功返回契约校验后的 value，失败统一抛 RpcError。
 * 2xx 应答为平台 Result：{ok:true,value} 取 value 并经 contract.js 入站校验（形状违例
 * 转 contract-violation 显式错误，渲染层永远只见合法形状）；{ok:false,error} 转 RpcError。
 * transport 失败（401/403/500/断连/超时）由 rpc.call 抛裸 Error，转为 code=transport。
 * @param {{ connection: { rpc: { call: Function } } }} ctx Client 插件上下文（inject 含 connection）
 * @returns {(endpoint: string, payload?: object) => Promise<unknown>} 成功返回 value
 * @throws {RpcError} 失败统一抛（业务失败带 code/repair；transport 失败 code='transport'；契约违例 code='contract-violation'）
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
    if (result && typeof result === 'object' && result.ok === true) {
      try {
        return parseEndpointPayload(endpoint, result.value)
      } catch (error) {
        if (error instanceof ContractError) {
          throw new RpcError(error.message, { code: 'contract-violation', retryable: false, repair: null })
        }
        throw error
      }
    }
    const failure = result && typeof result === 'object' && result.error ? result.error : {}
    const details = failure.details && typeof failure.details === 'object' ? failure.details : {}
    throw new RpcError(failure.message || '请求失败', {
      code: failure.code || 'internal',
      retryable: details.retryable === true,
      repair: details.repair && typeof details.repair === 'object' ? details.repair : null,
    })
  }
}
