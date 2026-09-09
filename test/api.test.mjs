// 服务编排与 RPC dispatch（插件运行时.md）：Result 映射、三路队列、未配置
// 门禁、配置意图驱动的只读视图与对账（意图在 settings，方法只读/文件/网络）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { buildApi, createDispatch, createQueue, toRpcFailure } from '../src/core/service.js'
import { configSchema } from '../src/core/model/intent.js'
import { SkillManagerError } from '../src/core/base/errors.js'
import { isLink } from '../src/core/mount/materialize.js'
import { mkTmp, cleanup, writeSkill, fakeStore, fakeScope, skillRecord, assertRejectsCode } from './helpers.mjs'

/** 可变假 scope：让测试能模拟配置编辑。 */
function mutableScope(skillsDir, initial = {}) {
  let value = { ...fakeScope(skillsDir, initial).get() }
  return {
    get: () => value,
    set(next) {
      value = next
    },
  }
}

function makeApi({ root = '', workspaces = [], store = fakeStore(), backupsRoot = '', globalRoot, libraryRoot = null, scope } = {}) {
  return {
    api: buildApi(typeof scope === 'function' ? scope : () => scope ?? fakeScope(root), {
      listWorkspaces: () => workspaces,
      getStore: () => store,
      backupsRoot,
      globalRoot,
      libraryRoot,
    }),
    store,
  }
}

test('未配置门禁：所有方法统一 skilldir-unconfigured', async () => {
  const { api } = makeApi({ root: '' })
  for (const method of Object.keys(api)) {
    await assertRejectsCode(api[method]({}), 'skilldir-unconfigured')
  }
})

test('已配置但目录缺失：统一 skilldir-missing（插件保持存活）', async (t) => {
  const tmp = await mkTmp()
  t.after(() => cleanup(tmp))
  const { api } = makeApi({ root: join(tmp, 'not-there') })
  await assertRejectsCode(api.overview({}), 'skilldir-missing')
  await assertRejectsCode(api.sync({}), 'skilldir-missing')
})

test('toRpcFailure：错误 → 平台 Result 失败侧（retryable 归 details）', () => {
  const sme = toRpcFailure(new SkillManagerError('bad-name', '名字不对'))
  assert.deepEqual(
    { ok: sme.ok, code: sme.error.code, message: sme.error.message, retryable: sme.error.details.retryable },
    { ok: false, code: 'bad-name', message: '名字不对', retryable: false },
  )
  assert.ok(sme.error.details.repair.summary) // DSR-018：任何失败带 repair
  assert.equal(toRpcFailure(new SkillManagerError('rate-limited', '稍后重试', true)).error.details.retryable, true)
  // GhError 网络分类：kind 直通错误码，unreachable/rate-limited 可重试
  const gh = toRpcFailure(Object.assign(new Error('gh down'), { kind: 'unreachable' }), 'search')
  assert.equal(gh.error.code, 'unreachable')
  assert.equal(gh.error.details.retryable, true)
  assert.equal(gh.error.details.repair.operation, 'search')
  assert.equal(toRpcFailure(new Error('boom')).error.code, 'internal')
  assert.equal(toRpcFailure('plain string').error.code, 'internal')
  assert.ok(toRpcFailure(new Error('boom')).error.details.repair) // internal 也有复制入口
})

test('createQueue：busy/idle 与失败不阻塞后续', async () => {
  const queue = createQueue()
  assert.equal(queue.busy, false)
  let release
  const gate = new Promise((r) => { release = r })
  const run = queue.enqueue(async () => { await gate })
  assert.equal(queue.busy, true)
  const idle = queue.idle()
  release()
  await run
  await idle
  assert.equal(queue.busy, false)
  const order = []
  await Promise.all([
    queue.enqueue(async () => { order.push('a'); throw new Error('x') }).catch(() => {}),
    queue.enqueue(async () => { order.push('b') }),
  ])
  assert.deepEqual(order, ['a', 'b'])
})

test('createDispatch：成功/失败 Result 包装、payload 兜底、未知端点与原型链防御', async () => {
  const api = {
    async 'backups'() {
      return { ok: true }
    },
    async sync(payload) {
      return payload
    },
    async boom() {
      throw new SkillManagerError('skilldir-missing', '目录缺失')
    },
  }
  // 假 api 只测队列/Result 语义，返回体不过契约：显式关闭出站校验
  const dispatch = createDispatch(api, { validate: false })
  assert.deepEqual(await dispatch('backups', {}), { ok: true, value: { ok: true } })
  assert.deepEqual(await dispatch('sync', { a: 1 }), { ok: true, value: { a: 1 } })
  assert.deepEqual(await dispatch('sync'), { ok: true, value: {} }) // payload 缺失兜底
  assert.deepEqual(await dispatch('sync', 'not-an-object'), { ok: true, value: {} })
  assert.equal((await dispatch('boom', {})).error.code, 'skilldir-missing')
  assert.equal((await dispatch('nope', {})).error.code, 'unknown-endpoint')
  assert.equal((await dispatch('constructor', {})).error.code, 'unknown-endpoint') // 方法表非自有键不放行
})

test('createDispatch：三路队列语义 — 读等写屏障、网络不等写、写 FIFO 串行', async () => {
  const order = []
  let releaseWrite
  const gate = new Promise((r) => {
    releaseWrite = r
  })
  const api = {
    async overview() {
      order.push('read')
      return 'r'
    },
    async search() {
      order.push('net')
      return 'n'
    },
    async sync() {
      order.push('write')
      await gate
      return 'w'
    },
    async restore() {
      order.push('write2')
      return 'w2'
    },
  }
  // 假 api 只测三路排队语义，返回体不过契约：显式关闭出站校验
  const dispatch = createDispatch(api, { validate: false })
  const write = dispatch('sync', {})
  const write2 = dispatch('restore', {})
  const read = dispatch('overview', {})
  const net = dispatch('search', {})
  const netResult = await net
  assert.deepEqual(order, ['write', 'net']) // 网络独立：不等写屏障
  assert.equal(netResult.value, 'n')
  releaseWrite()
  assert.equal((await read).value, 'r')
  // 读等的是整个写队列（含排队中的 write2）结算：无半写窗口
  assert.deepEqual(order, ['write', 'net', 'write2', 'read'])
  await write2
})

/** 一次性闸门假 api：sync 停在门上，overview 记录自己何时被放行。 */
function gatedApi(order) {
  let release
  const gate = new Promise((r) => { release = r })
  return {
    api: {
      async overview() { order.push('read'); return 'r' },
      async sync() { order.push('reconcile'); await gate; return 'w' },
    },
    release,
  }
}

test('写队列共享（adapter 注入）：后台对账入同队才被读屏障看见，自起一路则读到半收敛现场', async () => {
  // 装配后：对账器经注入的 writeQueue 入队 → 写后自动刷新的读等它结算
  const shared = []
  const g1 = gatedApi(shared)
  const writeQueue = createQueue()
  const dispatch1 = createDispatch(g1.api, { writeQueue, validate: false })
  const bg = writeQueue.enqueue(() => g1.api.sync({}))
  const read = dispatch1('overview', {})
  await new Promise((r) => setImmediate(r)) // 推进到各自阻塞点：对账在门上、读在屏障上
  assert.deepEqual(shared, ['reconcile']) // 读尚未被放行
  g1.release()
  await bg
  assert.equal((await read).value, 'r')
  assert.deepEqual(shared, ['reconcile', 'read'])

  // 装配前（缺陷对照）：对账不入队，dispatch 私有写队列的 busy 屏障看不见它 → 读抢跑
  const alone = []
  const g2 = gatedApi(alone)
  const dispatch2 = createDispatch(g2.api, { validate: false })
  const bg2 = g2.api.sync({})
  const read2 = await dispatch2('overview', {})
  assert.deepEqual(alone, ['reconcile', 'read']) // 对账还在门上，读已经走了
  assert.equal(read2.value, 'r')
  g2.release()
  await bg2
})

test('overview：配置意图驱动 — 禁用/分组/挂载目标/工作区/健康一次出全', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  const lib = await mkTmp()
  try {
    // 双根制（DSR-020）：github 条目的内容在插件库根，自研条目在用户根
    await writeSkill(lib, 'pdf')
    await writeSkill(root, 'off')
    const workspaces = [{ id: 'w1', path: proj, title: '项目' }]
    const { api, store } = makeApi({
      root,
      workspaces,
      globalRoot: groot,
      libraryRoot: lib,
      scope: () => fakeScope(root, {
        groups: {
          办公: { mounts: [{ scope: 'global' }, { scope: 'project', project: 'w1' }] },
        },
        skills: {
          pdf: { disabled: false, group: '办公' },
          off: { disabled: true, group: '办公' },
        },
      }),
    })
    // github 元数据叠加（先落记录再读：bundle 快照冻结语义，读后写入不立即反映）
    await store.putSkill('pdf', skillRecord({ origin: 'github', repo: 'a/b', commit: 'f'.repeat(40) }))
    const o = await api.overview({})
    assert.equal(o.root, root)
    const pdf = o.lib.skills.find((s) => s.dir === 'pdf')
    const off = o.lib.skills.find((s) => s.dir === 'off')
    assert.equal(pdf.disabled, false)
    assert.equal(pdf.group, '办公')
    assert.deepEqual(pdf.targets.sort(), ['dsh:global|global', 'dsh:project|w1'])
    // 未物化现场：行状态逐 target 报 link-missing（DSR-017 行状态经 overview 下发）
    assert.deepEqual(pdf.mount.map((m) => m.issue).sort(), ['link-missing', 'link-missing'])
    assert.equal(off.disabled, true)
    assert.deepEqual(off.targets, []) // 禁用不进期望集
    assert.equal(pdf.origin, 'github')
    assert.ok(Array.isArray(o.health.issues))
    assert.equal(o.workspaces.length, 1)
    assert.equal(o.workspaces[0].workspaceId, 'w1')
    assert.equal(o.workspaces[0].mountCount, 1) // 「办公」组挂了 w1
  } finally {
    await cleanup(root)
    await cleanup(proj)
    await cleanup(groot)
    await cleanup(lib)
  }
})

test('sync：配置意图物化到全局根与工作区；配置变更后对账收敛', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const workspaces = [{ id: 'w1', path: proj, title: '项目' }]
    const scope = mutableScope(root, {
      groups: { 默认: { mounts: [{ scope: 'global' }, { scope: 'project', project: 'w1' }] } },
      skills: { pdf: { disabled: false, group: '默认' } },
    })
    const { api } = makeApi({ root, workspaces, globalRoot: groot, scope })
    const r = await api.sync({})
    assert.equal(r.errors.length, 0)
    assert.ok(await isLink(join(groot, 'pdf')))
    assert.ok(await isLink(join(proj, '.dsh', 'skills', 'pdf')))
    // 配置变更（模拟 settings 编辑）→ sync 收敛摘链
    scope.set({ ...scope.get(), skills: { pdf: { disabled: true, group: '默认' } } })
    const r2 = await api.sync({})
    assert.equal(r2.errors.length, 0)
    assert.equal(await isLink(join(groot, 'pdf')), false)
    assert.equal(await isLink(join(proj, '.dsh', 'skills', 'pdf')), false)
    // 配置变更（挂载移除）→ 摘链
    scope.set({ ...scope.get(), skills: { pdf: { disabled: false, group: '默认' } }, groups: { 默认: { mounts: [] } } })
    await api.sync({})
    assert.equal(await isLink(join(groot, 'pdf')), false)
  } finally {
    await cleanup(root)
    await cleanup(proj)
    await cleanup(groot)
  }
})

// 配置默认种子的端到端语义（DSR-011「修订（2026-09-09）」）：scope 值一律经
// configSchema() 求值 —— 与 Host settings 解析面同形（默认值 → base → 用户），
// 默认种子本身因此成为被断言的对象，而不是测试夹具里手写的 groups。
const resolveConfig = configSchema() // schemastery 模式：schema 可调用，调用即求值并回填默认

test('默认种子空挂载：未显式配 groups ⇒ sync 零期望 ⇒ 旧种子遗留的全局链接按孤儿摘除；显式勾选可恢复', async () => {
  const root = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const seedGlobal = { skillsDir: root, groups: { 默认: { mounts: [{ scope: 'global', project: null }] } } }
    const box = { value: resolveConfig(seedGlobal) }
    const { api } = makeApi({ root, globalRoot: groot, scope: () => ({ get: () => box.value }) })
    // ① 旧种子等价现场（显式「默认」组挂全局）→ 链接物化
    assert.equal(box.value.groups['默认'].mounts.length, 1)
    assert.equal((await api.sync({})).errors.length, 0)
    assert.ok(await isLink(join(groot, 'pdf')))
    // ② 配置里根本没有 groups 键（新装 / 从未显式配过）→ 解析落到空种子
    box.value = resolveConfig({ skillsDir: root })
    assert.deepEqual(box.value.groups, { 默认: { mounts: [] } })
    const r = await api.sync({})
    assert.equal(r.errors.length, 0)
    assert.equal(r.results.find((x) => x.name === 'pdf')?.action, 'removed')
    assert.match(String(r.results.find((x) => x.name === 'pdf')?.reason), /孤儿/)
    assert.equal(await isLink(join(groot, 'pdf')), false)
    // ③ 对照：显式重新勾选全局 → 链接回来（本次只取消隐式默认，不禁止全局挂载）
    box.value = resolveConfig(seedGlobal)
    assert.equal((await api.sync({})).errors.length, 0)
    assert.ok(await isLink(join(groot, 'pdf')))
  } finally {
    await cleanup(root)
    await cleanup(groot)
  }
})

test('check 缓存随 overview 下发（不发网络）', async () => {
  const root = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const { api, store } = makeApi({ root, globalRoot: groot })
    // 先落 github 记录再读（bundle 快照冻结语义：读后写入需 TTL/写后刷新才可见）
    await store.putSkill('pdf', skillRecord({ origin: 'github', repo: 'a/b', commit: 'f'.repeat(40) }))
    await store.putCheck('pdf', {
      checked_at: '2026-08-20T00:00:00.000Z', repo: 'a/b', branch: 'main',
      current: 'f'.repeat(40), latest: 'f'.repeat(40), status: 'up_to_date',
      reason: null, via: 'api', updatable: false, reachable: true,
      locally_modified: false, baseline_missing: false, missing: false,
    })
    const o = await api.overview({})
    assert.equal(o.lib.checkedAt, '2026-08-20T00:00:00.000Z')
    assert.equal(o.lib.skills.find((s) => s.dir === 'pdf').origin, 'github')
    assert.equal(o.lib.skills.find((s) => s.dir === 'pdf').upstream.status, 'up_to_date')
  } finally {
    await cleanup(root)
    await cleanup(groot)
  }
})

test('storage 域未就绪：方法回 internal 语义（getStore 抛错）', async () => {
  const root = await mkTmp()
  try {
    const api = buildApi(() => fakeScope(root), {
      listWorkspaces: () => [],
      getStore: () => {
        throw new Error('storage 域尚未就绪')
      },
      backupsRoot: '',
    })
    // 门禁先于 store：未配置时仍报 skilldir-unconfigured
    const gate = buildApi(() => fakeScope(''), { getStore: () => { throw new Error('x') }, backupsRoot: '' })
    await assertRejectsCode(gate.overview({}), 'skilldir-unconfigured')
    await assert.rejects(() => api.overview({}), /storage 域尚未就绪/)
  } finally {
    await cleanup(root)
  }
})
