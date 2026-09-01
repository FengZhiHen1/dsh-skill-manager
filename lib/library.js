// dsh-skill-manager — 库扫描与内容基线（inbound-operations.md 库扫描；storage-model.md skills 表）。
// frontmatter 解析语义沿用：单行 key: value + 块标量折叠。
// 库成员 = 配置目录直接子目录中含 SKILL.md 者（纯平铺目录，无 skills/ 子层）。

import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { existsDir } from './dir.js'

/** 解析 SKILL.md frontmatter；无 frontmatter 返回 {}。 */
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

/**
 * SKILL.md 的 stat 签名（mtimeMs:size）；不存在或不可读返回 null。
 * 签名一致 → meta 缓存命中，跳过 readFile + frontmatter 解析。
 */
async function skillMdSignature(mdPath) {
  try {
    const info = await stat(mdPath)
    if (!info.isFile()) return null
    return `${info.mtimeMs}:${info.size}`
  } catch {
    return null
  }
}

/**
 * 读取并解析一个 SKILL.md；带 meta 缓存时按签名复用。
 * @param {string} mdPath SKILL.md 绝对路径
 * @param {Map<string, {sig: string, hasSkillMd: boolean, meta: object}> | undefined} meta
 *        共享 meta 缓存（createSharedCache().meta）；缺省不缓存
 * @param {string} key 缓存键（`${root}\0${dir}`）
 */
async function readSkillMeta(mdPath, meta, key) {
  const sig = await skillMdSignature(mdPath)
  if (sig === null) return { hasSkillMd: false, meta: {} }
  if (meta !== undefined) {
    const cached = meta.get(key)
    if (cached !== undefined && cached.sig === sig) return { hasSkillMd: cached.hasSkillMd, meta: cached.meta }
  }
  let parsed = {}
  try {
    parsed = parseSkillMd(await readFile(mdPath, 'utf8'))
  } catch {
    // 读失败按无 SKILL.md 处理
  }
  if (meta !== undefined) meta.set(key, { sig, hasSkillMd: true, meta: parsed })
  return { hasSkillMd: true, meta: parsed }
}

/**
 * 库扫描：配置目录直接子目录 + 表中 origin 非 self 但目录缺失的条目（missing）。
 * 列表项：name、dir、description、origin(self/github/local)、hasSkillMd、commit、
 * disabled、missing、group（所属组，虚拟组为 默认）。
 * 副作用（仅域写入）：目录存在而表无记录 → 补登记 origin:'self'；记录缺
 * content_hash 且目录在 → 回填基线。
 * @param {object} opts `{ meta }`：meta 为共享缓存（createSharedCache().meta），
 *        未改动目录的解析结果按 stat 签名复用，重扫退化为 N 次 stat。
 */
export async function scanLibrary(root, store, opts = {}) {
  const records = new Map(store.skillEntries())
  const items = []
  const seen = new Set()
  let dirs = []
  try {
    dirs = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) throw error
  }
  for (const entry of dirs.filter((d) => d.isDirectory())) {
    const dir = entry.name
    if (dir.startsWith('.')) continue
    seen.add(dir)
    const absDir = join(root, dir)
    const mdPath = join(absDir, 'SKILL.md')
    const { hasSkillMd, meta } = await readSkillMeta(mdPath, opts.meta, `${root}\0${dir}`)
    const record = records.get(dir) ?? null
    items.push({
      name: meta.name || dir,
      dir,
      description: meta.description || '',
      // 无记录目录 = 本地文件（自研），不登记 storage（本地 skill 无版本管理）。
      origin: record?.origin ?? 'self',
      hasSkillMd,
      commit: record?.commit ?? null,
      missing: false,
      // 意图字段由 API 层叠加配置（settings.skills）；此处默认值供纯扫描消费。
      disabled: false,
      group: '默认',
    })
  }
  // 表中 github 记录但目录缺失的条目 → missing 恢复入口（仅 github 有上游可恢复；
  // 本地 skill 目录删除即消失，无版本管理）。
  for (const [name, record] of records) {
    if (!seen.has(name) && record && record.origin === 'github') {
      items.push({
        name,
        dir: name,
        description: '',
        origin: record.origin,
        hasSkillMd: false,
        commit: record.commit,
        missing: true,
        disabled: false,
        group: '默认',
      })
    }
  }
  items.sort((a, b) => a.dir.localeCompare(b.dir))
  return items
}

/** 目录是否真实存在（供 API 层判断 missing 现场的恢复动作）。 */
export async function skillDirExists(root, name) {
  return existsDir(join(root, name))
}
