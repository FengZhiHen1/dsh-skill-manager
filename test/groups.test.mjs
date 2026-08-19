// 分组（storage-model.md groups 表与 skills.group 字段）。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateGroupName, createGroup, renameGroup, deleteGroup,
  setMembership, removeMember, loadGroups, groupSummary, DEFAULT_GROUP,
} from '../lib/groups.js'
import { fakeStore, skillRecord, assertRejectsCode, assertThrowsCode } from './helpers.mjs'

test('validateGroupName：长度、保留字与非法字符', () => {
  assert.doesNotThrow(() => validateGroupName('办公'))
  assertThrowsCode(() => validateGroupName(''), 'bad-group-name')
  assertThrowsCode(() => validateGroupName('x'.repeat(31)), 'bad-group-name')
  assertThrowsCode(() => validateGroupName('默认'), 'bad-group-name')
  assertThrowsCode(() => validateGroupName('全部'), 'bad-group-name')
  assertThrowsCode(() => validateGroupName('a/b'), 'bad-group-name')
  assertThrowsCode(() => validateGroupName('a\\b'), 'bad-group-name')
  assertThrowsCode(() => validateGroupName('a:b'), 'bad-group-name')
  assertThrowsCode(() => validateGroupName('a\0b'), 'bad-group-name')
})

test('createGroup：登记存在性；重名拒绝', async () => {
  const store = fakeStore()
  await createGroup(store, '办公')
  assert.ok(store.getGroup('办公'))
  await assertRejectsCode(createGroup(store, '办公'), 'group-exists')
})

test('renameGroup：迁移成员与挂载规则', async () => {
  const store = fakeStore()
  await createGroup(store, '旧')
  await store.putSkill('pdf', skillRecord({ group: '旧' }))
  await store.putMount({ group: '旧', app: 'dsh', scope: 'global', project: null })
  await renameGroup(store, '旧', '新')
  assert.equal(store.getGroup('旧'), undefined)
  assert.ok(store.getGroup('新'))
  assert.equal(store.getSkill('pdf').group, '新')
  assert.deepEqual(store.mountEntries().map(([, m]) => m), [{ group: '新', app: 'dsh', scope: 'global', project: null }])
  await assertRejectsCode(renameGroup(store, '无', '新'), 'group-not-found')
  await createGroup(store, '他')
  await assertRejectsCode(renameGroup(store, '新', '他'), 'group-exists')
})

test('deleteGroup：成员回落 默认，挂载规则删除', async () => {
  const store = fakeStore()
  await createGroup(store, '办公')
  await store.putSkill('a', skillRecord({ group: '办公' }))
  await store.putSkill('b', skillRecord())
  await store.putMount({ group: '办公', app: 'dsh', scope: 'global', project: null })
  await store.putMount({ group: '默认', app: 'dsh', scope: 'global', project: null })
  await deleteGroup(store, '办公')
  assert.equal(store.getSkill('a').group, '默认')
  assert.equal(store.getSkill('b').group, '默认')
  assert.deepEqual(store.mountEntries().map(([, m]) => m.group), ['默认'])
  await assertRejectsCode(deleteGroup(store, '办公'), 'group-not-found')
})

test('setMembership：单组归属；null 回落默认组', async () => {
  const store = fakeStore()
  await store.putSkill('pdf', skillRecord())
  await createGroup(store, '办公')
  await setMembership(store, 'pdf', '办公')
  assert.equal(store.getSkill('pdf').group, '办公')
  await setMembership(store, 'pdf', DEFAULT_GROUP)
  assert.equal(store.getSkill('pdf').group, '默认')
  await assertRejectsCode(setMembership(store, 'pdf', '不存在'), 'group-not-found')
  await assertRejectsCode(setMembership(store, 'ghost', '办公'), 'not-found')
})

test('removeMember：摘出命名组；无记录静默', async () => {
  const store = fakeStore()
  await store.putSkill('pdf', skillRecord({ group: '办公' }))
  await removeMember(store, 'pdf')
  assert.equal(store.getSkill('pdf').group, '默认')
  await removeMember(store, 'ghost') // 不抛
})

test('loadGroups：存在性来自 groups 表；成员来自 skills.group；失效组引用不收录', async () => {
  const store = fakeStore()
  await createGroup(store, '办公')
  await createGroup(store, '空组')
  await store.putSkill('a', skillRecord({ group: '办公' }))
  await store.putSkill('b', skillRecord({ group: '办公' }))
  await store.putSkill('c', skillRecord({ group: '已删除' })) // 失效引用不收录
  await store.putSkill('d', skillRecord()) // 默认组不入命名组
  const doc = await loadGroups(store)
  assert.deepEqual(Object.keys(doc.groups).sort(), ['办公', '空组'])
  assert.deepEqual(doc.groups['办公'].sort(), ['a', 'b'])
  assert.deepEqual(doc.groups['空组'], [])
  // existingDirs 过滤已消失成员
  const filtered = await loadGroups(store, new Set(['a']))
  assert.deepEqual(filtered.groups['办公'], ['a'])
})

test('groupSummary：组名与成员数', async () => {
  const store = fakeStore()
  await createGroup(store, '办公')
  await store.putSkill('a', skillRecord({ group: '办公' }))
  const doc = await loadGroups(store)
  assert.deepEqual(groupSummary(doc.groups), [{ name: '办公', count: 1 }])
})
