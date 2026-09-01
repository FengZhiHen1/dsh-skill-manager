// 分组（插件运行时.md「配置即意图」）：组集合/成员来自配置的纯推导。

import test from 'node:test'
import assert from 'node:assert/strict'
import { makeGroups, groupSummary } from '../lib/groups.js'
import { validateGroupName, DEFAULT_GROUP } from '../lib/dir.js'
import { assertThrowsCode } from './helpers.mjs'

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

test('makeGroups：组存在性来自配置 groups 键；成员来自 skills.group；失效引用不收录', () => {
  const configGroups = { 办公: { mounts: [] }, 空组: { mounts: [] } }
  const configSkills = {
    a: { disabled: false, group: '办公' },
    b: { disabled: false, group: '办公' },
    c: { disabled: false, group: '已删除' }, // 失效引用不收录
    d: { disabled: false, group: DEFAULT_GROUP }, // 默认组不入命名组
  }
  const doc = makeGroups(configGroups, configSkills)
  assert.deepEqual(Object.keys(doc.groups).sort(), ['办公', '空组'])
  assert.deepEqual(doc.groups['办公'].sort(), ['a', 'b'])
  assert.deepEqual(doc.groups['空组'], [])
  // existingDirs 过滤已消失成员
  const filtered = makeGroups(configGroups, configSkills, new Set(['a']))
  assert.deepEqual(filtered.groups['办公'], ['a'])
})

test('groupSummary：组名与成员数', () => {
  const doc = makeGroups({ 办公: { mounts: [] } }, { a: { disabled: false, group: '办公' } })
  assert.deepEqual(groupSummary(doc.groups), [{ name: '办公', count: 1 }])
})
