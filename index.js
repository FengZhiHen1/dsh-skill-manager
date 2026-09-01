// dsh-skill-manager — DSH Host 插件入口（plugin-runtime.md）。
//
// 职责（配置即意图）：
// - 注册 settings 命名空间 skill-manager（skillsDir + groups + skills +
//   intentMigrated；validate 形式校验；applies: live 保存即生效）。
//   用户意图的唯一事实源 = settings.yaml 的 skill-manager 段；浏览器端经
//   标准 settings 域（settingsScope）直读直写，不经过自定义 HTTP 协议。
// - 旧 storage 意图一次性迁移（lib/migrate.js）投影进配置。
// - 打开 storage 域 skill_manager（五表投影：skills/synced/projects/
//   check_cache/backups）；打开失败只记日志，API 统一回 internal，不拖垮 Host。
// - 对账器：scope.watch 监听配置变更 → 200ms 防抖 → sync（bundle+reconcile+
//   物化+预热缓存）；对账错误进健康列表（health），不打断配置编辑。
// - 注册 /skill-manager/api 路由（受信请求围栏 + 三路队列 + 统一信封），
//   只提供只读视图与网络/文件操作（配置读写不在此层）。
// - 未配置 skills 目录时所有方法统一返回 skilldir-unconfigured。
// - 备份树根：ctx.dshHomePath('skill-manager', 'backups')（DSR-010 D5）。
//
// 部署形态：真实插件包 + cordis.patch.yml insert 行；禁止与 dsh.profile.bundles
// 同时挂载同一行（双重挂载 → duplicate loader entry id）。
//
// 模块布局：
//   lib/errors.js    — SkillManagerError 稳定错误类型
//   lib/dir.js       — 配置命名空间（意图 schema + 形式校验）、目录门禁、原子写
//   lib/store.js     — storage 域 spec（五表投影 + 旧七表迁移 spec）与读写门面
//   lib/migrate.js   — 旧 storage 意图一次性迁移进 settings
//   lib/cache.js     — 进程内缓存层（bundle 快照、meta、dirHash、health 代际）
//   lib/fence.js     — 受信请求围栏
//   lib/zip.js       — 极简 ZIP 读取器（零依赖）
//   lib/net.js       — skills.sh / GitHub 网络通道
//   lib/library.js   — 库扫描、frontmatter、内容哈希基线
//   lib/groups.js    — 组文档纯推导（意图来自配置）
//   lib/state.js     — 挂载状态投影、工作区镜像
//   lib/sync.js      — 挂载推导、物化、对账、健康、项目既有条目
//   lib/inbound.js   — 搜索/探测/入库/检查/更新/导入/出库/恢复
//   lib/api.js       — HTTP 信封、三路队列、只读视图与文件/网络操作
//
// 权威语义：docs/design/dsh-skill-manager/（本仓库）。

import { registerConfig } from './lib/dir.js'
import { openStore } from './lib/store.js'
import { migrateLegacyIntent } from './lib/migrate.js'
import { createSharedCache } from './lib/cache.js'
import { ApiError, buildApi, createQueue, readJsonBody, writeJson, writeOk, writeError } from './lib/api.js'
import { isTrustedApiRequest, trustedHostsOf } from './lib/fence.js'

/** 读方法：不排队，直接走进程内 bundle 缓存快照（写屏障由 createQueue.busy 对齐）。 */
const READ_METHODS = new Set(['overview', 'warm', 'health', 'project-skills', 'backups'])
/** 网络慢方法：独立队列，绝不阻塞读写。 */
const NET_METHODS = new Set(['check', 'search', 'repo-skills'])
// 其余方法（add/update/import/remove/restore/claim-empty/sync）= 文件写操作，FIFO 串行。

export default {
  name: 'skill-manager',
  inject: ['webServer', 'loader', 'workspaceRegistry', 'storage', 'dshHomePath', 'settings'],
  apply(ctx) {
    // settings 命名空间注册（硬依赖：配置即意图，settings 服务是插件核心）。
    const scope = registerConfig(ctx)

    // 旧意图一次性迁移（storage → settings）；失败仅告警，不拖垮启动。
    // 必须先于 openStore：legacy 域与新 spec 域同名，并发打开会 already-open。
    const migratePromise = migrateLegacyIntent(ctx, scope, ctx.logger).catch((error) => {
      ctx.logger?.warn?.(`dsh-skill-manager: 意图迁移失败（跳过，按新配置空意图启动）：${error?.message ?? String(error)}`)
    })

    // storage 域（单实例打开；apply 同步返回，域异步就绪。失败仅降级 API，不拖垮 Host）。
    let store = null
    let storeError = null
    const storeReady = migratePromise
      .then(() => openStore(ctx))
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
    // DSH 全局 skill 根（$DSH_HOME/skills）：与 dsh-skill-filesystem 的
    // resolveDshHome 同源，不再由 homedir 硬编码推导（mount-sync.md）。
    const globalRootPath = ctx.dshHomePath('skills')

    // 队列：文件写操作 FIFO 串行（R-17 写写互斥）；网络慢操作独立；
    // 读请求不排队（bundle 缓存快照 + 写屏障对齐，plugin-runtime.md「低延迟路径」）。
    const writeQueue = createQueue()
    const netQueue = createQueue()
    const sharedCache = createSharedCache()
    const trustedHosts = trustedHostsOf(ctx)
    const fence = (req) => isTrustedApiRequest(req, trustedHosts)
    // Host workspaceRegistry 是项目级目标与路径的唯一事实源；Client 不参与路径解析。
    const api = buildApi(() => scope, {
      listWorkspaces: () => ctx.workspaceRegistry.list(),
      getStore,
      backupsRoot,
      globalRoot: globalRootPath,
      cache: sharedCache,
    })

    // 对账器：配置变更（settings 直写/外部编辑）→ 200ms 防抖 → sync 对账
    // （bundle + reconcile + 物化 + 预热缓存）。对账失败进健康列表（health），
    // 此处只吞异常避免未处理拒绝。写配置的调用方无感知等待。
    let reconcileTimer = null
    const offWatch = scope.watch(() => {
      clearTimeout(reconcileTimer)
      reconcileTimer = setTimeout(() => {
        void api.sync({}).catch((error) => {
          ctx.logger?.warn?.(`dsh-skill-manager: 配置对账失败（详见健康列表）：${error?.message ?? String(error)}`)
        })
      }, 200)
    })

    // 启动预热：配置过目录时延迟 1s 后台扫一次并缓存 health，首次打开设置页秒出。
    const warmTimer = setTimeout(() => {
      void api.warm().catch(() => {})
    }, 1000)

    ctx.effect(() => () => {
      offWatch()
      clearTimeout(reconcileTimer)
      clearTimeout(warmTimer)
    }, 'dsh-skill-manager: config watcher and warmup')

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
          const invoke = () => api[method](body?.payload ?? {})
          let result
          if (READ_METHODS.has(method)) {
            // 读路径：写操作进行中则等其结算（避免冷扫读到半写状态），否则直接走缓存快照。
            if (writeQueue.busy) await writeQueue.idle()
            result = await invoke()
          } else if (NET_METHODS.has(method)) {
            result = await netQueue.enqueue(invoke)
          } else {
            result = await writeQueue.enqueue(invoke)
          }
          writeOk(res, result)
        } catch (error) {
          writeError(res, error)
        }
      },
    }), 'dsh-skill-manager: /skill-manager/api route')
  },
}
