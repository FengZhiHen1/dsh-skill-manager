// storage 域 spec 与门面（目录配置与状态存储.md；DSR-017 两表投影：
// skills/check_cache + 旧七表迁移 spec；backups 表随目录事实源废止）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { skillManagerSpec, legacySkillManagerSpec } from '../src/adapter/storage.js'
import { backupId, createStore, readCheckCache } from '../src/core/model/store.js'
import { fakeDomain, skillRecord } from './helpers.mjs'

test('spec：域名/版本保持 1/两表投影（synced、projects、backups 已随无台账收敛删除）', () => {
  assert.equal(skillManagerSpec.name, 'skill_manager')
  assert.equal(skillManagerSpec.version, 1) // 必须保持 1：storage-json 对 version 严格相等校验
  assert.deepEqual(Object.keys(skillManagerSpec.tables).sort(), ['check_cache', 'skills'])
})

test('legacySpec：旧七表齐备（迁移读意图与旧投影用）', () => {
  assert.deepEqual(
    Object.keys(legacySkillManagerSpec.tables).sort(),
    ['backups', 'check_cache', 'groups', 'mounts', 'projects', 'skills', 'synced'],
  )
})

test('新 spec skills 校验：旧意图字段 strip、self 存量兼容放行', () => {
  const parsed = skillManagerSpec.tables.skills.valueSchema.parse({
    ...skillRecord({ origin: 'github', repo: 'a/b', commit: 'x'.repeat(40) }),
    disabled: true,
    group: '办公',
  })
  assert.equal(parsed.disabled, undefined)
  assert.equal(parsed.group, undefined)
  assert.equal(parsed.repo, 'a/b')
  assert.equal(skillManagerSpec.tables.skills.valueSchema.parse(skillRecord()).origin, 'self')
})

test('backupId 格式（备份目录名即事实凭证，无登记表）', () => {
  const id = backupId('pdf', new Date('2026-08-20T01:02:03.004Z'))
  assert.match(id, /^pdf-\d{8}\d{6}\d{3}$/)
})

test('门面：skills/check 读写往返 + close；已删表不再暴露访问器', async () => {
  const store = createStore(fakeDomain())
  await store.putSkill('pdf', skillRecord({ origin: 'github', repo: 'a/b', commit: 'x'.repeat(40) }))
  assert.equal(store.getSkill('pdf').repo, 'a/b')
  assert.equal(store.skillEntries().length, 1)
  assert.equal(await store.deleteSkill('pdf'), true)
  assert.equal(store.getSkill('pdf'), undefined)

  await store.putCheck('pdf', {
    checked_at: 't', repo: 'a/b', branch: 'main', current: null, latest: null,
    status: 'up_to_date', reason: null, via: 'api', updatable: false, reachable: true,
    locally_modified: false, baseline_missing: false, missing: false,
  })
  assert.equal(store.checkEntries().length, 1)
  await store.deleteCheck('pdf')
  assert.equal(store.checkEntries().length, 0)

  // 台账与备份表访问器必须整体消失（防止旧代码路径复活）
  for (const gone of ['putSynced', 'syncedEntries', 'putProject', 'getProject', 'putBackup', 'getBackup', 'backupEntries']) {
    assert.equal(store[gone], undefined, `门面不应再暴露 ${gone}`)
  }
  await store.close()
})

test('门面：写入深拷贝隔离（改入参不回写表）', async () => {
  const store = createStore(fakeDomain())
  const rec = skillRecord()
  await store.putSkill('a', rec)
  rec.origin = 'github'
  assert.equal(store.getSkill('a').origin, 'self')
})

test('readCheckCache：聚合条目 → {checkedAt 最新时间（未查为 null）, results 按名索引}', async () => {
  const store = createStore(fakeDomain())
  assert.deepEqual(readCheckCache(store), { checkedAt: null, results: {} })
  await store.putCheck('a', { checked_at: '2026-08-01T00:00:00.000Z', repo: 'x/y', status: 'updatable' })
  await store.putCheck('b', { checked_at: '2026-08-02T00:00:00.000Z', repo: 'x/y', status: 'up_to_date' })
  const cache = readCheckCache(store)
  assert.equal(cache.checkedAt, '2026-08-02T00:00:00.000Z')
  assert.deepEqual(Object.keys(cache.results).sort(), ['a', 'b'])
  assert.equal(cache.results.a.status, 'updatable')
})
