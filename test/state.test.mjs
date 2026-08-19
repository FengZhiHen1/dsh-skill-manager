// 挂载状态投影、工作区镜像、挂载规则（mount-sync.md；storage-model.md）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  loadState, saveState, ensureSeedMounts, loadCheckCache, saveCheckCache,
  normalizeWorkspaceProjects, mirrorWorkspaceProjects, validateMountShape,
  addMount, removeMount, globalRoot, projectRootOf, DSH_APP,
} from '../lib/state.js'
import { fakeStore, assertRejectsCode, assertThrowsCode } from './helpers.mjs'

test('loadState/saveState：投影往返（projects/mounts/synced）', async () => {
  const store = fakeStore()
  const state = {
    projects: { w1: 'E:/repo' },
    mounts: [{ group: '默认', app: 'dsh', scope: 'global', project: null }],
    synced: {
      pdf: [
        { app: 'dsh', scope: 'global', project: null, method: 'junction', dir: 'C:/x/pdf', at: 't1' },
        { app: 'dsh', scope: 'project', project: 'w1', method: 'copy', dir: 'E:/repo/.dsh/skills/pdf', at: 't2' },
      ],
    },
    proxy: null,
  }
  await saveState(store, state)
  const back = await loadState(store)
  assert.deepEqual(back.projects, { w1: 'E:/repo' })
  assert.deepEqual(back.mounts, state.mounts)
  assert.equal(back.synced.pdf.length, 2)
  const projectRec = back.synced.pdf.find((r) => r.scope === 'project')
  assert.equal(projectRec.project, 'w1')
  assert.equal(projectRec.method, 'copy')
})

test('loadState：空域按空骨架', async () => {
  const state = await loadState(fakeStore())
  assert.deepEqual(state, { projects: {}, mounts: [], synced: {}, proxy: null })
})

test('ensureSeedMounts：全新域种子默认挂载；非空域不再种子', async () => {
  const store = fakeStore()
  await ensureSeedMounts(store)
  assert.deepEqual(store.mountEntries().map(([, m]) => m), [
    { group: '默认', app: 'dsh', scope: 'global', project: null },
  ])
  // 用户删掉挂载但域内有 skill → 不重新种子
  await store.deleteMount({ group: '默认', app: 'dsh', scope: 'global', project: null })
  assert.equal(store.mountEntries().length, 0)
  const fresh = fakeStore()
  await fresh.putSkill('x', {
    origin: 'self', repo: null, branch: null, commit: null, path_in_repo: null,
    content_hash: null, origin_path: null, installed_at: 't', disabled: false, group: '默认',
  })
  await ensureSeedMounts(fresh)
  assert.equal(fresh.mountEntries().length, 0)
})

test('check 缓存：往返与 checkedAt 取最大', async () => {
  const store = fakeStore()
  assert.deepEqual(await loadCheckCache(store), { checkedAt: null, results: {} })
  await saveCheckCache(store, {
    checkedAt: '2026-08-20T00:00:00.000Z',
    results: {
      pdf: { checked_at: '2026-08-19T00:00:00.000Z', repo: 'a/b', branch: 'main', current: null, latest: null, status: 'up_to_date', reason: null, via: 'api', updatable: false, reachable: true, locally_modified: false, baseline_missing: false, missing: false },
      doc: { checked_at: '2026-08-20T00:00:00.000Z', repo: 'c/d', branch: 'main', current: null, latest: null, status: 'updatable', reason: null, via: 'api', updatable: true, reachable: true, locally_modified: false, baseline_missing: false, missing: false },
    },
  })
  const cache = await loadCheckCache(store)
  assert.equal(cache.checkedAt, '2026-08-20T00:00:00.000Z')
  assert.equal(Object.keys(cache.results).length, 2)
})

test('normalizeWorkspaceProjects：拒绝无效或重复的 Host 投影', () => {
  assertThrowsCode(() => normalizeWorkspaceProjects('nope'), 'workspace-unavailable')
  assertThrowsCode(() => normalizeWorkspaceProjects([{ id: '', path: '/x' }]), 'workspace-unavailable')
  assertThrowsCode(() => normalizeWorkspaceProjects([{ id: 'w', path: '/x' }, { id: 'w', path: '/y' }]), 'workspace-unavailable')
  const out = normalizeWorkspaceProjects([{ id: 'w', path: '/x', title: '' }])
  assert.equal(out[0].title, 'w')
})

test('mirrorWorkspaceProjects：活动键覆写；未匹配项保持只读遗留', () => {
  const state = {
    projects: { stale: 'E:/gone' },
    mounts: [],
    synced: {},
    proxy: null,
  }
  const snapshot = mirrorWorkspaceProjects(state, [{ id: 'w1', path: 'E:/repo', title: '仓库' }])
  assert.equal(state.projects.w1, 'E:/repo')
  assert.equal(state.projects.stale, 'E:/gone') // 未匹配保留
  assert.equal(snapshot.workspaceProjects.length, 1)
  assert.deepEqual(snapshot.legacyProjects.map((l) => l.project), ['stale'])
  assert.equal(snapshot.legacyProjects[0].status, 'workspace-unmatched')
  // title 永不写入持久项目键
  assert.ok(!('title' in state.projects))
})

test('mirrorWorkspaceProjects：旧键按路径归一到活动工作区', () => {
  const state = {
    projects: { oldKey: 'E:/repo' },
    mounts: [{ group: '默认', app: 'dsh', scope: 'project', project: 'oldKey' }],
    synced: { pdf: [{ app: 'dsh', scope: 'project', project: 'oldKey', method: 'junction', dir: 'E:/repo/.dsh/skills/pdf', at: 't' }] },
    proxy: null,
  }
  const snapshot = mirrorWorkspaceProjects(state, [{ id: 'w1', path: 'E:/repo', title: '仓库' }])
  assert.equal(state.projects.oldKey, undefined)
  assert.equal(state.projects.w1, 'E:/repo')
  assert.equal(state.mounts[0].project, 'w1')
  assert.equal(state.synced.pdf[0].project, 'w1')
  assert.equal(snapshot.legacyProjects.length, 0)
})

test('mirrorWorkspaceProjects：无法安全合并同步记录时拒绝迁移且不改写 state', () => {
  const state = {
    projects: { oldKey: 'E:/repo', w1: 'E:/repo' },
    mounts: [],
    synced: {
      pdf: [
        { app: 'dsh', scope: 'project', project: 'oldKey', method: 'junction', dir: 'E:/repo/.dsh/skills/pdf', at: 't1' },
        { app: 'dsh', scope: 'project', project: 'w1', method: 'copy', dir: 'E:/other/pdf', at: 't2' },
      ],
    },
    proxy: null,
  }
  assertThrowsCode(() => mirrorWorkspaceProjects(state, [{ id: 'w1', path: 'E:/repo', title: '仓库' }]), 'workspace-migration-conflict')
  // 未改写
  assert.equal(state.projects.oldKey, 'E:/repo')
})

test('validateMountShape：项目级挂载只能引用当前 Host 工作区', () => {
  const apps = { dsh: { ...DSH_APP } }
  const state = { projects: { w1: 'E:/repo' }, mounts: [], synced: {}, proxy: null }
  assert.doesNotThrow(() => validateMountShape(state, apps, { group: '默认', app: 'dsh', scope: 'global', project: null }))
  assertThrowsCode(() => validateMountShape(state, apps, { group: '默认', app: 'dsh', scope: 'project', project: 'gone' }), 'workspace-not-found')
  assert.throws(
    () => validateMountShape(state, apps, { group: '默认', app: 'claude', scope: 'global', project: null }),
    /只管理 dsh/,
  )
  assert.throws(
    () => validateMountShape(state, { dsh: { ...DSH_APP, enabled: false } }, { group: '默认', app: 'dsh', scope: 'global', project: null }),
    /未启用/,
  )
  assert.throws(
    () => validateMountShape(state, apps, { group: '默认', app: 'dsh', scope: 'global', project: 'w1' }),
    /global 挂载不能携带项目/,
  )
})

test('addMount/removeMount：重复与不存在', () => {
  const state = { projects: {}, mounts: [], synced: {}, proxy: null }
  const m = { group: '默认', app: 'dsh', scope: 'global', project: null }
  addMount(state, m)
  assertThrowsCode(() => addMount(state, m), 'mount-exists')
  removeMount(state, m)
  assert.equal(state.mounts.length, 0)
  assertThrowsCode(() => removeMount(state, m), 'mount-not-found')
})

test('globalRoot/projectRootOf：路径事实', () => {
  assert.match(globalRoot(), /\.dsh[/\\]skills$/)
  const state = { projects: { w1: 'E:/repo' }, mounts: [], synced: {}, proxy: null }
  assert.equal(projectRootOf(state, 'w1'), join('E:/repo', '.dsh', 'skills'))
  assert.equal(projectRootOf(state, 'gone'), undefined)
})
