// Host 入口装配（plugin-runtime.md）：硬依赖声明与模块形态。

import test from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../index.js'

test('Host 入口声明硬依赖：webServer/loader/connection/workspaceRegistry/storage/dshHomePath', () => {
  assert.equal(plugin.name, 'skill-manager')
  for (const dep of ['webServer', 'loader', 'connection', 'workspaceRegistry', 'storage', 'dshHomePath']) {
    assert.ok(plugin.inject.includes(dep), `缺少硬依赖 ${dep}`)
  }
  assert.equal(typeof plugin.apply, 'function')
})
