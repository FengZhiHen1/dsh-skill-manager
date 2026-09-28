// index — DSH Host 侧装配入口：把 Config 意图、storage 投影、RPC 通道与后台对账接成一个 fiber。
//
// 边界：只做装配，不含领域逻辑；模块清单与分层规则见 docs/项目结构设计.md。
// 0.1.7 配置模型（知识库 host/07 §1-§3）：配置真相 = 本行 loader entry 的 Cordis `Config`，
// 由 loader 在 apply 之前校验并填默认，`apply(ctx, config)` 收到即完整配置；即时字段是
// volatile 引用，**操作时现读** `ref.get()`。旧注册面（`ctx.settings.register` / SettingsScope /
// `scope.watch`）已整体作废，本文件相应改为「现读门面 + loader/volatile-update 触发对账」。
// 参考：插件运行时.md、挂载与同步.md；DSR-015（分层）、DSR-014（RPC 通道）、DSR-025（配置模型）。

import { Config, assertConfigValid, configReader, installConfigValidation } from './settings.js'
import { openStore } from './storage.js'
import { migrateLegacyIntent } from './migrate.js'
import { createSharedCache } from '../core/base/cache.js'
import { createAudit } from '../core/base/audit.js'
import { buildApi, createDispatch, createQueue } from '../core/service.js'

/**
 * profile 名从启动参数现取：知识库确认平台只承诺 ctx.dshHomePath（19-services-index），
 * 没有 profile 可读面，而实例一律以 `--profile <name>` 启动（启动器与手工皆然）。
 * 取不到写 null——台账键名不变，日后平台开放该面时填入即改值不改格式。
 */
function profileFromArgv() {
  const i = process.argv.indexOf('--profile')
  const name = i >= 0 ? process.argv[i + 1] : undefined
  return typeof name === 'string' && name !== '' && !name.startsWith('-') ? name : null
}

export default {
  name: 'skill-manager',
  inject: ['connection', 'workspaceRegistry', 'storage', 'dshHomePath', 'settings'],
  // loader 读 plugin.Config（vendor/cordis/src/registry.ts:326）——对象式插件形态把 Config
  // 挂在本对象上；具名 export 到不了这里（unwrapExports 取 `exports.default ?? exports`）。
  Config,
  /**
   * @param {object} ctx Host 插件上下文
   * @param {object} config loader 按 Config 校验并填默认后的配置（即时字段为 volatile 引用）
   */
  apply(ctx, config = {}) {
    // 挂载期跨字段校验：`internal/config` 监听器在本行初次解析时尚未注册（解析先于 apply），
    // 故初次校验只能在这里做。抛错 = 行挂载失败（响亮），不把非法配置带进第一次调用。
    assertConfigValid(config)
    // volatile 热更候选的解析前校验（设置页写入的那条路径）。
    installConfigValidation(ctx)

    // 配置只读门面：core 只依赖 `.get()`，每次调用现读 volatile 引用，
    // 于是「目录/开关改完立即生效」不依赖任何 watch 回调。
    const scope = configReader(config)

    // 旧意图一次性迁移（storage → 配置行），失败仅告警，不拖垮启动。
    // 延到本 fiber ACTIVE 之后是硬要求：写面 `ctx.settings.update` 要求该 ns 已出现在
    // `describe()` 结果里，而 describe 只收 ACTIVE 的行（settings/src/index.ts:302-307），
    // 在 apply 内直接写会撞 "is no longer configurable"。
    // `fiber.await()` 在就绪与启动失败两种结局都会结算（后者以启动错误 reject）。
    // 读面（旧域）不依赖 ACTIVE，但「迁移先于 openStore」是同名域硬约束，故整条链挂在它之后。
    const migratePromise = ctx.fiber
      .await()
      .then(() => migrateLegacyIntent(ctx, scope, ctx.logger), () => false)
      .catch((error) => {
        ctx.logger?.warn?.(`dsh-skill-manager: 意图迁移失败（跳过，按新配置空意图启动）：${error?.message ?? String(error)}`)
      })

    // storage 域单实例打开。apply 同步返回、域异步就绪，打开失败只降级 API，不拖垮 Host。
    // 关闭挂进 fiber dispose 的 async disposer：fiber 推进 DISPOSED 前会等它结算。
    // 于是重载或依赖重启时旧域先关，新 apply 的 openStore 不会撞 already-open。
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
    ctx.effect(() => async () => {
      const opened = await storeReady
      try {
        await opened?.close()
      } catch (error) {
        ctx.logger?.warn?.(`dsh-skill-manager: storage 域关闭失败：${error?.message ?? String(error)}`)
      }
    }, 'dsh-skill-manager: close storage domain')

    // 设置页策略：本插件自绘配置页（浏览器半区注册进 Plugins 页的 plugins.row.config），
    // 关掉按 schema 自动生成的页面，避免将来客户端自动出第二份重复表单。
    ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber), 'dsh-skill-manager: settings presentation')

    // 备份树根 = $DSH_HOME/skill-manager/backups。
    const backupsRoot = ctx.dshHomePath('skill-manager', 'backups')
    // DSH 全局 skill 根 = $DSH_HOME/skills，与 dsh-skill-filesystem 同源。
    const globalRootPath = ctx.dshHomePath('skills')
    // 插件库根 = $DSH_HOME/skill-manager/library：GitHub 外部 skill 专属（DSR-020 双根制），
    // 与用户配置的 skillsDir 物理隔离，本地编辑/整理动作不波及外部条目。
    const libraryRoot = ctx.dshHomePath('skill-manager', 'library')
    // 审计台账 = $DSH_HOME/skill-manager/audit.jsonl（DSR-022）：动手前落 pending，动完补终态。
    // 按 HOME 分文件天然隔离，无需跨进程加锁（两实例共用 HOME 属 AGENTS.md Security 红线）。
    const audit = createAudit({
      file: ctx.dshHomePath('skill-manager', 'audit.jsonl'),
      profile: profileFromArgv(),
      logger: ctx.logger,
    })

    // 三路排队：READ 快照 / NET 网络 / WRITE FIFO。后两路由 createDispatch 内建，
    // 唯有 WRITE FIFO 由本装配创建并注入——后台对账器要与 RPC 写同队（见下）。
    // bundle 缓存跨分发共享，读路径与写后预热都落在这里。
    const writeQueue = createQueue()
    const sharedCache = createSharedCache()
    // workspaceRegistry 是项目级目标的唯一事实源，Client 不参与路径解析。
    const api = buildApi(() => scope, {
      listWorkspaces: () => ctx.workspaceRegistry.list(),
      getStore,
      backupsRoot,
      globalRoot: globalRootPath,
      libraryRoot,
      cache: sharedCache,
      logger: ctx.logger,
      audit,
    })

    // 对账器：配置变更（设置页直写、Plugins 页配置页写入或外部编辑 profile patch）经
    // 200ms 防抖后触发 sync 收敛。对账失败落进各条目的 linkState，由 overview 下发。
    // 触发面 = `loader/volatile-update`：loader 把 volatile 值提交进**运行中** fiber 后
    // 只派发给所属 fiber（vendor/loader/src/config/entry.ts:186-193），正是「本行配置变了」。
    // 旧代的 `scope.watch` 已随 SettingsScope 消失。非 volatile 改动走普通重挂载
    // （本插件全部字段 volatile，故不走那条路）。
    // 这里只记 warn 不外抛：写配置的调用方无感知等待收敛结果。
    let reconcileTimer = null
    const offWatch = ctx.on('loader/volatile-update', () => {
      clearTimeout(reconcileTimer)
      reconcileTimer = setTimeout(() => {
        // 对账走注入的 WRITE FIFO，不自起一路：
        // ① 两路全量对账并发时会对同一目标同时建链，后到者吃 EEXIST 误报「挂载失败」；
        // ② createDispatch 的读屏障只看 writeQueue.busy，对账不入队就不被它覆盖，
        //    Client 在防抖窗口后自动刷新（section.jsx converge）会读到半收敛现场。
        // meta 是给台账的归因，不是负载：后台收敛与 RPC 触发的对账由此可分辨。
        void writeQueue.enqueue(() => api.sync({}, { entry: 'watch', method: 'volatile-update' })).catch((error) => {
          ctx.logger?.warn?.(`dsh-skill-manager: 配置对账失败（详见健康列表）：${error?.message ?? String(error)}`)
        })
      }, 200)
    })

    // 启动预热：配置过目录时延迟 1s 后台扫一次 bundle 快照，首次打开技能页秒出。
    // 预热失败是可接受降级：冷扫由首次真实读承担，错误面在各自的 Result 里呈现。
    const warmTimer = setTimeout(() => {
      void api.warm().catch(() => {}) // quality-floor: ignore silent-catch 预热失败是可接受降级：冷扫由首次真实读承担，错误面在各自的 Result 里呈现
    }, 1000)

    ctx.effect(() => () => {
      offWatch()
      clearTimeout(reconcileTimer)
      clearTimeout(warmTimer)
    }, 'dsh-skill-manager: config watcher and warmup')

    // RPC 通道：/skill-manager 前缀挂 connection.rpc，围栏与 JSON 信封由平台承担。
    // handler 必须返回 Result，抛错会退化成 500 纯文本——createDispatch 保证绝不外抛。
    // handle 经 owner.effect 自持生命周期，随本插件 fiber 注销，无需插件清理。
    ctx.connection.rpc.handle('/skill-manager', createDispatch(api, { writeQueue }))
  },
}
