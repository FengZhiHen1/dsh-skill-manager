// dsh-skill-manager — DSH Host 插件入口（plugin-runtime.md）。
//
// 职责：
// - 注册 settings 命名空间 skill-manager（workshopDir 默认空串；validate 拒绝
//   非绝对路径或不存在的目录），`applies: live` 保存即生效（R-22 / DSR-005）。
// - 注册 /skill-manager/api 路由（受信请求围栏 + 单飞队列 + 统一信封）。
// - 注册 connection 配置 RPC 通道 /dsh-skill-manager（endpoint config：
//   get/set/reset），供浏览器端配置卡片读写 workshopDir——settings 网关只对
//   硬编码白名单（api-proxy WEB_SETTINGS_NAMESPACES）开放，第三方命名空间
//   会被 settings-not-exposed 拒绝，因此浏览器端不走 ctx.settingsScope，改用
//   自定义通道 + 进程内 scope.update/replace 持久化（对齐 dsh-background）。
// - 未配置车间根时所有方法统一返回 workshop-unconfigured。
//
// 部署形态：真实插件包 + cordis.patch.yml insert 行；禁止与 dsh.profile.bundles
// 同时挂载同一行（双重挂载 → duplicate loader entry id）。
//
// 模块布局：
//   lib/errors.js    — WorkshopError 稳定错误类型
//   lib/workshop.js  — 配置命名空间、车间根门禁、原子读写
//   lib/fence.js     — 受信请求围栏
//   lib/git.js       — git 通道（约定路径提交、指纹、ls-remote）
//   lib/zip.js       — 极简 ZIP 读取器（零依赖）
//   lib/net.js       — skills.sh / GitHub 网络通道
//   lib/library.js   — 库扫描、frontmatter、锁文件
//   lib/groups.js    — 分组
//   lib/state.js     — state/apps、工作区兼容镜像、挂载规则
//   lib/sync.js      — 工作区挂载推导、物化、对账、健康、项目既有条目
//   lib/inbound.js   — 搜索/探测/入库/检查/更新/导入/出库/恢复/禁用启用
//   lib/api.js       — HTTP 信封、单飞队列、方法分发
//
// 权威语义：docs/design/dsh-skill-manager/（本仓库）。

import { registerConfig, CONFIG_NS, WORKSHOP_DIR_FIELD } from './lib/workshop.js'
import { ApiError, buildApi, createQueue, readJsonBody, writeJson, writeOk, writeError } from './lib/api.js'
import { isTrustedApiRequest, trustedHostsOf } from './lib/fence.js'

/** RPC 信封错误（connection 通道返回形态，对齐 dsh-background）。 */
function rpcError(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

export default {
  name: 'skill-manager',
  inject: ['webServer', 'loader', 'connection', 'workspaceRegistry'],
  apply(ctx) {
    // settings 命名空间注册；scope 在 apply 期间同步就位（settings 为硬依赖）。
    let scope
    let settingsSvc
    ctx.inject(['settings'], (sctx) => {
      settingsSvc = sctx.settings
      scope = registerConfig(sctx)
    })

    const queue = createQueue()
    const trustedHosts = trustedHostsOf(ctx)
    const fence = (req) => isTrustedApiRequest(req, trustedHosts)
    // Host workspaceRegistry 是项目级目标与路径的唯一事实源；Client 不参与路径解析。
    const api = buildApi(() => scope, { listWorkspaces: () => ctx.workspaceRegistry.list() })

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/skill-manager/api',
      handler: async (req, res) => {
        if (!fence(req)) {
          writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden', retryable: false } })
          return
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed', retryable: false } })
          return
        }
        try {
          const body = await readJsonBody(req)
          const method = body?.method
          if (typeof method !== 'string' || !(method in api)) {
            throw new ApiError('not-found', `unknown skill-manager API method "${String(method)}"`)
          }
          // 单飞队列：读写共用，串行执行（R-17）
          const result = await queue.enqueue(() => api[method](body?.payload ?? {}))
          writeOk(res, result)
        } catch (error) {
          writeError(res, error)
        }
      },
    }), 'dsh-skill-manager: /skill-manager/api route')

    // 配置 RPC 通道（plugin-runtime.md：settings 网关不对第三方命名空间开放，
    // 浏览器端经此通道读写 workshopDir；持久化走进程内 settings seam）。
    ctx.inject(['connection'], (connCtx) => {
      connCtx.effect(() => connCtx.connection.rpc.handle('/dsh-skill-manager', async (endpoint, payload) => {
        if (endpoint !== 'config') {
          return rpcError('not-found', `dsh-skill-manager: unknown endpoint "${endpoint}"`)
        }
        if (scope === undefined) {
          return rpcError('service-unavailable', 'dsh-skill-manager: settings 服务未挂载')
        }
        /** 当前解析值 + 用户层覆盖标记（与设置页卡片语义一致）。 */
        const snapshot = () => {
          const section = scope.get()
          const user = settingsSvc.describe({ redactSecrets: true })
            .find((d) => d.ns === CONFIG_NS)?.user
          return {
            workshopDir: typeof section?.[WORKSHOP_DIR_FIELD] === 'string' ? section[WORKSHOP_DIR_FIELD] : '',
            overridden: Boolean(user && typeof user === 'object' && WORKSHOP_DIR_FIELD in user),
          }
        }
        try {
          if (payload?.op === 'get') return { ok: true, value: snapshot() }
          if (payload?.op === 'set') {
            // 形式校验交给注册期 validate（非空必须是绝对路径），拒绝不落盘。
            await scope.update({
              [WORKSHOP_DIR_FIELD]: typeof payload.workshopDir === 'string' ? payload.workshopDir.trim() : '',
            })
            return { ok: true, value: snapshot() }
          }
          if (payload?.op === 'reset') {
            // 整体重置用户段：清空即回到未配置（默认空串），去掉覆盖标记。
            await scope.replace({})
            return { ok: true, value: snapshot() }
          }
          return rpcError('bad-request', 'dsh-skill-manager: op 必须是 get/set/reset')
        } catch (error) {
          return rpcError('rejected', error instanceof Error ? error.message : String(error))
        }
      }, {}), 'dsh-skill-manager: config rpc channel')
    })
  },
}
