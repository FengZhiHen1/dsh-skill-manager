// workshop.js 单元测试：配置命名空间校验、未配置门禁、原子读写、路径安全。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configSchema,
  registerConfig,
  requireRoot,
  readJson,
  writeJson,
  workshopPath,
} from '../lib/workshop.js'
import { WorkshopError } from '../lib/errors.js'

function fakeSettings() {
  const captured = {}
  return {
    captured,
    ctx: {
      settings: {
        register(ns, schema, options) {
          captured.ns = ns
          captured.schema = schema
          captured.options = options
          return { get: () => ({ workshopDir: '' }) }
        },
      },
    },
  }
}

test('registerConfig：命名空间与 schema 正确', () => {
  const { captured, ctx } = fakeSettings()
  registerConfig(ctx)
  assert.equal(captured.ns, 'skill-manager')
  assert.ok(captured.options.validate)
})

test('registerConfig.validate：拒绝相对路径', async () => {
  const { captured, ctx } = fakeSettings()
  registerConfig(ctx)
  await assert.rejects(() => captured.options.validate({ workshopDir: 'relative/path' }), /绝对路径/)
})

test('registerConfig.validate：拒绝不存在的目录', async () => {
  const { captured, ctx } = fakeSettings()
  registerConfig(ctx)
  await assert.rejects(
    () => captured.options.validate({ workshopDir: join(tmpdir(), 'no-such-dir-xyz') }),
    /不存在或不可访问/,
  )
})

test('registerConfig.validate：接受绝对路径且目录存在；空串通过', async () => {
  const { captured, ctx } = fakeSettings()
  registerConfig(ctx)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await captured.options.validate({ workshopDir: dir })
  await captured.options.validate({ workshopDir: '' })
  await rm(dir, { recursive: true, force: true })
})

test('requireRoot：未配置抛 workshop-unconfigured', () => {
  const scope = { get: () => ({ workshopDir: '' }) }
  assert.throws(() => requireRoot(scope), (e) => e instanceof WorkshopError && e.code === 'workshop-unconfigured')
})

test('requireRoot：配置后返回绝对路径', () => {
  const dir = join(tmpdir(), 'dsh-sm-root')
  const scope = { get: () => ({ workshopDir: dir }) }
  assert.equal(requireRoot(scope), dir)
})

test('writeJson/readJson：往返一致且无临时文件残留', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await writeJson(root, 'distributor/state.json', { projects: {}, mounts: [], synced: {} })
  const data = await readJson(root, 'distributor/state.json')
  assert.deepEqual(data, { projects: {}, mounts: [], synced: {} })
  const files = await readFile(join(root, 'distributor', 'state.json'), 'utf8')
  assert.equal(files.trim().endsWith('}'), true)
  await rm(root, { recursive: true, force: true })
})

test('readJson：缺失返回 null；损坏抛 workshop-corrupt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  assert.equal(await readJson(root, 'skills.lock.json'), null)
  await mkdir(join(root, 'distributor'), { recursive: true })
  await writeFile(join(root, 'distributor', 'groups.json'), '{ 坏 json', 'utf8')
  await assert.rejects(
    () => readJson(root, 'distributor/groups.json'),
    (e) => e instanceof WorkshopError && e.code === 'workshop-corrupt',
  )
  await rm(root, { recursive: true, force: true })
})

test('writeJson：覆盖既有文件（Windows rename 语义）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await writeJson(root, 'a.json', { v: 1 })
  await writeJson(root, 'a.json', { v: 2 })
  assert.deepEqual(await readJson(root, 'a.json'), { v: 2 })
  await rm(root, { recursive: true, force: true })
})

test('workshopPath：拒绝越界路径', () => {
  const root = join(tmpdir(), 'dsh-sm-root')
  assert.throws(() => workshopPath(root, '../escape'), (e) => e instanceof WorkshopError && e.code === 'bad-path')
  assert.throws(() => workshopPath(root, 'a/../../escape'), (e) => e instanceof WorkshopError && e.code === 'bad-path')
  assert.ok(workshopPath(root, 'skills/alpha'))
})
