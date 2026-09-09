// backups — 出库、备份列表与恢复：外部 skill 的离库、快照盘点与回库。
//
// 边界：备份事实源 = 备份目录 + _backup_meta.json，无登记表；出库一律自动备份。
// 本地 skill 无版本管理，不经插件入库，由用户在配置目录内自管目录。
// 参考：入站操作.md「remove」「restore」「backups 列表」；DSR-015。

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillManagerError } from '../base/errors.js'
import { atomicSwapDirAudited, canonicalPath, pathExists, pathsEqual, safePath } from '../base/fsys.js'
import { dirHash } from '../model/library.js'
import { backupId } from '../model/store.js'
import { scanMountLinks } from '../mount/inspect.js'
import { removeLink } from '../mount/materialize.js'
import { copyTree, nowIso, validateInstallName } from './zipball.js'

/**
 * 出库：仅限 origin:"github" 的外部 skill（双根制下落插件库根，DSR-020）。执行顺序不可交换：
 * 1. 备份整目录（missing 条目无物可备，backup=null）；
 * 2. 摘除该 name 的全部物化链接：归属判据单源扫描全局根与活动工作区根；
 *    指向 <root>/<name> 者删除，真实目录与其他链接一律不动；
 *    归属判据为双根并集（userRoot ∪ 插件库根），扫描范围与对账同口径；
 * 3. 删除库内目录；
 * 4. 删除 skills 登记与 check_cache 条目。
 * 不触碰 settings 意图（disabled/group 残留，日后入库自然落回原组）。
 * 任一步失败不回滚已完成步骤，错误消息携带已完成动作供展示。
 * @throws {SkillManagerError} not-removable — 非 github 登记（本地/自研无删除入口）
 */
export async function remove({ root, userRoot = null, store, name, backupsRoot, workspacesById, globalRootPath, piSkillsRoot = null, ctx = null }) {
  // 台账上下文：出库的四步（备份 / 摘链 / 删库内目录 / 清表）记在同一条因果链上。
  const audit = ctx?.audit ?? null
  const actor = ctx?.actor ?? null
  const configGen = ctx?.configGen ?? null // quality-floor: ignore docstring-promise 函数体确有 throw SkillManagerError（not-removable 等）；扫描器将参数解构花括号配误作函数体起点致漏看
  const record = store.getSkill(name) ?? null
  if (!record || record.origin !== 'github') {
    throw new SkillManagerError('not-removable', `「${name}」不是外部 skill（本地与自研目录无删除入口，请在文件系统自管）`, false, [
      { label: 'skill', value: name },
      { label: '库内路径', value: join(root, name) },
    ])
  }
  const src = safePath(root, name)
  const present = await pathExists(src)

  // 1. 备份：出库一律自动，无跳过选项。
  let backup = null
  if (present) {
    const id = backupId(name)
    backup = join(backupsRoot, id)
    // op 边界 = 备份目录建立到元数据落定（_backup_meta.json 是恢复与名字/时间的事实源，
    // 属用户可见现场，折进同一条记录而非逐文件成条）；回滚 rm 落在 fail 的 result 里。
    const op = audit === null ? null : await audit.begin({ op: 'backup-create', actor, skill: name, path: backup, reason: '出库前自动备份', configGen })
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
      await op?.fail(error, { result: 'rolled-back' })
      throw error
    }
    await op?.done({ result: 'created' })
  }

  // 2. 摘除全部物化链接：与对账同一归属判据，owned 链接中 realpath
  //    指向 <root>/<name> 者删除，真实目录与其他链接一律不动。
  const detached = []
  const srcCanonical = await canonicalPath(src)
  for (const link of await scanMountLinks({ root: userRoot ?? root, globalRootPath, workspacesById, piSkillsRoot, libraryRoot: root })) {
    if (link.owned && pathsEqual(link.target, srcCanonical)) {
      await removeLink({ path: link.path, audit, actor, skill: name, target: link.target, srcRoot: userRoot ?? root, reason: '出库摘链', configGen })
      detached.push(link.path)
    }
  }

  // 3. 删除库内目录（插件自行下载的外部 skill，属 C-03 允许的可写范围）。
  if (present) {
    const op = audit === null ? null : await audit.begin({ op: 'library-remove', actor, skill: name, path: src, srcRoot: root, reason: '出库删除库内目录（已自动备份）', configGen })
    try {
      await rm(src, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      await op?.fail(error)
      throw error
    }
    await op?.done({ result: 'removed' })
  }

  // 4. 两表清理。
  await store.deleteSkill(name)
  await store.deleteCheck(name)
  return { name, backup, detached }
}

/**
 * 备份列表：事实源 = 备份目录实际内容，逐个读 _backup_meta.json 补名称与时间。
 * 元数据三态分流：
 * - 缺失（ENOENT）→ 正常降级：has_meta=false，名字回退 id；
 * - 损坏/形状非法 → meta_corrupt=true，同样降级展示，恢复时由 restore 硬拒；
 * - 其余读取异常（权限等）→ 转码抛出 backup-meta-invalid，不静默。
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
 * 恢复：备份快照经原子换装从备份目录回库，完成后触发对账。
 * id = 不含路径分隔符的普通目录名，且目录实际存在（存在性只查文件系统）。
 * 元数据三态与 backups 同判据：缺失 = 本地恢复；损坏或不可读 = 硬拒。
 * 类型无法判定不静默恢复，避免把 github 快照悄悄恢复成无上游登记。
 * 就位时剥除 _backup_meta.json；目标已占位一律拒绝。
 * 有 record 的 github 快照按登记恢复，并剥除意图字段；content_hash 缺失时以恢复结果重算基线。
 * local/self/无记录 = 本地文件恢复，不写登记。
 * @throws {SkillManagerError} not-found — id 非法或备份目录不存在
 * @throws {SkillManagerError} bad-name — 回退推导名不满足安装名文法
 * @throws {SkillManagerError} backup-meta-invalid — 元数据存在但损坏/形状非法/不可读
 * @throws {SkillManagerError} name-conflict — 目标已占位
 * @throws {SkillManagerError} write-failed — 原子换装失败（fsys 层归类）
 * @throws {SkillManagerError} registration-failed — 已恢复就位但登记写入失败（现场与台账不一致）
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
      // 无元数据 = 本地文件恢复（契约规定路径，不是错误）
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
  await atomicSwapDirAudited(dest, async (stage) => {
    await copyTree(src, stage)
    await rm(join(stage, '_backup_meta.json'), { force: true })
  }, {
    audit: ctx?.audit ?? null,
    actor: ctx?.actor ?? null,
    skill: name,
    srcRoot: root,
    reason: `从备份恢复（id=${id}）`,
    configGen: ctx?.configGen ?? null,
  })

  const record = meta.record && typeof meta.record === 'object' ? { ...meta.record } : null
  delete record?.disabled
  delete record?.group
  if (record && record.origin === 'github') {
    record.content_hash = record.content_hash ?? await dirHash(dest)
    // 换装已成功、登记失败不能静默：目录已回库而台账无记录，必须显式失败。
    try {
      await store.putSkill(name, record)
    } catch (error) {
      throw new SkillManagerError('registration-failed', `${name} 已从备份恢复但登记失败：${error instanceof Error ? error.message : String(error)}`, false, [
        { label: '库内路径', value: dest },
        { label: '备份 id', value: id },
      ])
    }
  }

  const sync = await ctx.reconcile()
  return { name, sync }
}
