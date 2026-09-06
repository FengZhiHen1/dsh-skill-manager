// RPC 载荷契约（core/model/contract.js）：逐端点形状校验、违例路径可定位、
// 真实 api 全端点出站过闸（Host 回归钉死：产出形状漂移即红）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ContractError, parseEndpointPayload } from '../src/core/model/contract.js'
import { buildApi, createDispatch, toRpcFailure } from '../src/core/service.js'
import { mkTmp, cleanup, writeSkill, fakeStore, fakeScope } from './helpers.mjs'

/** 最小合法 overview 载荷。 */
function minimalOverview() {
  return {
    root: 'E:/skills',
    lib: {
      skills: [{
        name: 'pdf', dir: 'pdf', description: '', origin: 'self', hasSkillMd: true,
        commit: null, missing: false, disabled: false, group: '默认', nameVisible: true,
        targets: ['global|global'], mount: [{ target: 'global|global', path: 'G/pdf', issue: 'link-missing' }],
        upstream: null,
      }],
      warnings: [],
      checkedAt: null,
    },
    health: { issues: [{ name: 'pdf', target: 'global|global', issue: 'link-missing' }] },
    workspaces: [{ workspaceId: 'w1', title: '项目', path: 'P', mountCount: 0 }],
  }
}

test('contract：合法载荷原值通过（不产生副本）', () => {
  const overview = minimalOverview()
  assert.equal(parseEndpointPayload('overview', overview), overview)
  const sync = { results: [], warnings: [], errors: [] }
  assert.equal(parseEndpointPayload('sync', sync), sync)
  const upd = { results: [], sync: null }
  assert.equal(parseEndpointPayload('update', upd), upd)
})

test('contract：形状违例抛 ContractError 且 path 可定位', () => {
  const broken = minimalOverview()
  broken.lib.skills[0].dir = 42
  assert.throws(
    () => parseEndpointPayload('overview', broken),
    (error) => error instanceof ContractError && error.path === 'value.lib.skills[0].dir',
  )
  assert.throws(() => parseEndpointPayload('overview', { root: 'x' }), /value\.lib/)
  assert.throws(() => parseEndpointPayload('search', { query: 'q', count: 0, skills: [{ key: 1 }] }), /value\.skills\[0\]\.key/)
})

test('contract：check 的 skipped 与完整记录是两种合法形状；update 三态词表闭合', () => {
  const skipped = { name: 'a', status: 'skipped', reason: '无上游' }
  assert.doesNotThrow(() => parseEndpointPayload('check', [skipped]))
  assert.throws(() => parseEndpointPayload('check', [{ name: 'a', status: 'updatable' }]), ContractError) // 完整态缺字段
  assert.doesNotThrow(() => parseEndpointPayload('update', {
    results: [
      { name: 'a', status: 'updated', commit: 'c'.repeat(40), via: 'api' },
      { name: 'b', status: 'failed', reason: 'HTTP 500' },
      { name: 'c', status: 'failed', reason: '登记失败', registrationFailed: true },
      { name: 'd', status: 'skipped', reason: '已是最新', upToDate: true },
    ],
    sync: null,
  }))
  // 词表外状态拒绝
  assert.throws(() => parseEndpointPayload('update', { results: [{ name: 'a', status: 'broken' }], sync: null }), ContractError)
})

test('contract：未登记端点与 toRpcFailure 映射', () => {
  assert.throws(() => parseEndpointPayload('ghost', {}), ContractError)
  const failure = toRpcFailure(new ContractError('value.lib', 'object', 'x'), 'overview')
  assert.equal(failure.error.code, 'contract-violation')
  assert.equal(failure.error.details.retryable, false)
  assert.ok(failure.error.details.repair.summary)
})

test('contract 端到端：真实 api 的 overview/sync/add 形状经 dispatch 出站过闸', async (t) => {
  const root = await mkTmp()
  const groot = await mkTmp()
  t.after(() => cleanup(root))
  t.after(() => cleanup(groot))
  await writeSkill(root, 'pdf')
  const store = fakeStore()
  const api = buildApi(() => fakeScope(root), { getStore: () => store, backupsRoot: '', globalRoot: groot })
  const dispatch = createDispatch(api) // validate 默认开
  const overview = await dispatch('overview', {})
  assert.equal(overview.ok, true)
  assert.equal(overview.value.lib.skills[0].dir, 'pdf')
  const sync = await dispatch('sync', {})
  assert.equal(sync.ok, true)
  assert.equal(sync.value.errors.length, 0)
  const warm = await dispatch('warm', {})
  assert.equal(warm.ok, true)
  const backups = await dispatch('backups', {})
  assert.equal(backups.ok, true)
  assert.deepEqual(backups.value, [])
})
