// 库扫描与内容基线（inbound-operations.md 库扫描；storage-model.md skills 表）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSkillMd, dirHash, scanLibrary, skillDirExists } from '../lib/library.js'
import { mkTmp, cleanup, writeSkill, fakeStore, skillRecord } from './helpers.mjs'

test('parseSkillMd：单行 key: value 与引号剥离', () => {
  const text = '---\nname: "demo"\ndescription: \'有引号\'\n---\n# demo\n'
  assert.deepEqual(parseSkillMd(text), { name: 'demo', description: '有引号' })
})

test('parseSkillMd：块标量折叠为单行', () => {
  const text = '---\ndescription: >\n  第一行\n  第二行\nname: demo\n---\n'
  assert.deepEqual(parseSkillMd(text), { description: '第一行 第二行', name: 'demo' })
})

test('parseSkillMd：无 frontmatter 返回空对象', () => {
  assert.deepEqual(parseSkillMd('# 标题\n正文'), {})
})

test('dirHash：跳过 .git 与 __pycache__，结果确定', async () => {
  const root = await mkTmp()
  try {
    const dir = await writeSkill(root, 'demo')
    await mkdir(join(dir, '.git'), { recursive: true })
    await writeFile(join(dir, '.git', 'config'), 'x', 'utf8')
    await mkdir(join(dir, '__pycache__'), { recursive: true })
    await writeFile(join(dir, '__pycache__', 'a.pyc'), 'y', 'utf8')
    const h1 = await dirHash(dir)
    const h2 = await dirHash(dir)
    assert.equal(h1, h2)
    assert.match(h1, /^[0-9a-f]{64}$/)
    await writeFile(join(dir, 'extra.txt'), 'z', 'utf8')
    assert.notEqual(await dirHash(dir), h1)
  } finally {
    await cleanup(root)
  }
})

test('scanLibrary：平铺目录成员；未登记目录补登记 self', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'mine', { description: '自研技能' })
    const store = fakeStore()
    const items = await scanLibrary(root, store)
    assert.equal(items.length, 1)
    assert.equal(items[0].dir, 'mine')
    assert.equal(items[0].origin, 'self')
    assert.equal(items[0].group, '默认')
    assert.equal(items[0].commit, null)
    assert.equal(items[0].description, '自研技能')
    // 副作用：补登记（含立即建立内容基线）
    const rec = store.getSkill('mine')
    assert.equal(rec.origin, 'self')
    assert.equal(rec.disabled, false)
    assert.match(rec.content_hash, /^[0-9a-f]{64}$/)
  } finally {
    await cleanup(root)
  }
})

test('scanLibrary：github 记录带 commit；记录缺 content_hash 时回填', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const store = fakeStore()
    await store.putSkill('pdf', skillRecord({
      origin: 'github', repo: 'anthropics/skills', branch: 'main', commit: 'a'.repeat(40), group: '办公',
    }))
    await store.putGroup('办公', { created_at: '2026-08-01T00:00:00.000Z' })
    const items = await scanLibrary(root, store)
    assert.equal(items[0].origin, 'github')
    assert.equal(items[0].commit, 'a'.repeat(40))
    assert.equal(items[0].group, '办公')
    // content_hash 回填
    assert.match(store.getSkill('pdf').content_hash, /^[0-9a-f]{64}$/)
  } finally {
    await cleanup(root)
  }
})

test('scanLibrary：表中 origin 非 self 但目录缺失 → missing 条目', async () => {
  const root = await mkTmp()
  try {
    const store = fakeStore()
    await store.putSkill('gone', skillRecord({ origin: 'github', repo: 'a/b', commit: 'b'.repeat(40) }))
    const items = await scanLibrary(root, store)
    assert.equal(items.length, 1)
    assert.equal(items[0].missing, true)
    assert.equal(items[0].origin, 'github')
    // self 记录目录缺失不展示 missing（self 无上游可恢复）
    await store.putSkill('gone-self', skillRecord())
    const again = await scanLibrary(root, store)
    assert.equal(again.length, 1)
  } finally {
    await cleanup(root)
  }
})

test('scanLibrary：disabled 标记与失效组名回落 默认', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'off')
    const store = fakeStore()
    await store.putSkill('off', skillRecord({ disabled: true, group: '已删组' }))
    const items = await scanLibrary(root, store)
    assert.equal(items[0].disabled, true)
    assert.equal(items[0].group, '默认') // 组不在 groups 表 → 回落
  } finally {
    await cleanup(root)
  }
})

test('scanLibrary：无 SKILL.md 的目录仍列出但 hasSkillMd=false；点开头目录跳过', async () => {
  const root = await mkTmp()
  try {
    await mkdir(join(root, 'empty-one'), { recursive: true })
    await mkdir(join(root, '.hidden'), { recursive: true })
    const items = await scanLibrary(root, fakeStore())
    assert.equal(items.length, 1)
    assert.equal(items[0].dir, 'empty-one')
    assert.equal(items[0].hasSkillMd, false)
  } finally {
    await cleanup(root)
  }
})

test('skillDirExists：平铺直查', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'x')
    assert.equal(await skillDirExists(root, 'x'), true)
    assert.equal(await skillDirExists(root, 'nope'), false)
  } finally {
    await cleanup(root)
  }
})
