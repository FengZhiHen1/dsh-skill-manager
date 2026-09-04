// 入站操作（入站操作.md；DSR-017）：出库四步（备份→摘除→删目录→清两表，
// 仅限 github）、备份列表目录事实源、恢复原子换装与 github-only 登记、
// update 本地修改门禁、check 无上游跳态。disable/enable 归配置（settings）；
// 本地导入端点已随 P3 删除；网络路径不在单元测试内。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { remove, backups, restore } from '../src/core/inbound/backups.js'
import { update, check } from '../src/core/inbound/upstream.js'
import { isLink } from '../src/core/mount/materialize.js'
import { projectWorkspaces } from '../src/core/mount/derive.js'
import { readCheckCache } from '../src/core/model/store.js'
import { mkTmp, cleanup, writeSkill, fakeStore, skillRecord, assertRejectsCode } from './helpers.mjs'

const okSync = { results: [], warnings: [], errors: [] }
const stubCtx = (calls = []) => ({ reconcile: async () => { calls.push('reconcile'); return okSync } })

// ---- 出库（四步序） ----

test('remove：备份 → 按归属判据摘除全部链接 → 删目录 → 清两表；不触碰 settings 意图', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  const backupsRoot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const store = fakeStore()
    await store.putSkill('pdf', skillRecord({ origin: 'github', repo: 'a/b', commit: 'c'.repeat(40) }))
    const parent = join(proj, '.dsh', 'skills')
    await mkdir(parent, { recursive: true })
    await symlink(join(root, 'pdf'), join(parent, 'pdf'), 'junction')
    await symlink(join(root, 'pdf'), join(groot, 'pdf'), 'junction')
    await store.putCheck('pdf', { checked_at: 't', repo: 'a/b', status: 'up_to_date' })
    // 他人现场：库外链接同名不动
    const outside = join(proj, 'outside')
    await mkdir(outside, { recursive: true })

    const r = await remove({
      root, store, name: 'pdf', backupsRoot,
      workspacesById: projectWorkspaces([{ id: 'w1', path: proj }]),
      globalRootPath: groot,
    })
    assert.equal(r.name, 'pdf')
    assert.equal(r.detached.length, 2) // project 根 + 全局根都摘
    assert.equal(await isLink(join(parent, 'pdf')), false)
    assert.equal(await isLink(join(groot, 'pdf')), false)
    // 备份落盘（目录 + meta 即事实，无登记表）
    const [id] = await readdir(backupsRoot)
    assert.match(id, /^pdf-\d{8}\d{6}\d{3}$/)
    assert.equal(r.backup, join(backupsRoot, id))
    const meta = JSON.parse(await readFile(join(backupsRoot, id, '_backup_meta.json'), 'utf8'))
    assert.equal(meta.name, 'pdf')
    assert.equal(meta.record.repo, 'a/b')
    // 两表清理 + 库目录删除
    assert.equal(store.getSkill('pdf'), undefined)
    assert.equal(readCheckCache(store).results.pdf, undefined)
    await assert.rejects(readdir(join(root, 'pdf')))
  } finally {
    await cleanup(root)
    await cleanup(proj)
    await cleanup(groot)
    await cleanup(backupsRoot)
  }
})

test('remove：仅限 github 登记；自研/本地目录无删除入口；missing 条目出库（backup=null）仍清登记', async () => {
  const root = await mkTmp()
  const backupsRoot = await mkTmp()
  try {
    await writeSkill(root, 'mine')
    const store = fakeStore()
    await assertRejectsCode(
      remove({ root, store, name: 'mine', backupsRoot, workspacesById: new Map(), globalRootPath: '' }),
      'not-removable',
    )
    assert.ok(await readdir(join(root, 'mine'))) // 自研目录零触碰
    // github 登记但目录缺失（missing）：无物可备，记录照清
    await store.putSkill('gone', skillRecord({ origin: 'github', repo: 'a/b', commit: 'c'.repeat(40) }))
    const r = await remove({ root, store, name: 'gone', backupsRoot, workspacesById: new Map(), globalRootPath: '' })
    assert.equal(r.backup, null)
    assert.deepEqual(await readdir(backupsRoot), []) // 不造假备份
    assert.equal(store.getSkill('gone'), undefined)
  } finally {
    await cleanup(root)
    await cleanup(backupsRoot)
  }
})

// ---- 备份列表（目录事实源） ----

test('backups：以目录实际内容为准；无 meta 备份仍展示（has_meta=false，名字回退 id）', async () => {
  const backupsRoot = await mkTmp()
  try {
    const withMeta = join(backupsRoot, 'pdf-20260820000000000')
    await mkdir(withMeta, { recursive: true })
    await writeFile(join(withMeta, '_backup_meta.json'), JSON.stringify({ name: 'pdf', created_at: '2026-08-20T00:00:00.000Z' }), 'utf8')
    const bare = join(backupsRoot, 'mine-20260821000000000')
    await mkdir(bare, { recursive: true })
    const list = await backups({ backupsRoot })
    assert.deepEqual(list.map((b) => b.id).sort(), ['mine-20260821000000000', 'pdf-20260820000000000'])
    const byId = Object.fromEntries(list.map((b) => [b.id, b]))
    assert.equal(byId['pdf-20260820000000000'].has_meta, true)
    assert.equal(byId['pdf-20260820000000000'].time, '2026-08-20T00:00:00.000Z')
    assert.equal(byId['mine-20260821000000000'].has_meta, false)
    assert.equal(byId['mine-20260821000000000'].name, 'mine')
  } finally {
    await cleanup(backupsRoot)
  }
})

// ---- 恢复 ----

test('restore：目录存在即可恢复；github 快照按记录登记（意图字段不回落、缺基线现算）', async () => {
  const root = await mkTmp()
  const backupsRoot = await mkTmp()
  try {
    const store = fakeStore()
    const id = 'pdf-20260820000000000'
    const src = join(backupsRoot, id)
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'SKILL.md'), '---\nname: pdf\ndescription: 回来\n---\n', 'utf8')
    await writeFile(join(src, '_backup_meta.json'), JSON.stringify({
      name: 'pdf',
      record: { ...skillRecord({ origin: 'github', repo: 'a/b', commit: 'd'.repeat(40), content_hash: null }), disabled: true, group: '办公' },
      created_at: '2026-08-20T00:00:00.000Z',
    }), 'utf8')
    const calls = []
    const r = await restore({ root, store, id, backupsRoot, ctx: stubCtx(calls) })
    assert.equal(r.name, 'pdf')
    assert.deepEqual(calls, ['reconcile'])
    const rec = store.getSkill('pdf')
    assert.equal(rec.origin, 'github')
    assert.equal(rec.commit, 'd'.repeat(40))
    assert.equal(rec.disabled, undefined) // 意图归配置，不随快照登记
    assert.equal(rec.group, undefined)
    assert.match(rec.content_hash, /^[0-9a-f]{64}$/) // 缺基线以恢复内容现算
    assert.match(await readFile(join(root, 'pdf', 'SKILL.md'), 'utf8'), /name: pdf/)
    await assert.rejects(readFile(join(root, 'pdf', '_backup_meta.json'), 'utf8')) // 元数据不回库
  } finally {
    await cleanup(root)
    await cleanup(backupsRoot)
  }
})

test('restore：无 meta / self / local 快照 = 本地文件恢复不登记；目录缺失与越界 id → not-found；占位 → name-conflict', async () => {
  const root = await mkTmp()
  const backupsRoot = await mkTmp()
  try {
    const store = fakeStore()
    await assertRejectsCode(restore({ root, store, id: '../escape', backupsRoot, ctx: stubCtx() }), 'not-found')
    await assertRejectsCode(restore({ root, store, id: 'never-made', backupsRoot, ctx: stubCtx() }), 'not-found')

    const bare = join(backupsRoot, 'mine-20260820000000000')
    await mkdir(bare, { recursive: true })
    await writeFile(join(bare, 'SKILL.md'), '---\nname: mine\n---\n', 'utf8')
    const r = await restore({ root, store, id: 'mine-20260820000000000', backupsRoot, ctx: stubCtx() })
    assert.equal(r.name, 'mine')
    assert.equal(store.getSkill('mine'), undefined) // 无 meta = 本地恢复
    assert.match(await readFile(join(root, 'mine', 'SKILL.md'), 'utf8'), /name: mine/)

    // self 快照同样不登记（DSR-017：登记只认 github）
    const selfSnap = join(backupsRoot, 'old-20260820000000001')
    await mkdir(selfSnap, { recursive: true })
    await writeFile(join(selfSnap, 'SKILL.md'), '---\nname: old\n---\n', 'utf8')
    await writeFile(join(selfSnap, '_backup_meta.json'), JSON.stringify({ name: 'old', record: skillRecord() }), 'utf8')
    await restore({ root, store, id: 'old-20260820000000001', backupsRoot, ctx: stubCtx() })
    assert.equal(store.getSkill('old'), undefined)

    // 目标占位拒绝
    const clash = join(backupsRoot, 'pdf-20260820000000002')
    await mkdir(clash, { recursive: true })
    await writeFile(join(clash, 'SKILL.md'), '---\nname: pdf\n---\n', 'utf8')
    await writeFile(join(clash, '_backup_meta.json'), JSON.stringify({ name: 'pdf' }), 'utf8')
    await writeSkill(root, 'pdf')
    await assertRejectsCode(restore({ root, store, id: 'pdf-20260820000000002', backupsRoot, ctx: stubCtx() }), 'name-conflict')
  } finally {
    await cleanup(root)
    await cleanup(backupsRoot)
  }
})

// ---- update 门禁与 check 跳态 ----

test('update：本地修改门禁 — 基线不符与缺基线都必须显式确认', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const store = fakeStore()
    await store.putSkill('pdf', skillRecord({
      origin: 'github', repo: 'a/b', branch: 'main', commit: 'e'.repeat(40), content_hash: '0'.repeat(64),
    }))
    await writeFile(join(root, 'pdf', 'notes.txt'), '本地改动', 'utf8')
    await assertRejectsCode(update({ root, store, names: ['pdf'], confirmLocalChanges: false, ctx: stubCtx() }), 'local-changes-confirmation-required')
    await cleanup(root)

    await writeSkill(root, 'pdf')
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
    assert.deepEqual(readCheckCache(store), { checkedAt: null, results: {} })
  } finally {
    await cleanup(root)
  }
})
