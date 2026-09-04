// Host 入口装配（插件运行时.md）：硬依赖声明与模块形态。

import test from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../src/adapter/index.js'

test('Host 入口声明硬依赖：connection/workspaceRegistry/storage/dshHomePath/settings（P4 起不含 webServer/loader）', () => {
  assert.equal(plugin.name, 'skill-manager')
  for (const dep of ['connection', 'workspaceRegistry', 'storage', 'dshHomePath', 'settings']) {
    assert.ok(plugin.inject.includes(dep), `缺少硬依赖 ${dep}`)
  }
  // 传输迁移 connection.rpc：自注册 webServer 路由与 loader 自省（fence 取
  // trustedHosts）已随平台围栏接管而删除。
  assert.ok(!plugin.inject.includes('webServer'), 'webServer 应已随 rpc 迁移移除')
  assert.ok(!plugin.inject.includes('loader'), 'loader 应已随 fence 删除移除')
  assert.equal(typeof plugin.apply, 'function')
})
