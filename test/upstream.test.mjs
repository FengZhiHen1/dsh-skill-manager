// 上游检查与更新（入站操作.md「check」「update」）：check 六态判定、update 落盘/
// 批次隔离/缓存回填/changed→对账。stub fetch + 注入 lsRemote，不出网不起子进程。

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { check, update } from '../src/core/inbound/upstream.js'
import { dirHash } from '../src/core/model/library.js'
import { readCheckCache } from '../src/core/model/store.js'
import { mkTmp, cleanup, writeSkill, fakeStore, skillRecord, buildZip } from './helpers.mjs'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const okSync = { results: [], warnings: [], errors: [] }

/** stub 全局 fetch：branch 接口回 shaMap 内 sha（缺省 404），zipball 接口按 zipFor 回包。 */
function stubGitHub(t, { shaMap = {}, zipFor = {} } = {}) {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const branch = /\/branches\/([^/]+)$/.exec(url)?.[1]
    if (branch !== undefined) {
      const sha = shaMap[branch]
      return {
        ok: sha !== undefined,
        status: sha !== undefined ? 200 : 404,
        headers: { get: () => null },
        json: async () => (sha !== undefined ? { commit: { sha } } : {}),
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    }
    const zipRepo = /\/repos\/([^/]+\/[^/]+)\/zipball\//.exec(url)?.[1]
    if (zipRepo !== undefined) {
      const payload = zipFor[zipRepo]
      if (payload === undefined || payload === null) {
        return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => payload }
    }
    throw new Error(`测试内未预期的 fetch：${url}`)
  }
  t.after(() => {
    globalThis.fetch = original
  })
}

/** 含根级 SKILL.md 的最小 zipball。 */
function skillZipball(name, extra = '') {
  return buildZip([
    { name: `repo-sha/SKILL.md`, data: Buffer.from(`---\nname: ${name}\ndescription: ${extra || name}\n---\n`, 'utf8'), method: 0 },
    { name: `repo-sha/content.txt`, data: Buffer.from(extra || 'v1', 'utf8'), method: 0 },
  ])
}

const noLsRemote = { lsRemote: async () => null }

test('check：六态判定 — up_to_date / updatable / check_failed / missing / baseline_missing / locally_modified', async (t) => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'same')
    await writeSkill(root, 'old')
    await writeSkill(root, 'noline')
    await writeSkill(root, 'dirty')
    // 'gone' 只落记录不写目录（missing 现场）
    const store = fakeStore()
    await store.putSkill('same', skillRecord({ origin: 'github', repo: 'x/same', branch: 'main', commit: SHA_A, content_hash: await dirHash(join(root, 'same')) }))
    await store.putSkill('old', skillRecord({ origin: 'github', repo: 'x/old', branch: 'main', commit: SHA_A, content_hash: await dirHash(join(root, 'old')) }))
    await store.putSkill('noline', skillRecord({ origin: 'github', repo: 'x/noline', branch: 'main', commit: SHA_A })) // content_hash null → baseline_missing
    await store.putSkill('dirty', skillRecord({ origin: 'github', repo: 'x/dirty', branch: 'main', commit: SHA_A, content_hash: '0'.repeat(64) })) // 基线不符 → locally_modified
    await store.putSkill('gone', skillRecord({ origin: 'github', repo: 'x/gone', branch: 'main', commit: SHA_A, content_hash: '0'.repeat(64) }))
    stubGitHub(t, { shaMap: { main: SHA_A } }) // old 的 commit 与上游同 → up_to_date；其余靠记录形态分化
    const results = await check({ root, store, deps: noLsRemote })
    const byName = Object.fromEntries(results.map((r) => [r.name, r]))
    assert.equal(byName.same.status, 'up_to_date')
    assert.equal(byName.same.locally_modified, false)
    assert.equal(byName.old.status, 'up_to_date') // sha 相同
    assert.equal(byName.noline.baseline_missing, true)
    assert.equal(byName.noline.locally_modified, null) // 无基线 → 三态「未知」，不猜
    assert.equal(byName.dirty.locally_modified, true)
    assert.equal(byName.gone.missing, true)
    // 全部命中缓存（check 结果逐条回填）
    const cache = readCheckCache(store)
    assert.ok(cache.checkedAt)
    assert.equal(Object.keys(cache.results).length, 5)
  } finally {
    await cleanup(root)
  }
})

test('check：上游 404 → check_failed 单条降级不拖批；updatable 在 sha 不同分支', async (t) => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'fresh')
    await writeSkill(root, 'stale')
    const store = fakeStore()
    await store.putSkill('fresh', skillRecord({ origin: 'github', repo: 'x/fresh', branch: 'main', commit: SHA_A, content_hash: await dirHash(join(root, 'fresh')) }))
    await store.putSkill('stale', skillRecord({ origin: 'github', repo: 'x/stale', branch: 'dev', commit: SHA_A, content_hash: await dirHash(join(root, 'stale')) }))
    // main 分支 404（fresh → check_failed）；dev 分支回新 sha（stale → updatable）
    stubGitHub(t, { shaMap: { dev: SHA_B } })
    const results = await check({ root, store, deps: noLsRemote })
    const byName = Object.fromEntries(results.map((r) => [r.name, r]))
    assert.equal(byName.fresh.status, 'check_failed')
    assert.equal(byName.fresh.reachable, false)
    assert.equal(byName.stale.status, 'updatable')
    assert.equal(byName.stale.updatable, true)
    assert.equal(byName.stale.latest, SHA_B)
  } finally {
    await cleanup(root)
  }
})

test('update：确认后落盘 — 换装、登记刷新、缓存回填、changed 恰触发一次对账', async (t) => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const store = fakeStore()
    await store.putSkill('pdf', skillRecord({ origin: 'github', repo: 'x/pdf', branch: 'main', commit: SHA_A, content_hash: await dirHash(join(root, 'pdf')) }))
    stubGitHub(t, { shaMap: { main: SHA_B }, zipFor: { 'x/pdf': skillZipball('pdf', 'v2') } })
    const calls = []
    const r = await update({ root, store, names: ['pdf'], confirmLocalChanges: false, ctx: { reconcile: async () => { calls.push('reconcile'); return okSync } }, deps: noLsRemote })
    assert.equal(r.results[0].status, 'updated')
    assert.equal(r.results[0].commit, SHA_B)
    assert.deepEqual(calls, ['reconcile']) // changed → 对账恰一次
    const rec = store.getSkill('pdf')
    assert.equal(rec.commit, SHA_B)
    assert.equal(rec.content_hash, await dirHash(join(root, 'pdf'))) // 基线随换装重算
    assert.equal(readCheckCache(store).results.pdf.status, 'up_to_date') // 行徽章立即翻转
  } finally {
    await cleanup(root)
  }
})

test('update：批次隔离 — 单条下载失败 status=failed 不断批，另一条照常 updated', async (t) => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'good')
    await writeSkill(root, 'bad')
    const store = fakeStore()
    await store.putSkill('good', skillRecord({ origin: 'github', repo: 'x/good', branch: 'main', commit: SHA_A, content_hash: await dirHash(join(root, 'good')) }))
    await store.putSkill('bad', skillRecord({ origin: 'github', repo: 'x/bad', branch: 'main', commit: SHA_A, content_hash: await dirHash(join(root, 'bad')) }))
    stubGitHub(t, { shaMap: { main: SHA_B }, zipFor: { 'x/good': skillZipball('good', 'v2'), 'x/bad': null } })
    const r = await update({ root, store, names: ['good', 'bad'], confirmLocalChanges: false, ctx: { reconcile: async () => okSync }, deps: noLsRemote })
    const byName = Object.fromEntries(r.results.map((it) => [it.name, it]))
    assert.equal(byName.good.status, 'updated')
    assert.equal(byName.bad.status, 'failed') // 失败与「不适用」的 skipped 显式区分
    assert.match(byName.bad.reason, /HTTP 500/)
    assert.equal(store.getSkill('good').commit, SHA_B)
    assert.equal(store.getSkill('bad').commit, SHA_A) // 失败条目台账不动
  } finally {
    await cleanup(root)
  }
})

test('update：登记失败显式漂移（registrationFailed）与缺目录拉回、upToDate 跳态', async (t) => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'reg-fail')
    await writeSkill(root, 'current')
    const store = fakeStore()
    const realPut = store.putSkill
    store.putSkill = async (name, record) => {
      if (name === 'reg-fail') throw new Error('disk full')
      return realPut(name, record)
    }
    await realPut('reg-fail', skillRecord({ origin: 'github', repo: 'x/reg', branch: 'main', commit: SHA_A, content_hash: await dirHash(join(root, 'reg-fail')) }))
    await realPut('current', skillRecord({ origin: 'github', repo: 'x/current', branch: 'main', commit: SHA_B, content_hash: await dirHash(join(root, 'current')) }))
    await realPut('gone', skillRecord({ origin: 'github', repo: 'x/gone', branch: 'main', commit: SHA_B, content_hash: '0'.repeat(64) }))
    stubGitHub(t, {
      shaMap: { main: SHA_B },
      zipFor: { 'x/reg': skillZipball('reg-fail', 'v2'), 'x/gone': skillZipball('gone', 'v1') },
    })
    const r = await update({ root, store, names: ['reg-fail', 'current', 'gone'], confirmLocalChanges: true, ctx: { reconcile: async () => okSync }, deps: noLsRemote })
    const byName = Object.fromEntries(r.results.map((it) => [it.name, it]))
    assert.equal(byName['reg-fail'].status, 'failed')
    assert.equal(byName['reg-fail'].registrationFailed, true) // 换装成功但登记失败：漂移显式
    assert.equal(byName.current.status, 'skipped')
    assert.equal(byName.current.upToDate, true)
    assert.equal(byName.gone.status, 'updated') // 目录缺失即使 commit 未变也拉回
    assert.equal(readCheckCache(store).results.current.status, 'up_to_date')
  } finally {
    await cleanup(root)
  }
})
