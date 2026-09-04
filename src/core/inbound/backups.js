// dsh-skill-manager — 导入、出库、备份与恢复（入站操作.md；DSR-015 inbound 层）。
// 自原 lib/inbound.js 搬位（P1，逻辑未动）。importSkill 按批次要求临时放在本文件
// （P3 随端点删除一并处理）。解包原语在 zipball.js；摘链 detachOne 在 mount 域。

import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { SkillManagerError } from '../base/errors.js'
import { safePath } from '../base/fsys.js'
import { dirHash } from '../model/library.js'
import { loadState, saveState } from '../model/state.js'
import { backupId } from '../model/store.js'
import { targetKey } from '../mount/derive.js'
import { detachOne } from '../mount/materialize.js'
import { copyTree, explodeZipball, locateSkillDir, nowIso, pathExists, validateInstallName } from './zipball.js'

/** 本地导入（R-11）。 */
export async function importSkill({ root, store, path: inputPath, as, ctx }) {
  const src = resolve(inputPath.replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? `%${v}%`))
  if (!(await pathExists(src))) throw new SkillManagerError('not-found', `路径不存在: ${inputPath}`)
  let skillDir
  let tmp = null
  const info = await stat(src)
  if (info.isFile()) {
    if (!src.toLowerCase().endsWith('.zip')) throw new SkillManagerError('bad-import', '文件导入仅支持 .zip')
    const payload = await readFile(src)
    const { files } = explodeZipball(payload)
    const dir = locateSkillDir(files, undefined)
    tmp = await mkdtemp(join(tmpdir(), 'dsh-sm-'))
    const prefix = dir === '' ? '' : `${dir}/`
    for (const [rel, data] of Object.entries(files)) {
      if (!rel.startsWith(prefix)) continue
      const target = join(tmp, rel.slice(prefix.length))
      if (target.includes('__pycache__')) continue
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, data)
    }
    skillDir = tmp
  } else {
    if (!(await pathExists(join(src, 'SKILL.md')))) {
      throw new SkillManagerError('no-skill-md', `目录中未找到 SKILL.md: ${src}`)
    }
    skillDir = src
  }
  const installName = as || skillDir.split(/[\\/]/).pop()
  validateInstallName(installName)
  const dest = safePath(root, installName)
  if (await pathExists(dest)) {
    if (tmp) await rm(tmp, { recursive: true, force: true })
    throw new SkillManagerError('name-conflict', `${installName} 已存在，可用改名导入`)
  }
  await mkdir(dest, { recursive: true })
  await copyTree(skillDir, dest)
  if (tmp) await rm(tmp, { recursive: true, force: true })

  await store.putSkill(installName, {
    origin: 'local',
    repo: null,
    branch: null,
    commit: null,
    path_in_repo: null,
    // 本地 skill 无版本管理：不建立内容基线（content_hash 仅 github 更新门禁用）。
    content_hash: null,
    origin_path: src,
    installed_at: nowIso(),
  })
  const sync = await ctx.reconcile()
  return { name: installName, source: 'local', sync }
}

/** 出库（R-12）：备份 → 摘除物化 → 删除目录 → 删记录 → 清缓存。 */
export async function remove({ root, store, name, keepFiles, backupsRoot, ctx }) {
  const src = safePath(root, name)
  if (!(await pathExists(src))) throw new SkillManagerError('not-found', `库中不存在 skill: ${name}`)
  const record = store.getSkill(name) ?? null

  let backup = null
  if (!keepFiles) {
    const id = backupId(name)
    backup = join(backupsRoot, id)
    await mkdir(backup, { recursive: true })
    await copyTree(src, backup)
    const createdAt = nowIso()
    await writeFile(
      join(backup, '_backup_meta.json'),
      JSON.stringify({ name, record, created_at: createdAt }, null, 2),
      'utf8',
    )
    await store.putBackup(id, { name, created_at: createdAt })
  }

  const state = await loadState(store)
  const detached = []
  for (const rec of state.synced[name] ?? []) {
    if ((await detachOne(rec)) === 'removed') detached.push(targetKey(rec))
  }
  delete state.synced[name]
  await saveState(store, state)

  await rm(src, { recursive: true, force: true, maxRetries: 3 })
  if (record) await store.deleteSkill(name)

  // DSR-008：出库后清理检查缓存条目，避免残留状态。
  await store.deleteCheck(name)
  return { name, backup, detached }
}

/** 备份列表（R-12）：域登记 ∪ 备份目录实际内容。 */
export async function backups({ store, backupsRoot }) {
  let entries = []
  try {
    entries = await readdir(backupsRoot, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') entries = []
    else throw error
  }
  const registered = new Map(store.backupEntries())
  const out = []
  for (const entry of entries.filter((d) => d.isDirectory())) {
    let meta = {}
    try {
      meta = JSON.parse(await readFile(join(backupsRoot, entry.name, '_backup_meta.json'), 'utf8'))
    } catch {
      // 无元数据仍展示
    }
    const reg = registered.get(entry.name)
    out.push({
      id: entry.name,
      name: meta.name || reg?.name || entry.name,
      time: meta.created_at || reg?.created_at || '',
      has_meta: Boolean(meta.name),
    })
  }
  return out
}

/** 恢复（R-12）：备份必须在 backups 表登记且为备份目录直接子目录。 */
export async function restore({ root, store, id, backupsRoot, ctx }) {
  const registration = typeof id === 'string' && !id.includes('/') && !id.includes('\\') && id !== '.' && id !== '..'
    ? store.getBackup(id)
    : undefined
  if (!registration) throw new SkillManagerError('not-found', `备份不存在: ${id}`)
  const src = join(backupsRoot, id)
  if (!(await pathExists(src))) throw new SkillManagerError('not-found', `备份目录缺失: ${id}`)
  let meta = {}
  try {
    meta = JSON.parse(await readFile(join(src, '_backup_meta.json'), 'utf8'))
  } catch {
    // 无元数据
  }
  const name = meta.name || registration.name || id
  const dest = safePath(root, name)
  if (await pathExists(dest)) throw new SkillManagerError('name-conflict', `${name} 已存在，无法恢复`)
  await mkdir(dest, { recursive: true })
  await copyTree(src, dest)
  await rm(join(dest, '_backup_meta.json'), { force: true })

  // 恢复 github/local 记录（含基线；意图字段已废弃，组归属以配置为准）。
  // 无元数据或无记录的备份 = 本地文件恢复，不写登记（本地 skill 无版本管理）。
  const record = meta.record && typeof meta.record === 'object' ? { ...meta.record } : null
  delete record?.disabled
  delete record?.group
  if (record && record.origin !== 'self') {
    record.content_hash = record.content_hash ?? await dirHash(dest)
    await store.putSkill(name, record)
  }

  const sync = await ctx.reconcile()
  return { name, sync }
}
