// sync.js 单元测试：挂载推导、junction 物化、对账摘除、孤儿清扫、健康、项目条目分类。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deriveDesired,
  materializeOne,
  reconcile,
  health,
  detachOne,
  classifyProjectEntries,
  targetKey,
} from '../lib/sync.js'
import { loadState, saveState, globalRoot } from '../lib/state.js'
import { readJson, writeJson } from '../lib/workshop.js'

// 重定向 homedir()（globalRoot 每次调用时读取环境）。
const realHome = process.env.USERPROFILE
let home
let root

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-sm-home-'))
  process.env.USERPROFILE = home
  root = await mkdtemp(join(tmpdir(), 'dsh-sm-workshop-'))
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n正文', 'utf8')
  await mkdir(join(root, 'skills', 'no-md'), { recursive: true })
})

after(async () => {
  process.env.USERPROFILE = realHome
  await rm(home, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
})

const apps = { dsh: { skills_dir: '~/.dsh/skills', project_dir: '.dsh/skills', enabled: true } }

function baseState() {
  return {
    projects: {},
    mounts: [{ group: '默认', app: 'dsh', scope: 'global', project: null }],
    synced: {},
    proxy: null,
  }
}

test('deriveDesired：组挂载推导与 warning', () => {
  const state = baseState()
  const groups = {}
  const { desired, warnings } = deriveDesired({ state, apps, groups, skills: ['alpha', 'no-md'] })
  assert.deepEqual([...desired.get('alpha')].map(targetKey), ['dsh|global|'])
  assert.deepEqual([...desired.get('no-md')].map(targetKey), ['dsh|global|'])
  assert.equal(warnings.length, 0)
  // 引用未注册项目的挂载 → warning，不计入期望
  const bad = { ...baseState(), mounts: [{ group: '默认', app: 'dsh', scope: 'project', project: '不存在' }] }
  const r = deriveDesired({ state: bad, apps, groups: {}, skills: ['alpha'] })
  assert.equal(r.desired.get('alpha').length, 0)
  assert.equal(r.warnings.length, 1)
  // 组挂载：alpha 在「写作」组，挂载引用「写作」才生效
  const grouped = { ...baseState(), mounts: [{ group: '写作', app: 'dsh', scope: 'global', project: null }] }
  const g = deriveDesired({ state: grouped, apps, groups: { 写作: ['alpha'] }, skills: ['alpha'] })
  assert.deepEqual([...g.desired.get('alpha')].map(targetKey), ['dsh|global|'])
})

test('reconcile：junction 物化 → health 收敛 → 摘除', async () => {
  const state = baseState()
  const groups = {}
  const save = (s) => saveState(root, s)
  const r1 = await reconcile({ root, state, apps, groups, skills: ['alpha'], save })
  assert.equal(r1.errors.length, 0)
  assert.ok(r1.results.some((x) => x.action === 'synced' && x.method === 'junction'))
  // 目标为 junction 且 realpath 指向车间源（两侧都经 realpath 规范化）
  const dst = join(home, '.dsh', 'skills', 'alpha')
  const rp = await realpath(dst)
  assert.equal(rp.toLowerCase(), (await realpath(join(root, 'skills', 'alpha'))).toLowerCase())
  // health 收敛
  const issues = await health({ root, state, apps, groups, skills: ['alpha'] })
  assert.equal(issues.length, 0)
  // 摘除：移除挂载后对账
  state.mounts = []
  await reconcile({ root, state, apps, groups, skills: ['alpha'], save })
  await assert.rejects(() => realpath(dst))
  const issues2 = await health({ root, state, apps, groups, skills: ['alpha'] })
  assert.equal(issues2.length, 0)
})

test('reconcile：缺 SKILL.md 的源拒绝物化（error 不中断）', async () => {
  const state = baseState()
  const groups = {}
  const save = (s) => saveState(root, s)
  const r = await reconcile({ root, state, apps, groups, skills: ['alpha', 'no-md'], save })
  const error = r.results.find((x) => x.name === 'no-md' && x.action === 'error')
  assert.ok(error, 'no-md 应报 error')
  assert.match(error.error, /SKILL\.md/)
  assert.equal(r.errors.length, 1)
})

test('孤儿清扫：指向车间但不在期望集的链接被摘除；他人链接不动', async () => {
  const state = baseState()
  const groups = {}
  const save = (s) => saveState(root, s)
  await reconcile({ root, state, apps, groups, skills: ['alpha'], save })
  const rootDir = join(home, '.dsh', 'skills')
  // 孤儿：指向车间 no-md（不在期望集）
  await symlink(join(root, 'skills', 'no-md'), join(rootDir, 'no-md'), 'junction')
  // 他人链接：指向车间外（两侧都经 realpath 规范化）
  const foreign = await mkdtemp(join(tmpdir(), 'dsh-sm-foreign-'))
  await symlink(foreign, join(rootDir, 'foreign'), 'junction')
  state.mounts = []
  await reconcile({ root, state, apps, groups, skills: ['alpha'], save })
  await assert.rejects(() => realpath(join(rootDir, 'no-md'))) // 孤儿被摘
  assert.equal((await realpath(join(rootDir, 'foreign'))).toLowerCase(), (await realpath(foreign)).toLowerCase()) // 他人链接保留
  await rm(join(rootDir, 'foreign'), { recursive: true, force: true })
  await rm(foreign, { recursive: true, force: true })
})

test('detachOne：absent / 链接摘除 / 非托管真实目录 kept', async () => {
  assert.equal(await detachOne({ dir: join(home, 'no-such') }), 'absent')
  const dst = join(home, '.dsh', 'skills', 'alpha')
  await mkdir(join(home, '.dsh', 'skills'), { recursive: true })
  await symlink(join(root, 'skills', 'alpha'), dst, 'junction')
  assert.equal(await detachOne({ dir: dst, method: 'junction' }), 'removed')
  await assert.rejects(() => realpath(dst))
  // 真实目录（非 copy 记录）→ kept
  const realDir = join(home, 'real-dir')
  await mkdir(realDir, { recursive: true })
  assert.equal(await detachOne({ dir: realDir, method: 'junction' }), 'kept')
  await rm(realDir, { recursive: true, force: true })
})

test('classifyProjectEntries：五类现场 + external-skill', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-sm-proj-'))
  const base = join(project, '.dsh', 'skills')
  await mkdir(base, { recursive: true })
  // managed-ok：链接与车间 skill 同名且指向 skills/<同名>
  await symlink(join(root, 'skills', 'alpha'), join(base, 'alpha'), 'junction')
  // wrong-target：链接指向车间外（名字无所谓，realpath 不匹配）
  await symlink(await foreignDir(), join(base, 'wrong-link'), 'junction')
  await mkdir(join(base, 'empty-dir'))
  await mkdir(join(base, 'real-skill'))
  await writeFile(join(base, 'real-skill', 'SKILL.md'), '---\nname: real-skill\n---\n', 'utf8')
  await mkdir(join(base, 'foreign-dir'))
  await writeFile(join(base, 'foreign-dir', 'notes.txt'), 'x', 'utf8')

  const { entries } = await classifyProjectEntries(root, project)
  const byName = Object.fromEntries(entries.map((e) => [e.name, e.kind]))
  assert.equal(byName.alpha, 'managed-ok')
  assert.equal(byName['wrong-link'], 'wrong-target')
  assert.equal(byName['empty-dir'], 'local-empty')
  assert.equal(byName['real-skill'], 'local-skill')
  assert.equal(byName['foreign-dir'], 'local-foreign')
  // 车间中存在但项目中不存在 → external-skill
  const noMd = entries.find((e) => e.name === 'no-md')
  assert.equal(noMd !== undefined && noMd.kind === 'external-skill', true)
  await rm(project, { recursive: true, force: true })
})

async function foreignDir() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sm-foreign2-'))
  return dir
}

test('materializeOne：真实目录冲突拒绝覆盖（target-exists）', async () => {
  const state = baseState()
  const dst = join(home, '.dsh', 'skills', 'alpha')
  await mkdir(join(home, '.dsh', 'skills'), { recursive: true })
  await mkdir(dst, { recursive: true })
  await writeFile(join(dst, 'user-file.txt'), 'mine', 'utf8')
  await assert.rejects(
    () => materializeOne({ root, state, apps, skill: 'alpha', t: { app: 'dsh', scope: 'global', project: null }, method: 'auto', existingRec: undefined }),
    (e) => e.code === 'target-exists',
  )
  await rm(dst, { recursive: true, force: true })
})

test('loadState：缺失按空骨架', async () => {
  const state = await loadState(root)
  assert.deepEqual(state.projects, {})
  assert.deepEqual(state.mounts, [])
  await writeJson(root, 'distributor/state.json', { projects: {}, mounts: [], synced: {} })
  assert.ok(globalRoot().endsWith('.dsh\\skills') || globalRoot().endsWith('.dsh/skills'))
})
