// zipball 管线（入站操作.md）：解包安全边界（zip-slip/顶层不唯一）、skill 目录定位
// （strict/非 strict 分岔）、安装名文法（C-01）、临时目录生命周期（失败不漏 tmp）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { extractSkillDir, explodeZipball, locateSkillDir, skillsFromFiles, validateInstallName, withMaterializedSkillDir } from '../src/core/inbound/zipball.js'
import { buildZip, assertThrowsCode, cleanup, mkTmp } from './helpers.mjs'

/** 单顶层目录 zipball 的标准形态（GitHub zipball 必带顶层 sha 目录）。 */
function skillZip(files, top = 'repo-abc123') {
  return buildZip(files.map(([rel, content]) => ({ name: `${top}/${rel}`, data: Buffer.from(content, 'utf8'), method: 0 })))
}

test('explodeZipball：剥顶层目录、跳目录条目与 .git 段', () => {
  const payload = skillZip([
    ['SKILL.md', '---\nname: pdf\n---'],
    ['scripts/run.py', 'print(1)'],
    ['.git/HEAD', 'ref'],
  ])
  const { top, files } = explodeZipball(payload)
  assert.equal(top, 'repo-abc123')
  assert.deepEqual(Object.keys(files).sort(), ['SKILL.md', 'scripts/run.py'])
})

test('explodeZipball：顶层目录不唯一 → bad-zipball', () => {
  const payload = buildZip([
    { name: 'a/x.txt', data: Buffer.from('x'), method: 0 },
    { name: 'b/y.txt', data: Buffer.from('y'), method: 0 },
  ])
  assertThrowsCode(() => explodeZipball(payload), 'bad-zipball')
})

test('explodeZipball：zip-slip 条目（../ 逃逸、绝对路径、盘符）一律拒绝', () => {
  for (const evil of ['../escape.txt', 'dir/../../escape.txt', '/abs.txt', 'C:/win.txt', './dot.txt']) {
    const payload = skillZip([['SKILL.md', 'x'], [evil, 'evil']])
    assertThrowsCode(() => explodeZipball(payload), 'bad-zipball')
  }
})

test('locateSkillDir：指定命中即用；strict 未命中 path-stale；非 strict 回退自动探测', () => {
  const files = { 'SKILL.md': Buffer.from('x'), 'sub/SKILL.md': Buffer.from('x') }
  assert.equal(locateSkillDir(files, 'sub'), 'sub') // 指定命中
  assert.equal(locateSkillDir(files, 'sub/'), 'sub') // 尾斜杠归一
  assertThrowsCode(() => locateSkillDir(files, 'gone', true), 'path-stale') // strict 未命中拒静默装错
  assert.equal(locateSkillDir(files, 'gone', false), '') // 非 strict 回退：仓库根优先
  assertThrowsCode(() => locateSkillDir({}, undefined), 'no-skill-md')
})

test('locateSkillDir：多候选同深无法唯一收窄 → needs-selection；深浅分明取最浅', () => {
  const multi = { 'a/SKILL.md': Buffer.from('x'), 'b/SKILL.md': Buffer.from('x') }
  assertThrowsCode(() => locateSkillDir(multi, undefined), 'needs-selection')
  const nested = { 'a/SKILL.md': Buffer.from('x'), 'a/deep/SKILL.md': Buffer.from('x') }
  assert.equal(locateSkillDir(nested, undefined), 'a') // 唯一最浅
})

test('skillsFromFiles：候选收集与去重排序；仓库根候选为空串', () => {
  const files = { 'SKILL.md': Buffer.from('x'), 'b/SKILL.md': Buffer.from('x'), 'b/inner.txt': Buffer.from('y') }
  assert.deepEqual(skillsFromFiles(files), ['', 'b'])
})

test('validateInstallName：C-01 文法双边（小写/数字/连字符）', () => {
  assert.doesNotThrow(() => validateInstallName('pdf-tools'))
  assert.doesNotThrow(() => validateInstallName('a'))
  for (const bad of ['', 'PDF', 'pdf_tools', 'pdf tools', '-pdf', 'pdf-', 'pdf--x']) {
    assertThrowsCode(() => validateInstallName(bad), 'bad-name')
  }
})

test('extractSkillDir：直接解进指定目录；定位失败先抛且不建目录（收口第 3 项：更新不经 os.tmpdir）', async () => {
  const into = await mkTmp()
  const payload = skillZip([['SKILL.md', '---\nname: pdf\n---'], ['sub/a.md', 'a'], ['foo/__pycache__/x.pyc', 'x']])
  try {
    const dir = await extractSkillDir(payload, undefined, false, into)
    assert.equal(dir, '')
    assert.deepEqual((await readdir(into)).sort(), ['SKILL.md', 'sub'])
    // strict + 记录的路径在上游已失效 → path-stale，且不得留下半成品目录
    const stale = await mkTmp()
    await assert.rejects(() => extractSkillDir(payload, 'gone', true, join(stale, 'stage')), (e) => e.code === 'path-stale')
    await assert.rejects(() => readdir(join(stale, 'stage')), (e) => e.code === 'ENOENT')
    await cleanup(stale)
  } finally {
    await cleanup(into)
  }
})

test('withMaterializedSkillDir：fn 抛错后临时目录必定清理（失败不漏 tmp）', async () => {
  const payload = skillZip([['SKILL.md', '---\nname: pdf\n---'], ['docs/a.txt', 'a']])
  let leaked = null
  await assert.rejects(
    withMaterializedSkillDir(payload, undefined, false, async ({ tmp }) => {
      leaked = tmp // 记录临时目录路径，供断言语后复验
      throw new Error('fn 失败')
    }),
    /fn 失败/,
  )
  assert.ok(leaked)
  await assert.rejects(stat(leaked), (error) => error.code === 'ENOENT') // 临时目录无残留
})

test('withMaterializedSkillDir：子目录前缀过滤与 __pycache__ 段跳过', async () => {
  const payload = skillZip([
    ['sub/SKILL.md', '---\nname: sub\n---'],
    ['sub/keep.txt', 'k'],
    ['sub/__pycache__/gen.pyc', 'g'],
    ['other/SKILL.md', '---\nname: other\n---'],
  ])
  const seen = await withMaterializedSkillDir(payload, 'sub', true, async ({ tmp, dir }) => {
    assert.equal(dir, 'sub')
    return readdir(tmp)
  })
  assert.deepEqual(seen.sort(), ['SKILL.md', 'keep.txt']) // other/ 与 __pycache__ 不进临时目录
})
