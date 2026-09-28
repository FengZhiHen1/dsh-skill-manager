// 配置命名空间与目录门禁（需求.md R-22；插件运行时.md「配置即意图」；DSR-025）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_NS, SKILLS_DIR_FIELD, PI_FIELD, DEFAULT_GROUP, configSchema, requireDir, probePiAgentDir,
  validateConfigIntent,
} from '../src/core/model/intent.js'
import { Config, readConfig, configReader } from '../src/adapter/settings.js'
import { atomicSwapDir, safePath, existsDir, writeFileAtomic } from '../src/core/base/fsys.js'
import { mkTmp, cleanup, assertRejectsCode, assertThrowsCode } from './helpers.mjs'

const isRef = (v) => typeof v === 'object' && v !== null && typeof v.get === 'function'

test('Config：命名空间、字段齐备、全量 volatile、默认种子与 hosts 回落（0.1.7 配置模型）', () => {
  assert.equal(CONFIG_NS, 'skill-manager')
  assert.equal(SKILLS_DIR_FIELD, 'skillsDir')
  // settings 面按 `'toJSON' in schema` 认这份 schema，且 loader 读的正是 plugin.Config。
  assert.equal(typeof Config.toJSON, 'function')
  // 摆放合法性：volatile 字段必须落在固定对象路径上（不允许 volatile 套 dict/union 子项），
  // 故这里必须真的**调用**一次 schema —— 摆放违规是在 resolve 期抛，不是构造期。
  const resolved = Config({})
  // 全量 volatile：settings 的 volatileForm 只保留 volatile 子树，漏标 = 该字段既不上设置页
  // 也不可写（静默功能缺失），故逐字段锁住「是引用对象而非普通值」。
  for (const key of [SKILLS_DIR_FIELD, PI_FIELD, 'intentMigrated', 'groups', 'skills']) {
    assert.ok(isRef(resolved[key]), `${key} 必须是 volatile 引用（0.1.7 只允许写 volatile 字段）`)
  }
  // readConfig 解包引用 → 纯值；默认种子 = 空挂载（默认组不自动挂 DSH 全局，必须显式勾选）
  const plain = readConfig(resolved)
  assert.equal(plain[SKILLS_DIR_FIELD], '')
  assert.equal(plain[PI_FIELD], false)
  assert.equal(plain.intentMigrated, false)
  assert.deepEqual(plain.groups[DEFAULT_GROUP], { mounts: [] })
  assert.deepEqual(plain.skills, {})
  // hosts 缺省回落 ['dsh']：显式写出的无 hosts 规则天然仅 DSH（向后兼容）
  const withGlobal = readConfig(Config({ groups: { 默认: { mounts: [{ scope: 'global', project: null }] } } }))
  assert.deepEqual(withGlobal.groups[DEFAULT_GROUP].mounts[0].hosts, ['dsh'])
  // 深嵌套意图（组内 mounts / 技能意图）也要解包到位
  const nested = readConfig(Config({ skillsDir: 'E:/x', pi: true, skills: { pdf: { disabled: true } } }))
  assert.deepEqual(nested.skills, { pdf: { disabled: true, group: DEFAULT_GROUP } })
  // 每次调用都是新 schema：命名空间常量是唯一共享标识
  assert.notEqual(configSchema, undefined)
})

test('readConfig/configReader：容忍普通值（单测与手写行 config 的形态），非对象回落空对象', () => {
  // 生产是 volatile 引用，测试与手写行 config 是普通对象——两者必须同形可读。
  assert.deepEqual(readConfig({ skillsDir: 'E:/plain', pi: true, groups: {} }), { skillsDir: 'E:/plain', pi: true, groups: {} })
  assert.deepEqual(readConfig(null), {})
  assert.deepEqual(readConfig(undefined), {})
  assert.deepEqual(readConfig('x'), {})
  assert.deepEqual(readConfig([1, 2]), {})
  assert.deepEqual(configReader({ skillsDir: 'E:/r' }).get(), { skillsDir: 'E:/r' })
})

test('validateConfigIntent：形式校验（绝对路径/组名/空 hosts/意图形状）；引用完整性放行', () => {
  const validate = validateConfigIntent
  // skillsDir
  assert.doesNotThrow(() => validate({ skillsDir: '' }))
  assert.throws(() => validate({ skillsDir: 'relative/path' }), /绝对路径/)
  assert.doesNotThrow(() => validate({ skillsDir: 'E:/Project/Skills' }))
  assert.doesNotThrow(() => validate({ skillsDir: 'E:/not/existing/yet' }))
  // hosts 空数组 = 死规则拒绝
  assert.throws(() => validate({ skillsDir: 'E:/s', groups: { 办公: { mounts: [{ scope: 'global', project: null, hosts: [] }] } } }), /宿主/)
  // 组名形式
  assert.doesNotThrow(() => validate({ skillsDir: 'E:/s', groups: { 办公: { mounts: [] } } }))
  // 「默认」键合法（schema 种子/挂载载体，docs L40/L47；P9 实测缺陷回归：曾误拒致 boot 崩）；
  // 「全部」永非法；其余命名组走全量规则（客户端建组预检另拦「默认」输入）。
  assert.doesNotThrow(() => validate({ skillsDir: 'E:/s', groups: { 默认: { mounts: [{ scope: 'global', project: null }] } } }))
  assert.throws(() => validate({ skillsDir: 'E:/s', groups: { 全部: { mounts: [] } } }), /保留字/)
  assert.throws(() => validate({ skillsDir: 'E:/s', groups: { 'a/b': { mounts: [] } } }), /不能包含/)
  // 引用完整性不在此拒绝（提交是字段级原子，跨字段中间态必须放行）
  assert.doesNotThrow(() => validate({
    skillsDir: 'E:/s',
    groups: {},
    skills: { pdf: { disabled: false, group: '不存在的组' } },
  }))
  // 意图形状
  assert.throws(() => validate({ skillsDir: 'E:/s', skills: { pdf: { group: 42 } } }), /技能意图格式错误/)
})

test('validateConfigIntent：容忍未求值的 !!js 表达式（校验挂在 internal/config 上时值是原始 config）', () => {
  // loader 的 interpolate 在本瀑布之后才求值，故挂点拿到的是表达式占位对象；
  // 对它做结构判定必然误判——旧代 validate 作用在已解析值上，故这是本次迁移引入的差异。
  const expr = (code) => ({ __jsExpr: code })
  assert.doesNotThrow(() => validateConfigIntent({ skillsDir: expr("ctx.dshHomePath('skills')") }))
  assert.doesNotThrow(() => validateConfigIntent({ skillsDir: 'E:/s', groups: expr('someExpr') }))
  assert.doesNotThrow(() => validateConfigIntent({ skillsDir: 'E:/s', skills: expr('someExpr') }))
  assert.doesNotThrow(() => validateConfigIntent({ skillsDir: 'E:/s', skills: { pdf: expr('someExpr') } }))
  // 但具体值仍照拦：表达式与合法/非法具体值混排时，非法的那条照样抛
  assert.throws(() => validateConfigIntent({ skillsDir: expr('x'), groups: { 全部: { mounts: [] } } }), /保留字/)
  assert.throws(() => validateConfigIntent({ skillsDir: expr('x'), skills: { pdf: { group: 42 } } }), /技能意图格式错误/)
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

test('writeFileAtomic：原子写入、可覆盖、无临时文件残留、拒绝相对路径', async () => {
  const root = await mkTmp()
  const file = join(root, 'sub', 'data.txt')
  try {
    await writeFileAtomic(file, 'first') // 父目录不存在也要建
    assert.equal(await readFile(file, 'utf8'), 'first')
    await writeFileAtomic(file, 'second') // 覆盖（Windows rename 语义）
    assert.equal(await readFile(file, 'utf8'), 'second')
    assert.deepEqual(await readdir(join(root, 'sub')), ['data.txt'])
    await assert.rejects(() => writeFileAtomic('relative/data.txt', 'x'), (e) => e.code === 'bad-path')
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

test('probePiAgentDir：无条件探测——PI_CODING_AGENT_DIR 优先，无 ~/.pi/agent → null', async () => {
  const home = await mkTmp()
  try {
    // 无 .pi/agent → null（未安装回落）；环境变量优先于默认路径
    assert.equal(probePiAgentDir(home, {}), null)
    await mkdir(join(home, '.pi', 'agent'), { recursive: true })
    assert.equal(probePiAgentDir(home, {}), join(home, '.pi', 'agent'))
    const envDir = join(home, 'custom-pi')
    await mkdir(envDir, { recursive: true })
    assert.equal(probePiAgentDir(home, { PI_CODING_AGENT_DIR: envDir }), envDir)
    // 环境变量指向不存在目录 → null（不直通，探测语义只对真实目录成立）
    assert.equal(probePiAgentDir(home, { PI_CODING_AGENT_DIR: join(home, 'gone') }), null)
  } finally {
    await cleanup(home)
  }
})
