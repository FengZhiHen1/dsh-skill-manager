// 工作区项目镜像：DSR-006 的纯状态迁移与挂载边界。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  mirrorWorkspaceProjects,
  normalizeWorkspaceProjects,
  validateMountShape,
} from '../lib/state.js'
import { WorkshopError } from '../lib/errors.js'

const apps = { dsh: { enabled: true, project_dir: '.dsh/skills' } }

test('mirrorWorkspaceProjects：旧手工项目按路径迁移，未匹配项保持只读遗留', () => {
  const workspacePath = join(tmpdir(), 'dsh-sm-workspace-one')
  const legacyPath = join(tmpdir(), 'dsh-sm-legacy-only')
  const state = {
    projects: { '旧项目名': workspacePath, auteur: legacyPath },
    mounts: [
      { group: '默认', app: 'dsh', scope: 'project', project: '旧项目名' },
      { group: '默认', app: 'dsh', scope: 'project', project: 'ws-1' },
    ],
    synced: {
      alpha: [
        { app: 'dsh', scope: 'project', project: '旧项目名', method: 'junction', dir: join(workspacePath, '.dsh', 'skills', 'alpha') },
        { app: 'dsh', scope: 'project', project: 'ws-1', method: 'junction', dir: join(workspacePath, '.dsh', 'skills', 'alpha') },
      ],
    },
    proxy: null,
  }

  const snapshot = mirrorWorkspaceProjects(state, [{ id: 'ws-1', title: 'Aurora', path: workspacePath }])

  assert.deepEqual(state.projects, { auteur: legacyPath, 'ws-1': workspacePath })
  assert.deepEqual(state.mounts, [{ group: '默认', app: 'dsh', scope: 'project', project: 'ws-1' }])
  assert.equal(state.synced.alpha.length, 1)
  assert.equal(state.synced.alpha[0].project, 'ws-1')
  assert.equal(snapshot.workspaceProjects[0].workspaceId, 'ws-1')
  assert.equal(snapshot.workspaceProjects[0].title, 'Aurora')
  assert.deepEqual(snapshot.legacyProjects, [{
    project: 'auteur',
    path: legacyPath,
    status: 'workspace-unmatched',
    mountCount: 0,
    syncedCount: 0,
  }])
})

test('mirrorWorkspaceProjects：无法安全合并同步记录时拒绝迁移且不改写 state', () => {
  const workspacePath = join(tmpdir(), 'dsh-sm-workspace-conflict')
  const state = {
    projects: { old: workspacePath, 'ws-1': workspacePath },
    mounts: [],
    synced: {
      alpha: [
        { app: 'dsh', scope: 'project', project: 'old', method: 'junction', dir: join(workspacePath, '.dsh', 'skills', 'alpha') },
        { app: 'dsh', scope: 'project', project: 'ws-1', method: 'copy', dir: join(workspacePath, '.dsh', 'skills', 'alpha') },
      ],
    },
  }
  const before = JSON.stringify(state)
  assert.throws(
    () => mirrorWorkspaceProjects(state, [{ id: 'ws-1', title: '冲突', path: workspacePath }]),
    (error) => error instanceof WorkshopError && error.code === 'workspace-migration-conflict',
  )
  assert.equal(JSON.stringify(state), before)
})

test('normalizeWorkspaceProjects：拒绝无效或重复的 Host 投影', () => {
  assert.throws(
    () => normalizeWorkspaceProjects([{ id: '', title: '坏项', path: resolve(tmpdir()) }]),
    (error) => error instanceof WorkshopError && error.code === 'workspace-unavailable',
  )
  assert.throws(
    () => normalizeWorkspaceProjects([
      { id: 'same', title: '一', path: join(tmpdir(), 'one') },
      { id: 'same', title: '二', path: join(tmpdir(), 'two') },
    ]),
    (error) => error instanceof WorkshopError && error.code === 'workspace-unavailable',
  )
})

test('validateMountShape：项目级挂载只能引用当前 Host 工作区', () => {
  const state = { projects: { legacy: join(tmpdir(), 'legacy'), active: join(tmpdir(), 'active') }, mounts: [], synced: {} }
  assert.throws(
    () => validateMountShape(state, apps, { group: '默认', app: 'dsh', scope: 'project', project: 'legacy' }, new Set(['active'])),
    (error) => error instanceof WorkshopError && error.code === 'workspace-not-found',
  )
  assert.doesNotThrow(() => validateMountShape(
    state,
    apps,
    { group: '默认', app: 'dsh', scope: 'project', project: 'active' },
    new Set(['active']),
  ))
})
