// 旧 storage 意图一次性迁移（插件运行时.md「迁移」）：groups/mounts/
// skills 意图 → settings；self 不迁移；幂等（intentMigrated）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateLegacyIntent } from '../src/adapter/migrate.js'
import { fakeDomain, skillRecord } from './helpers.mjs'

/** 造一个带旧意图的 legacy 域假句柄。 */
async function legacyDomainWithIntent() {
  const domain = fakeDomain()
  await domain.table('mounts').put('默认|dsh|global|', { group: '默认', app: 'dsh', scope: 'global', project: null })
  await domain.table('mounts').put('办公|dsh|project|w1', { group: '办公', app: 'dsh', scope: 'project', project: 'w1' })
  await domain.table('groups').put('办公', { created_at: '2026-08-01T00:00:00.000Z' })
  await domain.table('skills').put('pdf', {
    ...skillRecord({ origin: 'github', repo: 'a/b', commit: 'c'.repeat(40) }),
    disabled: true,
    group: '办公',
  })
  // self 记录不迁移（本地 skill 无版本管理）
  await domain.table('skills').put('mine', skillRecord())
  return domain
}

test('迁移：意图投影进 settings；self 排除；标记 intentMigrated', async () => {
  const domain = await legacyDomainWithIntent()
  let patch = null
  const scope = {
    get: () => ({ intentMigrated: false, groups: {}, skills: {} }),
    update: async (p) => { patch = p },
  }
  const ctx = { storage: { domain: { open: async () => domain } } }
  const migrated = await migrateLegacyIntent(ctx, scope, null)
  assert.equal(migrated, true)
  assert.equal(patch.intentMigrated, true)
  // 挂载按组归集（global 的 project 归一 null）
  assert.deepEqual(patch.groups['默认'], { mounts: [{ scope: 'global', project: null }] })
  assert.deepEqual(patch.groups['办公'], { mounts: [{ scope: 'project', project: 'w1' }] })
  // 意图迁移；self 不迁移
  assert.deepEqual(patch.skills, { pdf: { disabled: true, group: '办公' } })
})

test('迁移：已标记 intentMigrated → 跳过', async () => {
  const scope = {
    get: () => ({ intentMigrated: true }),
    update: async () => { throw new Error('不应写入') },
  }
  const migrated = await migrateLegacyIntent({ storage: { domain: { open: async () => { throw new Error('不应打开') } } } }, scope, null)
  assert.equal(migrated, false)
})

test('迁移：无意图数据 → 跳过且不写配置', async () => {
  const domain = fakeDomain()
  const scope = {
    get: () => ({ intentMigrated: false }),
    update: async () => { throw new Error('不应写入') },
  }
  const ctx = { storage: { domain: { open: async () => domain } } }
  const migrated = await migrateLegacyIntent(ctx, scope, null)
  assert.equal(migrated, false)
})

test('迁移：旧域打开失败 → 跳过不拖垮启动', async () => {
  const scope = { get: () => ({ intentMigrated: false }), update: async () => {} }
  const ctx = { storage: { domain: { open: async () => { throw new Error('版本不匹配') } } } }
  const migrated = await migrateLegacyIntent(ctx, scope, { warn: () => {} })
  assert.equal(migrated, false)
})
