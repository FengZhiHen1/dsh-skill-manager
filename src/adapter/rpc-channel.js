// rpc-channel — 自定义 RPC 通道的 `/api` 精确 Fetch 路由承载。
//
// 为什么不用 `connection.rpc.handle`（平台官方文档的自定义通道 API）：
//   它在**生产 web 组合下注册不上任何自定义通道**——失败点在 connection 服务自己的 ctx 上
//   （rpc-host.ts:87 `get rpc() { const owner = this.ctx }` → :192
//    `owner.effect(() => owner.webServer.register(route))`），而 `webserver` 行与 `connection`
//   行是顶层兄弟行 ⇒ `owner.webServer` 必抛 `cannot get property "webServer" without inject`。
//   该异常发生在匿名子 fiber 内、启动期不外显 ⇒ 行仍 `active`，浏览器一律 405。
//   且改**调用方**的 inject（动态或静态）都无效，这已是消融结论。
//
// 本模块改用 `connection.fetch.register`：**registerFetchRoute 只写内部 Map，全程不读
// `owner.webServer`** ⇒ 兄弟行可注册；且这些路由由 connection 自己正确挂载的 `/api` 前缀路由
// 承载 ⇒ **免费继承**平台围栏(403)/认证(401)/`connection/request` waterfall/体积上限(413)/
// 并发与断连排空。插件侧因此**不再自持任何安全围栏**。
//
// 代价（本模块承担的部分）：路径必须在 `/api` 之下（`assertFetchRoute` 强制），且精确路由是
// **按完整 pathname 精确匹配**（`fetchRoutes.get(pathname)`）⇒ 每个端点一条路由；
// 信封的解析/封装由本模块承担（平台只对 `rpc.handle` 通道做信封，`fetch` 路由是裸 WHATWG 面）。
// 安全语义（围栏/认证/上限）**仍全在平台侧**，本模块不复制。
//
// 依据：docs/decisions/0002-自定义RPC通道改用精确Fetch路由.md（顶层仓库）。

/** 平台共享前缀：自定义能力一律挂在它之下（唯一可达的承载点）。 */
export const API_CHANNEL = '/api'

/** 本插件的命名空间段：决定 `/api/<ns>/<endpoint>` 与客户端 `<ns>/<endpoint>`。 */
export const RPC_NAMESPACE = 'skill-manager'

/** 端点串的分段文法，与平台 ENDPOINT_SEGMENT_PATTERN 一致（rpc.ts:12）。 */
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/

/**
 * 校验一个端点名可否进入 `/api/<ns>/<ep>` 路径（各段非空、非 `.`/`..`、只含安全字符）。
 * @param {string} endpoint 端点名
 * @returns {boolean}
 */
export function isValidEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint === '') return false
  return endpoint.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..' && ENDPOINT_SEGMENT.test(segment))
}

/**
 * 构造「客户端调用端点」：**含命名空间前缀**（如 `skill-manager/overview`）。
 * 客户端 `ctx.connection.rpc.call(API_CHANNEL, qualified(endpoint), …)`。
 * @param {string} namespace 命名空间段（一般取插件名）
 * @param {string} endpoint 端点名
 * @returns {string} `<ns>/<endpoint>`
 */
export function qualified(namespace, endpoint) {
  return `${namespace}/${endpoint}`
}

/**
 * 解析平台 `client-request` 信封（rpc-schema.ts:35-40）。
 * 只做最小必要校验：脏信封一律返回 undefined，由调用方回 400。
 * @param {unknown} body 已解析的 JSON 体
 * @returns {{ rpcId: string, method: string, payload: unknown } | undefined}
 */
export function parseEnvelope(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined
  const { type, rpcId, method } = /** @type {Record<string, unknown>} */ (body)
  if (type !== 'client-request') return undefined
  if (typeof rpcId !== 'string' || rpcId === '') return undefined
  if (typeof method !== 'string') return undefined
  return { rpcId, method, payload: /** @type {Record<string, unknown>} */ (body).payload }
}

/**
 * 封装平台 `server-response` 信封（rpc-schema.ts:43-47）。
 * @param {string} rpcId 请求带回的相关 id
 * @param {{ ok: boolean, value?: unknown, error?: unknown }} result 平台 Result 形状
 * @returns {{ type: 'server-response', rpcId: string, result: unknown }}
 */
export function envelopeOf(rpcId, result) {
  if (result && result.ok === true) {
    // 与平台 fullResponse 同形：成功体剥离 `attachments`（本插件通道不用附件，故恒为 JSON）。
    const { attachments, ...success } = /** @type {Record<string, unknown>} */ (result)
    void attachments
    return { type: 'server-response', rpcId, result: success }
  }
  return { type: 'server-response', rpcId, result }
}

/**
 * 把一个「(endpoint, payload) => Result」分发器装成 `/api/<ns>/<ep>` 的精确 Fetch 路由。
 *
 * 每个端点一条路由（`fetch.register` 按完整 pathname 精确匹配，无前缀形态）。
 * 生命周期：`ctx.effect(...)` 挂在本插件 fiber 上 ⇒ 随行卸载自动摘除（实测卸载后该路径 404）。
 * 非 web 载体（`connection.fetch` 不可用）时**安静降级**：不注册、不抛、不 PENDING。
 *
 * @param {object} ctx Host 插件上下文（须已静态 inject `connection`）
 * @param {object} options
 * @param {string} options.namespace 命名空间段
 * @param {string[]} options.endpoints 端点名清单（应与 dispatch 认可的集合一致）
 * @param {(endpoint: string, payload: unknown) => Promise<{ ok: boolean, value?: unknown, error?: unknown }>} options.dispatch 分发器
 * @param {string} [options.label] effect 标签
 * @param {(msg: string) => void} [options.warn] 降级告警出口
 * @returns {void}
 */
export function registerRpcChannel(ctx, { namespace, endpoints, dispatch, label = 'rpc', warn }) {
  const connection = /** @type {any} */ (ctx).connection
  // 降级判定：非 web 载体上 connection 可能不提供 fetch 注册面。此时不注册（插件其余功能照常）。
  if (connection === undefined || connection === null || typeof connection.fetch?.register !== 'function') {
    warn?.(`${label}: connection.fetch 注册面不可用（非 web 载体？）⇒ 不注册 RPC 通道，插件其余功能照常`)
    return
  }

  for (const endpoint of endpoints) {
    if (!isValidEndpoint(endpoint)) {
      warn?.(`${label}: 跳过非法端点名 ${JSON.stringify(endpoint)}（不满足平台端点段文法）`)
      continue
    }
    const path = `${API_CHANNEL}/${namespace}/${endpoint}`
    ctx.effect(() => connection.fetch.register({
      path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (/** @type {Request} */ request) => {
        // 与平台 rpcFetchHandler 同形的入站校验（安全语义在 /api 侧已先行，这里是契约面）。
        if (request.method !== 'POST') return new Response('not found', { status: 404 })
        const mediaType = String(request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
        if (mediaType !== 'application/json') return new Response('content type must be application/json', { status: 415 })

        let body
        try {
          body = await request.json()
        } catch {
          return new Response('body is not JSON', { status: 400 })
        }
        const message = parseEnvelope(body)
        // 端点必须与路径一致（平台对 method≠endpoint 一律拒）。
        if (message === undefined || message.method !== qualified(namespace, endpoint)) {
          return new Response('invalid client-request message', { status: 400 })
        }
        try {
          // signal 不透传（与 createDispatch 的既有语义一致：写操作断连也必须跑完）。
          // 体积上限/背压/断连排空已由平台 bridge 在调用我们之前完成。
          return Response.json(envelopeOf(message.rpcId, await dispatch(endpoint, message.payload)))
        } catch (error) {
          // dispatch 保证绝不外抛；真外抛则与平台同形：500 明文带原文。
          return new Response(`handler failure: ${String(error)}`, { status: 500 })
        }
      },
    }), `${label}: ${path}`)
  }
}
