// adapter 装配（插件运行时.md）：apply 的硬时序（迁移先于 openStore）、storage
// 域降级、watch 防抖对账、dispose 清理。fake ctx 直调 apply，不依赖真实 Host。

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import plugin from '../src/adapter/index.js'
import { isLink } from '../src/core/mount/materialize.js'
import { mkTmp, cleanup, writeSkill, fakeDomain } from './helpers.mjs'

/**
 * 假 Host ctx：settings/storage/connection/workspaceRegistry/dshHomePath/effect 全记录。
 * 域句柄带 close 追踪；watch 回调捕获供手动触发。
 */
function fakeCtx(home, { config, openImpl } = {}) {
  const calls = []
  const watchers = new Set()
  const disposers = []
  const domains = []
  const scope = {
    get: () => config,
    update: async (patch) => Object.assign(config, patch),
    watch: (fn) => {
      watchers.add(fn)
      return () => watchers.delete(fn)
    },
  }
  const defaultOpen = async (spec) => {
    const domain = fakeDomain()
    domain.closed = false
    const origClose = domain.close.bind(domain)
    domain.close = async () => {
      domain.closed = true
      return origClose()
    }
    domains.push(domain)
    calls.push(['open', Object.keys(spec.tables ?? {}).length])
    return domain
  }
  const ctx = {
    logger: { warn: (msg) => calls.push(['warn', String(msg)]) },
    settings: { register: () => scope },
    storage: { domain: { open: openImpl ?? defaultOpen } },
    workspaceRegistry: { list: () => [] },
    dshHomePath: (...parts) => join(home, ...parts),
    connection: { rpc: { handle: (channel, handler) => { ctx.handler = handler; calls.push(['rpc', channel]) } } },
    effect: (fn) => disposers.push(fn()),
    scope,
    watchers,
    domains,
    calls,
    /** 推进全部 disposer（模拟 fiber 销毁）。 */
    async dispose() {
      for (const d of disposers) await (typeof d === 'function' ? d() : d)
    },
  }
  return ctx
}

test('apply 装配：迁移先于 openStore；RPC 通道注册；dispose 关域撤 watch 清 timer', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))
  await writeSkill(root, 'pdf')
  const ctx = fakeCtx(home, {
    config: {
      skillsDir: root,
      intentMigrated: false,
      groups: { 默认: { mounts: [{ scope: 'global', project: null }] } },
      skills: {},
    },
  })
  plugin.apply(ctx)
  // 等 storeReady 链结算（迁移 → openStore）
  await new Promise((r) => setTimeout(r, 50))
  assert.deepEqual(ctx.calls.filter(([k]) => k === 'open'), [['open', 7], ['open', 3]]) // legacy 七表先于新 spec（skills/check_cache/managed_links）
  assert.deepEqual(ctx.calls.filter(([k]) => k === 'rpc'), [['rpc', '/skill-manager']])
  assert.equal(ctx.watchers.size, 1)

  // watch 触发后立即 dispose：防抖窗口（200ms）内销毁 → 对账不得执行（fs 证据）
  for (const fn of [...ctx.watchers]) fn()
  await ctx.dispose()
  assert.equal(ctx.domains.length, 2)
  assert.ok(ctx.domains.every((d) => d.closed === true)) // 两域都随 fiber 关闭
  assert.equal(ctx.watchers.size, 0)
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(await isLink(join(home, 'skills', 'pdf')), false) // dispose 后无对账发生
})

test('apply 降级：storage 域打开失败 → 管理 API 回 internal，插件不拖垮启动', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))
  const ctx = fakeCtx(home, {
    config: { skillsDir: root, intentMigrated: true, groups: {}, skills: {} },
    openImpl: async () => { throw new Error('already-open') },
  })
  plugin.apply(ctx)
  await new Promise((r) => setTimeout(r, 50))
  const result = await ctx.handler('overview', {})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'internal')
  assert.match(result.error.message, /already-open/)
  assert.ok(ctx.calls.some(([k, msg]) => k === 'warn' && /storage 域打开失败/.test(msg)))
  await ctx.dispose()
})

test('apply 对账器：watch 触发经 200ms 防抖后 sync 收敛（真实物化到全局根）', async (t) => {
  const home = await mkTmp('dsh-sm-home-')
  const root = await mkTmp()
  t.after(() => cleanup(home))
  t.after(() => cleanup(root))
  await writeSkill(root, 'pdf')
  const ctx = fakeCtx(home, {
    config: {
      skillsDir: root,
      intentMigrated: true,
      groups: { 默认: { mounts: [{ scope: 'global', project: null }] } },
      skills: {},
    },
  })
  plugin.apply(ctx)
  await new Promise((r) => setTimeout(r, 50)) // 等 openStore 就绪
  assert.equal(await isLink(join(home, 'skills', 'pdf')), false)
  for (const fn of [...ctx.watchers]) fn() // 模拟 settings 变更
  await new Promise((r) => setTimeout(r, 400)) // 200ms 防抖 + 对账执行
  assert.equal(await isLink(join(home, 'skills', 'pdf')), true)
  await ctx.dispose()
})
