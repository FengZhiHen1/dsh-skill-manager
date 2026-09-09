// 挂载推导、物化、走查、对账（挂载与同步.md；DSR-017 junction-only + 无台账）。
// 真实文件系统夹具：junction 在 Windows 无需特权；全局根一律注入临时
// globalRootPath，真实用户根（$DSH_HOME/skills）不被测试触碰。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deriveDesired, projectWorkspaces, targetDir, targetKey } from '../src/core/mount/derive.js'
import { isLink, materializeOne, removeLink } from '../src/core/mount/materialize.js'
import { createLinkRegistry } from '../src/core/mount/registry.js'
import { fakeStore } from './helpers.mjs'
import { findOrphanLinks, scanMountLinks, walkMountState } from '../src/core/mount/inspect.js'
import { reconcile } from '../src/core/mount/reconcile.js'
import { piState } from '../src/core/service.js'
import { mkTmp, cleanup, writeSkill } from './helpers.mjs'

function workspaces(list = [{ id: 'w1', title: 'Ws1', path: 'P' }]) {
  return projectWorkspaces(list)
}

// ---- 推导（derive.js） ----

test('deriveDesired：组归属展平、重复规则去重、非法挂载项容忍', () => {
  const memberships = new Map([['pdf', '文档'], ['mine', '默认']])
  const mounts = [
    { group: '文档', scope: 'global', project: null },
    { group: '文档', scope: 'global', project: null },
    { group: '默认', scope: 'project', project: 'w1' },
    { group: '默认', scope: 'weird', project: null },
  ]
  const { desired, warnings } = deriveDesired({
    memberships,
    mounts,
    workspacesById: workspaces([{ id: 'w1', title: '', path: 'P' }]),
    globalRootPath: 'G',
  })
  assert.deepEqual([...desired.get('pdf')], [{ host: 'dsh', scope: 'global', project: null }])
  assert.deepEqual([...desired.get('mine')], [{ host: 'dsh', scope: 'project', project: 'w1' }])
  assert.deepEqual([...warnings], [])
  assert.equal(targetKey({ scope: 'global', project: null }), 'dsh:global|global')
  assert.equal(targetKey({ scope: 'project', project: 'w1' }), 'dsh:project|w1')
  assert.equal(targetKey({ host: 'pi', scope: 'project', project: 'w1' }), 'pi:project|w1')
})

test('deriveDesired：hosts 展开双侧目标；pi 不可用时 pi 侧跳过并按组告警一次', () => {
  const byId = workspaces([{ id: 'w1', title: '', path: 'P' }])
  const memberships = new Map([['pdf', 'g1']])
  const mounts = [{ group: 'g1', scope: 'project', project: 'w1', hosts: ['dsh', 'pi'] }]
  const both = deriveDesired({ memberships, mounts, workspacesById: byId, globalRootPath: 'G', piSkillsRoot: 'PS' })
  assert.deepEqual([...both.desired.get('pdf')], [
    { host: 'dsh', scope: 'project', project: 'w1' },
    { host: 'pi', scope: 'project', project: 'w1' },
  ])
  assert.deepEqual([...both.warnings], [])
  // pi 不可用：pi 目标不产期望，dsh 侧不受影响；告警按组去重
  const off = deriveDesired({ memberships, mounts, workspacesById: byId, globalRootPath: 'G' })
  assert.deepEqual([...off.desired.get('pdf')], [{ host: 'dsh', scope: 'project', project: 'w1' }])
  assert.deepEqual(off.warnings.length, 1)
  assert.match(off.warnings[0], /pi 不可用/)
})

test('deriveDesired：引用不存在的工作区 → 无目标 + 「未匹配工作区」warning（R-12）', () => {
  const { desired, warnings } = deriveDesired({
    memberships: new Map([['pdf', 'g1']]),
    mounts: [{ group: 'g1', scope: 'project', project: 'gone' }],
    workspacesById: workspaces(),
    globalRootPath: 'G',
  })
  assert.deepEqual([...(desired.get('pdf') ?? [])], [])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /未匹配工作区/)
})

test('projectWorkspaces：缺 id/path 或重复 id → workspace-unavailable', () => {
  assert.throws(() => workspaces([{ id: '', path: 'P' }]), (e) => e.code === 'workspace-unavailable')
  assert.throws(() => workspaces([{ id: 'a', path: '' }]), (e) => e.code === 'workspace-unavailable')
  assert.throws(() => workspaces([{ id: 'a', path: 'P1' }, { id: 'a', path: 'P2' }]), (e) => e.code === 'workspace-unavailable')
})

test('targetDir：dsh 用注入根与 .dsh/skills；pi 用 piSkillsRoot 与 .pi/skills；未知工作区/空根 → undefined', () => {
  const byId = workspaces()
  assert.equal(targetDir({ scope: 'global', project: null }, { workspacesById: byId, globalRootPath: 'G' }), 'G')
  assert.equal(targetDir({ scope: 'project', project: 'w1' }, { workspacesById: byId, globalRootPath: 'G' }), join('P', '.dsh', 'skills'))
  assert.equal(targetDir({ scope: 'project', project: 'nope' }, { workspacesById: byId, globalRootPath: 'G' }), undefined)
  assert.equal(targetDir({ scope: 'global', project: null }, { workspacesById: byId, globalRootPath: '' }), undefined)
  // pi 宿主：global → piSkillsRoot；project → 工作区 .pi/skills；piSkillsRoot=null 时 pi 全局无目录
  assert.equal(targetDir({ host: 'pi', scope: 'global', project: null }, { workspacesById: byId, globalRootPath: 'G', piSkillsRoot: 'PS' }), 'PS')
  assert.equal(targetDir({ host: 'pi', scope: 'project', project: 'w1' }, { workspacesById: byId, globalRootPath: 'G', piSkillsRoot: 'PS' }), join('P', '.pi', 'skills'))
  assert.equal(targetDir({ host: 'pi', scope: 'global', project: null }, { workspacesById: byId, globalRootPath: 'G', piSkillsRoot: null }), undefined)
})

// ---- 夹具 ----

async function fixture() {
  const tmp = await mkTmp()
  const root = join(tmp, 'lib')
  await mkdir(root, { recursive: true })
  const globalRootPath = join(tmp, 'global')
  const ws1 = join(tmp, 'ws1')
  await mkdir(ws1, { recursive: true })
  // 摘除权来自 managed_links（DSR-022 B 案）：物化/对账类用例一律带登记表，
  // 否则按「宁可残留」新语义它们什么都摘不动——那是设计，不是这些用例要测的东西。
  const registry = createLinkRegistry({ store: fakeStore() })
  await registry.load()
  return { tmp, root, globalRootPath, registry, workspacesById: workspaces([{ id: 'w1', title: '', path: ws1 }]) }
}

// ---- 物化（materialize.js，junction-only） ----

test('materializeOne：空闲建 junction，重复调用幂等 ok；无 SKILL.md 源拒绝（no-skill-md）', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    const t = { scope: 'global', project: null }
    const call = () => materializeOne({ root: f.root, skill: 'pdf', t, workspacesById: f.workspacesById, globalRootPath: f.globalRootPath, registry: f.registry })
    assert.equal((await call()).action, 'mounted')
    assert.ok(await isLink(join(f.globalRootPath, 'pdf')))
    assert.ok(f.registry.has(join(f.globalRootPath, 'pdf')), '建链成功必须同刻登记（摘除权来源）')
    assert.equal((await call()).action, 'ok')
    await assert.rejects(
      materializeOne({ root: f.root, skill: 'ghost', t, workspacesById: f.workspacesById, globalRootPath: f.globalRootPath }),
      (e) => e.code === 'no-skill-md',
    )
  } finally {
    await cleanup(f.tmp)
  }
})

test('materializeOne：真实目录占位 → target-occupied 且内容零触碰（C-03/C-04）', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    const dst = join(f.globalRootPath, 'pdf')
    await mkdir(dst, { recursive: true })
    await writeFile(join(dst, 'keep.txt'), 'user data', 'utf8')
    await assert.rejects(
      materializeOne({ root: f.root, skill: 'pdf', t: { scope: 'global', project: null }, workspacesById: f.workspacesById, globalRootPath: f.globalRootPath }),
      (e) => e.code === 'target-occupied',
    )
    assert.equal(await readFile(join(dst, 'keep.txt'), 'utf8'), 'user data')
  } finally {
    await cleanup(f.tmp)
  }
})

test('materializeOne：库外链接不夺取（wrong-target）；库内他处链接自检重建', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    await writeSkill(f.root, 'pdf-old')
    const dst = join(f.globalRootPath, 'pdf')
    await mkdir(f.globalRootPath, { recursive: true })
    // 指向库外：不夺取
    const outside = join(f.tmp, 'outside')
    await mkdir(outside, { recursive: true })
    await symlink(outside, dst, 'junction')
    const t = { scope: 'global', project: null }
    const call = () => materializeOne({ root: f.root, skill: 'pdf', t, workspacesById: f.workspacesById, globalRootPath: f.globalRootPath })
    await assert.rejects(call(), (e) => e.code === 'wrong-target')
    assert.ok(await isLink(dst))
    // 指向库内他处（改名后旧链接）：仍需**登记命中**才夺取（DSR-022 第 10 条）
    await removeLink({ path: dst })
    await symlink(join(f.root, 'pdf-old'), dst, 'junction')
    await assert.rejects(
      materializeOne({ root: f.root, skill: 'pdf', t, workspacesById: f.workspacesById, globalRootPath: f.globalRootPath, libraryRoot: f.root, registry: f.registry }),
      (e) => e.code === 'wrong-target' && /不在本实例归属登记内/.test(e.message),
      '前缀自有但未登记的链接：只报告，不夺取',
    )
    await f.registry.register({ path: dst, target: join(f.root, 'pdf-old'), skill: 'pdf' })
    assert.equal((await materializeOne({ root: f.root, skill: 'pdf', t, workspacesById: f.workspacesById, globalRootPath: f.globalRootPath, libraryRoot: f.root, registry: f.registry })).action, 'mounted')
    assert.ok(await isLink(dst))
    assert.deepEqual(await readdir(dst), ['SKILL.md'])
  } finally {
    await cleanup(f.tmp)
  }
})

// 原「detachLink：owned 摘除 / 真实目录与库外链接 kept / absent」用例随该导出删除（2026-09-09 收口第 5 项）：
// 它在 src/ 内零生产调用方，摘除判定实际发生在 findOrphanLinks + removeLink，
// 同一张判定表由本文件 materializeOne 的 wrong-target / target-occupied 分支与
// inspect.test 的归属并集用例覆盖。B 案落地时该表将改由 managed_links 登记授予。

// ---- 归属判据（inspect.js 单源） ----

test('findOrphanLinks：登记 ∧ ¬expected 才孤儿；未登记（含前缀自有）、库外、兄弟前缀、AC-10 旧链接均非孤儿', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    await mkdir(f.globalRootPath, { recursive: true })
    const expected = new Map([['pdf', [{ scope: 'global', project: null }]]])
    const args = (root) => ({ root, desired: expected, globalRootPath: f.globalRootPath, workspacesById: f.workspacesById, registered: f.registry })
    // 期望内链接：非孤儿；改名残留（登记 ∧ ¬expected）：孤儿
    await symlink(join(f.root, 'pdf'), join(f.globalRootPath, 'pdf'), 'junction')
    await symlink(join(f.root, 'pdf'), join(f.globalRootPath, 'old-name'), 'junction')
    await f.registry.register({ path: join(f.globalRootPath, 'old-name'), target: join(f.root, 'pdf'), skill: 'old-name' })
    assert.deepEqual((await findOrphanLinks(args(f.root))).map((l) => l.name), ['old-name'])
    // 前缀自有但未登记 = 别的东西（其他实例/手工）→ 非孤儿（B 案的立项理由，第 6 条闸的最小面）
    await symlink(join(f.root, 'pdf'), join(f.globalRootPath, 'foreign'), 'junction')
    assert.deepEqual((await findOrphanLinks(args(f.root))).map((l) => l.name), ['old-name'])
    // 登记表缺席（null）→ 一律不判孤儿：宁可残留
    assert.deepEqual(await findOrphanLinks({ root: f.root, desired: expected, globalRootPath: f.globalRootPath, workspacesById: f.workspacesById }), [])
    // 库外链接：非孤儿
    const outside = join(f.tmp, 'elsewhere')
    await mkdir(outside, { recursive: true })
    await symlink(outside, join(f.globalRootPath, 'theirs'), 'junction')
    assert.deepEqual((await findOrphanLinks(args(f.root))).map((l) => l.name), ['old-name'])
    // 兄弟前缀目录（lib-sibling）：字符串前缀命中但不在库内 → 非孤儿
    const sibling = join(f.tmp, 'lib-sibling')
    await mkdir(sibling, { recursive: true })
    await writeSkill(sibling, 'sib')
    await symlink(join(sibling, 'sib'), join(f.globalRootPath, 'sib'), 'junction')
    assert.deepEqual((await findOrphanLinks(args(f.root))).map((l) => l.name), ['old-name'])
    // AC-10：改配另一目录后，指向旧目录的链接既不再 owned 也未在新目录登记 → 一律保留
    const root2 = join(f.tmp, 'lib2')
    await mkdir(root2, { recursive: true })
    assert.equal((await findOrphanLinks(args(root2))).length, 0)
    assert.ok(await isLink(join(f.globalRootPath, 'old-name')))
  } finally {
    await cleanup(f.tmp)
  }
})

test('scanMountLinks：悬挂链接以 readlink 原始目标兜底判 owned', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'temp')
    await mkdir(f.globalRootPath, { recursive: true })
    await symlink(join(f.root, 'temp'), join(f.globalRootPath, 'temp'), 'junction')
    await rm(join(f.root, 'temp'), { recursive: true, force: true })
    const links = await scanMountLinks({ root: f.root, globalRootPath: f.globalRootPath, workspacesById: f.workspacesById })
    assert.equal(links.length, 1)
    assert.equal(links[0].owned, true)
  } finally {
    await cleanup(f.tmp)
  }
})

// ---- 行状态走查 ----

test('walkMountState：ok 不报；target-occupied / wrong-target / link-missing 三判', async () => {
  const f = await fixture()
  try {
    for (const n of ['a', 'b', 'c']) await writeSkill(f.root, n)
    const t = { scope: 'global', project: null }
    const desired = new Map([['a', [t]], ['b', [t]], ['c', [t]], ['d', [t]]])
    await mkdir(f.globalRootPath, { recursive: true })
    await symlink(join(f.root, 'a'), join(f.globalRootPath, 'a'), 'junction')
    await mkdir(join(f.globalRootPath, 'b'), { recursive: true })
    const outside = join(f.tmp, 'out2')
    await mkdir(outside, { recursive: true })
    await symlink(outside, join(f.globalRootPath, 'c'), 'junction')
    const links = await scanMountLinks({ root: f.root, globalRootPath: f.globalRootPath, workspacesById: f.workspacesById })
    const rows = await walkMountState({ root: f.root, desired, links, globalRootPath: f.globalRootPath, workspacesById: f.workspacesById })
    assert.equal(rows.has('a'), false)
    assert.equal(rows.get('b')[0].issue, 'target-occupied')
    assert.equal(rows.get('c')[0].issue, 'wrong-target')
    assert.equal(rows.get('d')[0].issue, 'link-missing')
  } finally {
    await cleanup(f.tmp)
  }
})

// ---- 对账（三步幂等，无台账写回） ----

test('reconcile：物化 → 幂等 ok → 期望退场摘除（禁用即退场）', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    const opts = () => ({ root: f.root, mounts: [{ group: 'g1', scope: 'global', project: null }], workspacesById: f.workspacesById, globalRootPath: f.globalRootPath, registry: f.registry })
    const memberships = new Map([['pdf', 'g1']])
    const r1 = await reconcile({ ...opts(), memberships })
    assert.equal(r1.errors.length, 0)
    assert.equal(r1.results.find((x) => x.name === 'pdf')?.action, 'mounted')
    assert.ok(await isLink(join(f.globalRootPath, 'pdf')))
    const r2 = await reconcile({ ...opts(), memberships })
    assert.equal(r2.results.find((x) => x.name === 'pdf')?.action, 'ok')
    const r3 = await reconcile({ ...opts(), memberships: new Map() })
    assert.equal(r3.results.find((x) => x.name === 'pdf')?.action, 'removed')
    assert.equal(await isLink(join(f.globalRootPath, 'pdf')), false)
  } finally {
    await cleanup(f.tmp)
  }
})

test('reconcile：单目标失败不中断其余目标，errors 汇总', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    await writeSkill(f.root, 'img')
    await mkdir(join(f.globalRootPath, 'img'), { recursive: true })
    const r = await reconcile({
      root: f.root,
      memberships: new Map([['pdf', 'g1'], ['img', 'g1']]),
      mounts: [{ group: 'g1', scope: 'global', project: null }],
      workspacesById: f.workspacesById,
      globalRootPath: f.globalRootPath,
    })
    assert.equal(r.errors.length, 1)
    assert.equal(r.errors[0].code, 'target-occupied')
    assert.ok(await isLink(join(f.globalRootPath, 'pdf')))
  } finally {
    await cleanup(f.tmp)
  }
})

test('reconcile：project 期望物化到工作区根并写 git exclude 托管块；期望退场后块清除、用户内容保留', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    const wsPath = f.workspacesById.get('w1').path
    await mkdir(join(wsPath, '.git', 'info'), { recursive: true })
    const excludeFile = join(wsPath, '.git', 'info', 'exclude')
    await writeFile(excludeFile, '# 既有内容\n', 'utf8')
    const opts = () => ({ root: f.root, mounts: [{ group: 'g1', scope: 'project', project: 'w1' }], workspacesById: f.workspacesById, globalRootPath: f.globalRootPath, registry: f.registry })
    const r = await reconcile({ ...opts(), memberships: new Map([['pdf', 'g1']]) })
    assert.equal(r.results.find((x) => x.name === 'pdf')?.action, 'mounted')
    assert.ok(await isLink(join(wsPath, '.dsh', 'skills', 'pdf')))
    const text = await readFile(excludeFile, 'utf8')
    assert.match(text, /# >>> dsh-skill-manager/)
    assert.match(text, /\/\.dsh\/skills\//)
    assert.match(text, /# 既有内容/)
    await reconcile({ ...opts(), memberships: new Map() })
    const text2 = await readFile(excludeFile, 'utf8')
    assert.doesNotMatch(text2, /dsh-skill-manager/)
    assert.match(text2, /# 既有内容/)
  } finally {
    await cleanup(f.tmp)
  }
})

test('reconcile：孤儿链接在对账第一步被摘除（与清扫同一判据），他人现场不动', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    await mkdir(f.globalRootPath, { recursive: true })
    await symlink(join(f.root, 'pdf'), join(f.globalRootPath, 'orphan'), 'junction')
    await f.registry.register({ path: join(f.globalRootPath, 'orphan'), target: join(f.root, 'pdf'), skill: 'orphan' })
    const outside = join(f.tmp, 'kept')
    await mkdir(outside, { recursive: true })
    await symlink(outside, join(f.globalRootPath, 'theirs'), 'junction')
    // 前缀自有但未登记（别的实例指向同一配置目录建的）：不摘，且必须报条数
    await symlink(join(f.root, 'pdf'), join(f.globalRootPath, 'foreign'), 'junction')
    const r = await reconcile({ root: f.root, memberships: new Map(), mounts: [], workspacesById: f.workspacesById, globalRootPath: f.globalRootPath, registry: f.registry })
    assert.equal(r.results.find((x) => x.name === 'orphan')?.action, 'removed')
    assert.equal(await isLink(join(f.globalRootPath, 'orphan')), false)
    assert.ok(await isLink(join(f.globalRootPath, 'theirs')))
    assert.ok(await isLink(join(f.globalRootPath, 'foreign')), '未登记的前缀自有链接绝不摘除（宁可残留）')
    assert.ok(r.warnings.some((w) => /不在本实例归属登记内/.test(w)), '未登记残留必须显式报告条数')
  } finally {
    await cleanup(f.tmp)
  }
})

test('reconcile：失效工作区根不在扫描范围，其既有链接不动且仅 warning（R-12）', async () => {  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    const gone = join(f.tmp, 'gone-ws')
    const goneLink = join(gone, '.dsh', 'skills', 'pdf')
    await mkdir(join(gone, '.dsh', 'skills'), { recursive: true })
    await symlink(join(f.root, 'pdf'), goneLink, 'junction')
    const r = await reconcile({
      root: f.root,
      memberships: new Map([['pdf', 'g1']]),
      mounts: [{ group: 'g1', scope: 'project', project: 'gone' }],
      workspacesById: f.workspacesById,
      globalRootPath: f.globalRootPath,
      registry: f.registry,
    })
    assert.equal(r.warnings.length, 1)
    assert.match(r.warnings[0], /未匹配工作区/)
    assert.ok(await isLink(goneLink))
    assert.equal(r.results.find((x) => x.name === 'pdf'), undefined)
  } finally {
    await cleanup(f.tmp)
  }
})

test('reconcile：pi 宿主接管——.pi/skills 双侧物化与摘除、exclude 托管块双行', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    const piSkillsRoot = join(f.tmp, 'pi-agent', 'skills')
    const wsPath = f.workspacesById.get('w1').path
    await mkdir(join(wsPath, '.git', 'info'), { recursive: true })
    const excludeFile = join(wsPath, '.git', 'info', 'exclude')
    await writeFile(excludeFile, '# 既有内容\n', 'utf8')
    const opts = () => ({
      root: f.root,
      mounts: [
        { group: 'g1', scope: 'global', project: null, hosts: ['dsh', 'pi'] },
        { group: 'g1', scope: 'project', project: 'w1', hosts: ['dsh', 'pi'] },
      ],
      workspacesById: f.workspacesById,
      globalRootPath: f.globalRootPath,
      piSkillsRoot,
      registry: f.registry,
    })
    const r = await reconcile({ ...opts(), memberships: new Map([['pdf', 'g1']]) })
    assert.equal(r.errors.length, 0)
    // 双侧物化：dsh 全局 + dsh 项目 + pi 用户级 + pi 项目
    assert.ok(await isLink(join(f.globalRootPath, 'pdf')))
    assert.ok(await isLink(join(wsPath, '.dsh', 'skills', 'pdf')))
    assert.ok(await isLink(join(piSkillsRoot, 'pdf')))
    assert.ok(await isLink(join(wsPath, '.pi', 'skills', 'pdf')))
    const text = await readFile(excludeFile, 'utf8')
    assert.match(text, /\/\.dsh\/skills\//)
    assert.match(text, /\/\.pi\/skills\//)
    // 期望退场：双侧摘除、托管块清除
    await reconcile({ ...opts(), memberships: new Map() })
    assert.equal(await isLink(join(piSkillsRoot, 'pdf')), false)
    assert.equal(await isLink(join(wsPath, '.pi', 'skills', 'pdf')), false)
    assert.doesNotMatch(await readFile(excludeFile, 'utf8'), /dsh-skill-manager/)
  } finally {
    await cleanup(f.tmp)
  }
})

test('reconcile：双根制——github 条目从插件库根物化；归属判据覆盖用户根与插件库根（DSR-020）', async () => {
  const f = await fixture()
  const lib = await mkTmp()
  try {
    await writeSkill(f.root, 'mine') // 自研：用户根
    await writeSkill(lib, 'pdf') // github：插件库根
    const opts = () => ({
      root: f.root,
      mounts: [{ group: 'g1', scope: 'global', project: null }],
      workspacesById: f.workspacesById,
      globalRootPath: f.globalRootPath,
      libraryRoot: lib,
      srcRootOf: (dir) => (dir === 'pdf' ? lib : f.root),
      registry: f.registry,
    })
    const memberships = new Map([['mine', 'g1'], ['pdf', 'g1']])
    const r = await reconcile({ ...opts(), memberships })
    assert.equal(r.errors.length, 0)
    // 双侧物化，链接各回各源根
    assert.ok(await isLink(join(f.globalRootPath, 'mine')))
    assert.ok(await isLink(join(f.globalRootPath, 'pdf')))
    assert.equal((await readdir(join(f.globalRootPath, 'pdf')))[0], 'SKILL.md')
    // pdf 退场：指向插件库根的链接同属管辖（owned 并集），按孤儿摘除；mine 不动
    const r2 = await reconcile({ ...opts(), memberships: new Map([['mine', 'g1']]) })
    assert.equal(r2.results.find((x) => x.name === 'pdf')?.action, 'removed')
    assert.equal(await isLink(join(f.globalRootPath, 'pdf')), false)
    assert.ok(await isLink(join(f.globalRootPath, 'mine')))
  } finally {
    await cleanup(f.tmp)
    await cleanup(lib)
  }
})

test('piState：扫描根 = 开关开或规则引用 pi；开关关且无引用 = pi 全不存在（不扫不报）', () => {
  const offNoRef = piState({ pi: false, groups: { 默认: { mounts: [] } } }, 'PS')
  assert.deepEqual(offNoRef, { piSkillsRoot: null, piScanRoot: null })
  // 开关关但规则残留 pi：扫描根保留（干净退出语义），期望根仍 null
  const offWithRef = piState({ pi: false, groups: { 默认: { mounts: [{ scope: 'global', project: null, hosts: ['dsh', 'pi'] }] } } }, 'PS')
  assert.deepEqual(offWithRef, { piSkillsRoot: null, piScanRoot: 'PS' })
  // 开关开：两根俱在；未探测到目录（probedRoot=null）一律 null
  assert.deepEqual(piState({ pi: true, groups: {} }, 'PS'), { piSkillsRoot: 'PS', piScanRoot: 'PS' })
  assert.deepEqual(piState({ pi: true, groups: {} }, null), { piSkillsRoot: null, piScanRoot: null })
})

test('reconcile：pi 开关关闭但目录探测在（期望根 null + 扫描根在）→ pi 残留链接按孤儿摘除（干净退出）', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    const piRoot = join(f.tmp, 'pi-agent', 'skills')
    await mkdir(piRoot, { recursive: true })
    await symlink(join(f.root, 'pdf'), join(piRoot, 'pdf'), 'junction')
    await f.registry.register({ path: join(piRoot, 'pdf'), target: join(f.root, 'pdf'), skill: 'pdf' }) // 模拟本实例早年所建
    const r = await reconcile({
      root: f.root,
      memberships: new Map([['pdf', 'g1']]),
      mounts: [{ group: 'g1', scope: 'global', project: null, hosts: ['dsh', 'pi'] }],
      workspacesById: f.workspacesById,
      globalRootPath: f.globalRootPath,
      piSkillsRoot: null,
      piScanRoot: piRoot,
      registry: f.registry,
    })
    assert.match(r.warnings[0], /pi 不可用/)
    assert.equal(await isLink(join(piRoot, 'pdf')), false)
    assert.ok(await isLink(join(f.globalRootPath, 'pdf')))
  } finally {
    await cleanup(f.tmp)
  }
})
test('reconcile：pi 不可用（piSkillsRoot 缺省）零副作用——pi 侧不扫不建，dsh 侧照常', async () => {
  const f = await fixture()
  try {
    await writeSkill(f.root, 'pdf')
    const wsPath = f.workspacesById.get('w1').path
    const r = await reconcile({
      root: f.root,
      memberships: new Map([['pdf', 'g1']]),
      mounts: [{ group: 'g1', scope: 'project', project: 'w1', hosts: ['dsh', 'pi'] }],
      workspacesById: f.workspacesById,
      globalRootPath: f.globalRootPath,
      registry: f.registry,
    })
    assert.equal(r.warnings.length, 1)
    assert.match(r.warnings[0], /pi 不可用/)
    assert.ok(await isLink(join(wsPath, '.dsh', 'skills', 'pdf')))
    // pi 侧完全未建（.pi 目录不存在）
    let piExists = true
    try {
      await readdir(join(wsPath, '.pi'))
    } catch {
      piExists = false
    }
    assert.equal(piExists, false)
  } finally {
    await cleanup(f.tmp)
  }
})
