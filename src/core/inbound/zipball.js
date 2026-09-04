// dsh-skill-manager — zipball → skill 目录管线（入站操作.md；DSR-015 inbound 层）。
// 自原 lib/inbound.js 搬位（P1，逻辑未动）：add/upstream/backups 三消费方共用的
// 解包、定位、临时目录物化与文件树复制原语；nowIso/pathExists/validateInstallName
// 为入站域共享小工具，统一收在本文件（原为 lib/inbound.js 模块内私有 helper）。

import { cp, mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SkillManagerError } from '../base/errors.js'
import { unzip } from '../base/zip.js'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateInstallName(name) {
  if (!SKILL_NAME.test(name)) {
    throw new SkillManagerError('bad-name', `非法安装名: ${name}（小写字母/数字/连字符）`)
  }
}

export function nowIso() {
  return new Date().toISOString()
}

export async function pathExists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** zipball 字节 → {顶层目录名, 文件: {相对路径: Buffer}}。 */
export function explodeZipball(payload) {
  const files = unzip(payload)
  const tops = new Set()
  for (const name of Object.keys(files)) {
    const top = name.split('/')[0]
    if (top !== '' && !name.endsWith('/')) tops.add(top)
  }
  if (tops.size !== 1) throw new SkillManagerError('bad-zipball', 'zipball 结构异常：顶层目录不唯一')
  const top = [...tops][0]
  const out = {}
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(`${top}/`) || name.endsWith('/')) continue
    const rel = name.slice(top.length + 1)
    if (rel.split('/').includes('.git')) continue
    // 防解包逃逸：拒绝绝对路径、盘符前缀与 .. / . 段（恶意 zip 可任意写文件）
    if (rel === '' || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').some((part) => part === '..' || part === '.')) {
      throw new SkillManagerError('bad-zipball', `zipball 含不安全路径条目: ${rel}`)
    }
    out[rel] = data
  }
  return { top, files: out }
}

/** 目录树中全部 SKILL.md 候选（path 为空串表示仓库根即 skill）。 */
export function skillsFromFiles(files) {
  const hits = []
  for (const rel of Object.keys(files)) {
    const parts = rel.split('/')
    if (parts[parts.length - 1] !== 'SKILL.md') continue
    const dir = parts.slice(0, -1).join('/')
    hits.push(dir === '' ? '' : dir)
  }
  return [...new Set(hits)].sort()
}

/**
 * 定位 skill 目录。
 * @param {boolean} strict - true 时指定子目录未命中直接报 path-stale（update 用，
 *   防止上游重构后静默装错 skill）；false 回退自动探测（add/repo-skills 用）。
 */
export function locateSkillDir(files, subdir, strict = false) {
  const candidates = skillsFromFiles(files)
  if (candidates.length === 0) throw new SkillManagerError('no-skill-md', '仓库中未找到任何 SKILL.md')
  if (subdir) {
    if (files[`${subdir.replace(/\/$/, '')}/SKILL.md`] !== undefined) return subdir.replace(/\/$/, '')
    if (strict) {
      const listing = candidates.map((c) => (c === '' ? '（仓库根）' : c)).join('、') || '无'
      throw new SkillManagerError('path-stale', `记录路径 ${subdir} 在上游已失效；仓内现有 skill: ${listing}`)
    }
    // 指定子目录未命中：回退自动探测（skills.sh 的 skillId 是名字不是路径）
  }
  if (files['SKILL.md'] !== undefined) return ''
  const shallow = Math.min(...candidates.map((c) => (c === '' ? 0 : c.split('/').length)))
  const shallowest = candidates.filter((c) => (c === '' ? 0 : c.split('/').length) === shallow)
  if (shallowest.length > 1) {
    const list = shallowest.map((c) => (c === '' ? '（仓库根）' : c)).join(', ')
    throw new SkillManagerError('needs-selection', `仓库含多个 skill，请选择其一: ${list}`)
  }
  return shallowest[0]
}

/** 把 zipball 内一个 skill 目录物化到临时目录，返回 {tmp, dir}（dir 相对路径）。 */
export async function materializeSkillDir(payload, subdir, strict = false) {
  const { files } = explodeZipball(payload)
  const dir = locateSkillDir(files, subdir, strict)
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-sm-'))
  const prefix = dir === '' ? '' : `${dir}/`
  for (const [rel, data] of Object.entries(files)) {
    if (!rel.startsWith(prefix)) continue
    const target = join(tmp, rel.slice(prefix.length))
    if (target.includes('__pycache__')) continue
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, data)
  }
  return { tmp, dir }
}

export async function copyTree(src, dest) {
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '__pycache__') continue
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true })
      await copyTree(from, to)
    } else if (entry.isFile()) {
      await cp(from, to)
    }
  }
}
