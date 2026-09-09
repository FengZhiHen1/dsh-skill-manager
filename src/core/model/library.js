// library — 库扫描与内容基线：双根目录遍历、SKILL.md 解析、目录哈希。
//
// 边界：纯读视图，不写 storage；库成员 = 用户根直接子目录（自研/本地）+ 插件库根内的 github 条目。
// 双根制（DSR-020）：GitHub 外部 skill 装在插件专属库根，与用户的本地目录物理隔离。
// 参考：入站操作.md「库扫描」；目录配置与状态存储.md「storage 域形状」。

import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 解析 SKILL.md frontmatter；无 frontmatter 返回 {}。
 * 支持单行 key: value 与块标量折叠（> | >- |-）。
 */
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
 *        createSharedCache 产出的共享 meta 缓存；缺省不缓存
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
  } catch { // quality-floor: ignore silent-catch 签名与读取间竞态删除/权限失败按「无 SKILL.md」降级，单目录异常不中断整库扫描
    // 读失败按无 SKILL.md 处理
  }
  if (meta !== undefined) meta.set(key, { sig, hasSkillMd: true, meta: parsed })
  return { hasSkillMd: true, meta: parsed }
}

/**
 * 库扫描（双根制，DSR-020）：产出库内每个技能的总览列表，含目录缺失条目。
 * 用户根（配置目录）= 自研/本地自管：直接子目录纯平铺、无 skills/ 子层，不登记。
 * 插件库根（libraryRoot）= GitHub 外部专属：条目由登记表驱动，目录缺失 → missing 恢复入口。
 * 同名冲突：用户根目录与 github 登记撞名 → 登记优先，本地目录遮蔽并入 conflicts（调用方出警告）。
 * 列表项字段：name、dir、description、hasSkillMd、commit、disabled、
 * missing、group；origin 取 self/github/local，group 为所属组（虚拟组 =「默认」）。
 * 纯读视图：不写 storage，本地目录无版本管理不登记。
 * github 记录缺 content_hash 不回填，基线只由入站路径 add/update 维护。
 * disabled、group 为占位默认值，意图字段由 API 层叠加 settings.skills。
 * @param {string} root 用户根（配置目录）
 * @param {object} store 存取门面
 * @param {object} opts 传 opts.meta（共享缓存）→ 签名一致即复用解析结果；opts.libraryRoot = 插件库根
 * @returns {{ items: Array, conflicts: string[] }} items 按 dir 排序；conflicts 为被遮蔽的同名目录名
 */
export async function scanLibrary(root, store, opts = {}) {
  const records = new Map(store.skillEntries())
  const items = []
  const conflicts = []
  let dirs = []
  try {
    dirs = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) throw error
  }
  for (const entry of dirs.filter((d) => d.isDirectory())) {
    const dir = entry.name
    if (dir.startsWith('.')) continue
    const record = records.get(dir) ?? null
    // 同名冲突：GitHub 登记的源根是插件库，用户根里的同名目录遮蔽（登记优先）
    if (record && record.origin === 'github') {
      conflicts.push(dir)
      continue
    }
    const absDir = join(root, dir)
    const mdPath = join(absDir, 'SKILL.md')
    const { hasSkillMd, meta } = await readSkillMeta(mdPath, opts.meta, `${root}\0${dir}`)
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
  // github 条目由登记表驱动、落插件库根：目录在 → 读元数据；缺失 → missing 恢复入口。
  for (const [name, record] of records) {
    if (!record || record.origin !== 'github') continue
    const libDir = typeof opts.libraryRoot === 'string' && opts.libraryRoot !== '' ? join(opts.libraryRoot, name) : null
    const present = libDir !== null && await existsDir(libDir)
    if (!present) {
      items.push({
        name, dir: name, description: '', origin: 'github', hasSkillMd: false,
        commit: record.commit, missing: true, disabled: false, group: '默认',
      })
      continue
    }
    const { hasSkillMd, meta } = await readSkillMeta(join(libDir, 'SKILL.md'), opts.meta, `${libDir}\0${name}`)
    items.push({
      name: meta.name || name,
      dir: name,
      description: meta.description || '',
      origin: 'github',
      hasSkillMd,
      commit: record.commit ?? null,
      missing: false,
      disabled: false,
      group: '默认',
    })
  }
  items.sort((a, b) => a.dir.localeCompare(b.dir))
  return { items, conflicts }
}

/**
 * 换装残骸名（DSR-022 第 4 条咽喉点的失败路径产物）：
 * `.dsh-sm-swap-*` = 被 finally 漏掉的暂存（进程被杀），`.dsh-sm-old-*` = 换装失败刻意保留的旧版。
 * 二者都以 `.` 开头 → 被 scanLibrary 跳过、永不成为 skill、**页面上完全不可见**，
 * 却能长期占盘且装着旧内容。本函数是它们唯一的报告出口（台账能解释，现场必须可见）。
 * @param {string|null|undefined} dir 插件库根
 * @returns {Promise<string[]>} 残骸目录名（按名排序；根不存在或读不了 → 空集，不抛）
 */
export async function findSwapResidue(dir) {
  if (typeof dir !== 'string' || dir === '') return []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return [] // 探针语义：读不到按无残骸报，残骸本身不该制造新错误
  }
  return entries
    .filter((e) => e.isDirectory() && /^\.dsh-sm-(swap|old)-/.test(e.name))
    .map((e) => e.name)
    .sort()
}

/** 目录存在性探针（库扫描内部用；不存在/非目录/不可读 → false）。 */
async function existsDir(p) {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false // 探针语义：任何失败都按不存在报（missing 是显式状态）
  }
}
