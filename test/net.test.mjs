// 网络通道（base/net.js）失败语义：GhError 分类（入站操作.md 网络分类表）、
// 仓库 slug 规范化、skills.sh 结果过滤。全部 stub globalThis.fetch，不出网。

import test from 'node:test'
import assert from 'node:assert/strict'
import { GhError, ghApi, ghDownload, normalizeRepoSlug, searchSkillsSh } from '../src/core/base/net.js'
import { toRpcFailure } from '../src/core/service.js'

function stubFetch(impl) {
  const original = globalThis.fetch
  globalThis.fetch = impl
  return () => {
    globalThis.fetch = original
  }
}

function jsonRes(body, { ok = true, status = 200, headers = {} } = {}) {
  return async () => ({
    ok,
    status,
    headers: { get: (k) => headers[k] ?? null },
    json: async () => body,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  })
}

test('ghApi：状态分类 not_found / rate_limited / http_error / unreachable', async () => {
  const cases = [
    [jsonRes(null, { ok: false, status: 404 }), 'not_found'],
    [jsonRes(null, { ok: false, status: 403, headers: { 'X-RateLimit-Remaining': '0' } }), 'rate_limited'],
    [jsonRes(null, { ok: false, status: 500 }), 'http_error'],
  ]
  for (const [impl, kind] of cases) {
    const restore = stubFetch(impl)
    await assert.rejects(ghApi('/repos/x/y'), (error) => error instanceof GhError && error.kind === kind)
    restore()
  }
  const restore = stubFetch(async () => {
    throw new TypeError('fetch failed')
  })
  await assert.rejects(ghApi('/repos/x/y'), (error) => error instanceof GhError && error.kind === 'unreachable')
  restore()
})

test('ghApi 成功体透传；ghDownload 返回二进制缓冲', async () => {
  const restore = stubFetch(jsonRes({ commit: { sha: 'abc' } }))
  assert.deepEqual(await ghApi('/repos/x/y/branches/main'), { commit: { sha: 'abc' } })
  restore()
  const restore2 = stubFetch(jsonRes(null))
  assert.deepEqual([...(await ghDownload('https://github.com/x/y/archive/main.zip'))], [1, 2, 3])
  restore2()
})

test('GhError → dispatch 错误码直通且 rate_limited/unreachable 可重试', async () => {
  const rl = toRpcFailure(new GhError('rate_limited', '限流'), 'check')
  assert.equal(rl.error.code, 'rate_limited')
  assert.equal(rl.error.details.retryable, true)
  assert.equal(rl.error.details.repair.operation, 'check')
  assert.equal(toRpcFailure(new GhError('not_found', '无'), 'add').error.details.retryable, false)
  assert.equal(toRpcFailure(new GhError('http_error', '5xx'), 'search').error.details.retryable, false)
})

test('normalizeRepoSlug：形态归一与非法拒绝', () => {
  assert.equal(normalizeRepoSlug('anthropics/skills'), 'anthropics/skills')
  assert.equal(normalizeRepoSlug('  https://github.com/a/b.git  '), 'a/b') // .git 尾缀先于去尾斜杠
  for (const bad of ['single', 'a/b/c', 'a.git/x', 'https://gitlab.com/a/b', 'owner/']) {
    assert.throws(() => normalizeRepoSlug(bad), /无效的仓库标识/, `应拒绝 ${bad}`)
  }
})

test('searchSkillsSh：结果映射与非 GitHub 来源过滤、失败语义', async () => {
  const restore = stubFetch(
    jsonRes({
      query: 'pdf',
      count: 3,
      skills: [
        { id: 1, name: 'Pdf', source: 'anthropics/skills', skillId: 'pdf', installs: 99 },
        { id: 2, name: 'Local', source: 'registry.example/pkg', skillId: 'x', installs: 5 }, // 含点：非 GitHub
        { id: 3, name: 'Odd', source: 'only-one-segment', skillId: 'y', installs: 1 }, // 单段：过滤
      ],
    }),
  )
  const out = await searchSkillsSh('pdf')
  assert.equal(out.skills.length, 1)
  assert.deepEqual(out.skills[0], {
    key: 1,
    name: 'Pdf',
    directory: 'pdf',
    repo: 'anthropics/skills',
    installs: 99,
    url: 'https://github.com/anthropics/skills',
  })
  restore()
  const restore2 = stubFetch(jsonRes(null, { ok: false, status: 503 }))
  await assert.rejects(searchSkillsSh('pdf'), /skills\.sh 搜索失败: HTTP 503/)
  restore2()
  const restore3 = stubFetch(async () => {
    throw new Error('socket hang up')
  })
  await assert.rejects(searchSkillsSh('pdf'), /skills\.sh 搜索失败: socket hang up/)
  restore3()
})
