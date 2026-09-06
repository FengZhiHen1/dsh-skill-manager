// dsh-skill-manager — 出库、备份与恢复（入站操作.md；DSR-015 inbound 层；
// DSR-017：备份事实源 = 备份目录 + _backup_meta.json（无登记表）；remove 一律
// 自动备份（keepFiles 与本地导入端点一并废止——本地 skill 无版本管理，在
// 配置目录内自管目录即可，不经插件入库）。

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillManagerError } from '../base/errors.js'
import { atomicSwapDir, canonicalPath, pathsEqual, safePath } from '../base/fsys.js'
import { dirHash } from '../model/library.js'
import { backupId } from '../model/store.js'
import { scanMountLinks } from '../mount/inspect.js'
import { removeLink } from '../mount/materialize.js'
import { copyTree, nowIso, pathExists, validateInstallName } from './zipball.js'

/**
 * 出库（入站操作.md「remove」）：仅限 origin:"github"。执行顺序不可交换：
 * 1. 备份整目录（missing 条目无物可备，backup=null）；
 * 2. 摘除该 name 的全部物化链接（归属判据单源扫描全局根与活动工作区根，
 *    指向 <root>/<name> 者删除；真实目录与其他链接一律不动）；
 * 3. 删除库内目录；
 * 4. 删除 skills 登记与 check_cache 条目。
 * 不触碰 settings 意图（disabled/group 残留，日后入库自然落回原组）。
 * 任一步失败不回滚已完成步骤；错误消息携带已完成动作供展示（DSR-018 facts 归 P5）。
 * @throws {SkillManagerError} not-removable — 非 github 登记（本地/自研无删除入口）
 */
export async function remove({ root, store, name, backupsRoot, workspacesById, globalRootPath }) { // quality-floor: ignore docstring-promise 函数体确有 throw SkillManagerError（not-removable 等）；扫描器将参数解构花括号配误作函数体起点致漏看
  const record = store.getSkill(name) ?? null
  if (!record || record.origin !== 'github') {
    throw new SkillManagerError('not-removable', `「${name}」不是外部 skill（本地与自研目录无删除入口，请在文件系统自管）`, false, [
      { label: 'skill', value: name },
      { label: '库内路径', value: join(root, name) },
    ])
  }
  const src = safePath(root, name)
  const present = await pathExists(src)

  // 1. 备份（一律自动，keepFiles 选项随本地导入一并废止）。
  let backup = null
  if (present) {
    const id = backupId(name)
    backup = join(backupsRoot, id)
    await mkdir(backup, { recursive: true })
    try {
      await copyTree(src, backup)
      await writeFile(
        join(backup, '_backup_meta.json'),
        JSON.stringify({ name, record, created_at: nowIso() }, null, 2),
        'utf8',
      )
    } catch (error) {
      await rm(backup, { recursive: true, force: true })
      throw error
    }
  }

  // 2. 摘除全部物化链接（与对账同一归属判据：owned 链接中 realpath 指向
  //    <root>/<name> 者删除；真实目录与其他链接一律不动）。
  const detached = []
  const srcCanonical = await canonicalPath(src)
  for (const link of await scanMountLinks({ root, globalRootPath, workspacesById })) {
    if (link.owned && pathsEqual(link.target, srcCanonical)) {
      await removeLink(link.path)
      detached.push(link.path)
    }
  }

  // 3. 删除库内目录（插件自行下载的外部 skill，属 C-03 允许的可写范围）。
  if (present) await rm(src, { recursive: true, force: true, maxRetries: 3 })

  // 4. 两表清理。
  await store.deleteSkill(name)
  await store.deleteCheck(name)
  return { name, backup, detached }
}

/**
 * 备份列表（入站操作.md）：事实源 = 备份目录实际内容（无登记表，DSR-017）；
 * 逐个读 _backup_meta.json 补名称与时间。元数据三态分流：缺失（ENOENT）= 正常
 * 降级（has_meta=false，名字回退 id）；损坏/形状非法 = meta_corrupt=true 同样降级
 * 展示（恢复时由 restore 硬拒）；其余读取异常（权限等）抛出转码，不静默。
 * @throws {SkillManagerError} backup-meta-invalid — 元数据读取异常（非缺失、非损坏）
 */
export async function backups({ backupsRoot }) { // quality-floor: ignore docstring-promise 函数体确有 throw SkillManagerError（backup-meta-invalid）；扫描器将参数解构花括号配误作函数体起点致漏看
  let entries = []
  try {
    entries = await readdir(backupsRoot, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') entries = []
    else throw error
  }
  const out = []
  for (const entry of entries.filter((d) => d.isDirectory())) {
    let meta = {}
    let metaCorrupt = false
    try {
      const parsed = JSON.parse(await readFile(join(backupsRoot, entry.name, '_backup_meta.json'), 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) metaCorrupt = true
      else meta = parsed
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        // 无元数据：按目录名回退（契约内降级）
      } else if (error instanceof SyntaxError) {
        metaCorrupt = true // 损坏：列表降级展示，恢复路径硬拒（restore 同判据）
      } else {
        throw new SkillManagerError('backup-meta-invalid', `读取备份 ${entry.name} 元数据失败：${error instanceof Error ? error.message : String(error)}`, false, [
          { label: '备份目录', value: join(backupsRoot, entry.name) },
        ])
      }
    }
    out.push({
      id: entry.name,
      name: typeof meta.name === 'string' && meta.name !== '' ? meta.name : entry.name.replace(/-\d{8,}T?[\d.]*Z?$/, ''),
      time: typeof meta.created_at === 'string' ? meta.created_at : '',
      has_meta: typeof meta.name === 'string' && meta.name !== '',
      meta_corrupt: metaCorrupt,
    })
  }
  return out
}

/**
 * 恢复（入站操作.md「restore」）：id = 不含路径分隔符的普通目录名且目录实际存在
 * （登记存在性检查随 backups 表一并删除）；目标占位拒绝；原子换装就位（剥除
 * _backup_meta.json）；有 record 的 github 快照按登记恢复（剥除意图字段，
 * content_hash 缺失时以恢复结果重算基线）；local/self/无记录 = 本地文件恢复，
 * 不写登记。完成后触发对账。
 * 元数据三态与 backups 同判据：缺失 = 本地恢复；损坏/不可读 = 硬拒（类型无法
 * 判定不静默恢复，避免把 github 快照悄悄恢复成无上游登记）。
 * @throws {SkillManagerError} not-found — id 非法或备份目录不存在
 * @throws {SkillManagerError} bad-name — 回退推导名不满足安装名文法
 * @throws {SkillManagerError} backup-meta-invalid — 元数据存在但损坏/形状非法/不可读
 * @throws {SkillManagerError} name-conflict — 目标已占位
 * @throws {SkillManagerError} write-failed — 原子换装失败（fsys 层归类）
 */
export async function restore({ root, store, id, backupsRoot, ctx }) { // quality-floor: ignore docstring-promise 函数体确有 throw SkillManagerError（not-found/backup-meta-invalid 等）；扫描器将参数解构花括号配误作函数体起点致漏看
  if (typeof id !== 'string' || id === '' || id.includes('/') || id.includes('\\') || id === '.' || id === '..') {
    throw new SkillManagerError('not-found', `非法备份 id: ${id}`, false, [{ label: '备份 id', value: String(id) }])
  }
  const src = join(backupsRoot, id)
  if (!(await pathExists(src))) throw new SkillManagerError('not-found', `备份目录不存在: ${id}`, false, [{ label: '期望的备份路径', value: src }])
  let meta = {}
  try {
    const parsed = JSON.parse(await readFile(join(src, '_backup_meta.json'), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SkillManagerError('backup-meta-invalid', `备份 ${id} 的 _backup_meta.json 顶层形状非法，无法判定恢复类型`, false, [
        { label: '备份目录', value: src },
      ])
    }
    meta = parsed
  } catch (error) {
    if (error instanceof SkillManagerError) throw error
    if (error && error.code === 'ENOENT') {
      // 无元数据 = 本地文件恢复（入站操作.md 契约内路径）
    } else {
      throw new SkillManagerError('backup-meta-invalid', `备份 ${id} 的 _backup_meta.json 不可用（损坏或读取失败），无法判定恢复类型：${error instanceof Error ? error.message : String(error)}`, false, [
        { label: '备份目录', value: src },
      ])
    }
  }
  const name = typeof meta.name === 'string' && meta.name !== '' ? meta.name : id.replace(/-\d{8,}T?[\d.]*Z?$/, '')
  validateInstallName(name)
  const dest = safePath(root, name)
  if (await pathExists(dest)) {
    throw new SkillManagerError('name-conflict', `${name} 已存在，无法恢复`, false, [
      { label: '目标路径', value: dest },
      { label: '备份 id', value: id },
    ])
  }

  // 原子换装恢复：备份内容在同卷临时位置就位（剥元数据）后 rename 到目标。
  await atomicSwapDir(dest, async (stage) => {
    await copyTree(src, stage)
    await rm(join(stage, '_backup_meta.json'), { force: true })
  })

  const record = meta.record && typeof meta.record === 'object' ? { ...meta.record } : null
  delete record?.disabled
  delete record?.group
  if (record && record.origin === 'github') {
    record.content_hash = record.content_hash ?? await dirHash(dest)
    await store.putSkill(name, record)
  }

  const sync = await ctx.reconcile()
  return { name, sync }
}
