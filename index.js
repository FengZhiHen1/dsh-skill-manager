// dsh-skill-manager — DSH Host 插件入口（plugin-runtime.md）。
//
// 职责：
// - 注册 settings 命名空间 skill-manager（workshopDir 默认空串；validate 拒绝
//   非绝对路径或不存在的目录），`applies: live` 保存即生效（R-22 / DSR-005）。
// - 注册 /skill-manager/api 路由（受信请求围栏 + 单飞队列 + 统一信封）。
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
//   lib/state.js     — state/apps、项目注册表、挂载规则
//   lib/sync.js      — 挂载推导、物化、对账、健康、项目既有条目
//   lib/inbound.js   — 搜索/探测/入库/检查/更新/导入/出库/恢复/禁用启用
//   lib/api.js       — HTTP 信封、单飞队列、方法分发
//
// 权威语义：docs/design/dsh-skill-manager/（本仓库）。

import { registerConfig } from './lib/workshop.js'
import { ApiError, buildApi, createQueue, readJsonBody, writeJson, writeOk, writeError } from './lib/api.js'
import { isTrustedApiRequest, trustedHostsOf } from './lib/fence.js'

export default {
  name: 'skill-manager',
  inject: ['webServer', 'loader'],
  apply(ctx) {
    // settings 命名空间注册；scope 在 apply 期间同步就位（settings 为硬依赖）。
    let scope
    ctx.inject(['settings'], (sctx) => {
      scope = registerConfig(sctx)
    })

    const queue = createQueue()
    const trustedHosts = trustedHostsOf(ctx)
    const fence = (req) => isTrustedApiRequest(req, trustedHosts)
    const api = buildApi(() => scope)

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
  },
}
