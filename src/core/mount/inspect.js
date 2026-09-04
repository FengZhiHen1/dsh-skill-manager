// dsh-skill-manager — 只读走查（挂载与同步.md「健康检查」「项目级既有条目」；DSR-015 mount 层）。
// 自原 lib/sync.js 搬位（P1，逻辑未动）。SKILL_NAME 随 health 迁入本文件（临时，
// 文法收口与端点删除在 P3/P5）。

import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { canonicalPath, readLinkTarget, withinRoot } from '../base/fsys.js'
import { deriveDesired, isLegacyProjectRecord, linkLocations, targetDirOf, targetKey } from './derive.js'
import { isLink } from './materialize.js'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 项目 .dsh/skills 条目分类（挂载与同步.md 项目级既有条目）。 */
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
      let target = ''
      try {
        target = await realpath(full)
      } catch {
        target = ''
      }
      const expected = await canonicalPath(join(root, entry.name))
      entries.push({
        name: entry.name,
        kind: target !== '' && target.toLowerCase() === expected.toLowerCase() ? 'managed-ok' : 'wrong-target',
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
    const hasSkillMd = await fileExists(join(full, 'SKILL.md'))
    if (hasSkillMd) {
      entries.push({ name: entry.name, kind: 'local-skill' })
    } else if (await isEmptyDir(full)) {
      entries.push({ name: entry.name, kind: 'local-empty' })
    } else {
      entries.push({ name: entry.name, kind: 'local-foreign' })
    }
  }
  // 配置目录中存在而项目中不存在的 skill：external-skill（只读展示，永不纳管）
  let skills = []
  try {
    skills = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch {
    // 配置目录缺失视为空
  }
  for (const name of skills) {
    if (!entries.some((e) => e.name === name)) entries.push({ name, kind: 'external-skill' })
  }
  return { entries, base }
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function isEmptyDir(path) {
  try {
    return (await readdir(path)).length === 0
  } catch {
    return false
  }
}

/** 健康检查（只读，挂载与同步.md 健康检查）。 */
export async function health({ root, state, apps, groups, skills, mounts, workspaceIds, globalRootPath }) {
  const derived = deriveDesired({ state, apps, groups, skills, mounts, workspaceIds })
  const { desired, legacyProjectIds } = derived
  const activeIds = derived.workspaceIds
  const issues = []

  // 未匹配遗留项目只报告、从不扫描或触碰其目录。
  for (const project of legacyProjectIds) {
    issues.push({ name: project, target: state.projects[project], issue: 'workspace-unmatched' })
  }

  // 先跑活动工作区的项目既有条目分类；避免与 target-exists/wrong-target 重复报告。
  const projectKinds = new Map() // `${project}|${name}` → kind
  for (const workspaceId of activeIds) {
    const ppath = state.projects[workspaceId]
    if (typeof ppath !== 'string') continue
    const { entries } = await classifyProjectEntries(root, ppath)
    for (const entry of entries) {
      if (entry.kind === 'local-empty' || entry.kind === 'local-skill' || entry.kind === 'local-foreign' || entry.kind === 'wrong-target') {
        projectKinds.set(`${workspaceId}|${entry.name}`, entry.kind)
        issues.push({ name: entry.name, target: `dsh|project|${workspaceId}`, issue: entry.kind })
      }
    }
  }
  for (const [name, targets] of desired) {
    for (const t of targets) {
      const parent = targetDirOf(state, apps, t, activeIds, globalRootPath)
      const key = targetKey(t)
      if (parent === undefined) {
        issues.push({ name, target: key, issue: 'project-missing' })
        continue
      }
      if (t.scope === 'project' && projectKinds.has(`${t.project}|${name}`)) continue
      const dst = join(parent, name)
      if (!(await isLink(dst))) {
        try {
          await lstat(dst)
          issues.push({ name, target: key, issue: 'target-exists' })
        } catch {
          issues.push({ name, target: key, issue: 'missing-link' })
        }
        continue
      }
      let target = ''
      try {
        target = await realpath(dst)
      } catch {
        target = ''
      }
      const expected = await canonicalPath(join(root, name))
      if (target.toLowerCase() !== expected.toLowerCase()) {
        issues.push({ name, target: key, issue: 'wrong-target' })
      }
    }
  }
  for (const [name, records] of Object.entries(state.synced)) {
    if (!Array.isArray(records)) continue
    const want = new Set([...desired.get(name) ?? []].map(targetKey))
    for (const record of records) {
      if (!isLegacyProjectRecord(state, record, activeIds) && !want.has(targetKey(record))) {
        issues.push({ name, target: targetKey(record), issue: 'extra-link' })
      }
    }
  }
  const desiredPaths = new Set()
  for (const [name, targets] of desired) {
    for (const t of targets) {
      const parent = targetDirOf(state, apps, t, activeIds, globalRootPath)
      if (parent !== undefined) desiredPaths.add(resolve(join(parent, name)).toLowerCase())
    }
  }
  const repoRoot = await canonicalPath(root)
  for (const loc of linkLocations(state, activeIds, globalRootPath)) {
    let entries = []
    try {
      entries = await readdir(loc, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(loc, entry.name)
      if (!(await isLink(full))) continue
      const target = await readLinkTarget(full)
      if (target !== '' && withinRoot(repoRoot, target) && !desiredPaths.has(resolve(full).toLowerCase())) {
        issues.push({ name: entry.name, target: full, issue: 'orphan-link' })
      }
    }
  }
  for (const name of skills) {
    if (!SKILL_NAME.test(name)) issues.push({ name, target: '', issue: 'dsh-invisible-name' })
  }
  return issues
}
