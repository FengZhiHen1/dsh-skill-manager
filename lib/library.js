// dsh-skill-manager — 库扫描与锁文件（inbound-operations.md 库扫描；workshop-files.md 锁形状）。
// frontmatter 解析语义与 distributor 参考实现一致：单行 key: value + 块标量折叠。

import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { WorkshopError } from './errors.js'
import { readJson, writeJson, existsDir } from './workshop.js'
import { logHash } from './git.js'

/** 解析 SKILL.md frontmatter（与 distributor parse_skill_md 同语义）；无 frontmatter 返回 {}。 */
export function parseSkillMd(text) {
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end === -1) return {}
  const meta = {}
  const lines = text.slice(3, end).split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const m = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(lines[i])
    if (!m) {
      i += 1
      continue
    }
    const key = m[1]
    let value = m[2].trim()
    if (['>', '|', '>-', '|-'].includes(value)) {
      const block = []
      i += 1
      while (i < lines.length && (lines[i].startsWith(' ') || lines[i].startsWith('\t') || !lines[i].trim())) {
        if (lines[i].trim()) block.push(lines[i].trim())
        i += 1
      }
      meta[key] = block.join(' ')
      continue
    }
    meta[key] = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '')
    i += 1
  }
  return meta
}

/** 目录内容哈希（content_hash 基线）：按相对路径排序拼接 路径+'\0'+内容 SHA-256，跳过目录/.git/__pycache__。 */
export async function dirHash(dir) {
  const h = createHash('sha256')
  const files = await collectFiles(dir)
  for (const rel of files.sort()) {
    h.update(rel)
    h.update('\0')
    h.update(await readFile(join(dir, rel)))
  }
  return h.digest('hex')
}

async function collectFiles(dir, prefix = '') {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '__pycache__') continue
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await collectFiles(join(dir, entry.name), rel)))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

const LOCK_REL = 'skills.lock.json'
export const SKILLS_REL = 'skills'
export const DISABLED_REL = '.disabled'

/** 锁文件：缺失按空骨架 {version:1, skills:{}}。 */
export async function loadLock(root) {
  const data = await readJson(root, LOCK_REL)
  if (data === null) return { version: 1, skills: {} }
  if (typeof data !== 'object' || data === null || typeof data.skills !== 'object' || data.skills === null) {
    throw new WorkshopError('workshop-corrupt', 'skills.lock.json 形状非法（version/skills 缺失）')
  }
  return { version: 1, skills: data.skills }
}

export async function saveLock(root, lock) {
  await writeJson(root, LOCK_REL, lock)
}

/**
 * 库扫描：skills/ 全部目录 + 锁中存在但目录缺失的第三方条目（missing）+ 禁用条目。
 * 列表项：name、dir、description、origin(self/github/local)、hasSkillMd、fingerprint、
 * upstream（锁条目）、missing、disabled、group（所属组或 null=默认组）。
 */
export async function scanLibrary(root, groups) {
  const lock = await loadLock(root)
  const locked = lock.skills
  const items = []
  const seen = new Set()
  const skillsDir = join(root, SKILLS_REL)
  let dirs = []
  try {
    dirs = await readdir(skillsDir, { withFileTypes: true })
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) throw error
  }
  for (const entry of dirs.filter((d) => d.isDirectory())) {
    const dir = entry.name
    if (dir.startsWith('.')) continue
    seen.add(dir)
    const mdPath = join(skillsDir, dir, 'SKILL.md')
    let hasSkillMd = false
    let meta = {}
    try {
      const info = await stat(mdPath)
      hasSkillMd = info.isFile()
      if (hasSkillMd) meta = parseSkillMd(await readFile(mdPath, 'utf8'))
    } catch {
      // 读失败按无 SKILL.md 处理
    }
    const upstream = locked[dir] || null
    const origin = upstream ? (upstream.repo ? 'github' : 'local') : 'self'
    items.push({
      name: meta.name || dir,
      dir,
      description: meta.description || '',
      origin,
      hasSkillMd,
      fingerprint: await logHash(root, `${SKILLS_REL}/${dir}`),
      upstream,
      missing: false,
      disabled: false,
      group: groupOf(groups, dir),
    })
  }
  // 锁中存在但目录缺失的第三方条目 → missing 恢复入口
  for (const [name, upstream] of Object.entries(locked)) {
    if (!seen.has(name) && upstream && upstream.repo) {
      items.push({
        name,
        dir: name,
        description: '',
        origin: 'github',
        hasSkillMd: false,
        fingerprint: null,
        upstream,
        missing: true,
        disabled: false,
        group: groupOf(groups, name),
      })
    }
  }
  // 禁用条目：.disabled/<name>/_disable_meta.json
  const disabledDir = join(root, DISABLED_REL)
  try {
    const disabled = await readdir(disabledDir, { withFileTypes: true })
    for (const entry of disabled.filter((d) => d.isDirectory())) {
      const metaFile = join(disabledDir, entry.name, '_disable_meta.json')
      let meta = {}
      try {
        meta = JSON.parse(await readFile(metaFile, 'utf8'))
      } catch {
        // 元数据缺失仍展示禁用条目
      }
      items.push({
        name: meta.name || entry.name,
        dir: entry.name,
        description: '',
        origin: 'github',
        hasSkillMd: false,
        fingerprint: null,
        upstream: meta.locked || null,
        missing: false,
        disabled: true,
        group: groupOf(groups, meta.group || entry.name),
      })
    }
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) throw error
  }
  items.sort((a, b) => a.dir.localeCompare(b.dir))
  return items
}

function groupOf(groups, name) {
  for (const [group, members] of Object.entries(groups)) {
    if (Array.isArray(members) && members.includes(name)) return group
  }
  return null // 虚拟组 默认
}

/** 目录是否真实存在（供 API 层判断 missing 现场的恢复动作）。 */
export async function skillDirExists(root, name) {
  return existsDir(join(root, SKILLS_REL, name))
}
