// Host 入口装配（插件运行时.md）：硬依赖声明与模块形态。

import test from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../index.js'

test('Host 入口声明硬依赖：webServer/loader/workspaceRegistry/storage/dshHomePath/settings（不含 connection）', () => {
  assert.equal(plugin.name, 'skill-manager')
  for (const dep of ['webServer', 'loader', 'workspaceRegistry', 'storage', 'dshHomePath', 'settings']) {
    assert.ok(plugin.inject.includes(dep), `缺少硬依赖 ${dep}`)
  }
  // 配置即意图：settings 为硬依赖（apply 同步阶段即注册命名空间与对账器）。
  assert.ok(!plugin.inject.includes('connection'), 'connection 应已从 Host 注入移除')
  assert.equal(typeof plugin.apply, 'function')
})
