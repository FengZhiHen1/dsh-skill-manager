// dsh-skill-manager — 只读走查与归属判据单源（挂载与同步.md「归属判据」「行状态走查」；
// DSR-015 mount 层；DSR-017：判据由 findOrphanLinks 单源承载，对账摘除、remove
// 摘除与行状态走查三处共用；独立健康视图已废止，走查即行状态）。
//
// 不变式：本模块全部只读，不修改任何文件。工作区从注册表消失后其根不在扫描
// 范围内，既有现场保持原样（R-12 仅报告）。

import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { canonicalPath, pathsEqual, readLinkTarget, withinRoot } from '../base/fsys.js'
import { targetDir, targetKey } from './derive.js'
import { isLink } from './materialize.js'

/** 安装名文法（C-01；不满足者 DSH 不可见，行级提示）。 */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 对账/走查/摘除的扫描根：全局根 + 当前活动工作区根（仅此二者，失效工作区不在列）。 */
export function scanRoots({ workspacesById, globalRootPath }) {
  const roots = []
  if (typeof globalRootPath === 'string' && globalRootPath !== '') roots.push(globalRootPath)
  for (const ws of workspacesById.values()) roots.push(join(ws.path, '.dsh', 'skills'))
  return roots
}

/**
 * 扫描全部链接现场（只读）：返回 [{ path, name, parent, target, owned }]。
 * owned = 归属判据成立：realpath（悬挂链接以 readlink 原始目标兜底）落在
 * 当前配置目录内（带路径分隔符边界，`skills-sibling` 不算）。“改配另一目录
 * 后旧链接不在新前缀内” → owned=false → 保留为孤儿，永不清理（AC-10）。
 */
export async function scanMountLinks({ root, globalRootPath, workspacesById }) {
  const repoRoot = await canonicalPath(root)
  const links = []
  for (const dir of scanRoots({ globalRootPath, workspacesById })) {
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
        owned: target !== '' && withinRoot(repoRoot, target),
      })
    }
  }
  return links
}

/** 期望目标的路径全集（小写键，Windows 不区分大小写）。 */
function desiredPathSet(desired, { workspacesById, globalRootPath }) {
  const set = new Set()
  for (const [skill, targets] of desired) {
    for (const t of targets) {
      const parent = targetDir(t, { workspacesById, globalRootPath })
      if (parent !== undefined) set.add(resolve(join(parent, skill)).toLowerCase())
    }
  }
  return set
}

/**
 * 归属判据单源（挂载与同步.md「归属判据」）：扫描根下 owned（指向当前配置
 * 目录）且不在期望集内的链接。三处共用——
 * - 对账摘除：reconcile 对返回值逐个 removeLink（摘除与孤儿清扫同一步）；
 * - remove 摘除：调用方按 `target === <root>/<name>` 过滤后摘除；
 * - 行状态走查：walkMountState 借同一现场集判定。
 */
export async function findOrphanLinks({ root, desired, globalRootPath, workspacesById, links }) {
  const all = links ?? (await scanMountLinks({ root, globalRootPath, workspacesById }))
  const expected = desiredPathSet(desired, { workspacesById, globalRootPath })
  return all.filter((l) => l.owned && !expected.has(resolve(l.path).toLowerCase()))
}

/**
 * 行状态走查（挂载与同步.md「行状态走查」）：只读，与对账共用期望推导与
 * 扫描原语。每个期望目标判定其一：
 * ok | link-missing（期望位置不存在）| target-occupied（真实目录，含旧版
 * copy 遗留与遮蔽现场）| wrong-target（链接指向对应源之外——含库内他处，
 * 后者对账可自检修复，走查只报告）。
 * @returns {Map<string, Array<{ target: string, path: string, issue: string }>>}
 */
export async function walkMountState({ root, desired, links, globalRootPath, workspacesById }) {
  const linksByPath = new Map(links.map((l) => [resolve(l.path).toLowerCase(), l]))
  const rows = new Map()
  for (const [skill, targets] of desired) {
    const issues = []
    const expectedSrc = await canonicalPath(join(root, skill))
    for (const t of targets) {
      const parent = targetDir(t, { workspacesById, globalRootPath })
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

/**
 * health 端点薄壳（临时：端点随 P3 删除，行状态职责由 walkMountState 经
 * overview 承载）。把走查问题映射为旧 issues 形状，不再含台账/接管分类。
 */
export async function health({ root, desired, globalRootPath, workspacesById }) {
  const links = await scanMountLinks({ root, globalRootPath, workspacesById })
  const rows = await walkMountState({ root, desired, links, globalRootPath, workspacesById })
  const issues = []
  for (const [name, list] of rows) {
    for (const row of list) issues.push({ name, target: row.target, issue: row.issue })
  }
  for (const l of findOrphanLinks({ desired, globalRootPath, workspacesById, links })) {
    issues.push({ name: l.name, target: l.path, issue: 'orphan-link' })
  }
  return issues
}

/** 项目 .dsh/skills 条目分类（临时保留：project-skills/claim-empty 端点随 P3 删除）。 */
export async function classifyProjectEntries(root, projectPath) {
  const entries = []
  const base = join(projectPath, '.dsh', 'skills')
  let dirs = []
  try {
    dirs = await readdir(base, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return { entries: [], base }
    throw error
  }
  for (const entry of dirs) {
    const full = join(base, entry.name)
    if (await isLink(full)) {
      const target = await readLinkTarget(full)
      const expected = await canonicalPath(join(root, entry.name))
      entries.push({
        name: entry.name,
        kind: target !== '' && pathsEqual(target, expected) ? 'managed-ok' : 'wrong-target',
      })
      continue
    }
    let info
    try {
      info = await lstat(full)
    } catch {
      continue
    }
    if (!info.isDirectory()) continue
    entries.push({ name: entry.name, kind: 'local-foreign' })
  }
  return { entries, base }
}
