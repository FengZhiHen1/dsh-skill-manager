// materialize — junction 物化与摘除：在库与挂载根之间建链、拆链两个动作。
//
// 边界：对全局根与工作区根只创建/删除 junction，永不触碰真实目录。
// 双根制（DSR-020）：root 为 skill 所在源根（github→插件库根，其余→用户根），
// 归属判据的库内范围 = 源根 ∪ libraryRoot（自检重建与摘除共用）。
// 失败即报「挂载失败」，无 copy 降级；非链接内容只入行状态，不做处置。
// 审计（DSR-022）：本模块是链接变更的唯一咽喉点，op 边界 = 函数边界（一次建链/一次摘链各一条，
//   removeLink 内部的 rm 兜底重试不分别成条）；幂等 ok 不落条，由批次 summary 承载。
// 参考：挂载与同步.md「物化」「失败语义」「审计台账」；需求.md C-03/C-04 与 DSR-015/017/022。

import { lstat, mkdir, rm, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillManagerError } from '../base/errors.js'
import { canonicalPath, pathsEqual, probePath, readLinkTarget, safePath, withinRoot } from '../base/fsys.js'
import { targetDir } from './derive.js'

/** 是否为链接（junction 在 lstat 下也是 symlink；探针原语在 fsys.probePath）。 */
export async function isLink(path) {
  return (await probePath(path)) === 'link'
}

/**
 * 链接台账里的 target 归一：readlink 可能给出空串（fsys.readLinkTarget 的失败回退）、
 * 相对路径或 Windows 8.3 短名，直接入台账会让「按 target 反查谁建的链」误判。
 * 优先 realpath；悬空链接 realpath 失败时退回 resolve（保留可比较的绝对形态）。
 * 返回 null 表示「目标未知」，不写空串——空串在 grep 里与「无值」难区分。
 */
export async function auditTarget(value) {
  if (typeof value !== 'string' || value === '') return null
  try {
    return await canonicalPath(value)
  } catch {
    return null // 悬空或不可解析：目标未知由调用方的 op 类型自证（link-remove 时链接已不在现场）
  }
}

/**
 * 删除一个链接（本插件自有现场；非链接一律不走此函数——调用方先过归属判据）。
 * ctx 缺省 = 不记台账（供无台账上下文复用，如单测与 B 案前的旧路径）。
 * @param {object} args
 * @param {string} args.path - 待删除的链接绝对路径
 * @param {object|null} [args.audit] - 台账写入器（core/base/audit.js createAudit 产物）
 * @param {object|null} [args.actor] - 归因入口 {entry, method}
 * @param {string|null} [args.skill] - 条目名
 * @param {string|null} [args.reason] - 摘除判据（如「孤儿链接（归属本插件且不在期望集）」）
 * @param {string|null} [args.target] - 摘除前的链接目标（本函数内归一）
 * @param {string|null} [args.srcRoot] - 归属源根
 * @param {number|null} [args.configGen] - 配置代次
 */
export async function removeLink({ path, audit = null, actor = null, skill = null, reason = null, target = null, srcRoot = null, configGen = null } = {}) {
  if (audit === null) return rmLinkOnly(path)
  const op = await audit.begin({ op: 'link-remove', actor, skill, path, target: await auditTarget(target), srcRoot, reason, configGen })
  try {
    await rmLinkOnly(path)
  } catch (error) {
    await op.fail(error)
    throw error
  }
  await op.done({ result: 'removed' })
}

/** 摘除动作本体：一次边界，两条 rm（junction 兜底 rmdir 语义）不分别成条。 */
async function rmLinkOnly(path) {
  try {
    await rm(path, { recursive: false, force: true })
  } catch {
    // Windows 上 junction 偶尔需要 rmdir 语义；rm 已覆盖，这里兜底重试
    await rm(path, { recursive: true, force: true })
  }
}

/**
 * 物化一个 (skill, target)：只建 junction。
 * root = 该 skill 的源根（双根制下由调用方按来源分流：github→插件库根，其余→用户根）；
 * libraryRoot 仅供归属判据的库内并集（自检重建）。
 * audit/actor/configGen 为台账上下文，缺省 = 不记。
 * 返回 { action: 'ok' | 'mounted' }；失败抛 SkillManagerError
 * （no-skill-md / target-occupied / wrong-target / junction 创建失败的原始错误）。
 */
export async function materializeOne({ root, skill, t, workspacesById, globalRootPath, piSkillsRoot = null, libraryRoot = null, audit = null, actor = null, configGen = null }) {
  const src = safePath(root, skill)
  try {
    const info = await stat(join(src, 'SKILL.md'))
    if (!info.isFile()) throw new SkillManagerError('no-skill-md', `${skill} 缺少 SKILL.md，拒绝同步`, false, [{ label: '库内条目', value: src }])
  } catch (error) {
    if (error instanceof SkillManagerError) throw error
    if (error && error.code === 'ENOENT') throw new SkillManagerError('no-skill-md', `${skill} 缺少 SKILL.md，拒绝同步`, false, [{ label: '库内条目', value: src }])
    throw error
  }
  const parent = targetDir(t, { workspacesById, globalRootPath, piSkillsRoot })
  if (parent === undefined) {
    throw new SkillManagerError('workspace-unavailable', `目标根不可用: ${t.host ?? 'dsh'}:${t.project ?? 'global'}`, true, [
      { label: '挂载规则引用的目标', value: `${t.host ?? 'dsh'}:${t.project ?? 'global'}` },
      { label: 'skill', value: skill },
    ])
  }
  // 父目录只在「真的建了」时落一条单段记录（mkdir recursive 对已存在目录是 no-op，
  // Node 以返回值告知首个新建目录）——稳态对账因此不产噪音行。
  const created = await mkdir(parent, { recursive: true })
  if (typeof created === 'string' && created !== '' && audit !== null) {
    await audit.note({ op: 'mount-dir-create', actor, path: created, skill, reason: '挂载根父目录不存在，随物化建立', configGen })
  }
  const dst = join(parent, skill)

  if (await isLink(dst)) {
    const target = await readLinkTarget(dst)
    const expected = await canonicalPath(src)
    if (pathsEqual(target, expected)) return { action: 'ok' } // 已就位：幂等 ok 不入台账，由 summary 计数
    // 指向库内他处（如改名后的旧链接）：按归属判据摘除重建（自检修复）；
    // 库内 = 源根 ∪ 插件库根（双根并集，与 inspect.js 同一判据）。
    // 指向库外的链接非本插件所有：报告，不夺取。
    const owned = withinRoot(await canonicalPath(root), target)
      || (libraryRoot !== null && withinRoot(await canonicalPath(libraryRoot), target))
    if (!owned) {
      throw new SkillManagerError('wrong-target', `目标已存在指向库外的链接，不夺取: ${dst}`, false, [
        { label: '目标路径', value: dst },
        { label: '该链接现指向', value: target },
      ])
    }
    await removeLink({ path: dst, audit, actor, skill, target, srcRoot: root, reason: '自检重建（链接指向库内他处）', configGen })
  } else {
    try {
      await lstat(dst)
      // 目标已是真实目录：本插件只建 junction，真实目录必非我方所建。
      // 按「挂载失败·目标被占用」报告，永不覆盖或删除。
      throw new SkillManagerError('target-occupied', `目标已被真实目录占用（含旧版本 copy 遗留），本插件不触碰: ${dst}`, false, [
        { label: '目标路径', value: dst },
        { label: '期望链接的库内条目', value: src },
      ])
    } catch (error) {
      if (error instanceof SkillManagerError) throw error
      if (!(error && error.code === 'ENOENT')) throw error
      // 空闲：下方建链。
    }
  }

  const linkTarget = await auditTarget(src)
  const op = audit === null
    ? null
    : await audit.begin({ op: 'link-create', actor, skill, path: dst, target: linkTarget, srcRoot: root, reason: '期望集物化', configGen })
  try {
    await symlink(src, dst, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    await op?.fail(error)
    throw error
  }
  await op?.done({ result: 'mounted' })
  return { action: 'mounted' }
}

/**
 * 摘除一个 (skill, target) 的物化链接：仅当 dst 是链接且按归属判据
 * （realpath/readlink 目标落在库内并集：用户根 ∪ libraryRoot）属于本插件时删除；
 * 真实目录与库外链接一律不动。返回 'removed' | 'absent' | 'kept'。
 */
export async function detachLink({ root, skill, t, workspacesById, globalRootPath, piSkillsRoot = null, libraryRoot = null, audit = null, actor = null, configGen = null }) {
  const parent = targetDir(t, { workspacesById, globalRootPath, piSkillsRoot })
  if (parent === undefined) return 'kept' // 目标根不可用：不扫描不触碰
  const dst = join(parent, skill)
  const probe = await probePath(dst)
  if (probe !== 'link') return probe === 'absent' ? 'absent' : 'kept'
  const target = await readLinkTarget(dst)
  const owned = target !== '' && (withinRoot(await canonicalPath(root), target)
    || (libraryRoot !== null && withinRoot(await canonicalPath(libraryRoot), target)))
  if (!owned) return 'kept'
  await removeLink({ path: dst, audit, actor, skill, target, srcRoot: root, reason: '显式摘除（detachLink）', configGen })
  return 'removed'
}
