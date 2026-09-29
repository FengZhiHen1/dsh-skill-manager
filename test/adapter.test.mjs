// adapter 装配（插件运行时.md；DSR-025）：apply 的硬时序（等 fiber 结算 → 迁移 → openStore）、
// storage 域降级、loader/volatile-update 防抖对账、internal/config 校验挂点、dispose 清理。
// fake ctx 直调 apply，不依赖真实 Host。
//
// 0.1.7 配置模型：配置真相在 apply 的第二个参数 `config`（即时字段是 volatile 引用，
// 现读 ref.get()）。旧代的 `ctx.settings.register()` 返回 SettingsScope 与 `scope.watch`
// 在新树零命中，故假 Host 只提供 `settings.configure`（页面策略）与 `settings.update`（写面）。
// 测试直接传**普通对象** config——生产是引用对象，readConfig 的鸭子类型让两者同形可读。

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import plugin from '../src/adapter/index.js'
import { isLink } from '../src/core/mount/materialize.js'
import { mkTmp, cleanup, writeSkill, fakeDomain } from './helpers.mjs'

/** 可控结算的 fiber 闸：等它放行后才推进「迁移 → openStore」链。 */
function createGate() {
  let open
  const promise = new Promise((resolve) => { open = resolve })
  return { promise, open: () => open() }
}

/**
 * 假 Host ctx：settings/storage/connection/workspaceRegistry/dshHomePath/effect 全记录。
 * 域句柄带 close 追踪；volatile 回调捕获供手动触发；fiber 结算由闸控制。
 */
function fakeCtx(home, { config, openImpl, updateImpl } = {}) {
  const calls = []
  const volatileListeners = new Set()
  const configListeners = new Set()
  const disposers = []
  const domains = []
  const routes = new Map()
  const gate = createGate()
  const defaultOpen = async (spec) => {
    const domain = fakeDomain()
    domain.closed = false
    const origClose = domain.close.bind(domain)
    domain.close = async () => {
      domain.closed = true
      return origClose()
    }
    domains.push(domain)
    calls.push(['open', Object.keys(spec.tables ?? {}).length])
    return domain
  }
  const ctx = {
    logger: { warn: (msg) => calls.push(['warn', String(msg)]) },
    // 0.1.7：settings 只提供「本实例页面策略」与写面；配置真相在 config 参数里。
    settings: {
      configure: (presentation, owner) => {
        calls.push(['configure', presentation.auto, owner === ctx.fiber])
        return () => calls.push(['configure-off'])
      },
      update: async (ns, patch) => {
        calls.push(['settings-update', ns, patch])
        // updateImpl 可返回「永不结算」的 promise，复刻平台侧写路径被 profile 协调卡住的形状（DSR-027）。
        return updateImpl === undefined ? undefined : updateImpl(ns, patch)
      },
    },
    fiber: { await: () => gate.promise },
    on: (event, fn) => {
      const set = event === 'loader/volatile-update' ? volatileListeners : configListeners
      set.add(fn)
      return () => set.delete(fn)
    },
    storage: { domain: { open: openImpl ?? defaultOpen } },
    workspaceRegistry: { list: () => [] },
    dshHomePath: (...parts) => join(home, ...parts),
    // 外层 ctx 的连接服务：`connection` 本身可用（本插件静态 inject 了它），但它的
    // `rpc.handle` 在生产里会触达 `owner.webServer` 而 owner 无该声明 ⇒ **直接调必抛**。
    // 这就是 DSR-028 的现场形态：抛的不是 connection，而是它内部的 webServer。
    // ⇒ 本插件因此改用 `connection.fetch.register`（`/api` 精确 Fetch 路由）：该面只写内部
    //   Map、不读 owner.webServer，且由 connection 自己正确挂载的 `/api` 承载。
    connection: {
      rpc: {
        handle: () => {
          throw new Error('cannot get property "webServer" without inject')
        },
      },
      // 精确 Fetch 路由表：**只记录，不代为完成任何事**（关键：桩必须落在失败点之外）。
      // 真实平台按完整 pathname 精确匹配 ⇒ 这里复刻同一语义，供用例自行派发验证。
      fetch: {
        register: (route) => {
          if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
          routes.set(route.path, route)
          calls.push(['fetch-route', route.path])
          return () => {
            routes.delete(route.path)
            calls.push(['fetch-route-off', route.path])
          }
        },
      },
    },
    routes,
    effect: (fn) => disposers.push(fn()),
    volatileListeners,
    configListeners,
    domains,
    calls,
    /** 放行 fiber 结算（生产里 = apply 返回后 fiber 转 ACTIVE）。 */
    openFiber: () => gate.open(),
    /** 以本 fiber 为 this 触发 internal/config 瀑布（生产里由 loader/config-editor 触发）。 */
    fireConfig(candidate, { asSelf = true } = {}) {
      let value = candidate
      const next = () => value
      for (const fn of [...ctx.configListeners]) fn.call(asSelf ? ctx.fiber : { alien: true }, candidate, next)
      return value
    },
    /** 触发 loader/volatile-update（只派发给所属 fiber）。 */
    fireVolatile() {
      for (const fn of [...ctx.volatileListeners]) fn([['skillsDir']])
    },
    /** 推进全部 disposer（模拟 fiber 销毁）。 */
    async dispose() {
      for (const d of disposers) await (typeof d === 'function' ? d() : d)
    },
  }
  return ctx
}

const CONFIG = (root, over = {}) => ({
  skillsDir: root,
  pi: false,
  intentMigrated: true,
  groups: { 默认: { mounts: [{ scope: 'global', project: null }] } },
  skills: {},
  ...over,
})

test('apply 装配：fiber 结算 → 迁移 → openStore；页面策略关自动表单；RPC 注册；dispose 全清', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))
  await writeSkill(root, 'pdf')
  const ctx = fakeCtx(home, { config: CONFIG(root, { intentMigrated: false }) })
  plugin.apply(ctx, CONFIG(root, { intentMigrated: false }))

  // 迁移与 openStore 都挂在 fiber 结算之后：闸未开时一个域都不许开
  // （写面 ctx.settings.update 要求该 ns 已出现在 describe() 里，而 describe 只收 ACTIVE 的行）。
  await new Promise((r) => setTimeout(r, 30))
  assert.deepEqual(ctx.calls.filter(([k]) => k === 'open'), [], 'fiber 未结算前不得开域')

  ctx.openFiber()
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(ctx.calls.filter(([k]) => k === 'open'), [['open', 7], ['open', 3]]) // legacy 七表先于新 spec（skills/check_cache/managed_links）
  // 自定义 RPC 能力挂在 `/api/<ns>/<endpoint>` 精确 Fetch 路由上（不再走 rpc.handle）。
  // 端点清单与 dispatch 认可的集合同源（api 的键），故这里逐端点核对路径。
  assert.deepEqual([...ctx.routes.keys()].sort(), [
    '/api/skill-manager/add',
    '/api/skill-manager/backups',
    '/api/skill-manager/check',
    '/api/skill-manager/overview',
    '/api/skill-manager/remove',
    '/api/skill-manager/repo-skills',
    '/api/skill-manager/restore',
    '/api/skill-manager/search',
    '/api/skill-manager/sync',
    '/api/skill-manager/update',
    '/api/skill-manager/warm',
  ], '每个端点一条 /api 精确路由，且命名空间正确')
  assert.ok([...ctx.routes.values()].every((r) => r.methods.length === 1 && r.methods[0] === 'POST'),
    '精确路由只声明 POST（非 POST 由平台回落到 interceptor/404）')
  assert.ok([...ctx.routes.values()].every((r) => r.requestBody === 'buffered'),
    'requestBody=buffered ⇒ 继承平台 bridge 的体积上限(413)')
  // 页面策略：auto:false，且 owner 必须是本 fiber（否则策略挂错实例）
  assert.deepEqual(ctx.calls.filter(([k]) => k === 'configure'), [['configure', false, true]])
  assert.equal(ctx.volatileListeners.size, 1)

  // volatile 触发后立即 dispose：防抖窗口（200ms）内销毁 → 对账不得执行（fs 证据）
  ctx.fireVolatile()
  await ctx.dispose()
  assert.equal(ctx.domains.length, 2)
  assert.ok(ctx.domains.every((d) => d.closed === true)) // 两域都随 fiber 关闭
  assert.equal(ctx.volatileListeners.size, 0)
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(await isLink(join(home, 'skills', 'pdf')), false) // dispose 后无对账发生
})

// ─────────────────────────────────────────────────────────────────────────────
// RPC 承载闸门（2026-09-28 重写，取代已失效的 DSR-028 用例）
//
// 旧用例是**盲闸**：假件的 `inject()` 回调里直接装上可用的 `connection.rpc.handle`
// （由假件自己完成注册），被测代码的真实失败点 `owner.webServer` 从未被触达 ⇒ 恒绿。
// **教训：假件的桩必须落在被测代码的失败点之外。**
//
// 新闸的两条腿：
//   ① **接线闸**（恒跑）：注册必须落在 `connection.fetch.register`，且路径/方法/body 模式正确。
//      旧写法（`rpc.handle`）在本假件上必抛 `without inject` ⇒ 回退立即变红。
//   ② **可答闸**（恒跑）：**真的**向已注册路由派发一次信封请求，断言拿到标准
//      `server-response`。旧盲闸从不发请求，故通道是否可达它不知道。
//
// 安全语义（围栏 403 / 认证 401 / waterfall / 体积上限 413）由平台 `/api` 路由承担，
// 本插件不再复制 ⇒ 不在本层断言（那是平台契约，由真实部署类实验覆盖）。
// ─────────────────────────────────────────────────────────────────────────────

test('RPC 承载：走 /api 精确 Fetch 路由注册，且真的能答一次信封请求', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))

  const ctx = fakeCtx(home, { config: CONFIG(root) })
  plugin.apply(ctx, CONFIG(root))
  ctx.openFiber()
  await new Promise((r) => setTimeout(r, 30))

  // ① 接线闸：不得再走 rpc.handle（它在本假件上必抛），必须落在 fetch 路由表
  assert.ok(!ctx.calls.some(([k]) => k === 'rpc'), '不得再调用 connection.rpc.handle（生产注册不上）')
  assert.ok(ctx.routes.has('/api/skill-manager/overview'), 'overview 必须注册为 /api 精确路由')

  // ② 可答闸：真的派发一次请求（复刻平台按 pathname 精确匹配 + POST 限定）
  const route = ctx.routes.get('/api/skill-manager/overview')
  const request = new Request('http://127.0.0.1:3080/api/skill-manager/overview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r-1', method: 'skill-manager/overview', payload: {} }),
  })
  const response = await route.fetch(request)
  assert.equal(response.status, 200, '已注册端点必须能答 200（旧盲闸从不发请求，故查不出 405 类失效）')

  const envelope = await response.json()
  assert.equal(envelope.type, 'server-response')
  assert.equal(envelope.rpcId, 'r-1', 'rpcId 必须原样带回（客户端会比对，不匹配即抛）')
  assert.equal(envelope.result.ok, true)
  assert.ok('value' in envelope.result, '成功侧必须带 value（平台 serverResponseSchema 形状）')

  // ③ 契约面：method 与端点不符 → 400（平台 rpcFetchHandler 同形）
  const mismatched = await route.fetch(new Request('http://127.0.0.1:3080/api/skill-manager/overview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r-2', method: 'other/thing', payload: {} }),
  }))
  assert.equal(mismatched.status, 400, 'method ≠ 端点必须 400')

  // ④ 契约面：非 JSON 内容类型 → 415
  const wrongType = await route.fetch(new Request('http://127.0.0.1:3080/api/skill-manager/overview', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'x',
  }))
  assert.equal(wrongType.status, 415, 'content-type 非 application/json 必须 415')

  // ⑤ 生命周期：dispose 后路由必须摘除（否则插件重载会因 duplicate 抛错）
  await ctx.dispose()
  assert.equal(ctx.routes.size, 0, 'dispose 后所有精确路由必须摘除')
})

test('apply 降级：storage 域打开失败 → 管理 API 回 internal，插件不拖垮启动', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))
  const ctx = fakeCtx(home, { config: CONFIG(root), openImpl: async () => { throw new Error('already-open') } })
  plugin.apply(ctx, CONFIG(root))
  ctx.openFiber()
  await new Promise((r) => setTimeout(r, 50))
  // 经已注册的 `/api/skill-manager/overview` 精确路由取结果（不再有 ctx.handler 直调面）
  const route = ctx.routes.get('/api/skill-manager/overview')
  const response = await route.fetch(new Request('http://127.0.0.1:3080/api/skill-manager/overview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r-1', method: 'skill-manager/overview', payload: {} }),
  }))
  const envelope = await response.json()
  const result = envelope.result
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'internal')
  assert.match(result.error.message, /already-open/)
  assert.ok(ctx.calls.some(([k, msg]) => k === 'warn' && /storage 域打开失败/.test(msg)))
  await ctx.dispose()
})

test('apply 对账器：loader/volatile-update 经 200ms 防抖后 sync 收敛（真实物化到全局根）', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))
  await writeSkill(root, 'pdf')
  const ctx = fakeCtx(home, { config: CONFIG(root) })
  plugin.apply(ctx, CONFIG(root))
  ctx.openFiber()
  await new Promise((r) => setTimeout(r, 50)) // 等 openStore 就绪
  assert.equal(await isLink(join(home, 'skills', 'pdf')), false)
  ctx.fireVolatile() // 模拟设置页写入提交进运行中 fiber
  await new Promise((r) => setTimeout(r, 400)) // 200ms 防抖 + 对账执行
  assert.equal(await isLink(join(home, 'skills', 'pdf')), true)
  await ctx.dispose()
})

test('internal/config 校验挂点：本 fiber 的非法候选抛错（拒绝写入），合法候选放行，他 fiber 不拦', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))
  const ctx = fakeCtx(home, { config: CONFIG(root) })
  plugin.apply(ctx, CONFIG(root))
  ctx.openFiber()
  await new Promise((r) => setTimeout(r, 30))

  // 合法候选放行，且返回值即候选本身（本层只校验、不改编排）
  const ok = CONFIG(root, { skillsDir: 'E:/Project/Skills' })
  assert.equal(ctx.fireConfig(ok), ok)
  // 非法候选：抛错 → loader 侧的写入被拒（config-editor 在落盘前走这条瀑布）
  assert.throws(() => ctx.fireConfig(CONFIG(root, { skillsDir: 'relative/path' })), /绝对路径/)
  assert.throws(() => ctx.fireConfig(CONFIG(root, { groups: { 办公: { mounts: [{ scope: 'global', hosts: [] }] } } })), /宿主/)
  // 别的 fiber 解析自己的配置：不属本行，一律放行
  const alien = { skillsDir: 'relative/path' }
  assert.equal(ctx.fireConfig(alien, { asSelf: false }), alien)
  await ctx.dispose()
})

test('apply 挂载期校验：apply 收到的配置非法即在挂载期抛错（行挂载失败，不带进第一次调用）', async () => {
  const home = await mkTmp('dsh-sm-home-')
  try {
    const ctx = fakeCtx(home, { config: { skillsDir: 'relative/path' } })
    assert.throws(() => plugin.apply(ctx, { skillsDir: 'relative/path' }), /绝对路径/)
  } finally {
    await cleanup(home)
  }
})

// DSR-027 回归：disposer 不得依赖「apply 期发起的在途配置写」。
//
// 生产环（实测卡死，2026-09-28）：
//   boot → apply 发起 migratePromise → settings.update()
//        → config-editor edit()（config-editor/src/index.ts:84）
//        → reconcileProfilePatches()（app-boot/src/index.ts:289-291）
//          对 root Include 行 entry.update() ⇒ 重组整棵树 ⇒ dispose 本插件 fiber
//        → fiber._unload() 会 await 本插件异步 disposer（cordis fiber.ts:676-686）
//        → disposer 等 storeReady，storeReady 的链根在那笔写上 ⇒ **闭环**
//   ⇒ _unload() 永不结算 ⇒ fiber.inertia 永不清空
//   ⇒ tree.await() 的 while 永不出循环（vendor/loader/src/config/tree.ts:43-49）
//   ⇒ profile-boot 不返回、不打印 URL、不落诊断、CPU 静置。
//
// 本用例把「那笔写永不结算」灌进假 Host（updateImpl 返回 pending promise），
// 断言 dispose 仍必须结算——即 disposer 不参与那条链。
test('DSR-027：在途配置写不结算时 dispose 仍须结算（disposer 不得挂在写链上）', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))
  await writeSkill(root, 'pdf')

  // 迁移必然触发（intentMigrated:false 且有可迁移的非 self 记录）。
  // 假域须真有一张非 self 的 skills 记录：迁移只在「有意图」时才写（migrate.js:56-57），
  // 空域会提前 return false，那样本用例根本没测到那条链。
  const baseOpen = async (spec) => {
    const domain = fakeDomain()
    if (spec?.tables?.mounts !== undefined) {
      const record = (await import('./helpers.mjs')).skillRecord({ origin: 'github', repo: 'o/r' })
      await domain.table('skills').put('grill-me', { ...record, disabled: false, group: '默认' })
    }
    return domain
  }
  const ctx = fakeCtx(home, {
    config: CONFIG(root, { intentMigrated: false }),
    openImpl: baseOpen,
    updateImpl: () => new Promise(() => {}), // 永不结算：复刻被 profile 协调卡住的写
  })
  plugin.apply(ctx, CONFIG(root, { intentMigrated: false }))
  ctx.openFiber()
  await new Promise((r) => setTimeout(r, 50))

  // 迁移确实发起了那笔写（否则本用例没测到东西）
  assert.ok(
    ctx.calls.some(([k]) => k === 'settings-update'),
    '前置条件：迁移应当发起 settings.update',
  )

  // 核心断言：写挂住时，fiber 销毁不得挂住。
  const outcome = await Promise.race([
    ctx.dispose().then(() => 'settled'),
    new Promise((r) => setTimeout(() => r('HUNG'), 1500)),
  ])
  assert.equal(outcome, 'settled', 'disposer 等在了永不结算的配置写上 ⇒ 复现 DSR-027 启动卡死')
})

// DSR-027 附带不变量 ①：销毁必须关掉「此刻已开」的域，否则重挂时新 apply 撞 already-open。
// 旧的 async disposer 是靠 await storeReady 达到这一点的（代价是死锁）；新实现必须
// 在不等待那条链的前提下保住同一保证。
test('DSR-027①：已开域在销毁时同步关闭（重挂不撞 already-open）', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))
  await writeSkill(root, 'pdf')
  const ctx = fakeCtx(home, { config: CONFIG(root) })
  plugin.apply(ctx, CONFIG(root))
  ctx.openFiber()
  await new Promise((r) => setTimeout(r, 50))
  // CONFIG 默认 intentMigrated:true ⇒ 迁移整体跳过（migrate.js:26），只开新 spec 一个域。
  assert.equal(ctx.domains.length, 1, '前置条件：新 spec 域已开')
  await ctx.dispose()
  assert.ok(ctx.domains.every((d) => d.closed === true), '销毁后每个已开域都必须已关闭')
})

// DSR-027 附带不变量 ②：销毁与「open 在途」竞态时不得泄漏句柄（开出来的域必须被关掉或持有）。
test('DSR-027②：open 在途期间销毁 → 不泄漏句柄（开出的域自持关闭）', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))
  await writeSkill(root, 'pdf')

  const opened = []
  let releaseOpen = null
  const slowOpen = async () => {
    // 让首次 open 悬停，制造「销毁发生在 open 在途」的窗口。
    await new Promise((r) => { releaseOpen = r })
    const domain = fakeDomain()
    domain.closed = false
    const origClose = domain.close.bind(domain)
    // close 故意做成**跨 macrotask** 的慢关闭：否则「是否等待收场链」在微任务顺序上
    // 恰好也能通过，断言就失去判别力（本用例初版正是如此——消融掉等待后仍为绿）。
    // 真实 storage 后端关闭同样是异步 I/O，故此形状更接近生产。
    domain.close = async () => {
      await new Promise((r) => setTimeout(r, 25))
      domain.closed = true
      return origClose()
    }
    opened.push(domain)
    return domain
  }
  const ctx = fakeCtx(home, { config: CONFIG(root, { intentMigrated: true }), openImpl: slowOpen })
  plugin.apply(ctx, CONFIG(root, { intentMigrated: true }))
  ctx.openFiber()
  await new Promise((r) => setTimeout(r, 30))

  // 在 open 悬停时销毁，然后放行 open：该域必须被自行关闭，不得成为无人持有的僵尸句柄。
  const disposed = ctx.dispose()
  assert.ok(releaseOpen, '前置条件：open 应已发起且悬停')
  releaseOpen()
  await disposed
  // 关键：句柄必须在 **dispose 结算之前**就已释放——平台重组是「卸载旧 fiber 完成后
  // 才 apply 新 fiber」（app-boot:290 await 旧 fiber），若句柄晚于卸载结算才关，
  // 新 apply 的 open 仍会撞 already-open。故此处不 sleep、不额外等待，直接断言。
  assert.equal(opened.length, 1, '前置条件：那个域确实被开出来了')
  assert.equal(opened[0].closed, true, 'open 在途期间销毁 ⇒ 句柄必须在 dispose 结算前已关闭（否则新 apply 撞 already-open）')
})
