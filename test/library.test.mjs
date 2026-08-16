// library.js 单元测试：frontmatter 解析、目录哈希、库扫描。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSkillMd, dirHash, loadLock, scanLibrary } from '../lib/library.js'
import { logHashes } from '../lib/git.js'
import { writeJson } from '../lib/workshop.js'

function git(root, args) {
  return new Promise((resolvePromise, reject) => {
    execFile('git', ['-C', root, ...args], (error, stdout) => {
      if (error) reject(error)
      else resolvePromise(stdout)
    })
  })
}

test('parseSkillMd：单行 key: value 与引号剥离', () => {
  const md = '---\nname: my-skill\ndescription: "带引号的描述"\nwhenToUse: 某些场景\n---\n正文'
  const meta = parseSkillMd(md)
  assert.equal(meta.name, 'my-skill')
  assert.equal(meta.description, '带引号的描述')
  assert.equal(meta.whenToUse, '某些场景')
})

test('parseSkillMd：块标量折叠为单行', () => {
  const md = '---\nname: a\ndescription: |\n  第一行\n  第二行\n---\n正文'
  const meta = parseSkillMd(md)
  assert.equal(meta.description, '第一行 第二行')
})

test('parseSkillMd：无 frontmatter 返回空对象', () => {
  assert.deepEqual(parseSkillMd('纯正文'), {})
  assert.deepEqual(parseSkillMd('---\nname: x'), {})
})

test('dirHash：跳过 .git 与 __pycache__，结果确定', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(dir, 'sub'), { recursive: true })
  await writeFile(join(dir, 'a.txt'), '内容A', 'utf8')
  await writeFile(join(dir, 'sub', 'b.txt'), '内容B', 'utf8')
  await writeFile(join(dir, '.git-ignored'), 'x', 'utf8')
  const h1 = await dirHash(dir)
  await writeFile(join(dir, 'a.txt'), '内容A', 'utf8')
  const h2 = await dirHash(dir)
  assert.equal(h1, h2)
  await writeFile(join(dir, 'a.txt'), '内容A2', 'utf8')
  assert.notEqual(h1, await dirHash(dir))
  await rm(dir, { recursive: true, force: true })
})

async function makeWorkshop() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
  await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n正文', 'utf8')
  await mkdir(join(root, 'skills', 'beta'), { recursive: true })
  await writeFile(join(root, 'skills', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: 贝塔\n---\n', 'utf8')
  await mkdir(join(root, '.disabled', 'gamma'), { recursive: true })
  await writeJson(root, '.disabled/gamma/_disable_meta.json', { name: 'gamma', locked: { repo: 'o/r' }, group: 'G' })
  await writeJson(root, 'skills.lock.json', {
    version: 1,
    skills: {
      beta: { repo: 'owner/repo', branch: 'main', commit: 'c', path_in_repo: null, installed_at: '', content_hash: '' },
      delta: { repo: 'other/repo', branch: 'main', commit: 'd', path_in_repo: null, installed_at: '', content_hash: '' },
    },
  })
  return root
}

test('loadLock：缺失按空骨架', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sm-test-'))
  const lock = await loadLock(root)
  assert.deepEqual(lock, { version: 1, skills: {} })
  await rm(root, { recursive: true, force: true })
})

test('scanLibrary：来源判定、missing 与 disabled 条目', async () => {
  const root = await makeWorkshop()
  const items = await scanLibrary(root, {})
  const byDir = Object.fromEntries(items.map((it) => [it.dir, it]))
  // alpha：自研
  assert.equal(byDir.alpha.origin, 'self')
  assert.equal(byDir.alpha.name, 'alpha')
  // beta：锁记录同仓库 → github
  assert.equal(byDir.beta.origin, 'github')
  assert.equal(byDir.beta.description, '贝塔')
  // delta：锁中存在但目录缺失 → missing
  assert.equal(byDir.delta.missing, true)
  assert.equal(byDir.delta.origin, 'github')
  // gamma：禁用
  assert.equal(byDir.gamma.disabled, true)
  await rm(root, { recursive: true, force: true })
})

test('logHashes：单次 spawn 批量取每路径最新提交哈希', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'dsh-sm-git-'))
  await git(repo, ['init', '-b', 'main'])
  await mkdir(join(repo, 'skills', 'alpha'), { recursive: true })
  await mkdir(join(repo, 'skills', 'beta'), { recursive: true })
  await writeFile(join(repo, 'skills', 'alpha', 'SKILL.md'), 'a1', 'utf8')
  await git(repo, ['add', 'skills/alpha'])
  await git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'alpha'])
  await writeFile(join(repo, 'skills', 'beta', 'SKILL.md'), 'b1', 'utf8')
  await git(repo, ['add', 'skills/beta'])
  await git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'beta'])
  await writeFile(join(repo, 'skills', 'alpha', 'SKILL.md'), 'a2', 'utf8')
  await git(repo, ['add', 'skills/alpha'])
  await git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'alpha2'])

  const map = await logHashes(repo, ['skills/alpha', 'skills/beta', 'skills/ghost'])
  const alphaHash = map.get('skills/alpha')
  const betaHash = map.get('skills/beta')
  assert.match(alphaHash, /^[0-9a-f]{40}$/)
  assert.match(betaHash, /^[0-9a-f]{40}$/)
  assert.notEqual(alphaHash, betaHash)
  // alpha 的哈希 = 最后一次提交 alpha2（最新）；ghost 无历史 → null
  const latest = (await git(repo, ['log', '-1', '--format=%H'])).trim()
  assert.equal(alphaHash, latest)
  assert.equal(map.get('skills/ghost'), null)
  await rm(repo, { recursive: true, force: true })
})
