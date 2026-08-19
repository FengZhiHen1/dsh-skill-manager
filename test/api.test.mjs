// api.js 单元测试：未配置门禁、信封映射、单飞队列、方法分发。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApi, createQueue, writeError, readJsonBody, ApiError } from '../lib/api.js'
import { WorkshopError } from '../lib/errors.js'

function scopeOf(workshopDir) {
  return { get: () => ({ workshopDir }) }
}

function captureResponse() {
  const res = {
    status: 0,
    body: null,
    writeHead(status) { this.status = status },
    end(body) { this.body = body },
  }
  return res
}

test('未配置门禁：所有方法统一 workshop-unconfigured', async () => {
  const api = buildApi(() => scopeOf(''))
  for (const method of ['library', 'groups', 'sync', 'health', 'search', 'backups']) {
    await assert.rejects(
      () => api[method]({}),
      (e) => e instanceof WorkshopError && e.code === 'workshop-unconfigured',
      `方法 ${method} 应被门禁`,
    )
  }
})

test('已配置：library 与 groups 返回车间数据', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: 测试\n---\n', 'utf8')
  const api = buildApi(() => scopeOf(root))
  const lib = await api['library']({})
  assert.equal(lib.skills.length, 1)
  assert.equal(lib.skills[0].name, 'alpha')
  assert.equal(lib.skills[0].group, '默认')
  const grp = await api['groups']()
  assert.deepEqual(grp.groups, [])
  await rm(root, { recursive: true, force: true })
})

test('车间根目录缺失：统一 workshop-missing（插件保持存活）', async () => {
  const root = join(tmpdir(), 'dsh-sm-gone-' + Date.now())
  const api = buildApi(() => scopeOf(root))
  for (const method of ['library', 'groups', 'health', 'search', 'backups']) {
    await assert.rejects(
      () => api[method]({}),
      (e) => e instanceof WorkshopError && e.code === 'workshop-missing',
      `方法 ${method} 应报 workshop-missing`,
    )
  }
})

test('全新车间：首次访问写入默认挂载种子（默认组 → dsh 全局）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n', 'utf8')
  const api = buildApi(() => scopeOf(root))
  await api['library']({})
  const state = JSON.parse(await readFile(join(root, 'distributor', 'state.json'), 'utf8'))
  assert.deepEqual(state.mounts, [{ group: '默认', app: 'dsh', scope: 'global', project: null }])
  // 第二次访问不再重复写入（种子已存在）
  await api['groups']()
  const state2 = JSON.parse(await readFile(join(root, 'distributor', 'state.json'), 'utf8'))
  assert.equal(state2.mounts.length, 1)
  await rm(root, { recursive: true, force: true })
})

test('groups/op create：复制默认组挂载规则作为起步', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n', 'utf8')
  const api = buildApi(() => scopeOf(root))
  await api['library']({}) // 触发默认种子
  const r = await api['groups/op']({ action: 'create', name: '新组' })
  assert.equal(r.groups.length, 1)
  const state = JSON.parse(await readFile(join(root, 'distributor', 'state.json'), 'utf8'))
  const newMounts = state.mounts.filter((m) => m.group === '新组')
  assert.equal(newMounts.length, 1)
  assert.equal(newMounts[0].app, 'dsh')
  assert.equal(newMounts[0].scope, 'global')
  await rm(root, { recursive: true, force: true })
})

test('groups/op：改名同步迁移挂载，删除组清除其规则', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n', 'utf8')
  const api = buildApi(() => scopeOf(root), {
    listWorkspaces: () => [{ id: 'ws-1', title: '测试工作区', path: root }],
  })
  await api.library({})
  await api['groups/op']({ action: 'create', name: '写作' })
  await api['groups/op']({ action: 'rename', name: '写作', newName: '创作' })
  let groups = await api.groups()
  assert.ok(groups.mounts.some((mount) => mount.group === '创作' && mount.scope === 'global'))
  await api['groups/op']({ action: 'delete', name: '创作' })
  groups = await api.groups()
  assert.equal(groups.mounts.some((mount) => mount.group === '创作'), false)
  await rm(root, { recursive: true, force: true })
})

test('writeError：WorkshopError → 信封；未知错误 → internal 500', () => {
  const res1 = captureResponse()
  writeError(res1, new WorkshopError('workshop-corrupt', '损坏'))
  const env1 = JSON.parse(res1.body)
  assert.equal(env1.ok, false)
  assert.equal(env1.error.code, 'workshop-corrupt')
  assert.equal(res1.status, 200)

  const res2 = captureResponse()
  writeError(res2, new Error('boom'))
  const env2 = JSON.parse(res2.body)
  assert.equal(env2.error.code, 'internal')
  assert.equal(res2.status, 500)
})

test('createQueue：FIFO 串行且前序失败不阻塞后续', async () => {
  const queue = createQueue()
  const order = []
  const r1 = queue.enqueue(async () => { order.push(1); await new Promise((r) => setTimeout(r, 20)); return 'a' })
  const r2 = queue.enqueue(async () => { order.push(2); throw new Error('fail') })
  const r3 = queue.enqueue(async () => { order.push(3); return 'c' })
  assert.equal(await r1, 'a')
  await assert.rejects(() => r2, /fail/)
  assert.equal(await r3, 'c')
  assert.deepEqual(order, [1, 2, 3])
})

test('readJsonBody：边界与非法 JSON', async () => {
  const req = { [Symbol.asyncIterator]: async function* () { yield Buffer.from('{"a":1}') } }
  assert.deepEqual(await readJsonBody(req), { a: 1 })
  const bad = { [Symbol.asyncIterator]: async function* () { yield Buffer.from('{bad') } }
  await assert.rejects(() => readJsonBody(bad), (e) => e instanceof ApiError && e.code === 'bad-request')
  const empty = { [Symbol.asyncIterator]: async function* () {} }
  assert.deepEqual(await readJsonBody(empty), {})
})

test('工作区镜像：Host 投影迁移旧项目并移除手工 projects API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-sm-workspace-'))
  const orphan = join(tmpdir(), 'dsh-sm-unmatched-' + Date.now())
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n', 'utf8')
  await mkdir(join(root, 'distributor'), { recursive: true })
  await writeFile(join(root, 'distributor', 'state.json'), JSON.stringify({
    projects: { '旧项目': workspace, auteur: orphan },
    mounts: [{ group: '默认', app: 'dsh', scope: 'project', project: '旧项目' }],
    synced: { alpha: [{ app: 'dsh', scope: 'project', project: '旧项目', method: 'junction', dir: join(workspace, '.dsh', 'skills', 'alpha') }] },
  }), 'utf8')
  const api = buildApi(() => scopeOf(root), {
    listWorkspaces: () => [{ id: 'workspace-1', title: 'Aurora Web', path: workspace }],
  })

  const groups = await api.groups()
  assert.equal('projects' in api, false)
  assert.deepEqual(groups.workspaceProjects.map((item) => item.workspaceId), ['workspace-1'])
  assert.deepEqual(groups.legacyProjects.map((item) => item.project), ['auteur'])
  assert.equal(groups.mounts[0].project, 'workspace-1')
  const projection = await api['workspace-projects']()
  assert.equal(projection.workspaceProjects[0].title, 'Aurora Web')
  const projectSkills = await api['project-skills']()
  assert.deepEqual(Object.keys(projectSkills.entries), ['workspace-1'])
  assert.deepEqual(projectSkills.legacyProjects.map((item) => item.project), ['auteur'])
  const persisted = JSON.parse(await readFile(join(root, 'distributor', 'state.json'), 'utf8'))
  assert.equal(persisted.projects['workspace-1'], workspace)
  assert.equal(persisted.projects.auteur, orphan)
  assert.equal(persisted.mounts[0].project, 'workspace-1')
  assert.equal(persisted.synced.alpha[0].project, 'workspace-1')
  await assert.rejects(
    () => api.mounts({ action: 'add', group: '默认', app: 'dsh', scope: 'project', workspaceId: 'missing' }),
    (error) => error instanceof WorkshopError && error.code === 'workspace-not-found',
  )
  await rm(root, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
})
