// 挂载状态投影、工作区镜像（挂载与同步.md；目录配置与状态存储.md）。
// 挂载规则不再入 storage（意图在配置），mounts 仅以参数参与统计。

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  loadState, saveState, loadCheckCache, saveCheckCache,
  normalizeWorkspaceProjects, mirrorWorkspaceProjects, globalRoot, projectRootOf,
} from '../lib/state.js'
import { fakeStore, assertThrowsCode } from './helpers.mjs'

test('loadState/saveState：投影往返（projects/synced）', async () => {
  const store = fakeStore()
  const state = {
    projects: { w1: 'E:/repo' },
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
  assert.equal(back.synced.pdf.length, 2)
  const projectRec = back.synced.pdf.find((r) => r.scope === 'project')
  assert.equal(projectRec.project, 'w1')
  assert.equal(projectRec.method, 'copy')
  // global 记录往返后仍归一为 project:null——syncedKey 的 'global' 哨兵 ↔
  // parseSyncedKey 归一的桥接必须闭合。
  const globalRec = back.synced.pdf.find((r) => r.scope === 'global')
  assert.equal(globalRec.project, null)
  assert.equal(globalRec.method, 'junction')
})

test('parseSyncedKey 桥接：project 作用域工作区 id 恰为 global 时不被误还原', async () => {
  const store = fakeStore()
  const state = {
    projects: { global: 'E:/proj' },
    synced: {
      pdf: [
        { app: 'dsh', scope: 'project', project: 'global', method: 'junction', dir: 'E:/proj/.dsh/skills/pdf', at: 't1' },
      ],
    },
    proxy: null,
  }
  await saveState(store, state)
  const back = await loadState(store)
  assert.equal(back.synced.pdf.length, 1)
  const rec = back.synced.pdf[0]
  assert.equal(rec.scope, 'project')
  assert.equal(rec.project, 'global') // 真实工作区 id，不被当作 global 哨兵
  assert.equal(rec.method, 'junction')
})

test('loadState：空域按空骨架', async () => {
  const state = await loadState(fakeStore())
  assert.deepEqual(state, { projects: {}, synced: {} })
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

test('mirrorWorkspaceProjects：活动键覆写；未匹配项保持只读遗留；挂载统计来自配置展平', () => {
  const state = {
    projects: { stale: 'E:/gone' },
    synced: {},
    proxy: null,
  }
  const configMounts = [
    { group: '默认', app: 'dsh', scope: 'project', project: 'w1' },
    { group: '办公', app: 'dsh', scope: 'project', project: 'w1' },
  ]
  const snapshot = mirrorWorkspaceProjects(state, [{ id: 'w1', path: 'E:/repo', title: '仓库' }], configMounts)
  assert.equal(state.projects.w1, 'E:/repo')
  assert.equal(state.projects.stale, 'E:/gone') // 未匹配保留
  assert.equal(snapshot.workspaceProjects.length, 1)
  assert.equal(snapshot.workspaceProjects[0].mountCount, 2) // 两个组挂到 w1
  assert.deepEqual(snapshot.legacyProjects.map((l) => l.project), ['stale'])
  assert.equal(snapshot.legacyProjects[0].status, 'workspace-unmatched')
  // title 永不写入持久项目键
  assert.ok(!('title' in state.projects))
})

test('mirrorWorkspaceProjects：旧键按路径归一到活动工作区', () => {
  const state = {
    projects: { oldKey: 'E:/repo' },
    synced: { pdf: [{ app: 'dsh', scope: 'project', project: 'oldKey', method: 'junction', dir: 'E:/repo/.dsh/skills/pdf', at: 't' }] },
    proxy: null,
  }
  const snapshot = mirrorWorkspaceProjects(state, [{ id: 'w1', path: 'E:/repo', title: '仓库' }])
  assert.equal(state.projects.oldKey, undefined)
  assert.equal(state.projects.w1, 'E:/repo')
  assert.equal(state.synced.pdf[0].project, 'w1')
  assert.equal(snapshot.legacyProjects.length, 0)
})

test('mirrorWorkspaceProjects：无法安全合并同步记录时拒绝迁移且不改写 state', () => {
  const state = {
    projects: { oldKey: 'E:/repo', w1: 'E:/repo' },
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

test('globalRoot/projectRootOf：路径事实', () => {
  assert.match(globalRoot(), /\.dsh[/\\]skills$/)
  // 注入 DSH home 时以其为准（与 dsh-skill-filesystem 的 resolveDshHome 对齐）
  assert.equal(globalRoot('D:/dsh-home'), join('D:/dsh-home', 'skills'))
  assert.equal(globalRoot(''), join(homedir(), '.dsh', 'skills'))
  const state = { projects: { w1: 'E:/repo' }, synced: {}, proxy: null }
  assert.equal(projectRootOf(state, 'w1'), join('E:/repo', '.dsh', 'skills'))
  assert.equal(projectRootOf(state, 'gone'), undefined)
})
