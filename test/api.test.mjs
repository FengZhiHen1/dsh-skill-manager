// HTTP API 传输层与编排（plugin-runtime.md）：信封、单飞队列、未配置门禁、方法语义。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildApi, createQueue, readJsonBody, writeError, writeOk } from '../lib/api.js'
import { isLink } from '../lib/sync.js'
import { mkTmp, cleanup, writeSkill, fakeStore, fakeScope, skillRecord, assertRejectsCode } from './helpers.mjs'

/** 假 res：捕获 status 与 JSON body。 */
function fakeRes() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(text) {
      this.body = JSON.parse(text)
    },
  }
}

function makeApi({ root = '', workspaces = [], store = fakeStore(), backupsRoot = '' } = {}) {
  return {
    api: buildApi(() => fakeScope(root), {
      listWorkspaces: () => workspaces,
      getStore: () => store,
      backupsRoot,
    }),
    store,
  }
}

test('未配置门禁：所有方法统一 skilldir-unconfigured', async () => {
  const { api } = makeApi({ root: '' })
  for (const method of Object.keys(api)) {
    await assertRejectsCode(api[method]({}), 'skilldir-unconfigured')
  }
})

test('已配置但目录缺失：统一 skilldir-missing（插件保持存活）', async () => {
  const { api } = makeApi({ root: join(await mkTmp(), 'not-there') })
  await assertRejectsCode(api.library({}), 'skilldir-missing')
  await assertRejectsCode(api.groups({}), 'skilldir-missing')
})

test('writeError：SkillManagerError → 信封；未知错误 → internal 500', async () => {
  const { SkillManagerError } = await import('../lib/errors.js')
  const res1 = fakeRes()
  writeError(res1, new SkillManagerError('bad-name', '名字不对'))
  assert.equal(res1.status, 200)
  assert.deepEqual(res1.body, { ok: false, error: { code: 'bad-name', message: '名字不对', retryable: false } })
  const res2 = fakeRes()
  writeError(res2, new Error('boom'))
  assert.equal(res2.status, 500)
  assert.equal(res2.body.error.code, 'internal')
  const res3 = fakeRes()
  writeOk(res3, { a: 1 })
  assert.deepEqual(res3.body, { ok: true, data: { a: 1 } })
})

test('createQueue：FIFO 串行且前序失败不阻塞后续', async () => {
  const queue = createQueue()
  const order = []
  await Promise.all([
    queue.enqueue(async () => { order.push('a'); throw new Error('x') }).catch(() => {}),
    queue.enqueue(async () => { order.push('b') }),
    queue.enqueue(async () => { order.push('c') }),
  ])
  assert.deepEqual(order, ['a', 'b', 'c'])
})

test('readJsonBody：边界与非法 JSON', async () => {
  async function bodyOf(chunks) {
    const iterator = (async function* () {
      for (const c of chunks) yield c
    })()
    return readJsonBody(iterator)
  }
  assert.deepEqual(await bodyOf([]), {})
  assert.deepEqual(await bodyOf(['{"a":1}']), { a: 1 })
  await assertRejectsCode(bodyOf(['not json']), 'bad-request')
})

test('全新域：首次访问写入默认挂载种子（默认组 → dsh 全局）', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const { api, store } = makeApi({ root })
    const data = await api.library({})
    assert.equal(data.skills.length, 1)
    assert.equal(data.skills[0].dir, 'pdf')
    assert.deepEqual(data.skills[0].targets, ['dsh|global|'])
    assert.deepEqual(store.mountEntries().map(([, m]) => m), [
      { group: '默认', app: 'dsh', scope: 'global', project: null },
    ])
    assert.deepEqual(data.warnings, [])
  } finally {
    await cleanup(root)
  }
})

test('library：origin/group/q 过滤与缓存下发', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'pdf', { description: 'PDF 处理' })
    await writeSkill(root, 'mine', { description: '自研' })
    const { api, store } = makeApi({ root })
    await store.putSkill('pdf', skillRecord({ origin: 'github', repo: 'a/b', commit: 'f'.repeat(40) }))
    await store.putCheck('pdf', {
      checked_at: '2026-08-20T00:00:00.000Z', repo: 'a/b', branch: 'main',
      current: 'f'.repeat(40), latest: 'f'.repeat(40), status: 'up_to_date',
      reason: null, via: 'api', updatable: false, reachable: true,
      locally_modified: false, baseline_missing: false, missing: false,
    })
    const all = await api.library({})
    assert.equal(all.checkedAt, '2026-08-20T00:00:00.000Z')
    const pdf = all.skills.find((s) => s.dir === 'pdf')
    assert.equal(pdf.upstream.status, 'up_to_date')
    assert.equal(pdf.commit, 'f'.repeat(40))
    assert.equal((await api.library({ origin: 'github' })).skills.length, 1)
    assert.equal((await api.library({ q: '自研' })).skills[0].dir, 'mine')
    assert.equal((await api.library({ group: '默认' })).skills.length, 2)
    assert.equal((await api.library({ group: '不存在' })).skills.length, 0)
  } finally {
    await cleanup(root)
  }
})

test('groups/op：create 复制默认组挂载；rename 迁移挂载；delete 清规则；move 换组', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const { api, store } = makeApi({ root })
    await api.library({}) // 触发种子 + self 登记
    const created = await api['groups/op']({ action: 'create', name: '办公' })
    assert.deepEqual(created.groups, [{ name: '办公', count: 0 }])
    assert.deepEqual(
      store.mountEntries().map(([, m]) => m.group).sort(),
      ['办公', '默认'],
    )
    await api['groups/op']({ action: 'move', dir: 'pdf', group: '办公' })
    assert.equal(store.getSkill('pdf').group, '办公')
    await api['groups/op']({ action: 'rename', name: '办公', newName: '文档' })
    assert.deepEqual(store.mountEntries().map(([, m]) => m.group).sort(), ['文档', '默认'])
    assert.equal(store.getSkill('pdf').group, '文档')
    await api['groups/op']({ action: 'delete', name: '文档' })
    assert.deepEqual(store.mountEntries().map(([, m]) => m.group), ['默认'])
    assert.equal(store.getSkill('pdf').group, '默认')
    await assertRejectsCode(api['groups/op']({ action: 'move', dir: 'ghost', group: null }), 'not-found')
    await assertRejectsCode(api['groups/op']({ action: 'wat' }), 'bad-request')
  } finally {
    await cleanup(root)
  }
})

test('mounts：项目级挂载校验 + reconcile 物化到工作区', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const workspaces = [{ id: 'w1', path: proj, title: '项目' }]
    const { api } = makeApi({ root, workspaces })
    await assertRejectsCode(api.mounts({ action: 'add', group: '默认', scope: 'project', workspaceId: 'gone' }), 'workspace-not-found')
    const r = await api.mounts({ action: 'add', group: '默认', scope: 'project', workspaceId: 'w1' })
    assert.equal(r.sync.errors.length, 0)
    assert.ok(await isLink(join(proj, '.dsh', 'skills', 'pdf')))
    await assertRejectsCode(api.mounts({ action: 'add', group: '默认', scope: 'project', workspaceId: 'w1' }), 'mount-exists')
    const r2 = await api.mounts({ action: 'remove', group: '默认', scope: 'project', workspaceId: 'w1' })
    assert.equal(r2.sync.errors.length, 0)
    assert.equal(await isLink(join(proj, '.dsh', 'skills', 'pdf')), false)
  } finally {
    await cleanup(root)
    await cleanup(proj)
  }
})

test('disable/enable：禁用退出期望集，启用重新物化', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const workspaces = [{ id: 'w1', path: proj, title: '项目' }]
    const { api } = makeApi({ root, workspaces })
    await api.mounts({ action: 'add', group: '默认', scope: 'project', workspaceId: 'w1' })
    assert.ok(await isLink(join(proj, '.dsh', 'skills', 'pdf')))
    await api.disable({ name: 'pdf' })
    assert.equal(await isLink(join(proj, '.dsh', 'skills', 'pdf')), false)
    const lib = await api.library({})
    assert.equal(lib.skills[0].disabled, true)
    await api.enable({ name: 'pdf' })
    assert.ok(await isLink(join(proj, '.dsh', 'skills', 'pdf')))
  } finally {
    await cleanup(root)
    await cleanup(proj)
  }
})

test('claim-empty：空目录现场清理并接管', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const workspaces = [{ id: 'w1', path: proj, title: '项目' }]
    const { api } = makeApi({ root, workspaces })
    await mkdir(join(proj, '.dsh', 'skills', 'pdf'), { recursive: true }) // 空目录现场
    await api.mounts({ action: 'add', group: '默认', scope: 'project', workspaceId: 'w1' })
    // 现场仍在（target-exists 不自动接管）
    const before = await api['project-skills']({ workspaceId: 'w1' })
    assert.equal(before.entries.w1.entries.find((e) => e.name === 'pdf').kind, 'local-empty')
    const r = await api['claim-empty']({ name: 'pdf', workspaceId: 'w1' })
    assert.equal(r.name, 'pdf')
    assert.ok(await isLink(join(proj, '.dsh', 'skills', 'pdf')))
    await assertRejectsCode(api['claim-empty']({ name: 'pdf', workspaceId: 'gone' }), 'workspace-not-found')
  } finally {
    await cleanup(root)
    await cleanup(proj)
  }
})

test('health 与 workspace-projects 方法端到端', async () => {
  const root = await mkTmp()
  const proj = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const workspaces = [{ id: 'w1', path: proj, title: '项目' }]
    const { api } = makeApi({ root, workspaces })
    await api.library({})
    const wp = await api['workspace-projects']({})
    assert.equal(wp.workspaceProjects.length, 1)
    assert.equal(wp.workspaceProjects[0].workspaceId, 'w1')
    assert.deepEqual(wp.legacyProjects, [])
    const h = await api.health({})
    assert.ok(Array.isArray(h.issues))
    // 挂载后 health 收敛
    await api.mounts({ action: 'add', group: '默认', scope: 'project', workspaceId: 'w1' })
    const h2 = await api.health({})
    assert.equal(h2.issues.filter((i) => i.issue === 'missing-link').length, 0)
  } finally {
    await cleanup(root)
    await cleanup(proj)
  }
})

test('storage 域未就绪：方法回 internal 语义（getStore 抛错）', async () => {
  const root = await mkTmp()
  try {
    const api = buildApi(() => fakeScope(root), {
      listWorkspaces: () => [],
      getStore: () => {
        throw new Error('storage 域尚未就绪')
      },
      backupsRoot: '',
    })
    // 门禁先于 store：未配置时仍报 skilldir-unconfigured
    const gate = buildApi(() => fakeScope(''), { getStore: () => { throw new Error('x') }, backupsRoot: '' })
    await assertRejectsCode(gate.library({}), 'skilldir-unconfigured')
    await assert.rejects(() => api.library({}), /storage 域尚未就绪/)
  } finally {
    await cleanup(root)
  }
})

test('工作区镜像：legacy 项目经 api 下发为只读遗留项', async () => {
  const root = await mkTmp()
  try {
    const { api, store } = makeApi({ root, workspaces: [] })
    await store.putProject('gone', { path: 'E:/removed' })
    const data = await api['workspace-projects']({})
    assert.equal(data.legacyProjects.length, 1)
    assert.equal(data.legacyProjects[0].status, 'workspace-unmatched')
    // 目录不因遗留项被触碰
    assert.deepEqual(await readdir(root), [])
  } finally {
    await cleanup(root)
  }
})
