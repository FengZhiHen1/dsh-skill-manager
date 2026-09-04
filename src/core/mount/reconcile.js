// dsh-skill-manager — 对账编排（挂载与同步.md 对账流程；DSR-015 mount 层）。
// 自原 lib/sync.js 搬位（P1，逻辑未动）：摘除 → 孤儿清扫 → 物化 → Git exclude → 写回 state。

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { canonicalPath, readLinkTarget, withinRoot } from '../base/fsys.js'
import { deriveDesired, isLegacyProjectRecord, linkLocations, targetDirOf, targetKey } from './derive.js'
import { detachOne, isLink, materializeOne, removeLink, updateGitExcludes } from './materialize.js'

/** 孤儿清扫：仅扫描全局根与当前活动工作区，绝不触碰未匹配遗留项目。 */
export async function orphanSweep({ root, state, apps, desired, results, workspaceIds, globalRootPath }) {
  const desiredPaths = new Set()
  for (const [name, targets] of desired) {
    for (const t of targets) {
      const parent = targetDirOf(state, apps, t, workspaceIds, globalRootPath)
      if (parent !== undefined) desiredPaths.add(resolve(join(parent, name)).toLowerCase())
    }
  }
  const repoRoot = await canonicalPath(root)
  for (const loc of linkLocations(state, workspaceIds, globalRootPath)) {
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
      // 别人的链接，不动；归属判据带路径边界（skills-sibling 不算库内）。
      if (target === '' || !withinRoot(repoRoot, target)) continue
      if (desiredPaths.has(resolve(full).toLowerCase())) continue // 配置需要，保留
      await removeLink(full)
      results.push({ name: entry.name, target: full, action: 'removed', reason: '孤儿链接' })
    }
  }
}

/** 全量对账（挂载与同步.md 对账流程）：摘除多余 → 孤儿清扫 → 物化期望 → git exclude → 写 state。 */
export async function reconcile({ root, state, apps, groups, skills, mounts, method = 'auto', save, workspaceIds, globalRootPath }) {
  const derived = deriveDesired({ state, apps, groups, skills, mounts, workspaceIds })
  const { desired, warnings } = derived
  const activeIds = derived.workspaceIds
  const results = []

  // 1. 非期望 synced 记录摘除；未匹配遗留工作区只保护既有记录，绝不静默摘链。
  for (const [name, records] of Object.entries(state.synced)) {
    if (!Array.isArray(records)) continue
    const want = new Set([...desired.get(name) ?? []].map(targetKey))
    const kept = []
    for (const rec of records) {
      if (isLegacyProjectRecord(state, rec, activeIds) || (want.has(targetKey(rec)) && desired.has(name))) {
        kept.push(rec)
        continue
      }
      const action = await detachOne(rec)
      results.push({ name, target: targetKey(rec), action })
    }
    state.synced[name] = kept
  }

  // 2. 孤儿清扫只遍历活动工作区。
  await orphanSweep({ root, state, apps, desired, results, workspaceIds: activeIds, globalRootPath })

  // 3. 物化活动期望。
  for (const [name, targets] of desired) {
    for (const t of targets) {
      const key = targetKey(t)
      const records = state.synced[name] ?? (state.synced[name] = [])
      const existing = records.find((x) => targetKey(x) === key)
      try {
        const r = await materializeOne({ root, state, apps, skill: name, t, method, existingRec: existing, workspaceIds: activeIds, globalRootPath })
        const parent = targetDirOf(state, apps, t, activeIds, globalRootPath)
        const rec = { ...t, method: r.method, dir: parent === undefined ? null : join(parent, name), at: new Date().toISOString() }
        if (r.hash !== undefined) rec.hash = r.hash
        state.synced[name] = [...state.synced[name].filter((x) => targetKey(x) !== key), rec]
        results.push({ name, target: key, action: r.action, method: r.method })
      } catch (error) {
        results.push({ name, target: key, action: 'error', error: error.message })
      }
    }
  }

  // 4. Git exclude 仅更新活动工作区。
  await updateGitExcludes(state, apps, activeIds)

  // 5. 写回 state。
  await save(state)

  const errors = results.filter((r) => r.action === 'error')
  return { results, warnings, errors }
}
