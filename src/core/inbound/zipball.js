// zipball — zipball 字节 → skill 目录的管线：解包、定位、临时目录物化与文件树复制。
//
// 边界：临时目录生命周期由 withMaterializedSkillDir 持有，失败不漏 tmp。
// 消费方为 add/upstream/backups；nowIso/validateInstallName 为入站共享小工具，
// 存在性探测统一走 fsys.probePath 族（pathExists 在 fsys）。
// 参考：入站操作.md；DSR-015。

import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SkillManagerError } from '../base/errors.js'
import { unzip } from '../base/zip.js'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 安装名文法校验（C-01；小写字母/数字/连字符）。
 * @throws {SkillManagerError} bad-name — 不满足文法
 */
export function validateInstallName(name) {
  if (!SKILL_NAME.test(name)) {
    throw new SkillManagerError('bad-name', `非法安装名: ${name}（小写字母/数字/连字符）`)
  }
}

/** 当前时刻 ISO 字符串（时间戳字段统一入口，便于测试替换）。 */
export function nowIso() {
  return new Date().toISOString()
}

/**
 * zipball 字节 → {顶层目录名, 文件: {相对路径: Buffer}}。
 * @throws {SkillManagerError} bad-zipball — 顶层目录不唯一，或含越界路径条目（防解包逃逸）
 */
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
 * 定位 zipball 内的 skill 目录：指定子目录命中即用，未命中按 strict 报错或自动探测。
 * @param {boolean} strict - true：指定子目录未命中直接报 path-stale，禁止静默装错（update 用）；
 *   false：回退自动探测（add/repo-skills 用）。
 * @throws {SkillManagerError} no-skill-md — 仓内无任何 SKILL.md
 * @throws {SkillManagerError} path-stale — strict 且记录路径在上游失效
 * @throws {SkillManagerError} needs-selection — 多候选且无法唯一收窄
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

/**
 * 把 zipball 内一个 skill 目录物化到临时目录，返回 {tmp, dir}（dir 相对路径）。
 * 私有原语——tmp 生命周期只由 {@link withMaterializedSkillDir} 持有，外部不再
 * 直接调用（防旁路漏清理）。
 * Side Effects: 在 os.tmpdir() 建目录。
 */
async function materializeSkillDir(payload, subdir, strict = false) {
  const { files } = explodeZipball(payload)
  const dir = locateSkillDir(files, subdir, strict)
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-sm-'))
  const prefix = dir === '' ? '' : `${dir}/`
  for (const [rel, data] of Object.entries(files)) {
    if (!rel.startsWith(prefix)) continue
    const target = join(tmp, rel.slice(prefix.length))
    // 与 copyTree 同源：按路径段精确跳过 __pycache__（子串匹配会误伤 foo__pycache__.md）
    if (rel.split('/').includes('__pycache__')) continue
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, data)
  }
  return { tmp, dir }
}

/**
 * materializeSkillDir 的安全包装：fn 拿到 {tmp, dir} 后，无论成败临时目录必定清理。
 * fn 须在返回前把内容复制/换装到持久位置。
 * 错误语义：materializeSkillDir 与 fn 的异常均继续上抛，本包装只负责 finally 清 tmp。
 * @param {Buffer} payload zipball 字节
 * @param {string|undefined} subdir 仓内子目录（可空 = 自动探测）
 * @param {boolean} strict 传给 locateSkillDir 的严格模式
 * @param {(env: {tmp: string, dir: string}) => Promise<unknown>} fn 消费回调
 * @returns fn 的返回值
 */
export async function withMaterializedSkillDir(payload, subdir, strict, fn) {
  const { tmp, dir } = await materializeSkillDir(payload, subdir, strict)
  try {
    return await fn({ tmp, dir })
  } finally {
    // 清理失败不得遮蔽在途的业务错误（finally 抛出会替换原异常）。
    await rm(tmp, { recursive: true, force: true }).catch(() => {
      // tmp 残留归系统临时目录清理范畴，不阻断调用方
    })
  }
}

/** 递归复制文件树（跳过 .git 与 __pycache__；符号链接等非普通文件不复制）。 */
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
