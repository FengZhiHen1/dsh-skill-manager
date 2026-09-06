// 网络通道（base/net.js）失败语义：GhError 分类（入站操作.md 网络分类表）、
// 仓库 slug 规范化、skills.sh 结果过滤、remoteHead 回退链与 resolveRemote 分支回退、
// 超时归类（=可重试 unreachable，why 见 net.js classifyFetchError 注释）。
// 全部 stub globalThis.fetch + 注入 lsRemote，不出网不起子进程。

import test from 'node:test'
import assert from 'node:assert/strict'
import { GhError, ghApi, ghDownload, normalizeRepoSlug, remoteHead, resolveRemote, searchSkillsSh, classifyFetchError } from '../src/core/base/net.js'
import { toRpcFailure } from '../src/core/service.js'

/** stub 全局 fetch，经 t.after 恢复（断言失败也不污染进程）。 */
function stubFetch(t, impl) {
  const original = globalThis.fetch
  globalThis.fetch = impl
  t.after(() => {
    globalThis.fetch = original
  })
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

const noLsRemote = { lsRemote: async () => null }

test('ghApi：状态分类 repo-not-found / rate-limited / repo-http-error / unreachable', async (t) => {
  const cases = [
    [jsonRes(null, { ok: false, status: 404 }), 'repo-not-found'],
    [jsonRes(null, { ok: false, status: 403, headers: { 'X-RateLimit-Remaining': '0' } }), 'rate-limited'],
    [jsonRes(null, { ok: false, status: 500 }), 'repo-http-error'],
  ]
  for (const [impl, kind] of cases) {
    stubFetch(t, impl)
    await assert.rejects(ghApi('/repos/x/y'), (error) => error instanceof GhError && error.kind === kind)
  }
  stubFetch(t, async () => {
    throw new TypeError('fetch failed')
  })
  await assert.rejects(ghApi('/repos/x/y'), (error) => error instanceof GhError && error.kind === 'unreachable')
})

test('classifyFetchError：TLS 证书类失败点破加速工具归因与对策，其余泛化 unreachable', async (t) => {
  const cert = classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } }))
  assert.ok(cert instanceof GhError && cert.kind === 'unreachable')
  assert.match(cert.message, /TLS 证书校验失败/)
  assert.match(cert.message, /NODE_EXTRA_CA_CERTS/)
  const plain = classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
  assert.equal(plain.message, '网络不可达: fetch failed')
  assert.equal(classifyFetchError(new Error('x')).kind, 'unreachable') // 无 cause 也兜底
  // 端到端：ghFetch 的 catch 走本函数 → 证书失败信息可穿透到 ghApi 拒绝面
  stubFetch(t, async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } })
  })
  await assert.rejects(ghApi('/repos/x/y'), /NODE_EXTRA_CA_CERTS/)
})

test('超时归类：AbortError/TimeoutError 归 unreachable 且可重试（幂等 GET 的安全策略）', async (t) => {
  // AbortSignal.timeout 触发时 fetch 拒绝为 TimeoutError 类 abort——本通道全是幂等 GET，
  // 显式按「可重试失败」归类（不是「未知」）；该语义由此测试钉住。
  stubFetch(t, async () => {
    throw Object.assign(new TypeError('fetch failed'), { name: 'TimeoutError' })
  })
  await assert.rejects(ghApi('/repos/x/y'), (error) => error instanceof GhError && error.kind === 'unreachable')
  const failure = toRpcFailure(new GhError('unreachable', '超时'), 'check')
  assert.equal(failure.error.details.retryable, true)
})

test('ghApi 成功体透传；ghDownload 返回二进制缓冲', async (t) => {
  stubFetch(t, jsonRes({ commit: { sha: 'abc' } }))
  assert.deepEqual(await ghApi('/repos/x/y/branches/main'), { commit: { sha: 'abc' } })
  stubFetch(t, jsonRes(null))
  assert.deepEqual([...await ghDownload('https://github.com/x/y/archive/main.zip')], [1, 2, 3])
})

test('GhError → dispatch 错误码直通且 rate-limited/unreachable 可重试', () => {
  const rl = toRpcFailure(new GhError('rate-limited', '限流'), 'check')
  assert.equal(rl.error.code, 'rate-limited')
  assert.equal(rl.error.details.retryable, true)
  assert.equal(rl.error.details.repair.operation, 'check')
  assert.equal(toRpcFailure(new GhError('repo-not-found', '无'), 'add').error.details.retryable, false)
  assert.equal(toRpcFailure(new GhError('repo-http-error', '5xx'), 'search').error.details.retryable, false)
})

test('normalizeRepoSlug：形态归一、合法点号仓库名放行、非法拒绝', () => {
  assert.equal(normalizeRepoSlug('anthropics/skills'), 'anthropics/skills')
  assert.equal(normalizeRepoSlug('  https://github.com/a/b.git  '), 'a/b') // .git 尾缀先于去尾斜杠
  assert.equal(normalizeRepoSlug('foo/bar.js'), 'foo/bar.js') // 仓库名合法含点
  for (const bad of ['single', 'a/b/c', 'a.git/x', 'https://gitlab.com/a/b', 'owner/', '../x', 'a/..', 'a/.']) {
    assert.throws(() => normalizeRepoSlug(bad), /无效的仓库标识/, `应拒绝 ${bad}`)
  }
})

test('remoteHead：API 主路径命中；缺 sha 或失败回退 ls-remote；双失败按 kind 归类', async (t) => {
  // API 命中
  stubFetch(t, jsonRes({ commit: { sha: 'a'.repeat(40) } }))
  const ok = await remoteHead('x/y', 'main', noLsRemote)
  assert.deepEqual(ok, { sha: 'a'.repeat(40), status: 'ok', via: 'api', reason: '' })

  // API 缺 commit.sha → 回退 ls-remote 命中
  stubFetch(t, jsonRes({}))
  const viaGit = await remoteHead('x/y', 'main', { lsRemote: async () => 'b'.repeat(40) })
  assert.deepEqual(viaGit, { sha: 'b'.repeat(40), status: 'ok', via: 'ls-remote', reason: '' })

  // API 404 + 回退失败 → repo-not-found
  stubFetch(t, jsonRes(null, { ok: false, status: 404 }))
  const nf = await remoteHead('x/y', 'main', noLsRemote)
  assert.equal(nf.status, 'repo-not-found')
  assert.equal(nf.sha, null)

  // API 限流 + 回退失败 → rate-limited
  stubFetch(t, jsonRes(null, { ok: false, status: 403, headers: { 'X-RateLimit-Remaining': '0' } }))
  const rl = await remoteHead('x/y', 'main', noLsRemote)
  assert.equal(rl.status, 'rate-limited')

  // API 不可达 + 回退失败 → unreachable（原因含双通道现场）
  stubFetch(t, async () => {
    throw new TypeError('fetch failed')
  })
  const un = await remoteHead('x/y', 'main', noLsRemote)
  assert.equal(un.status, 'unreachable')
  assert.match(un.reason, /git 回退亦不可达/)
})

test('resolveRemote：branch → main → master 回退与全灭 remote-unreachable', async (t) => {
  // feature 404、main 命中 → 落到 main
  stubFetch(t, async (url) => {
    if (url.includes('/branches/feature')) return jsonRes(null, { ok: false, status: 404 })()
    return jsonRes({ commit: { sha: 'c'.repeat(40) } })()
  })
  const hit = await resolveRemote('x/y', 'feature', { lsRemote: async () => null })
  assert.deepEqual(hit, { commit: 'c'.repeat(40), branch: 'main', via: 'api' })

  // 三个候选全灭 → remote-unreachable（可重试，facts 带仓库名）
  stubFetch(t, jsonRes(null, { ok: false, status: 404 }))
  await assert.rejects(
    resolveRemote('x/y', 'dev', { lsRemote: async () => null }),
    (error) => error.code === 'remote-unreachable' && error.retryable === true,
  )
})

test('searchSkillsSh：结果映射归一、非 GitHub 来源过滤、失败语义', async (t) => {
  stubFetch(t, jsonRes({
    query: 'pdf',
    count: 3,
    skills: [
      { id: 's-1', name: 'Pdf', source: 'anthropics/skills', skillId: 'pdf', installs: 99 },
      { id: 's-2', name: 'Local', source: 'registry.example/pkg', skillId: 'x', installs: 5 }, // 首段含点：域名形态过滤
      { id: 's-3', name: 'Odd', source: 'only-one-segment', skillId: 'y', installs: 1 }, // 单段：过滤
      { name: 'NoId', source: 'foo/bar.js', installs: 'NaN' }, // 缺 id/脏 installs：归一兜底
    ],
  }))
  const out = await searchSkillsSh('pdf')
  assert.equal(out.skills.length, 2)
  assert.deepEqual(out.skills[0], {
    key: 's-1',
    name: 'Pdf',
    directory: 'pdf',
    repo: 'anthropics/skills',
    installs: 99,
    url: 'https://github.com/anthropics/skills',
  })
  assert.deepEqual(out.skills[1], {
    key: 'foo/bar.js#', // 缺 id → repo#目录合成稳定 key
    name: 'NoId',
    directory: '',
    repo: 'foo/bar.js', // 带点仓库名是合法 GitHub 来源，放行
    installs: 0,
    url: 'https://github.com/foo/bar.js',
  })

  stubFetch(t, jsonRes(null, { ok: false, status: 503 }))
  await assert.rejects(searchSkillsSh('pdf'), /skills\.sh 搜索失败: HTTP 503/)
  stubFetch(t, async () => {
    throw new Error('socket hang up')
  })
  await assert.rejects(searchSkillsSh('pdf'), /skills\.sh 搜索失败: socket hang up/)
})
