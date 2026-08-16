// api.js 单元测试：未配置门禁、信封映射、单飞队列、方法分发。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApi, createQueue, writeError, readJsonBody, ApiError } from '../lib/api.js'
import { WorkshopError } from '../lib/errors.js'

function scopeOf(workshopDir) {
  return { get: () => ({ workshopDir }) }
}

function captureResponse() {
  const res = {
    status: 0,
    body: null,
    writeHead(status) { this.status = status },
    end(body) { this.body = body },
  }
  return res
}

test('未配置门禁：所有方法统一 workshop-unconfigured', async () => {
  const api = buildApi(() => scopeOf(''))
  for (const method of ['library', 'groups', 'sync', 'health', 'search', 'backups']) {
    await assert.rejects(
      () => api[method]({}),
      (e) => e instanceof WorkshopError && e.code === 'workshop-unconfigured',
      `方法 ${method} 应被门禁`,
    )
  }
})

test('已配置：library 与 groups 返回车间数据', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: 测试\n---\n', 'utf8')
  const api = buildApi(() => scopeOf(root))
  const lib = await api['library']({})
  assert.equal(lib.skills.length, 1)
  assert.equal(lib.skills[0].name, 'alpha')
  assert.equal(lib.skills[0].group, '默认')
  const grp = await api['groups']()
  assert.deepEqual(grp.groups, [])
  await rm(root, { recursive: true, force: true })
})

test('writeError：WorkshopError → 信封；未知错误 → internal 500', () => {
  const res1 = captureResponse()
  writeError(res1, new WorkshopError('workshop-corrupt', '损坏'))
  const env1 = JSON.parse(res1.body)
  assert.equal(env1.ok, false)
  assert.equal(env1.error.code, 'workshop-corrupt')
  assert.equal(res1.status, 200)

  const res2 = captureResponse()
  writeError(res2, new Error('boom'))
  const env2 = JSON.parse(res2.body)
  assert.equal(env2.error.code, 'internal')
  assert.equal(res2.status, 500)
})

test('createQueue：FIFO 串行且前序失败不阻塞后续', async () => {
  const queue = createQueue()
  const order = []
  const r1 = queue.enqueue(async () => { order.push(1); await new Promise((r) => setTimeout(r, 20)); return 'a' })
  const r2 = queue.enqueue(async () => { order.push(2); throw new Error('fail') })
  const r3 = queue.enqueue(async () => { order.push(3); return 'c' })
  assert.equal(await r1, 'a')
  await assert.rejects(() => r2, /fail/)
  assert.equal(await r3, 'c')
  assert.deepEqual(order, [1, 2, 3])
})

test('readJsonBody：边界与非法 JSON', async () => {
  const req = { [Symbol.asyncIterator]: async function* () { yield Buffer.from('{"a":1}') } }
  assert.deepEqual(await readJsonBody(req), { a: 1 })
  const bad = { [Symbol.asyncIterator]: async function* () { yield Buffer.from('{bad') } }
  await assert.rejects(() => readJsonBody(bad), (e) => e instanceof ApiError && e.code === 'bad-request')
  const empty = { [Symbol.asyncIterator]: async function* () {} }
  assert.deepEqual(await readJsonBody(empty), {})
})
