// inbound.js 端到端测试：mock fetch 的入库路径（分支解析 → zipball → 锁记录 → 提交降级）。
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { add, importSkill, check } from '../lib/inbound.js'
import { loadLock } from '../lib/library.js'
import { writeJson } from '../lib/workshop.js'

const SHA = 'a'.repeat(40)

/** 构造 zipball：顶层 <repo>-<branch>，含 SKILL.md 与子文件（deflate）。 */
function zipball(repo, branch, skillMd) {
  const top = `${repo.replace('/', '-')}-${branch}`
  const entries = [
    { name: `${top}/SKILL.md`, data: Buffer.from(skillMd, 'utf8'), method: 8 },
    { name: `${top}/notes.txt`, data: Buffer.from('hello', 'utf8'), method: 0 },
  ]
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const data = e.method === 8 ? deflateRawSync(e.data) : e.data
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(e.method, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(0, 18)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, data)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(e.method, 10)
    cen.writeUInt32LE(0, 12)
    cen.writeUInt32LE(e.data.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30)
    cen.writeUInt16LE(0, 32)
    cen.writeUInt16LE(0, 34)
    cen.writeUInt16LE(0, 36)
    cen.writeUInt32LE(0, 38)
    cen.writeUInt32LE(offset, 42)
    centralParts.push(cen, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const cenBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cenBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, cenBuf, eocd])
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function mockGitHub(repo, branch, skillMd) {
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('api.github.com') && u.includes('/branches/')) {
      return { ok: true, status: 200, json: async () => ({ commit: { sha: SHA } }) }
    }
    if (u.includes('archive/refs/heads/')) {
      return { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => zipball(repo, branch, skillMd) }
    }
    throw new Error(`unexpected fetch: ${u}`)
  }
}

const fakeCtx = { reconcile: async () => ({ results: [], warnings: [], errors: [] }) }

test('add：mock GitHub 入库 → 锁记录与目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'skills'), { recursive: true })
  mockGitHub('owner/repo', 'main', '---\nname: my-skill\ndescription: 测试\n---\n正文')
  const result = await add({ root, repo: 'owner/repo', dir: undefined, ref: 'main', ctx: fakeCtx })
  assert.equal(result.name, 'my-skill')
  assert.equal(result.repo, 'owner/repo')
  assert.equal(result.commit, SHA)
  const lock = await loadLock(root)
  const entry = lock.skills['my-skill']
  assert.equal(entry.repo, 'owner/repo')
  assert.equal(entry.path_in_repo, null)
  assert.equal(entry.content_hash.length, 64)
  const md = await readFile(join(root, 'skills', 'my-skill', 'SKILL.md'), 'utf8')
  assert.match(md, /name: my-skill/)
  await rm(root, { recursive: true, force: true })
})

test('add：同名同仓库拒绝（already-installed）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'skills'), { recursive: true })
  mockGitHub('owner/repo', 'main', '---\nname: my-skill\n---\n')
  await add({ root, repo: 'owner/repo', ctx: fakeCtx })
  await assert.rejects(
    () => add({ root, repo: 'owner/repo', ctx: fakeCtx }),
    (e) => e.code === 'already-installed',
  )
  await rm(root, { recursive: true, force: true })
})

test('add：非法仓库 slug 拒绝（bad-repo）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await assert.rejects(
    () => add({ root, repo: 'not-a-slug', ctx: fakeCtx }),
    (e) => e.code === 'bad-repo',
  )
  await rm(root, { recursive: true, force: true })
})

test('importSkill：本地目录导入', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'skills'), { recursive: true })
  const src = await mkdtemp(join(tmpdir(), 'dsh-sm-src-'))
  await writeFile(join(src, 'SKILL.md'), '---\nname: local-skill\ndescription: 本地\n---\n', 'utf8')
  const result = await importSkill({ root, path: src, as: 'local-skill', ctx: fakeCtx })
  assert.equal(result.name, 'local-skill')
  assert.equal(result.source, 'local')
  const lock = await loadLock(root)
  assert.equal(lock.skills['local-skill'].repo, null)
  assert.equal(lock.skills['local-skill'].source, 'local')
  // 非 Git 车间：自动提交降级跳过（不抛错）
  await rm(src, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
})

test('check：断网时 check_failed 不崩溃', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n', 'utf8')
  await writeJson(root, 'skills.lock.json', {
    version: 1,
    skills: { alpha: { repo: 'owner/repo', branch: 'main', commit: SHA, path_in_repo: null, installed_at: '', content_hash: null } },
  })
  globalThis.fetch = async () => { throw new TypeError('network down') }
  // 同时屏蔽 git 回退通道（PATH 指向无 git 的目录），保证确定性
  const realPath = process.env.PATH
  process.env.PATH = await mkdtemp(join(tmpdir(), 'dsh-sm-empty-'))
  try {
    const results = await check({ root, names: undefined })
    assert.equal(results.length, 1)
    assert.equal(results[0].status, 'check_failed')
    assert.equal(results[0].reachable, false)
  } finally {
    process.env.PATH = realPath
  }
  await rm(root, { recursive: true, force: true })
})
