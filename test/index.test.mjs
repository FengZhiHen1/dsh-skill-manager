// Host 入口装配（插件运行时.md；DSR-025）：硬依赖声明、插件形态与配置行契约。

import test from 'node:test'
import assert from 'node:assert/strict'
import plugin from '../src/adapter/index.js'
import { Config } from '../src/adapter/settings.js'
import { CONFIG_NS } from '../src/core/model/intent.js'
import { readFile } from 'node:fs/promises'

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

test('Host 入口形态：对象式 default export 必须自带 Config —— loader 读的是 plugin.Config', () => {
  // vendor/cordis/src/registry.ts:326 `Config: plugin.Config`；而 loader 的 unwrapExports
  // 取 `exports.default ?? exports`，故对象式插件把 Config 挂在 default 对象上，
  // **具名 export 到不了那里**——丢了 Config 的后果是配置行静默失去 schema（无默认值、无设置页）。
  assert.ok(plugin.Config, 'default 对象必须带 Config')
  assert.equal(plugin.Config, Config)
  assert.equal(typeof plugin.Config.toJSON, 'function') // settings 面按 'toJSON' in schema 认它
})

test('配置行契约：命名空间常量 = cordis.patch.yml 里 insert 行的 id（0.1.7 命名空间即行 id）', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  // 命名空间不再是插件自选名：settings 面按 `entry.options.id` 建 ns，故两处必须逐字一致。
  // 改行 id 而不改 CONFIG_NS = 配置页与本命名空间解绑（且是运行期才暴露的静默失败）。
  const rowId = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)?.[1]
  assert.equal(rowId, CONFIG_NS, 'insert 行 id 必须与 CONFIG_NS 相同')
  assert.match(patch, /name:\s*dsh-skill-manager/, '行 name 必须是包名（Node 模块解析到 profile node_modules）')
})
