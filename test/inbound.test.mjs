// 入站操作（inbound-operations.md）：导入/出库/备份/恢复/禁用启用/更新门禁/检查跳态。
// 网络路径（add/update 远程段、check 远端探测）不在单元测试内；本地语义全覆盖。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { importSkill, remove, backups, restore, disable, enable, update, check } from '../lib/inbound.js'
import { isLink } from '../lib/sync.js'
import { loadCheckCache } from '../lib/state.js'
import { mkTmp, cleanup, writeSkill, fakeStore, skillRecord, assertRejectsCode } from './helpers.mjs'

const okSync = { results: [], warnings: [], errors: [] }
const stubCtx = (calls = []) => ({ reconcile: async () => { calls.push('reconcile'); return okSync } })

test('importSkill：本地目录导入 → local 记录与 reconcile', async () => {
  const root = await mkTmp()
  const src = await mkTmp()
  try {
    await writeSkill(src, 'local-skill', { description: '本地来的' })
    const store = fakeStore()
    const calls = []
    const r = await importSkill({ root, store, path: join(src, 'local-skill'), ctx: stubCtx(calls) })
    assert.equal(r.name, 'local-skill')
    assert.equal(r.source, 'local')
    assert.deepEqual(calls, ['reconcile'])
    const rec = store.getSkill('local-skill')
    assert.equal(rec.origin, 'local')
    assert.equal(rec.origin_path, join(src, 'local-skill'))
    assert.match(rec.content_hash, /^[0-9a-f]{64}$/)
    assert.equal(rec.group, '默认')
    assert.match(await readFile(join(root, 'local-skill', 'SKILL.md'), 'utf8'), /name: local-skill/)
  } finally {
    await cleanup(root)
    await cleanup(src)
  }
})

test('importSkill：重名拒绝；无 SKILL.md 拒绝；非法名拒绝', async () => {
  const root = await mkTmp()
  const src = await mkTmp()
  try {
    await writeSkill(src, 'taken')
    await writeSkill(root, 'taken')
    const store = fakeStore()
    await assertRejectsCode(importSkill({ root, store, path: join(src, 'taken'), ctx: stubCtx() }), 'name-conflict')
    await mkdir(join(src, 'no-md'), { recursive: true })
    await assertRejectsCode(importSkill({ root, store, path: join(src, 'no-md'), ctx: stubCtx() }), 'no-skill-md')
    await assertRejectsCode(importSkill({ root, store, path: join(src, 'taken'), as: 'Bad_Name', ctx: stubCtx() }), 'bad-name')
    await assertRejectsCode(importSkill({ root, store, path: join(src, 'missing-dir'), ctx: stubCtx() }), 'not-found')
  } finally {
    await cleanup(root)
    await cleanup(src)
  }
})

test('remove：备份 → 摘除物化 → 删目录 → 删记录 → 清缓存', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const backupsRoot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const store = fakeStore()
    await store.putSkill('pdf', skillRecord({ origin: 'github', repo: 'a/b', commit: 'c'.repeat(40), group: '办公' }))
    const parent = join(proj, '.dsh', 'skills')
    await mkdir(parent, { recursive: true })
    await symlink(join(root, 'pdf'), join(parent, 'pdf'), 'junction')
    await store.putSynced('pdf', { app: 'dsh', scope: 'project', project: 'w1' }, { method: 'junction', dir: join(parent, 'pdf'), at: 't' })
    await store.putCheck('pdf', {
      checked_at: 't', repo: 'a/b', branch: 'main', current: null, latest: null,
      status: 'up_to_date', reason: null, via: 'api', updatable: false, reachable: true,
      locally_modified: false, baseline_missing: false, missing: false,
    })

    const r = await remove({ root, store, name: 'pdf', keepFiles: false, backupsRoot, ctx: stubCtx() })
    // 备份落盘 + 登记
    assert.ok(r.backup)
    const [backupIdDir] = await readdir(backupsRoot)
    assert.match(backupIdDir, /^pdf-\d+$/)
    const meta = JSON.parse(await readFile(join(backupsRoot, backupIdDir, '_backup_meta.json'), 'utf8'))
    assert.equal(meta.name, 'pdf')
    assert.equal(meta.record.repo, 'a/b')
    assert.equal(store.getBackup(backupIdDir).name, 'pdf')
    // 物化摘除 + 记录清理
    assert.equal(await isLink(join(parent, 'pdf')), false)
    assert.equal(store.syncedEntries().length, 0)
    assert.equal(store.getSkill('pdf'), undefined)
    assert.equal((await loadCheckCache(store)).results.pdf, undefined)
    // 目录删除
    await assert.rejects(readdir(join(root, 'pdf')))
  } finally {
    await cleanup(root)
    await cleanup(proj)
    await cleanup(backupsRoot)
  }
})

test('remove：keepFiles 跳过备份但仍出库', async () => {
  const root = await mkTmp()
  const backupsRoot = await mkTmp()
  try {
    await writeSkill(root, 'tmp-skill')
    const store = fakeStore()
    const r = await remove({ root, store, name: 'tmp-skill', keepFiles: true, backupsRoot, ctx: stubCtx() })
    assert.equal(r.backup, null)
    assert.deepEqual(await readdir(backupsRoot), [])
    await assert.rejects(readdir(join(root, 'tmp-skill')))
    await assertRejectsCode(remove({ root, store, name: 'ghost', keepFiles: false, backupsRoot, ctx: stubCtx() }), 'not-found')
  } finally {
    await cleanup(root)
    await cleanup(backupsRoot)
  }
})

test('backups/restore：登记 ∪ 目录列表；恢复还原记录与分组', async () => {
  const root = await mkTmp()
  const backupsRoot = await mkTmp()
  try {
    const store = fakeStore()
    const calls = []
    // 手工造一份备份（等价于 remove 的产物）
    const id = 'pdf-20260820000000000'
    const src = join(backupsRoot, id)
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'SKILL.md'), '---\nname: pdf\ndescription: 回来\n---\n', 'utf8')
    await writeFile(join(src, '_backup_meta.json'), JSON.stringify({
      name: 'pdf',
      record: skillRecord({ origin: 'github', repo: 'a/b', commit: 'd'.repeat(40), group: '办公' }),
      created_at: '2026-08-20T00:00:00.000Z',
    }), 'utf8')
    await store.putBackup(id, { name: 'pdf', created_at: '2026-08-20T00:00:00.000Z' })

    const list = await backups({ store, backupsRoot })
    assert.equal(list.length, 1)
    assert.equal(list[0].id, id)
    assert.equal(list[0].name, 'pdf')
    assert.equal(list[0].has_meta, true)

    const r = await restore({ root, store, id, backupsRoot, ctx: stubCtx(calls) })
    assert.equal(r.name, 'pdf')
    assert.deepEqual(calls, ['reconcile'])
    const rec = store.getSkill('pdf')
    assert.equal(rec.origin, 'github')
    assert.equal(rec.repo, 'a/b')
    assert.equal(rec.group, '办公')
    assert.ok(store.getGroup('办公')) // 组不存在时自动重建
    assert.match(await readFile(join(root, 'pdf', 'SKILL.md'), 'utf8'), /name: pdf/)
    // 备份内元数据文件不带回库目录
    await assert.rejects(readFile(join(root, 'pdf', '_backup_meta.json'), 'utf8'))
  } finally {
    await cleanup(root)
    await cleanup(backupsRoot)
  }
})

test('restore：未登记/越界 id 拒绝；目标已存在拒绝', async () => {
  const root = await mkTmp()
  const backupsRoot = await mkTmp()
  try {
    const store = fakeStore()
    await assertRejectsCode(restore({ root, store, id: '../escape', backupsRoot, ctx: stubCtx() }), 'not-found')
    await assertRejectsCode(restore({ root, store, id: 'never-made', backupsRoot, ctx: stubCtx() }), 'not-found')
    // 登记但目录缺失
    await store.putBackup('ghost-1', { name: 'ghost', created_at: 't' })
    await assert.rejects(() => restore({ root, store, id: 'ghost-1', backupsRoot, ctx: stubCtx() }), /备份目录缺失/)
    // 冲突
    await writeSkill(root, 'pdf')
    const src = join(backupsRoot, 'pdf-x')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'SKILL.md'), '---\nname: pdf\n---\n', 'utf8')
    await writeFile(join(src, '_backup_meta.json'), JSON.stringify({ name: 'pdf' }), 'utf8')
    await store.putBackup('pdf-x', { name: 'pdf', created_at: 't' })
    await assertRejectsCode(restore({ root, store, id: 'pdf-x', backupsRoot, ctx: stubCtx() }), 'name-conflict')
  } finally {
    await cleanup(root)
    await cleanup(backupsRoot)
  }
})

test('disable/enable：disabled 标记翻转 + reconcile', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const store = fakeStore()
    await store.putSkill('pdf', skillRecord())
    const calls = []
    const ctx = stubCtx(calls)
    await disable({ root, store, name: 'pdf', ctx })
    assert.equal(store.getSkill('pdf').disabled, true)
    await enable({ root, store, name: 'pdf', ctx })
    assert.equal(store.getSkill('pdf').disabled, false)
    assert.deepEqual(calls, ['reconcile', 'reconcile'])
    // 幂等：重复禁用不再 reconcile
    await disable({ root, store, name: 'pdf', ctx })
    await disable({ root, store, name: 'pdf', ctx })
    assert.equal(calls.length, 3)
    await assertRejectsCode(disable({ root, store, name: 'ghost', ctx }), 'not-found')
  } finally {
    await cleanup(root)
  }
})

test('update：本地修改门禁 — 未确认抛 local-changes-confirmation-required', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const store = fakeStore()
    // 先建立基线
    const { scanLibrary } = await import('../lib/library.js')
    await scanLibrary(root, store)
    const base = store.getSkill('pdf')
    await store.putSkill('pdf', { ...base, origin: 'github', repo: 'a/b', branch: 'main', commit: 'e'.repeat(40) })
    // 改本地内容 → 与基线不符
    await writeFile(join(root, 'pdf', 'notes.txt'), '本地改动', 'utf8')
    await assertRejectsCode(update({ root, store, names: ['pdf'], confirmLocalChanges: false, ctx: stubCtx() }), 'local-changes-confirmation-required')
  } finally {
    await cleanup(root)
  }
})

test('update：缺少内容基线时同样必须确认', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const store = fakeStore()
    await store.putSkill('pdf', skillRecord({ origin: 'github', repo: 'a/b', branch: 'main', commit: 'e'.repeat(40) }))
    await assertRejectsCode(update({ root, store, names: ['pdf'], ctx: stubCtx() }), 'local-changes-confirmation-required')
  } finally {
    await cleanup(root)
  }
})

test('check：self/local/无记录 → skipped 且不入缓存', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'mine')
    const store = fakeStore()
    await store.putSkill('mine', skillRecord())
    await store.putSkill('imp', skillRecord({ origin: 'local', origin_path: '/somewhere' }))
    const results = await check({ root, store, names: ['mine', 'imp', 'ghost'] })
    const byName = Object.fromEntries(results.map((r) => [r.name, r]))
    assert.equal(byName.mine.status, 'skipped')
    assert.match(byName.mine.reason, /自研/)
    assert.equal(byName.imp.status, 'skipped')
    assert.match(byName.imp.reason, /本地导入/)
    assert.equal(byName.ghost.status, 'skipped')
    // 无上游条目不写缓存
    assert.deepEqual(await loadCheckCache(store), { checkedAt: null, results: {} })
  } finally {
    await cleanup(root)
  }
})
