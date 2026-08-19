// 配置命名空间与目录门禁（requirements.md R-22；plugin-runtime.md）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CONFIG_NS, SKILLS_DIR_FIELD, configSchema, registerConfig, requireDir,
  safePath, existsDir, writeJson,
} from '../lib/dir.js'
import { mkTmp, cleanup, assertThrowsCode } from './helpers.mjs'

test('registerConfig：命名空间与 schema 正确', () => {
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
})

test('registerConfig.validate：拒绝相对路径；接受任意绝对路径（存在性移运行期）', () => {
  let captured = null
  const fakeCtx = { settings: { register(ns, s, options) { captured = options } } }
  registerConfig(fakeCtx)
  const validate = captured.validate
  assert.doesNotThrow(() => validate({ skillsDir: '' }))
  assert.throws(() => validate({ skillsDir: 'relative/path' }), /绝对路径/)
  assert.doesNotThrow(() => validate({ skillsDir: 'E:/Project/Skills' }))
  assert.doesNotThrow(() => validate({ skillsDir: 'E:/not/existing/yet' }))
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
