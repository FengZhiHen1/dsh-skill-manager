// dsh-skill-manager — DSH Host 插件入口（插件运行时.md）。
//
// 职责（配置即意图）：
// - 注册 settings 命名空间 skill-manager（skillsDir + groups + skills +
//   intentMigrated；validate 形式校验；applies: live 保存即生效）。
//   用户意图的唯一事实源 = settings.yaml 的 skill-manager 段；浏览器端经
//   标准 settings 域（settingsScope）直读直写，不经过自定义 HTTP 协议。
// - 旧 storage 意图一次性迁移（src/adapter/migrate.js）投影进配置。
// - 打开 storage 域 skill_manager（两表运行时投影：skills/check_cache，
//   DSR-017）；打开失败只记日志，API 统一回 internal，不拖垮 Host。
// - 对账器：scope.watch 监听配置变更 → 200ms 防抖 → sync（bundle+reconcile+
//   junction 物化+预热缓存）；对账错误入行状态（overview 下发），不打断配置编辑。
// - 注册 /skill-manager/api 路由（受信请求围栏 + 三路队列 + 统一信封），
//   只提供只读视图与网络/文件操作（配置读写不在此层）。
// - 未配置 skills 目录时所有方法统一返回 skilldir-unconfigured。
// - 备份树根：ctx.dshHomePath('skill-manager', 'backups')（DSR-010 D5）。
//
// 部署形态：真实插件包 + cordis.patch.yml insert 行；禁止与 dsh.profile.bundles
// 同时挂载同一行（双重挂载 → duplicate loader entry id）。
//
// 模块布局（P1 分层重划，DSR-015；依赖方向 base ← model ← {mount, inbound} ← service ← adapter）：
//   src/core/base/errors.js       — SkillManagerError 稳定错误类型
//   src/core/base/fsys.js         — fs/路径原语（safePath、existsDir、原子写、withinRoot、readLinkTarget 等）
//   src/core/base/cache.js        — 进程内缓存层（bundle 快照、meta、dirHash、health 代际）
//   src/core/base/zip.js          — 极简 ZIP 读取器（零依赖）
//   src/core/base/net.js          — skills.sh / GitHub 网络通道
//   src/core/model/intent.js      — 配置即意图模型（schema、形式校验、requireDir）+ 组纯推导
//   src/core/model/store.js       — storage 域形状（zod schema、构建器、键）与读写门面
//   src/core/model/library.js     — 库扫描、frontmatter、内容哈希基线
//   src/core/mount/derive.js      — 挂载推导与工作区投影（targetKey/deriveDesired/targetDir/全局根回退）
//   src/core/mount/materialize.js — junction-only 物化与摘除（挂载与同步.md「物化」）
//   src/core/mount/inspect.js     — 归属判据单源（scanMountLinks/findOrphanLinks）与行状态走查
//   src/core/mount/reconcile.js   — 对账编排（摘除=清扫单源 → junction 物化 → git exclude，无台账写回）
//   src/core/inbound/zipball.js   — zipball → skill 目录管线与入站域共享原语
//   src/core/inbound/acquire.js   — 搜索 / 仓库探测 / 入库（原子换装）
//   src/core/inbound/upstream.js  — 上游检查与更新（结果逐条写 check_cache；覆盖走原子换装）
//   src/core/inbound/backups.js   — 出库 / 备份列表 / 恢复（备份事实源=目录+meta；importSkill 退役中）
//   src/core/service.js           — 方法表、三路队列、只读视图与文件/网络操作（原 lib/api.js）
//   src/adapter/settings.js       — settings 命名空间注册（唯一 @deepseek-ai/dsh-settings import）
//   src/adapter/storage.js        — storage 域 defineDomain/domainTable 包裹与 openStore
//   src/adapter/migrate.js        — 旧 storage 意图一次性迁移
//   src/adapter/fence.js          — 受信请求围栏（临时，P4 随 connection.rpc 迁移删除）
//   src/adapter/index.js          — 本文件：插件入口
//
// 权威语义：docs/（本仓库）。

import { registerConfig } from './settings.js'
import { openStore } from './storage.js'
import { migrateLegacyIntent } from './migrate.js'
import { createSharedCache } from '../core/base/cache.js'
import { ApiError, buildApi, createQueue, readJsonBody, writeJson, writeOk, writeError } from '../core/service.js'
import { isTrustedApiRequest, trustedHostsOf } from './fence.js'

/** 读方法：不排队，直接走进程内 bundle 缓存快照（写屏障由 createQueue.busy 对齐）。 */
const READ_METHODS = new Set(['overview', 'warm', 'backups'])
/** 网络慢方法：独立队列，绝不阻塞读写。 */
const NET_METHODS = new Set(['check', 'search', 'repo-skills'])
// 其余方法（add/update/remove/restore/sync）= 文件写操作，FIFO 串行。

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
    // resolveDshHome 同源，不再由 homedir 硬编码推导（挂载与同步.md）。
    const globalRootPath = ctx.dshHomePath('skills')

    // 队列：文件写操作 FIFO 串行（R-17 写写互斥）；网络慢操作独立；
    // 读请求不排队（bundle 缓存快照 + 写屏障对齐，插件运行时.md「低延迟路径」）。
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
    // （bundle + reconcile + junction 物化 + 预热缓存）。对账失败进行状态
    // （overview 下发），此处只吞异常避免未处理拒绝。写配置的调用方无感知等待。
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
