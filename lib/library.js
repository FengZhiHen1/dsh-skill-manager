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
 * 库扫描：配置目录直接子目录 + 表中 origin 非 self 但目录缺失的条目（missing）。
 * 列表项：name、dir、description、origin(self/github/local)、hasSkillMd、commit、
 * disabled、missing、group（所属组，虚拟组为 默认）。
 * 副作用（仅域写入）：目录存在而表无记录 → 补登记 origin:'self'；记录缺
 * content_hash 且目录在 → 回填基线。
 */
export async function scanLibrary(root, store) {
  const records = new Map(store.skillEntries())
  const groupNames = new Set(store.groupEntries().map(([name]) => name))
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
    let hasSkillMd = false
    let meta = {}
    try {
      const info = await stat(mdPath)
      hasSkillMd = info.isFile()
      if (hasSkillMd) meta = parseSkillMd(await readFile(mdPath, 'utf8'))
    } catch {
      // 读失败按无 SKILL.md 处理
    }
    let record = records.get(dir) ?? null
    if (record === null) {
      // 未登记的既有目录 → 补登记 self（storage-model.md skills 表）
      record = {
        origin: 'self', repo: null, branch: null, commit: null,
        path_in_repo: null, content_hash: null, origin_path: null,
        installed_at: new Date().toISOString(), disabled: false, group: '默认',
      }
      await store.putSkill(dir, record)
    } else if (record.content_hash === null && hasSkillMd) {
      // 回填缺失的内容基线（inbound-operations.md 库扫描）
      record = { ...record, content_hash: await dirHash(absDir) }
      await store.putSkill(dir, record)
    }
    items.push({
      name: meta.name || dir,
      dir,
      description: meta.description || '',
      origin: record.origin,
      hasSkillMd,
      commit: record.commit,
      missing: false,
      disabled: record.disabled === true,
      group: sanitizeGroup(record.group, groupNames),
    })
  }
  // 表中 origin 非 self 但目录缺失的条目 → missing 恢复入口
  for (const [name, record] of records) {
    if (!seen.has(name) && record && record.origin !== 'self') {
      items.push({
        name,
        dir: name,
        description: '',
        origin: record.origin,
        hasSkillMd: false,
        commit: record.commit,
        missing: true,
        disabled: record.disabled === true,
        group: sanitizeGroup(record.group, groupNames),
      })
    }
  }
  items.sort((a, b) => a.dir.localeCompare(b.dir))
  return items
}

/** 组引用失效（组已删除）时按虚拟组 默认 展示。 */
function sanitizeGroup(group, groupNames) {
  if (typeof group !== 'string' || group === '' || group === '默认') return '默认'
  return groupNames.has(group) ? group : '默认'
}

/** 目录是否真实存在（供 API 层判断 missing 现场的恢复动作）。 */
export async function skillDirExists(root, name) {
  return existsDir(join(root, name))
}
