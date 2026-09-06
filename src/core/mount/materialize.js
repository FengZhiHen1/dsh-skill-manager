// materialize — junction 物化与摘除：在库与挂载根之间建链、拆链两个动作。
//
// 边界：对全局根与工作区根只创建/删除 junction，永不触碰真实目录。
// 双根制（DSR-020）：root 为 skill 所在源根（github→插件库根，其余→用户根），
// 归属判据的库内范围 = 源根 ∪ libraryRoot（自检重建与摘除共用）。
// 失败即报「挂载失败」，无 copy 降级；非链接内容只入行状态，不做处置。
// 参考：挂载与同步.md「物化」「失败语义」；需求.md C-03/C-04 与 DSR-015/017。

import { lstat, mkdir, rm, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillManagerError } from '../base/errors.js'
import { canonicalPath, pathsEqual, probePath, readLinkTarget, safePath, withinRoot } from '../base/fsys.js'
import { targetDir } from './derive.js'

/** 是否为链接（junction 在 lstat 下也是 symlink；探针原语在 fsys.probePath）。 */
export async function isLink(path) {
  return (await probePath(path)) === 'link'
}

/** 删除一个链接（本插件自有现场；非链接一律不走此函数——调用方先过归属判据）。 */
export async function removeLink(path) {
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
 * libraryRoot 仅供归属判据的库内并集（自检重建），缺省 null = 单根。
 * 返回 { action: 'ok' | 'mounted' }；失败抛 SkillManagerError
 * （no-skill-md / target-occupied / wrong-target / junction 创建失败的原始错误）。
 */
export async function materializeOne({ root, skill, t, workspacesById, globalRootPath, piSkillsRoot = null, libraryRoot = null }) {
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
  await mkdir(parent, { recursive: true })
  const dst = join(parent, skill)

  if (await isLink(dst)) {
    const target = await readLinkTarget(dst)
    const expected = await canonicalPath(src)
    if (pathsEqual(target, expected)) return { action: 'ok' }
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
    await removeLink(dst)
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

  await symlink(src, dst, process.platform === 'win32' ? 'junction' : 'dir')
  return { action: 'mounted' }
}

/**
 * 摘除一个 (skill, target) 的物化链接：仅当 dst 是链接且按归属判据
 * （realpath/readlink 目标落在库内并集：用户根 ∪ libraryRoot）属于本插件时删除；
 * 真实目录与库外链接一律不动。返回 'removed' | 'absent' | 'kept'。
 */
export async function detachLink({ root, skill, t, workspacesById, globalRootPath, piSkillsRoot = null, libraryRoot = null }) {
  const parent = targetDir(t, { workspacesById, globalRootPath, piSkillsRoot })
  if (parent === undefined) return 'kept' // 目标根不可用：不扫描不触碰
  const dst = join(parent, skill)
  const probe = await probePath(dst)
  if (probe !== 'link') return probe === 'absent' ? 'absent' : 'kept'
  const target = await readLinkTarget(dst)
  const owned = target !== '' && (withinRoot(await canonicalPath(root), target)
    || (libraryRoot !== null && withinRoot(await canonicalPath(libraryRoot), target)))
  if (!owned) return 'kept'
  await removeLink(dst)
  return 'removed'
}
