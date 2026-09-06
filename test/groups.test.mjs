// 分组（插件运行时.md「配置即意图」）：组名形式校验（命名组创建/改名与 settings validate 共用）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { validateGroupName } from '../src/core/model/intent.js'
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
