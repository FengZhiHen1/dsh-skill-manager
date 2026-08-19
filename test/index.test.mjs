// Host 入口：DSR-006 依赖必须由 Cordis 在加载前保证可用。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../index.js'

test('Host 入口声明 workspaceRegistry 为硬依赖', () => {
  assert.ok(plugin.inject.includes('workspaceRegistry'))
})
