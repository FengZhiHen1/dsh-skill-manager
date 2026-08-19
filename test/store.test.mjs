// storage 域 spec 与门面（storage-model.md）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { skillManagerSpec, mountKey, syncedKey, backupId, createStore } from '../lib/store.js'
import { fakeDomain, skillRecord } from './helpers.mjs'

test('spec：域名/版本/七表齐全', () => {
  assert.equal(skillManagerSpec.name, 'skill_manager')
  assert.equal(skillManagerSpec.version, 1)
  assert.deepEqual(
    Object.keys(skillManagerSpec.tables).sort(),
    ['backups', 'check_cache', 'groups', 'mounts', 'projects', 'skills', 'synced'],
  )
})

test('mountKey / syncedKey / backupId 格式', () => {
  assert.equal(mountKey({ group: '默认', app: 'dsh', scope: 'global', project: null }), '默认|dsh|global|')
  assert.equal(mountKey({ group: 'g', app: 'dsh', scope: 'project', project: 'w1' }), 'g|dsh|project|w1')
  assert.equal(syncedKey('pdf', { app: 'dsh', scope: 'global', project: null }), 'pdf|dsh|global|global')
  assert.equal(syncedKey('pdf', { app: 'dsh', scope: 'project', project: 'w1' }), 'pdf|dsh|project|w1')
  const id = backupId('pdf', new Date('2026-08-20T01:02:03.004Z'))
  assert.match(id, /^pdf-\d{8}\d{6}\d{3}$/)
})

test('syncedRecord：存量记录缺 at 放行、新记录带 at 通过（打开校验不炸域）', () => {
  const schema = skillManagerSpec.tables.synced.valueSchema
  // 存量记录（早期写入端漏写 at）必须通过——否则 storage-domain 打开即整体失败
  assert.equal(schema.safeParse({ method: 'junction', dir: 'C:\\x' }).success, true)
  // 新记录（sync.js 已补齐 at）同样通过
  assert.equal(schema.safeParse({ method: 'copy', dir: 'C:\\x', at: '2026-08-20T00:00:00.000Z' }).success, true)
})

test('门面：skills/groups/mounts/synced/projects/check/backups 读写往返', async () => {
  const store = createStore(fakeDomain())
  await store.putSkill('pdf', skillRecord({ origin: 'github', repo: 'a/b', commit: 'x'.repeat(40) }))
  assert.equal(store.getSkill('pdf').repo, 'a/b')
  assert.equal(store.skillEntries().length, 1)
  assert.equal((await store.deleteSkill('pdf')), true)
  assert.equal(store.getSkill('pdf'), undefined)

  await store.putGroup('办公', { created_at: '2026-08-01T00:00:00.000Z' })
  assert.deepEqual(store.groupEntries().map(([n]) => n), ['办公'])

  const mount = { group: '默认', app: 'dsh', scope: 'project', project: 'w1' }
  await store.putMount(mount)
  assert.deepEqual(store.mountEntries(), [['默认|dsh|project|w1', mount]])
  await store.deleteMount(mount)
  assert.equal(store.mountEntries().length, 0)

  await store.putSynced('pdf', { app: 'dsh', scope: 'global', project: null }, { method: 'junction', dir: '/x', at: 't' })
  assert.deepEqual(store.syncedEntries()[0][0], 'pdf|dsh|global|global')
  await store.deleteSynced('pdf', { app: 'dsh', scope: 'global', project: null })
  assert.equal(store.syncedEntries().length, 0)

  await store.putProject('w1', { path: '/repo' })
  assert.equal(store.getProject('w1').path, '/repo')

  await store.putCheck('pdf', {
    checked_at: 't', repo: 'a/b', branch: 'main', current: null, latest: null,
    status: 'up_to_date', reason: null, via: 'api', updatable: false, reachable: true,
    locally_modified: false, baseline_missing: false, missing: false,
  })
  assert.equal(store.checkEntries().length, 1)
  await store.deleteCheck('pdf')
  assert.equal(store.checkEntries().length, 0)

  await store.putBackup('pdf-2026', { name: 'pdf', created_at: 't' })
  assert.equal(store.getBackup('pdf-2026').name, 'pdf')
  await store.deleteBackup('pdf-2026')
  assert.equal(store.backupEntries().length, 0)

  await store.close()
})

test('门面：写入深拷贝隔离（改入参不回写表）', async () => {
  const store = createStore(fakeDomain())
  const rec = skillRecord()
  await store.putSkill('a', rec)
  rec.origin = 'github'
  assert.equal(store.getSkill('a').origin, 'self')
})
