// 配置命名空间与目录门禁（需求.md R-22；插件运行时.md「配置即意图」）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_NS, SKILLS_DIR_FIELD, PI_AGENT_DIR_FIELD, DEFAULT_GROUP, configSchema, requireDir, resolvePiAgentDir,
} from '../src/core/model/intent.js'
import { registerConfig } from '../src/adapter/settings.js'
import { atomicSwapDir, safePath, existsDir, writeJson } from '../src/core/base/fsys.js'
import { mkTmp, cleanup, assertRejectsCode, assertThrowsCode } from './helpers.mjs'

test('registerConfig：命名空间与 schema 正确（意图字段齐备）', () => {
  assert.equal(CONFIG_NS, 'skill-manager')
  assert.equal(SKILLS_DIR_FIELD, 'skillsDir')
  const schema = configSchema()
  assert.ok(schema)
  let captured = null
  const fakeCtx = {
    settings: {
      register(ns, s, options) {
        captured = { ns, schema: s, options }
        return { get: () => ({}) }
      },
    },
  }
  registerConfig(fakeCtx)
  assert.ok(captured)
  assert.equal(typeof captured.options.validate, 'function')
  // 默认种子：默认组挂载全局（原 ensureSeedMounts 语义，配置化）
  const resolved = schema({})
  assert.equal(resolved[SKILLS_DIR_FIELD], '')
  assert.equal(resolved[PI_AGENT_DIR_FIELD], '')
  assert.equal(resolved.groups[DEFAULT_GROUP].mounts.length, 1)
  assert.equal(resolved.groups[DEFAULT_GROUP].mounts[0].scope, 'global')
  // hosts 缺省回落 ['dsh']：存量无 hosts 键的规则天然仅 DSH（向后兼容）
  assert.deepEqual(resolved.groups[DEFAULT_GROUP].mounts[0].hosts, ['dsh'])
  assert.deepEqual(resolved.skills, {})
  assert.equal(resolved.intentMigrated, false)
})

test('registerConfig.validate：形式校验（绝对路径/组名/意图形状）；引用完整性放行', () => {
  let captured = null
  const fakeCtx = { settings: { register(ns, s, options) { captured = options } } }
  registerConfig(fakeCtx)
  const validate = captured.validate
  // skillsDir
  assert.doesNotThrow(() => validate({ skillsDir: '' }))
  assert.throws(() => validate({ skillsDir: 'relative/path' }), /绝对路径/)
  assert.doesNotThrow(() => validate({ skillsDir: 'E:/Project/Skills' }))
  assert.doesNotThrow(() => validate({ skillsDir: 'E:/not/existing/yet' }))
  // piAgentDir：空串放行（自动探测）；相对路径拒绝；hosts 空数组 = 死规则拒绝
  assert.throws(() => validate({ piAgentDir: 'relative/pi' }), /绝对路径/)
  assert.doesNotThrow(() => validate({ piAgentDir: '' }))
  assert.doesNotThrow(() => validate({ piAgentDir: 'E:/pi/agent' }))
  assert.throws(() => validate({ skillsDir: 'E:/s', groups: { 办公: { mounts: [{ scope: 'global', project: null, hosts: [] }] } } }), /宿主/)
  // 组名形式
  assert.doesNotThrow(() => validate({ skillsDir: 'E:/s', groups: { 办公: { mounts: [] } } }))
  // 「默认」键合法（schema 种子/挂载载体，docs L40/L47；P9 实测缺陷回归：曾误拒致 boot 崩）；
  // 「全部」永非法；其余命名组走全量规则（客户端建组预检另拦「默认」输入）。
  assert.doesNotThrow(() => validate({ skillsDir: 'E:/s', groups: { 默认: { mounts: [{ scope: 'global', project: null }] } } }))
  assert.throws(() => validate({ skillsDir: 'E:/s', groups: { 全部: { mounts: [] } } }), /保留字/)
  assert.throws(() => validate({ skillsDir: 'E:/s', groups: { 'a/b': { mounts: [] } } }), /不能包含/)
  // 引用完整性不在此拒绝（settings 写是字段级原子，跨字段中间态必须放行）
  assert.doesNotThrow(() => validate({
    skillsDir: 'E:/s',
    groups: {},
    skills: { pdf: { disabled: false, group: '不存在的组' } },
  }))
  // 意图形状
  assert.throws(() => validate({ skillsDir: 'E:/s', skills: { pdf: { group: 42 } } }), /技能意图格式错误/)
})

test('requireDir：未配置抛 skilldir-unconfigured', () => {
  assertThrowsCode(() => requireDir({ get: () => ({ skillsDir: '' }) }), 'skilldir-unconfigured')
  assertThrowsCode(() => requireDir({ get: () => ({}) }), 'skilldir-unconfigured')
})

test('requireDir：配置但目录缺失抛 skilldir-missing；创建后返回绝对路径', async () => {
  const tmp = await mkTmp()
  try {
    const missing = join(tmp, 'not-yet')
    assertThrowsCode(() => requireDir({ get: () => ({ skillsDir: missing }) }), 'skilldir-missing')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(missing)
    assert.equal(requireDir({ get: () => ({ skillsDir: missing }) }), missing)
  } finally {
    await cleanup(tmp)
  }
})

test('safePath：拒绝越界路径与根自身', async () => {
  const root = await mkTmp()
  try {
    assert.equal(safePath(root, 'a/b'), join(root, 'a', 'b'))
    assertThrowsCode(() => safePath(root, '..'), 'bad-path')
    assertThrowsCode(() => safePath(root, '../escape'), 'bad-path')
    assertThrowsCode(() => safePath(root, ''), 'bad-path')
  } finally {
    await cleanup(root)
  }
})

test('writeJson：原子写入且无临时文件残留', async () => {
  const root = await mkTmp()
  try {
    await writeJson(root, 'sub/data.json', { a: 1 })
    assert.deepEqual(JSON.parse(await readFile(join(root, 'sub', 'data.json'), 'utf8')), { a: 1 })
    await writeJson(root, 'sub/data.json', { a: 2 }) // 覆盖（Windows rename 语义）
    assert.deepEqual(JSON.parse(await readFile(join(root, 'sub', 'data.json'), 'utf8')), { a: 2 })
    assert.deepEqual(await readdir(join(root, 'sub')), ['data.json'])
  } finally {
    await cleanup(root)
  }
})

test('existsDir：目录判定', async () => {
  const root = await mkTmp()
  try {
    assert.equal(await existsDir(root), true)
    assert.equal(await existsDir(join(root, 'nope')), false)
  } finally {
    await cleanup(root)
  }
})

// 以下三例锁 atomicSwapDir 的失败面：任何失败都不许让旧版消失。

test('atomicSwapDir：构建阶段失败时目标原状不动，无临时目录残留', async () => {
  const root = await mkTmp()
  try {
    const dest = join(root, 'skill')
    await mkdir(dest, { recursive: true })
    await writeFile(join(dest, 'f.txt'), '旧版')
    await assertRejectsCode(
      atomicSwapDir(dest, async () => {
        throw new Error('构建失败')
      }),
      'write-failed',
    )
    assert.equal(await readFile(join(dest, 'f.txt'), 'utf8'), '旧版')
    assert.deepEqual(await readdir(root), ['skill'])
  } finally {
    await cleanup(root)
  }
})

test('atomicSwapDir：顶上失败则回滚，目标保持完整旧版', async () => {
  const root = await mkTmp()
  try {
    const dest = join(root, 'skill')
    await mkdir(dest, { recursive: true })
    await writeFile(join(dest, 'f.txt'), '旧版')
    await assertRejectsCode(
      atomicSwapDir(dest, async (stage) => {
        await writeFile(join(stage, 'f.txt'), '新版')
        await rm(stage, { recursive: true, force: true })
      }),
      'write-failed',
    )
    assert.equal(await readFile(join(dest, 'f.txt'), 'utf8'), '旧版')
    assert.deepEqual(await readdir(root), ['skill'])
  } finally {
    await cleanup(root)
  }
})

test('atomicSwapDir：换装成功则新版就位，移开的旧目录被清掉', async () => {
  const root = await mkTmp()
  try {
    const dest = join(root, 'skill')
    await mkdir(dest, { recursive: true })
    await writeFile(join(dest, 'f.txt'), '旧版')
    await writeFile(join(dest, 'stale.txt'), '旧版独有文件')
    await atomicSwapDir(dest, async (stage) => {
      await writeFile(join(stage, 'f.txt'), '新版')
    })
    assert.equal(await readFile(join(dest, 'f.txt'), 'utf8'), '新版')
    assert.equal(await existsDir(join(dest, 'stale.txt')), false)
    assert.deepEqual(await readdir(root), ['skill'])
  } finally {
    await cleanup(root)
  }
})

test('resolvePiAgentDir：显式配置直通；空串按注入 home 探测，无 ~/.pi/agent → null', async () => {
  // 显式配置：不存在也直通（物化按需创建，探测只服务自动路径）
  assert.equal(resolvePiAgentDir('E:/pi/agent'), join('E:/pi/agent'))
  const home = await mkTmp()
  try {
    // 自动探测：无 .pi/agent → null（pi 不可用三态之一）
    assert.equal(resolvePiAgentDir('', home), null)
    await mkdir(join(home, '.pi', 'agent'), { recursive: true })
    assert.equal(resolvePiAgentDir('', home), join(home, '.pi', 'agent'))
  } finally {
    await cleanup(home)
  }
})
