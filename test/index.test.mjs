// Host 入口装配（plugin-runtime.md）：硬依赖声明与模块形态。

import test from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../index.js'

test('Host 入口声明硬依赖：webServer/loader/workspaceRegistry/storage/dshHomePath（不含 connection）', () => {
  assert.equal(plugin.name, 'skill-manager')
  for (const dep of ['webServer', 'loader', 'workspaceRegistry', 'storage', 'dshHomePath']) {
    assert.ok(plugin.inject.includes(dep), `缺少硬依赖 ${dep}`)
  }
  // rc.7 迁移后配置走 settings 域，不再需要 connection 自定义 RPC 通道。
  assert.ok(!plugin.inject.includes('connection'), 'connection 应已从 Host 注入移除')
  assert.equal(typeof plugin.apply, 'function')
})
