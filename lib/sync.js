// dsh-skill-manager — 挂载与同步（mount-sync.md）。
// 仅管理 app=dsh。安全边界：源必须含 SKILL.md；链接只删链接，且仅当有 synced
// 记录证明归属或链接目标落在配置目录内时才重建（不夺取指向他处的链接）；
// 真实目录仅当 synced 记录为本插件 copy 且内容哈希未被改动时才替换/摘除；
// 孤儿清扫只处理目标落在配置目录内（带路径边界）的链接。

import { mkdir, readdir, readFile, realpath, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { lstat } from 'node:fs/promises'
import { cp } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { SkillManagerError } from './errors.js'
import { safePath } from './dir.js'
import { dirHash } from './library.js'
import { globalRoot, projectRootOf } from './state.js'

const EXCLUDE_BEGIN = '# >>> dsh-skill-manager'
const EXCLUDE_END = '# <<< dsh-skill-manager'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const targetKey = (t) => `${t.app}|${t.scope}|${t.project ?? ''}`

/** 未显式传入时保留旧的纯函数调用语义；Host API 始终传入本次 workspaceRegistry 投影。 */
function activeWorkspaceIds(state, workspaceIds) {
  if (workspaceIds instanceof Set) return workspaceIds
  if (Array.isArray(workspaceIds)) return new Set(workspaceIds)
  return new Set(Object.keys(state.projects ?? {}))
}

function isLegacyProjectRecord(state, record, workspaceIds) {
  return record?.scope === 'project'
    && typeof record.project === 'string'
    && typeof state.projects?.[record.project] === 'string'
    && !workspaceIds.has(record.project)
}

/** realpath 规范化（8.3 短路径问题），失败回退 resolve。 */
async function canonicalPath(path) {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/** 路径相等判断：Windows 不区分大小写。空串永不相等。 */
function pathsEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * target 是否严格位于 root 之内。带路径分隔符边界：`skills-sibling/x`
 * 这类共享字符串前缀的兄弟路径不算在内（relative 结果不以 .. 逃逸为准）。
 */
export function withinRoot(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string' || root === '' || target === '') return false
  let r = resolve(root)
  let t = resolve(target)
  if (process.platform === 'win32') {
    r = r.toLowerCase()
    t = t.toLowerCase()
  }
  const rel = relative(r, t)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * 读取链接目标：realpath 优先；悬挂链接（目标已删除）回退 readlink 取原始
 * 目标串（剥除 Windows verbatim 前缀），供归属判断使用。全部失败返回 ''。
 */
export async function readLinkTarget(path) {
  try {
    return await realpath(path)
  } catch {
    try {
      const raw = await readlink(path)
      return raw.replace(/^\\\\\?\\/, '')
    } catch {
      return ''
    }
  }
}

/** 目标挂载点父目录（dsh 全局根或项目根）；项目路径缺失返回 undefined。 */
export function targetDirOf(state, apps, t, workspaceIds, globalRootPath) {
  if (t.app !== 'dsh') return undefined
  if (t.scope === 'global') return globalRootPath ?? globalRoot()
  if (!activeWorkspaceIds(state, workspaceIds).has(t.project ?? '')) return undefined
  const root = projectRootOf(state, t.project ?? '')
  if (root === undefined) return undefined
  const app = apps.dsh
  if (!app || typeof app.project_dir !== 'string') return undefined
  return resolve(root)
}

/** 挂载推导：{skill -> [target]} + warnings（mount-sync.md 挂载推导）。 */
export function deriveDesired({ state, apps, groups, skills, mounts, workspaceIds }) {
  const warnings = []
  const out = new Map()
  const activeIds = activeWorkspaceIds(state, workspaceIds)
  const legacyProjectIds = new Set(Object.keys(state.projects ?? {}).filter((project) => !activeIds.has(project)))
  const groupOf = new Map()
  for (const [group, members] of Object.entries(groups)) {
    for (const m of members) groupOf.set(m, group)
  }
  for (const skill of skills) {
    const gname = groupOf.get(skill) ?? '默认'
    const targets = []
    for (const m of mounts ?? []) {
      if (m.group !== gname) continue
      const app = m.app
      if (app !== 'dsh' || !apps[app] || apps[app].enabled === false) {
        warnings.push(`挂载引用的 App 未启用或不存在: ${app}（组 ${gname}）`)
        continue
      }
      if (m.scope === 'project' && !activeIds.has(m.project)) {
        const label = legacyProjectIds.has(m.project) ? '未匹配工作区' : '不存在的工作区'
        warnings.push(`挂载引用${label}: ${m.project}（组 ${gname}）`)
        continue
      }
      const t = { app, scope: m.scope, project: m.scope === 'project' ? m.project : null }
      if (!targets.some((x) => targetKey(x) === targetKey(t))) targets.push(t)
    }
    out.set(skill, targets)
  }
  return { desired: out, warnings: [...new Set(warnings)], legacyProjectIds, workspaceIds: activeIds }
}

/** 是否为链接（junction 在 lstat 下也是 symlink）。 */
export async function isLink(path) {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch {
    return false
  }
}

async function removeLink(path) {
  try {
    await rm(path, { recursive: false, force: true })
  } catch {
    // Windows 上 junction 偶尔需要 rmdir 语义；rm 已覆盖，这里兜底重试
    await rm(path, { recursive: true, force: true })
  }
}

async function removeTree(path) {
  await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

/** 物化一个 (skill, target)；返回 {action, method, hash?} 或抛错。 */
export async function materializeOne({ root, state, apps, skill, t, method = 'auto', existingRec, workspaceIds, globalRootPath }) {
  const src = safePath(root, skill)
  try {
    const info = await stat(join(src, 'SKILL.md'))
    if (!info.isFile()) throw new Error(`${skill} 缺少 SKILL.md，拒绝同步`)
  } catch (error) {
    if (error instanceof SkillManagerError) throw error
    if (error && error.code === 'ENOENT') throw new Error(`${skill} 缺少 SKILL.md，拒绝同步`)
    throw error
  }
  const parent = targetDirOf(state, apps, t, workspaceIds, globalRootPath)
  if (parent === undefined) throw new Error(`工作区路径缺失或已移除: ${t.project}`)
  await mkdir(parent, { recursive: true })
  const dst = join(parent, skill)

  if (await isLink(dst)) {
    const target = await readLinkTarget(dst)
    const expected = await canonicalPath(src)
    if (pathsEqual(target, expected)) return { action: 'ok', method: 'junction' }
    // 指向错误：仅当 synced 记录证明本插件此前在此物化（自检修复），或链接
    // 目标落在配置目录内（与孤儿清扫同一归属判据）时才删除重建；指向他处
    // 且无记录的链接视为他人现场，拒绝夺取。
    const owned = existingRec !== undefined || withinRoot(await canonicalPath(root), target)
    if (!owned) {
      throw new SkillManagerError('target-exists', `目标已存在指向他处的链接且非本插件管理: ${dst}`)
    }
    await removeLink(dst)
  } else {
    let dstInfo = null
    try {
      dstInfo = await lstat(dst)
    } catch (error) {
      if (!(error && error.code === 'ENOENT')) throw error
    }
    if (dstInfo) {
      // 本插件此前的 copy 副本且内容未被改动（哈希与记录一致）→ 替换；
      // 无哈希的旧记录或已被改动的目录按非托管真实目录拒绝覆盖。
      if (existingRec && existingRec.method === 'copy' && typeof existingRec.hash === 'string'
        && (await dirHash(dst)) === existingRec.hash) {
        await removeTree(dst)
      } else {
        throw new SkillManagerError('target-exists', `目标已存在真实目录且非本插件管理（或内容已被改动）: ${dst}`)
      }
    }
  }

  let used = method
  if (method === 'auto' || method === 'junction') {
    try {
      await symlink(src, dst, process.platform === 'win32' ? 'junction' : 'dir')
      used = 'junction'
    } catch (error) {
      if (method === 'junction') throw error
      await cp(src, dst, { recursive: true })
      used = 'copy'
    }
  } else {
    await cp(src, dst, { recursive: true })
    used = 'copy'
  }
  // copy 副本记录内容哈希：之后仅未改动的 copy 才允许被替换/摘除（mount-sync.md）。
  const hash = used === 'copy' ? await dirHash(dst) : undefined
  return { action: 'synced', method: used, hash }
}

/** 摘除一个 synced 记录对应的物化；返回 absent/removed/kept。 */
export async function detachOne(rec) {
  const dst = rec.dir
  if (typeof dst !== 'string' || dst === '') return 'absent'
  if (!(await isLink(dst))) {
    try {
      await lstat(dst)
    } catch {
      return 'absent'
    }
  }
  if (await isLink(dst)) {
    await removeLink(dst)
    return 'removed'
  }
  if (rec.method === 'copy') {
    let info
    try {
      info = await lstat(dst)
    } catch {
      return 'absent'
    }
    // 仅删除内容未被改动的本插件 copy（哈希与记录一致）；无哈希的旧记录
    // 或已被用户改动的目录一律保留，防止误删非插件内容。
    if (info.isDirectory() && typeof rec.hash === 'string' && (await dirHash(dst)) === rec.hash) {
      await removeTree(dst)
      return 'removed'
    }
  }
  return 'kept'
}

/** 维护项目 .git/info/exclude 托管块（mount-sync.md 对账流程第 4 步）。 */
export async function updateGitExcludes(state, apps, workspaceIds) {
  const perProject = new Map()
  const activeIds = activeWorkspaceIds(state, workspaceIds)
  for (const records of Object.values(state.synced)) {
    if (!Array.isArray(records)) continue
    for (const rec of records) {
      if (rec.scope === 'project' && rec.project && activeIds.has(rec.project) && rec.app in apps) {
        const projPath = state.projects[rec.project]
        if (projPath) {
          const set = perProject.get(projPath) ?? new Set()
          set.add(apps[rec.app].project_dir)
          perProject.set(projPath, set)
        }
      }
    }
  }
  for (const [proj, dirs] of perProject) {
    const excludeFile = join(proj, '.git', 'info', 'exclude')
    let text = ''
    try {
      text = await readFile(excludeFile, 'utf8')
    } catch {
      continue // 非 Git 项目跳过
    }
    // 清除旧托管块
    while (text.includes(EXCLUDE_BEGIN) && text.includes(EXCLUDE_END)) {
      const pre = text.split(EXCLUDE_BEGIN, 1)[0]
      const rest = text.slice(text.indexOf(EXCLUDE_BEGIN) + EXCLUDE_BEGIN.length)
      const post = rest.slice(rest.indexOf(EXCLUDE_END) + EXCLUDE_END.length)
      text = pre.replace(/\n+$/, '') + '\n' + post.replace(/^\n+/, '')
    }
    const block = EXCLUDE_BEGIN + '\n' + [...dirs].sort().map((d) => `/${d}/`).join('\n') + '\n' + EXCLUDE_END
    const next = text.replace(/\n+$/, '') + '\n\n' + block + '\n'
    if (next !== text) {
      await writeFile(excludeFile, next, 'utf8')
    }
  }
}

/** 所有可由普通对账触碰的父目录（dsh 全局根 + 当前活动工作区根）。 */
function linkLocations(state, workspaceIds, globalRootPath) {
  const dirs = [globalRootPath ?? globalRoot()]
  for (const workspaceId of activeWorkspaceIds(state, workspaceIds)) {
    const root = projectRootOf(state, workspaceId)
    if (root !== undefined) dirs.push(root)
  }
  return dirs
}

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

/** 项目 .dsh/skills 条目分类（mount-sync.md 项目级既有条目）。 */
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

/** 全量对账（mount-sync.md 对账流程）：摘除多余 → 孤儿清扫 → 物化期望 → git exclude → 写 state。 */
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

/** 健康检查（只读，mount-sync.md 健康检查）。 */
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
