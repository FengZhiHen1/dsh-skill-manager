// dsh-skill-manager — DSH Host 插件入口（plugin-runtime.md）。
//
// 职责：
// - 注册 settings 命名空间 skill-manager（skillsDir 默认空串；validate 仅形式
//   校验绝对路径，目录存在性是运行期条件），`applies: live` 保存即生效（R-22 / DSR-005）。
// - 打开 storage 域 skill_manager（skills/groups/mounts/synced/projects/
//   check_cache/backups 七表，DSR-010）；打开失败只记日志，API 统一回 internal，
//   不拖垮 Host。
// - 注册 /skill-manager/api 路由（受信请求围栏 + 单飞队列 + 统一信封）。
// - settings 命名空间注册：rc.7 起注册即暴露，浏览器端配置卡片经标准
//   settings 域（ctx.settingsScope → settings.describe/mutate）直读直写
//   skillsDir，Host 侧仅注册并在写路径上执行 validate（非空必须绝对路径）。
//   （旧版因 settings-not-exposed 白名单改走 /dsh-skill-manager 自定义
//   connection RPC 通道，已在 rc.7 迁移中移除。）
// - 未配置 skills 目录时所有方法统一返回 skilldir-unconfigured。
// - 备份树根：ctx.dshHomePath('skill-manager', 'backups')（DSR-010 D5）。
//
// 部署形态：真实插件包 + cordis.patch.yml insert 行；禁止与 dsh.profile.bundles
// 同时挂载同一行（双重挂载 → duplicate loader entry id）。
//
// 模块布局：
//   lib/errors.js    — SkillManagerError 稳定错误类型
//   lib/dir.js       — 配置命名空间、skills 目录门禁、安全路径与原子写
//   lib/store.js     — storage 域 spec 与读写门面
//   lib/fence.js     — 受信请求围栏
//   lib/zip.js       — 极简 ZIP 读取器（零依赖）
//   lib/net.js       — skills.sh / GitHub 网络通道
//   lib/library.js   — 库扫描、frontmatter、内容哈希基线
//   lib/groups.js    — 分组
//   lib/state.js     — 挂载状态投影、工作区镜像、挂载规则
//   lib/sync.js      — 工作区挂载推导、物化、对账、健康、项目既有条目
//   lib/inbound.js   — 搜索/探测/入库/检查/更新/导入/出库/恢复/禁用启用
//   lib/api.js       — HTTP 信封、单飞队列、方法分发
//
// 权威语义：docs/design/dsh-skill-manager/（本仓库）。

import { registerConfig } from './lib/dir.js'
import { openStore } from './lib/store.js'
import { ApiError, buildApi, createQueue, readJsonBody, writeJson, writeOk, writeError } from './lib/api.js'
import { isTrustedApiRequest, trustedHostsOf } from './lib/fence.js'

export default {
  name: 'skill-manager',
  inject: ['webServer', 'loader', 'workspaceRegistry', 'storage', 'dshHomePath'],
  apply(ctx) {
    // settings 命名空间注册；scope 在 apply 期间同步就位（settings 为硬依赖）。
    let scope
    ctx.inject(['settings'], (sctx) => {
      scope = registerConfig(sctx)
    })

    // storage 域（单实例打开；apply 同步返回，域异步就绪。失败仅降级 API，不拖垮 Host）。
    let store = null
    let storeError = null
    const storeReady = openStore(ctx)
      .then((opened) => {
        store = opened
        return opened
      })
      .catch((error) => {
        storeError = error
        ctx.logger?.warn?.(`dsh-skill-manager: storage 域打开失败，管理 API 将返回 internal：${error?.message ?? error}`)
        return null
      })
    const getStore = () => {
      if (store === null) throw storeError ?? new Error('storage 域尚未就绪')
      return store
    }
    ctx.effect(() => () => {
      void storeReady.then((opened) => opened?.close())
    }, 'dsh-skill-manager: close storage domain')

    // 备份树根（$DSH_HOME/skill-manager/backups/）。
    const backupsRoot = ctx.dshHomePath('skill-manager', 'backups')

    const queue = createQueue()
    const trustedHosts = trustedHostsOf(ctx)
    const fence = (req) => isTrustedApiRequest(req, trustedHosts)
    // Host workspaceRegistry 是项目级目标与路径的唯一事实源；Client 不参与路径解析。
    const api = buildApi(() => scope, {
      listWorkspaces: () => ctx.workspaceRegistry.list(),
      getStore,
      backupsRoot,
    })

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
