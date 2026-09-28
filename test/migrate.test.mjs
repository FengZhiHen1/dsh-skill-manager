// 旧 storage 意图一次性迁移（插件运行时.md「迁移」；DSR-025）：groups/mounts/
// skills 意图 → 本行配置行；self 不迁移；幂等（intentMigrated）。
//
// 0.1.7 写面：旧 `scope.update(patch)` 随 SettingsScope 消失，迁移改为经
// `ctx.settings.update(ns, patch)` 写 profile 的 cordis.patch.yml 行 config。
// 故这里盯两件事：补丁内容正确，以及**命名空间就是行 id**（写错 id 会撞
// `No configurable plugin entry`，而那是运行期才暴露的静默失败）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateLegacyIntent } from '../src/adapter/migrate.js'
import { CONFIG_NS, validateConfigIntent } from '../src/core/model/intent.js'
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

/**
 * 假 Host ctx + 只读配置门面：写面记录到 `writes`（ns 与补丁一并留证）。
 * `open` 缺省返回给定域；传 null 表示旧域打开失败。
 */
function fakeHost({ current, domain = null, openThrows = null } = {}) {
  const writes = []
  const ctx = {
    settings: { update: async (ns, patch) => { writes.push({ ns, patch }) } },
    storage: {
      domain: {
        open: async () => {
          if (openThrows) throw openThrows
          return domain
        },
      },
    },
  }
  return { ctx, writes, scope: { get: () => current } }
}

test('迁移：意图投影进配置行；self 排除；标记 intentMigrated', async () => {
  const domain = await legacyDomainWithIntent()
  const { ctx, writes, scope } = fakeHost({ current: { intentMigrated: false, groups: {}, skills: {} }, domain })
  const migrated = await migrateLegacyIntent(ctx, scope, null)
  assert.equal(migrated, true)
  assert.equal(writes.length, 1)
  // 命名空间必须是本行 loader entry id（写错 id = 运行期 "No configurable plugin entry"）
  assert.equal(writes[0].ns, CONFIG_NS)
  const patch = writes[0].patch
  assert.equal(patch.intentMigrated, true)
  // 挂载按组归集（global 的 project 归一 null）
  assert.deepEqual(patch.groups['默认'], { mounts: [{ scope: 'global', project: null }] })
  assert.deepEqual(patch.groups['办公'], { mounts: [{ scope: 'project', project: 'w1' }] })
  // 意图迁移；self 不迁移
  assert.deepEqual(patch.skills, { pdf: { disabled: true, group: '办公' } })
  // 迁移产物必须能通过配置校验器（P9 实测崩溃锁：两模块语义曾互相矛盾）
  assert.doesNotThrow(() => validateConfigIntent({ skillsDir: 'E:/s', ...patch }))
})

test('迁移：已标记 intentMigrated → 跳过', async () => {
  const { ctx, writes, scope } = fakeHost({ current: { intentMigrated: true }, openThrows: new Error('不应打开') })
  const migrated = await migrateLegacyIntent(ctx, scope, null)
  assert.equal(migrated, false)
  assert.deepEqual(writes, [])
})

test('迁移：无意图数据 → 跳过且不写配置', async () => {
  const domain = fakeDomain()
  const { ctx, writes, scope } = fakeHost({ current: { intentMigrated: false }, domain })
  const migrated = await migrateLegacyIntent(ctx, scope, null)
  assert.equal(migrated, false)
  assert.deepEqual(writes, [])
})

test('迁移：旧域打开失败 → 跳过不拖垮启动，且告警真实发出', async () => {
  const { ctx, scope } = fakeHost({ current: { intentMigrated: false }, openThrows: new Error('版本不匹配') })
  const warnings = []
  const migrated = await migrateLegacyIntent(ctx, scope, { warn: (msg) => warnings.push(msg) })
  assert.equal(migrated, false)
  assert.equal(warnings.length, 1) // 「只告警不外抛」两半句都钉住
  assert.match(warnings[0], /旧域读取失败/)
})

test('迁移：app≠dsh 的挂载规则过滤；local 记录迁移（只跳 self）；空组名回落默认', async () => {
  const domain = fakeDomain()
  await domain.table('mounts').put('默认|dsh|global|', { group: '默认', app: 'dsh', scope: 'global', project: null })
  await domain.table('mounts').put('办公|vscode|global|', { group: '办公', app: 'vscode', scope: 'global', project: null }) // 非 dsh 不归集
  await domain.table('skills').put('loc', skillRecord({ origin: 'local', origin_path: '/somewhere', group: '' })) // local 迁移，空组名回落默认
  await domain.table('skills').put('me', skillRecord({ origin: 'self' })) // self 不迁移
  const { ctx, writes, scope } = fakeHost({ current: { intentMigrated: false, groups: {}, skills: {} }, domain })
  const migrated = await migrateLegacyIntent(ctx, scope, null)
  assert.equal(migrated, true)
  const patch = writes[0].patch
  assert.deepEqual(patch.groups, { 默认: { mounts: [{ scope: 'global', project: null }] } }) // vscode 行未产生「办公」组
  assert.deepEqual(patch.skills, { loc: { disabled: false, group: '默认' } }) // 空组名回落；self 不在列
})
