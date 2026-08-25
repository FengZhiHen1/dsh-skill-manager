// 挂载推导、物化、对账、健康、项目既有条目（mount-sync.md）。
// 真实文件系统夹具：junction 在 Windows 无需特权；全局根一律注入临时
// globalRootPath，真实用户根（~/.dsh/skills）不被测试触碰。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, realpath, rm, symlink, lstat, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  deriveDesired, materializeOne, detachOne, reconcile, health,
  classifyProjectEntries, isLink, targetKey, targetDirOf,
} from '../lib/sync.js'
import { dirHash } from '../lib/library.js'
import { DSH_APP } from '../lib/state.js'
import { mkTmp, cleanup, writeSkill } from './helpers.mjs'

const apps = { dsh: { ...DSH_APP } }
const emptyState = (projects = {}) => ({ projects, mounts: [], synced: {}, proxy: null })

test('deriveDesired：组挂载推导与 warning', () => {
  const state = emptyState({ w1: 'E:/repo' })
  state.mounts = [
    { group: '默认', app: 'dsh', scope: 'global', project: null },
    { group: '办公', app: 'dsh', scope: 'project', project: 'w1' },
    { group: '办公', app: 'dsh', scope: 'project', project: 'gone' },
  ]
  const groups = { 办公: ['pdf'] }
  const { desired, warnings, legacyProjectIds } = deriveDesired({
    state, apps, groups, skills: ['pdf', 'mine'], workspaceIds: new Set(['w1']),
  })
  assert.deepEqual(desired.get('pdf').map(targetKey), ['dsh|project|w1'])
  assert.deepEqual(desired.get('mine').map(targetKey), ['dsh|global|'])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /不存在的工作区: gone/)
  assert.equal(legacyProjectIds.size, 0)
})

test('deriveDesired：未匹配遗留项目键标注「未匹配工作区」', () => {
  const state = emptyState({ legacy1: 'E:/gone' })
  state.mounts = [{ group: '默认', app: 'dsh', scope: 'project', project: 'legacy1' }]
  const { warnings, legacyProjectIds } = deriveDesired({
    state, apps, groups: {}, skills: ['pdf'], workspaceIds: new Set(),
  })
  assert.match(warnings[0], /未匹配工作区: legacy1/)
  assert.ok(legacyProjectIds.has('legacy1'))
})

test('materializeOne：junction 物化与幂等 ok；缺 SKILL.md 拒绝', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const state = emptyState({ w1: proj })
    const t = { app: 'dsh', scope: 'project', project: 'w1' }
    const parent = join(proj, '.dsh', 'skills')
    const r1 = await materializeOne({ root, state, apps, skill: 'pdf', t, method: 'auto', workspaceIds: new Set(['w1']) })
    assert.equal(r1.action, 'synced')
    assert.equal(r1.method, 'junction')
    assert.ok(await isLink(join(parent, 'pdf')))
    // 幂等：已指向正确目标 → ok
    const existingRec = { ...t, method: 'junction', dir: join(parent, 'pdf') }
    const r2 = await materializeOne({ root, state, apps, skill: 'pdf', t, method: 'auto', existingRec, workspaceIds: new Set(['w1']) })
    assert.equal(r2.action, 'ok')
    // 缺 SKILL.md
    await mkdir(join(root, 'broken'), { recursive: true })
    await assert.rejects(
      () => materializeOne({ root, state, apps, skill: 'broken', t, method: 'auto', workspaceIds: new Set(['w1']) }),
      /缺少 SKILL.md/,
    )
  } finally {
    await cleanup(root)
    await cleanup(proj)
  }
})

test('materializeOne：真实目录冲突拒绝覆盖（target-exists）；仅未被改动的本插件 copy 可替换', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const state = emptyState({ w1: proj })
    const t = { app: 'dsh', scope: 'project', project: 'w1' }
    const dst = join(proj, '.dsh', 'skills', 'pdf')
    await mkdir(dst, { recursive: true })
    await writeFile(join(dst, 'SKILL.md'), 'name: other\n', 'utf8')
    await assert.rejects(
      () => materializeOne({ root, state, apps, skill: 'pdf', t, method: 'copy', workspaceIds: new Set(['w1']) }),
      /目标已存在真实目录且非本插件管理/,
    )
    // 无哈希的旧 copy 记录同样拒绝（无法证明内容未被改动）
    await assert.rejects(
      () => materializeOne({
        root, state, apps, skill: 'pdf', t, method: 'copy',
        existingRec: { ...t, method: 'copy', dir: dst }, workspaceIds: new Set(['w1']),
      }),
      /目标已存在真实目录且非本插件管理/,
    )
    // 先物化一份 copy（返回内容哈希）
    await rm(dst, { recursive: true, force: true })
    const r1 = await materializeOne({ root, state, apps, skill: 'pdf', t, method: 'copy', workspaceIds: new Set(['w1']) })
    assert.equal(r1.action, 'synced')
    assert.equal(r1.method, 'copy')
    assert.match(r1.hash, /^[0-9a-f]{64}$/)
    const rec = { ...t, method: 'copy', dir: dst, hash: r1.hash }
    // copy 未被改动 → 允许替换
    const r2 = await materializeOne({
      root, state, apps, skill: 'pdf', t, method: 'copy',
      existingRec: rec, workspaceIds: new Set(['w1']),
    })
    assert.equal(r2.action, 'synced')
    assert.equal(r2.method, 'copy')
    assert.ok(!(await isLink(dst)))
    assert.match(await readFile(join(dst, 'SKILL.md'), 'utf8'), /name: pdf/)
    // 用户改动了 copy（哈希不符）→ 拒绝覆盖
    await writeFile(join(dst, 'user.txt'), '用户改动', 'utf8')
    await assert.rejects(
      () => materializeOne({
        root, state, apps, skill: 'pdf', t, method: 'copy',
        existingRec: rec, workspaceIds: new Set(['w1']),
      }),
      /目标已存在真实目录且非本插件管理/,
    )
  } finally {
    await cleanup(root)
    await cleanup(proj)
  }
})

test('materializeOne：指向他处的链接不夺取；指向库内的错误链接重建；有记录的链接自愈', async () => {
  const root = await mkTmp()
  const other = await mkTmp()
  const proj = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    await writeSkill(root, 'doc')
    await writeSkill(other, 'foreign')
    const state = emptyState({ w1: proj })
    const t = { app: 'dsh', scope: 'project', project: 'w1' }
    const parent = join(proj, '.dsh', 'skills')
    await mkdir(parent, { recursive: true })
    // 他人链接（指向库外、无 synced 记录）→ target-exists，链接保持不动
    await symlink(join(other, 'foreign'), join(parent, 'pdf'), 'junction')
    await assert.rejects(
      () => materializeOne({ root, state, apps, skill: 'pdf', t, workspaceIds: new Set(['w1']) }),
      /指向他处的链接且非本插件管理/,
    )
    assert.equal(await realpath(join(parent, 'pdf')), await realpath(join(other, 'foreign')))
    // 有 synced 记录 → 视为本插件旧物化，删除重建（自检修复）
    const r1 = await materializeOne({
      root, state, apps, skill: 'pdf', t,
      existingRec: { ...t, method: 'junction', dir: join(parent, 'pdf') }, workspaceIds: new Set(['w1']),
    })
    assert.equal(r1.action, 'synced')
    assert.equal(await realpath(join(parent, 'pdf')), await realpath(join(root, 'pdf')))
    // 指向库内错误位置的链接（无记录）→ 与孤儿清扫同一归属判据，重建
    await symlink(join(root, 'pdf'), join(parent, 'doc'), 'junction')
    const r2 = await materializeOne({ root, state, apps, skill: 'doc', t, workspaceIds: new Set(['w1']) })
    assert.equal(r2.action, 'synced')
    assert.equal(await realpath(join(parent, 'doc')), await realpath(join(root, 'doc')))
  } finally {
    await cleanup(root)
    await cleanup(other)
    await cleanup(proj)
  }
})

test('detachOne：absent / 链接摘除 / 非托管真实目录 kept / 仅哈希一致的 copy 摘除', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const parent = join(proj, '.dsh', 'skills')
    await mkdir(parent, { recursive: true })
    assert.equal(await detachOne({ method: 'junction', dir: join(parent, 'nope') }), 'absent')
    // 链接 → removed
    await symlink(join(root, 'pdf'), join(parent, 'linked'), 'junction')
    assert.equal(await detachOne({ method: 'junction', dir: join(parent, 'linked') }), 'removed')
    assert.equal(await isLink(join(parent, 'linked')), false)
    // 非托管真实目录 → kept
    await mkdir(join(parent, 'real'), { recursive: true })
    assert.equal(await detachOne({ method: 'junction', dir: join(parent, 'real') }), 'kept')
    // 无哈希的旧 copy 记录 → kept（无法证明未被改动）
    assert.equal(await detachOne({ method: 'copy', dir: join(parent, 'real') }), 'kept')
    // 本插件 copy 且哈希一致 → removed
    const copied = join(parent, 'copied')
    await mkdir(copied, { recursive: true })
    await writeFile(join(copied, 'SKILL.md'), 'name: copied\n', 'utf8')
    const hash = await dirHash(copied)
    assert.equal(await detachOne({ method: 'copy', dir: copied, hash }), 'removed')
    // 哈希不符（内容已被改动）→ kept
    await mkdir(copied, { recursive: true })
    await writeFile(join(copied, 'SKILL.md'), 'name: changed\n', 'utf8')
    assert.equal(await detachOne({ method: 'copy', dir: copied, hash }), 'kept')
  } finally {
    await cleanup(root)
    await cleanup(proj)
  }
})

test('reconcile：project 物化 → health 收敛 → 摘除', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const state = emptyState({ w1: proj })
    state.mounts = [{ group: '默认', app: 'dsh', scope: 'project', project: 'w1' }]
    const saved = []
    const save = async (s) => saved.push(JSON.parse(JSON.stringify(s)))
    const r1 = await reconcile({ root, state, apps, groups: {}, skills: ['pdf'], workspaceIds: new Set(['w1']), save, globalRootPath: groot })
    assert.equal(r1.errors.length, 0)
    assert.ok(r1.results.some((x) => x.name === 'pdf' && x.action === 'synced'))
    assert.ok(await isLink(join(proj, '.dsh', 'skills', 'pdf')))
    assert.equal(state.synced.pdf.length, 1)
    assert.equal(typeof state.synced.pdf[0].at, 'string') // 写入端补齐物化时间（rc.7 修复）
    // 再对账 → ok 幂等，health 无 missing-link
    await reconcile({ root, state, apps, groups: {}, skills: ['pdf'], workspaceIds: new Set(['w1']), save, globalRootPath: groot })
    const issues = await health({ root, state, apps, groups: {}, skills: ['pdf'], workspaceIds: new Set(['w1']), globalRootPath: groot })
    assert.equal(issues.filter((i) => i.issue === 'missing-link' || i.issue === 'wrong-target').length, 0)
    // 移除挂载 → 摘除
    state.mounts = []
    const r3 = await reconcile({ root, state, apps, groups: {}, skills: ['pdf'], workspaceIds: new Set(['w1']), save, globalRootPath: groot })
    assert.ok(r3.results.some((x) => x.name === 'pdf' && x.action === 'removed'))
    assert.equal(await isLink(join(proj, '.dsh', 'skills', 'pdf')), false)
    assert.deepEqual(state.synced.pdf, [])
    assert.ok(saved.length >= 3)
  } finally {
    await cleanup(root)
    await cleanup(proj)
    await cleanup(groot)
  }
})

test('reconcile：global 作用域物化到注入的 globalRootPath（真实用户根不被触碰）', async () => {
  const root = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const state = emptyState()
    state.mounts = [{ group: '默认', app: 'dsh', scope: 'global', project: null }]
    const save = async () => {}
    const r1 = await reconcile({ root, state, apps, groups: {}, skills: ['pdf'], workspaceIds: new Set(), save, globalRootPath: groot })
    assert.equal(r1.errors.length, 0)
    assert.ok(await isLink(join(groot, 'pdf')))
    assert.equal(await realpath(join(groot, 'pdf')), await realpath(join(root, 'pdf')))
    // 记录落 synced；摘除走同一注入根
    assert.equal(state.synced.pdf[0].dir, join(groot, 'pdf'))
    state.mounts = []
    const r2 = await reconcile({ root, state, apps, groups: {}, skills: ['pdf'], workspaceIds: new Set(), save, globalRootPath: groot })
    assert.ok(r2.results.some((x) => x.name === 'pdf' && x.action === 'removed'))
    assert.equal(await isLink(join(groot, 'pdf')), false)
  } finally {
    await cleanup(root)
    await cleanup(groot)
  }
})

test('reconcile：缺 SKILL.md 的源拒绝物化（error 不中断）', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  try {
    await mkdir(join(root, 'broken'), { recursive: true })
    const state = emptyState({ w1: proj })
    state.mounts = [{ group: '默认', app: 'dsh', scope: 'project', project: 'w1' }]
    const r = await reconcile({ root, state, apps, groups: {}, skills: ['broken'], workspaceIds: new Set(['w1']), save: async () => {}, globalRootPath: groot })
    assert.equal(r.errors.length, 1)
    assert.match(r.errors[0].error, /缺少 SKILL.md/)
    // 失败目标不产生有效 synced 记录（空数组或不存在）
    assert.deepEqual(state.synced.broken ?? [], [])
  } finally {
    await cleanup(root)
    await cleanup(proj)
    await cleanup(groot)
  }
})

test('孤儿清扫：指向配置目录但不在期望集的链接被摘除；他人链接与兄弟前缀目录不动', async () => {
  const root = await mkTmp()
  const other = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  const sibling = `${root}-sibling`
  try {
    await writeSkill(root, 'pdf')
    await writeSkill(other, 'foreign')
    await writeSkill(sibling, 'sib')
    const parent = join(proj, '.dsh', 'skills')
    await mkdir(parent, { recursive: true })
    // 孤儿：指向配置目录
    await symlink(join(root, 'pdf'), join(parent, 'orphan'), 'junction')
    // 他人链接：指向别处
    await symlink(join(other, 'foreign'), join(parent, 'theirs'), 'junction')
    // 兄弟目录：共享字符串前缀（`<root>-sibling`）但不在配置目录内
    await symlink(join(sibling, 'sib'), join(parent, 'sib'), 'junction')
    const state = emptyState({ w1: proj })
    state.mounts = [] // 无期望
    await reconcile({ root, state, apps, groups: {}, skills: [], workspaceIds: new Set(['w1']), save: async () => {}, globalRootPath: groot })
    assert.equal(await isLink(join(parent, 'orphan')), false)
    assert.ok(await isLink(join(parent, 'theirs')))
    assert.ok(await isLink(join(parent, 'sib')))
  } finally {
    await cleanup(root)
    await cleanup(other)
    await cleanup(proj)
    await cleanup(groot)
    await cleanup(sibling)
  }
})

test('未匹配遗留工作区：普通对账保留既有链接且仅报告 workspace-unmatched', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const parent = join(proj, '.dsh', 'skills')
    await mkdir(parent, { recursive: true })
    await symlink(join(root, 'pdf'), join(parent, 'pdf'), 'junction')
    const legacyDir = join(parent, 'pdf')
    const state = emptyState({ gone: proj }) // gone 不在活动集
    state.synced = { pdf: [{ app: 'dsh', scope: 'project', project: 'gone', method: 'junction', dir: legacyDir, at: 't' }] }
    await reconcile({ root, state, apps, groups: {}, skills: ['pdf'], workspaceIds: new Set(), save: async () => {}, globalRootPath: groot })
    // 既有链接保留
    assert.ok(await isLink(legacyDir))
    assert.equal(state.synced.pdf.length, 1)
    const issues = await health({ root, state, apps, groups: {}, skills: ['pdf'], workspaceIds: new Set(), globalRootPath: groot })
    assert.ok(issues.some((i) => i.issue === 'workspace-unmatched' && i.name === 'gone'))
    assert.ok(!issues.some((i) => i.issue === 'extra-link'))
  } finally {
    await cleanup(root)
    await cleanup(proj)
    await cleanup(groot)
  }
})

test('classifyProjectEntries：五类现场 + external-skill', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  try {
    await writeSkill(root, 'managed')
    await writeSkill(root, 'absent-in-project')
    const base = join(proj, '.dsh', 'skills')
    await mkdir(base, { recursive: true })
    await symlink(join(root, 'managed'), join(base, 'managed'), 'junction') // managed-ok
    await mkdir(join(root, 'x-target'), { recursive: true })
    await symlink(join(root, 'x-target'), join(base, 'wrong'), 'junction') // wrong-target
    await mkdir(join(base, 'local'), { recursive: true })
    await writeFile(join(base, 'local', 'SKILL.md'), '---\nname: local\n---\n', 'utf8') // local-skill
    await mkdir(join(base, 'empty'), { recursive: true }) // local-empty
    await mkdir(join(base, 'foreign'), { recursive: true })
    await writeFile(join(base, 'foreign', 'data.txt'), 'x', 'utf8') // local-foreign
    const { entries, base: returnedBase } = await classifyProjectEntries(root, proj)
    assert.equal(returnedBase, base)
    const kinds = Object.fromEntries(entries.map((e) => [e.name, e.kind]))
    assert.equal(kinds.managed, 'managed-ok')
    assert.equal(kinds.wrong, 'wrong-target')
    assert.equal(kinds.local, 'local-skill')
    assert.equal(kinds.empty, 'local-empty')
    assert.equal(kinds.foreign, 'local-foreign')
    assert.equal(kinds['absent-in-project'], 'external-skill')
  } finally {
    await cleanup(root)
    await cleanup(proj)
  }
})

test('health：报告项目 local-skill/local-empty/local-foreign 与 dsh-invisible-name', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const base = join(proj, '.dsh', 'skills')
    await mkdir(join(base, 'local'), { recursive: true })
    await writeFile(join(base, 'local', 'SKILL.md'), 'name: local\n', 'utf8')
    await mkdir(join(base, 'empty'), { recursive: true })
    const state = emptyState({ w1: proj })
    const issues = await health({ root, state, apps, groups: {}, skills: ['pdf', 'Bad_Name'], workspaceIds: new Set(['w1']), globalRootPath: groot })
    const byName = (n) => issues.filter((i) => i.name === n).map((i) => i.issue)
    assert.ok(byName('local').includes('local-skill'))
    assert.ok(byName('empty').includes('local-empty'))
    assert.ok(byName('Bad_Name').includes('dsh-invisible-name'))
  } finally {
    await cleanup(root)
    await cleanup(proj)
    await cleanup(groot)
  }
})

test('health：期望位置缺失 → missing-link；项目真实目录占位按现场类别报告（优先于 target-exists）', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    await writeSkill(root, 'blocked')
    const state = emptyState({ w1: proj })
    state.mounts = [{ group: '默认', app: 'dsh', scope: 'project', project: 'w1' }]
    const parent = join(proj, '.dsh', 'skills')
    await mkdir(join(parent, 'blocked'), { recursive: true })
    await writeFile(join(parent, 'blocked', 'note.txt'), 'x', 'utf8') // 非空无 SKILL.md → local-foreign
    const issues = await health({ root, state, apps, groups: {}, skills: ['pdf', 'blocked'], workspaceIds: new Set(['w1']), globalRootPath: groot })
    const byName = Object.fromEntries(issues.map((i) => [i.name, i.issue]))
    assert.equal(byName.pdf, 'missing-link')
    assert.equal(byName.blocked, 'local-foreign')
  } finally {
    await cleanup(root)
    await cleanup(proj)
    await cleanup(groot)
  }
})

test('reconcile：git exclude 托管块写入项目 .git/info/exclude', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    await mkdir(join(proj, '.git', 'info'), { recursive: true })
    await writeFile(join(proj, '.git', 'info', 'exclude'), '# 既有内容\n', 'utf8')
    const state = emptyState({ w1: proj })
    state.mounts = [{ group: '默认', app: 'dsh', scope: 'project', project: 'w1' }]
    await reconcile({ root, state, apps, groups: {}, skills: ['pdf'], workspaceIds: new Set(['w1']), save: async () => {}, globalRootPath: groot })
    const text = await readFile(join(proj, '.git', 'info', 'exclude'), 'utf8')
    assert.match(text, /# >>> dsh-skill-manager/)
    assert.match(text, /\/\.dsh\/skills\//)
    assert.match(text, /# <<< dsh-skill-manager/)
    assert.match(text, /# 既有内容/)
  } finally {
    await cleanup(root)
    await cleanup(proj)
    await cleanup(groot)
  }
})

test('targetDirOf：非 dsh / 未启用 / 未知工作区 → undefined', () => {
  const state = emptyState({ w1: 'E:/repo' })
  const ids = new Set(['w1'])
  assert.equal(targetDirOf(state, apps, { app: 'claude', scope: 'global', project: null }, ids), undefined)
  assert.equal(targetDirOf(state, apps, { app: 'dsh', scope: 'project', project: 'gone' }, ids), undefined)
  assert.equal(targetDirOf(state, { dsh: { enabled: false } }, { app: 'dsh', scope: 'project', project: 'w1' }, ids), undefined)
})
