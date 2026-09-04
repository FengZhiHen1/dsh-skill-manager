// 服务编排与 RPC dispatch（插件运行时.md）：Result 映射、三路队列、未配置
// 门禁、配置意图驱动的只读视图与对账（意图在 settings，方法只读/文件/网络）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { buildApi, createDispatch, createQueue, toRpcFailure } from '../src/core/service.js'
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

function makeApi({ root = '', workspaces = [], store = fakeStore(), backupsRoot = '', globalRoot, scope } = {}) {
  return {
    api: buildApi(typeof scope === 'function' ? scope : () => scope ?? fakeScope(root), {
      listWorkspaces: () => workspaces,
      getStore: () => store,
      backupsRoot,
      globalRoot,
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

test('已配置但目录缺失：统一 skilldir-missing（插件保持存活）', async () => {
  const { api } = makeApi({ root: join(await mkTmp(), 'not-there') })
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
  assert.equal(toRpcFailure(new SkillManagerError('rate_limited', '稍后重试', true)).error.details.retryable, true)
  // GhError 网络分类：kind 直通错误码，unreachable/rate_limited 可重试
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
  const dispatch = createDispatch(api)
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
  const dispatch = createDispatch(api)
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

test('overview：配置意图驱动 — 禁用/分组/挂载目标/工作区/健康一次出全', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    await writeSkill(root, 'off')
    const workspaces = [{ id: 'w1', path: proj, title: '项目' }]
    const { api, store } = makeApi({
      root,
      workspaces,
      globalRoot: groot,
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
    assert.deepEqual(pdf.targets.sort(), ['global|global', 'project|w1'])
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
