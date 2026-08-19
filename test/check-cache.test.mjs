// DSR-008 检查缓存测试：check 写缓存并并行降级、library 随列表下发、update 回填、remove 清理。
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { check, update, remove } from '../lib/inbound.js'
import { buildApi } from '../lib/api.js'
import { loadCheckCache } from '../lib/state.js'
import { dirHash } from '../lib/library.js'
import { writeJson } from '../lib/workshop.js'

const SHA = 'a'.repeat(40)
const NEW_SHA = 'b'.repeat(40)

/** 最小 zipball：顶层 <repo>-<branch>，仅含 SKILL.md。 */
function zipball(repo, branch, skillMd) {
  const top = `${repo.replace('/', '-')}-${branch}`
  const name = `${top}/SKILL.md`
  const data = Buffer.from(skillMd, 'utf8')
  const compressed = deflateRawSync(data)
  const nameBuf = Buffer.from(name, 'utf8')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x0800, 6)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(0, 10)
  local.writeUInt32LE(0, 14)
  local.writeUInt32LE(0, 18)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28)
  const cen = Buffer.alloc(46)
  cen.writeUInt32LE(0x02014b50, 0)
  cen.writeUInt16LE(20, 4)
  cen.writeUInt16LE(20, 6)
  cen.writeUInt16LE(0x0800, 8)
  cen.writeUInt16LE(8, 10)
  cen.writeUInt32LE(0, 12)
  cen.writeUInt32LE(data.length, 20)
  cen.writeUInt32LE(compressed.length, 24)
  cen.writeUInt16LE(nameBuf.length, 28)
  cen.writeUInt16LE(0, 30)
  cen.writeUInt16LE(0, 32)
  cen.writeUInt16LE(0, 34)
  cen.writeUInt16LE(0, 36)
  cen.writeUInt32LE(0, 38)
  cen.writeUInt32LE(0, 42)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cen.length + nameBuf.length, 12)
  eocd.writeUInt32LE(local.length + nameBuf.length + compressed.length, 16)
  return Buffer.concat([local, nameBuf, compressed, cen, nameBuf, eocd])
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** mock GitHub：分支 head 为 headSha；update 时提供 zipball。 */
function mockGitHub(repo, branch, headSha, skillMd) {
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('api.github.com') && u.includes('/branches/')) {
      return { ok: true, status: 200, json: async () => ({ commit: { sha: headSha } }) }
    }
    if (u.includes('archive/refs/heads/')) {
      return { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => zipball(repo, branch, skillMd || '---\nname: alpha\n---\n') }
    }
    throw new Error(`unexpected fetch: ${u}`)
  }
}

const fakeCtx = {
  reconcile: async () => ({ results: [], warnings: [], errors: [] }),
  loadGroups: async () => ({ version: 1, groups: {} }),
  loadState: async () => ({ projects: {}, mounts: [], synced: {}, proxy: null }),
}

async function workshopWithLockedAlpha(commit) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-cache-'))
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n', 'utf8')
  await writeJson(root, 'skills.lock.json', {
    version: 1,
    skills: { alpha: { repo: 'owner/repo', branch: 'main', commit, path_in_repo: null, installed_at: '', content_hash: null } },
  })
  return root
}

test('check：结果写入缓存；library 随列表下发 upstream 与 checkedAt', async () => {
  const root = await workshopWithLockedAlpha(SHA)
  mockGitHub('owner/repo', 'main', SHA)
  const api = buildApi(() => ({ get: () => ({ workshopDir: root }) }))
  const results = await api['check']({})
  assert.equal(results[0].status, 'up_to_date')
  const cache = await loadCheckCache(root)
  assert.equal(cache.results.alpha.status, 'up_to_date')
  assert.ok(cache.checkedAt)
  const lib = await api['library']({})
  assert.equal(lib.skills[0].upstream.status, 'up_to_date')
  assert.equal(lib.checkedAt, cache.checkedAt)
  await rm(root, { recursive: true, force: true })
})

test('check：上游新 commit → updatable；update 成功后缓存翻转为 up_to_date', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-cache-'))
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n', 'utf8')
  await writeJson(root, 'skills.lock.json', {
    version: 1,
    skills: {
      alpha: {
        repo: 'owner/repo', branch: 'main', commit: SHA, path_in_repo: null, installed_at: '',
        // 锁基线 = 当前目录哈希，避免触发本地修改确认门禁
        content_hash: await dirHash(join(root, 'skills', 'alpha')),
      },
    },
  })
  mockGitHub('owner/repo', 'main', NEW_SHA)
  const results = await check({ root, names: ['alpha'] })
  assert.equal(results[0].status, 'updatable')
  assert.equal((await loadCheckCache(root)).results.alpha.updatable, true)
  const r = await update({ root, names: ['alpha'], ctx: fakeCtx })
  assert.equal(r.results[0].status, 'updated')
  const cache = await loadCheckCache(root)
  assert.equal(cache.results.alpha.status, 'up_to_date')
  assert.equal(cache.results.alpha.updatable, false)
  assert.equal(cache.results.alpha.current, NEW_SHA)
  await rm(root, { recursive: true, force: true })
})

test('check：无上游（本地导入）条目不写缓存', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-cache-'))
  await mkdir(join(root, 'skills', 'local-one'), { recursive: true })
  await writeFile(join(root, 'skills', 'local-one', 'SKILL.md'), '---\nname: local-one\n---\n', 'utf8')
  await writeJson(root, 'skills.lock.json', {
    version: 1,
    skills: { 'local-one': { repo: null, branch: null, commit: null, path_in_repo: null, installed_at: '', content_hash: 'x' } },
  })
  const results = await check({ root, names: undefined })
  assert.equal(results[0].status, 'skipped')
  const cache = await loadCheckCache(root)
  assert.deepEqual(cache.results, {})
  assert.equal(cache.checkedAt, null)
  await rm(root, { recursive: true, force: true })
})

test('remove：出库后清理检查缓存条目', async () => {
  const root = await workshopWithLockedAlpha(SHA)
  mockGitHub('owner/repo', 'main', SHA)
  await check({ root, names: ['alpha'] })
  assert.ok((await loadCheckCache(root)).results.alpha)
  await remove({ root, name: 'alpha', keepFiles: true, ctx: fakeCtx })
  assert.deepEqual((await loadCheckCache(root)).results, {})
  await rm(root, { recursive: true, force: true })
})
