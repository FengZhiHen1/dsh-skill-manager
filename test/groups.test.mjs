// groups.js 单元测试：分组操作与校验（R-03/R-06；workshop-files.md 组名校验）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkshopError } from '../lib/errors.js'
import {
  loadGroups,
  saveGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  setMembership,
  removeMember,
  groupSummary,
  validateGroupName,
} from '../lib/groups.js'

const doc = () => ({ version: 1, groups: {} })

test('validateGroupName：长度、保留字与非法字符', () => {
  validateGroupName('工作')
  assert.throws(() => validateGroupName(''), (e) => e instanceof WorkshopError && e.code === 'bad-group-name')
  assert.throws(() => validateGroupName('x'.repeat(31)), (e) => e.code === 'bad-group-name')
  assert.throws(() => validateGroupName('默认'), (e) => e.code === 'bad-group-name')
  assert.throws(() => validateGroupName('全部'), (e) => e.code === 'bad-group-name')
  assert.throws(() => validateGroupName('a/b'), (e) => e.code === 'bad-group-name')
  assert.throws(() => validateGroupName('a:b'), (e) => e.code === 'bad-group-name')
})

test('createGroup / renameGroup / deleteGroup 语义', () => {
  const d = doc()
  createGroup(d, '写作')
  createGroup(d, '开发')
  assert.throws(() => createGroup(d, '写作'), (e) => e.code === 'group-exists')
  renameGroup(d, '写作', '创作')
  assert.equal(d.groups['创作'] !== undefined, true)
  assert.equal(d.groups['写作'] === undefined, true)
  assert.throws(() => renameGroup(d, '不存在', 'x'), (e) => e.code === 'group-not-found')
  deleteGroup(d, '创作')
  assert.equal(d.groups['创作'] === undefined, true)
})

test('setMembership：单组归属；null 回落默认组', () => {
  const d = doc()
  createGroup(d, 'A')
  createGroup(d, 'B')
  setMembership(d, 'skill-a', 'A')
  setMembership(d, 'skill-a', 'B') // 换组
  assert.deepEqual(d.groups.A, [])
  assert.deepEqual(d.groups.B, ['skill-a'])
  setMembership(d, 'skill-a', null) // 回落默认
  assert.deepEqual(d.groups.B, [])
  assert.throws(() => setMembership(d, 'skill-a', '不存在'), (e) => e.code === 'group-not-found')
})

test('removeMember：从所有组移除', () => {
  const d = doc()
  createGroup(d, 'A')
  setMembership(d, 'skill-a', 'A')
  removeMember(d, 'skill-a')
  assert.deepEqual(d.groups.A, [])
})

test('loadGroups：缺失按空骨架；读取时清理已消失成员', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'distributor'), { recursive: true })
  await saveGroups(root, { version: 1, groups: { A: ['alive', 'ghost'] } })
  const loaded = await loadGroups(root, new Set(['alive']))
  assert.deepEqual(loaded.groups, { A: ['alive'] })
  assert.deepEqual(groupSummary(loaded.groups), [{ name: 'A', count: 1 }])
  await rm(root, { recursive: true, force: true })
})
