// inspect — 只读走查与归属判据单源：扫描链接现场、判定孤儿链接、产出行状态。
//
// 边界：全部只读，不修改任何文件；无独立健康视图，行状态即走查结果。
// 扫描：工作区从注册表消失后其根不在列，其下既有链接与目录不作处置、只报告。
// 参考：挂载与同步.md「归属判据」「行状态走查」；DSR-015、DSR-017。

import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { canonicalPath, pathsEqual, readLinkTarget, withinRoot } from '../base/fsys.js'
import { targetDir, targetKey } from './derive.js'
import { isLink } from './materialize.js'

/** 安装名文法（C-01；不满足者 DSH 不可见，行级提示）。 */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 对账/走查/摘除的扫描根：DSH 全局根 + 活动工作区的 .dsh/skills（失效工作区不在列）。
 * pi 接管激活（piSkillsRoot 非空）时追加 pi 用户级根与各工作区 .pi/skills；
 * 未激活时 pi 侧零扫描，行为与单宿主一致。
 */
export function scanRoots({ workspacesById, globalRootPath, piSkillsRoot = null }) {
  const roots = []
  if (typeof globalRootPath === 'string' && globalRootPath !== '') roots.push(globalRootPath)
  const piActive = typeof piSkillsRoot === 'string' && piSkillsRoot !== ''
  if (piActive) roots.push(piSkillsRoot)
  for (const ws of workspacesById.values()) {
    roots.push(join(ws.path, '.dsh', 'skills'))
    if (piActive) roots.push(join(ws.path, '.pi', 'skills'))
  }
  return roots
}

/**
 * 扫描全部链接现场（只读）：返回 [{ path, name, parent, target, owned }]。
 * owned = realpath（悬挂链接以 readlink 原始目标兜底）落在库内并集（用户根 ∪ libraryRoot，
 * 双根制 DSR-020；带路径分隔符边界，`skills-sibling` 不算）。
 * **owned 只是摘除的下界，不是摘除权**（DSR-022 第 10 条）；摘除权另需 managed_links 命中，
 * 见 findOrphanLinks。“改配另一目录后旧链接不在新前缀内” → owned=false → 一律保留（AC-10）。
 */
export async function scanMountLinks({ root, globalRootPath, workspacesById, piSkillsRoot = null, libraryRoot = null }) {
  const canonicalGuards = [await canonicalPath(root)]
  if (typeof libraryRoot === 'string' && libraryRoot !== '') canonicalGuards.push(await canonicalPath(libraryRoot))
  const links = []
  for (const dir of scanRoots({ globalRootPath, workspacesById, piSkillsRoot })) {
    let entries = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue // 根不存在或不可读：跳过（物化时按需创建）
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (!(await isLink(full))) continue
      const target = await readLinkTarget(full)
      links.push({
        path: full,
        name: entry.name,
        parent: dir,
        target,
        owned: target !== '' && canonicalGuards.some((guard) => withinRoot(guard, target)),
      })
    }
  }
  return links
}

/** 期望目标的路径全集（小写键，Windows 不区分大小写）。 */
function desiredPathSet(desired, { workspacesById, globalRootPath, piSkillsRoot }) {
  const set = new Set()
  for (const [skill, targets] of desired) {
    for (const t of targets) {
      const parent = targetDir(t, { workspacesById, globalRootPath, piSkillsRoot })
      if (parent !== undefined) set.add(resolve(join(parent, skill)).toLowerCase())
    }
  }
  return set
}

/**
 * 可认领集（DSR-022 第 11 条，R9 收窄口径）：前缀自有 **且已在期望集内** 且未登记的链接。
 * 「且在期望集内」是硬约束而非省事：若把不在期望集的前缀自有链接一并收编，它们下一趟就会
 * 被判成自有孤儿摘除——而其中可能正有别的实例指向共享配置目录建的链接，09-08 事故原样重演。
 * 表已有登记时整体不触发（registry.size()>0 由调用方判定），本函数只回答「能认领谁」。
 */
export async function findAdoptableLinks({ root, desired, globalRootPath, workspacesById, piSkillsRoot = null, libraryRoot = null, links, registry }) {
  if (registry === null || !registry.available) return []
  const all = links ?? (await scanMountLinks({ root, globalRootPath, workspacesById, piSkillsRoot, libraryRoot }))
  const expected = desiredPathSet(desired, { workspacesById, globalRootPath, piSkillsRoot })
  return all.filter((l) => l.owned && expected.has(resolve(l.path).toLowerCase()) && !registry.has(l.path))
}

/**
 * 未登记残留的报告面（DSR-022 第 10/13 条；文案单源，读面 bundle 与写面对账共用）：
 * 前缀像我们的、表里没有、且配置也不再要求它 —— 本插件既不摘（无登记）也不认领（认领只收期望内），
 * 所以必须报条数，否则用户只看到"配置里没有它、页面上还挂着"而无从解释。
 * 登记表不可读时改报「不可读」一条（第 13 条第一分支）：看不见表就不猜条数。
 */
export function describeUnmanagedLinks({ links, registry, desired, workspacesById, globalRootPath, piSkillsRoot = null }) {
  if (registry === null) return []
  if (!registry.available) {
    return ['挂载归属登记表不可读：本趟不摘除、不认领任何链接（仍按期望集建链）。请检查 storage 域 skill_manager']
  }
  const expected = desiredPathSet(desired, { workspacesById, globalRootPath, piSkillsRoot })
  const count = links.filter((l) => l.owned && !registry.has(l.path) && !expected.has(resolve(l.path).toLowerCase())).length
  return count > 0
    ? [`有 ${count} 条指向库内的链接不在本实例归属登记内（可能由其他实例或手工所建），本插件不会摘除它们`]
    : []
}

/**
 * 归属判据单源：**两重否决同时成立**才算孤儿（DSR-022 第 10 条）——
 * ① owned：realpath 前缀落在当前配置根 ∪ 插件库根（**下界**，护住 AC-10「改配另一目录后旧挂载保留」
 *    与「不夺取他人」两件事，它不再单独授予摘除权）；
 * ② registered：managed_links 命中（**授权**，证明是本 HOME 建的）；
 * ③ 且不在期望集内。
 * registered 为 null（登记表缺席或不可读）→ 返回空集：宁可残留，绝不据前缀猜所有权。
 * 三处共用：
 * - 对账摘除：reconcile 对返回值逐个 removeLink（摘除与孤儿清扫同一步）；
 * - 行状态走查：借同一现场集判定。
 * 例外：**出库（remove）摘链不走本函数**——它是用户指名操作且只删指向本次被删库目录的链接
 * （留着就是悬空 junction），按 target 精确匹配摘除（R9 记录该收窄）。
 */
export async function findOrphanLinks({ root, desired, globalRootPath, workspacesById, piSkillsRoot = null, libraryRoot = null, links, registered = null }) {
  if (registered === null) return []
  const all = links ?? (await scanMountLinks({ root, globalRootPath, workspacesById, piSkillsRoot, libraryRoot }))
  const expected = desiredPathSet(desired, { workspacesById, globalRootPath, piSkillsRoot })
  return all.filter((l) => l.owned && registered.has(l.path) && !expected.has(resolve(l.path).toLowerCase()))
}

/**
 * 行状态走查：只读，与对账共用期望推导与扫描原语；每个期望目标判定其一：
 * - link-missing — 期望位置不存在；
 * - target-occupied — 期望位置是真实目录，非本插件所建，一律不触碰只报告；
 * - wrong-target — 链接指向对应源之外，库内他处对账可自检修复，走查仅报告。
 * 无异常的 skill 不入结果（即全部 ok）。
 * @returns {Map<string, Array<{ target: string, path: string, issue: string }>>}
 */
export async function walkMountState({ root, desired, links, globalRootPath, workspacesById, piSkillsRoot = null, srcRootOf = null }) {
  const linksByPath = new Map(links.map((l) => [resolve(l.path).toLowerCase(), l]))
  const rows = new Map()
  for (const [skill, targets] of desired) {
    const issues = []
    // 源根按来源分流（github→插件库根，其余→用户根）；srcRootOf 缺省 = 全量用户根（单根兼容）
    const srcRoot = srcRootOf ? srcRootOf(skill) : root
    const expectedSrc = await canonicalPath(join(srcRoot, skill))
    for (const t of targets) {
      const parent = targetDir(t, { workspacesById, globalRootPath, piSkillsRoot })
      const key = targetKey(t)
      if (parent === undefined) {
        issues.push({ target: key, path: '', issue: 'link-missing' })
        continue
      }
      const dst = join(parent, skill)
      const link = linksByPath.get(resolve(dst).toLowerCase())
      if (link === undefined) {
        let exists = true
        try {
          await lstat(dst)
        } catch {
          exists = false
        }
        issues.push({ target: key, path: dst, issue: exists ? 'target-occupied' : 'link-missing' })
      } else if (!pathsEqual(link.target, expectedSrc)) {
        issues.push({ target: key, path: dst, issue: 'wrong-target' })
      }
    }
    if (issues.length > 0) rows.set(skill, issues)
  }
  return rows
}
