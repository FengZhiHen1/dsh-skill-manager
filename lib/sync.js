// dsh-skill-manager — 挂载与同步（mount-sync.md）。
// 语义基线：distributor sync.py（v3.1 组挂载模型），仅管理 app=dsh。
// 安全边界：源必须含 SKILL.md；链接只删链接；真实目录仅当 synced 记录为本插件
// copy 时才替换；孤儿清扫只处理 realpath 落在「配置车间根/skills/」内的链接。

import { mkdir, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { lstat } from 'node:fs/promises'
import { cp } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { WorkshopError } from './errors.js'
import { workshopPath } from './workshop.js'
import { globalRoot, projectRootOf } from './state.js'

const EXCLUDE_BEGIN = '# >>> dsh-skill-manager'
const EXCLUDE_END = '# <<< dsh-skill-manager'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const targetKey = (t) => `${t.app}|${t.scope}|${t.project ?? ''}`

/** realpath 规范化（8.3 短路径问题），失败回退 resolve。 */
async function canonicalPath(path) {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/** 目标挂载点父目录（dsh 全局根或项目根）；项目路径缺失返回 undefined。 */
export function targetDirOf(state, apps, t) {
  if (t.app !== 'dsh') return undefined
  if (t.scope === 'global') return globalRoot()
  const root = projectRootOf(state, t.project ?? '')
  if (root === undefined) return undefined
  const app = apps.dsh
  if (!app || typeof app.project_dir !== 'string') return undefined
  return resolve(root)
}

/** 挂载推导：{skill -> [target]} + warnings（mount-sync.md 挂载推导）。 */
export function deriveDesired({ state, apps, groups, skills }) {
  const warnings = []
  const out = new Map()
  const groupOf = new Map()
  for (const [group, members] of Object.entries(groups)) {
    for (const m of members) groupOf.set(m, group)
  }
  for (const skill of skills) {
    const gname = groupOf.get(skill) ?? '默认'
    const targets = []
    for (const m of state.mounts) {
      if (m.group !== gname) continue
      const app = m.app
      if (app !== 'dsh' || !apps[app] || apps[app].enabled === false) {
        warnings.push(`挂载引用的 App 未启用或不存在: ${app}（组 ${gname}）`)
        continue
      }
      if (m.scope === 'project' && !(m.project in state.projects)) {
        warnings.push(`挂载引用的项目未注册: ${m.project}（组 ${gname}）`)
        continue
      }
      const t = { app, scope: m.scope, project: m.scope === 'project' ? m.project : null }
      if (!targets.some((x) => targetKey(x) === targetKey(t))) targets.push(t)
    }
    out.set(skill, targets)
  }
  return { desired: out, warnings: [...new Set(warnings)] }
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

/** 物化一个 (skill, target)；返回 {action, method} 或抛错。 */
export async function materializeOne({ root, state, apps, skill, t, method = 'auto', existingRec }) {
  const src = workshopPath(root, join('skills', skill))
  try {
    const info = await stat(join(src, 'SKILL.md'))
    if (!info.isFile()) throw new Error(`skills/${skill} 缺少 SKILL.md，拒绝同步`)
  } catch (error) {
    if (error instanceof WorkshopError) throw error
    if (error && error.code === 'ENOENT') throw new Error(`skills/${skill} 缺少 SKILL.md，拒绝同步`)
    throw error
  }
  const parent = targetDirOf(state, apps, t)
  if (parent === undefined) throw new Error(`项目路径缺失: ${t.project}`)
  await mkdir(parent, { recursive: true })
  const dst = join(parent, skill)

  if (await isLink(dst)) {
    let target
    try {
      target = await realpath(dst)
    } catch {
      target = ''
    }
    if (target === (await realpath(src))) return { action: 'ok', method: 'junction' }
    await removeLink(dst) // 指向错误 → 重建（链接自检修复）
  } else {
    try {
      await lstat(dst)
      // 本插件此前的 copy 副本 → 替换；否则拒绝覆盖
      if (existingRec && existingRec.method === 'copy') {
        await removeTree(dst)
      } else {
        throw new WorkshopError('target-exists', `目标已存在真实目录且非本插件管理: ${dst}`)
      }
    } catch (error) {
      if (error instanceof WorkshopError) throw error
      if (!(error && error.code === 'ENOENT')) throw error
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
  return { action: 'synced', method: used }
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
    try {
      const info = await lstat(dst)
      if (info.isDirectory()) {
        await removeTree(dst)
        return 'removed'
      }
    } catch {
      return 'absent'
    }
  }
  return 'kept'
}

/** 维护项目 .git/info/exclude 托管块（mount-sync.md 对账流程第 4 步）。 */
export async function updateGitExcludes(state, apps) {
  const perProject = new Map()
  for (const records of Object.values(state.synced)) {
    for (const rec of records) {
      if (rec.scope === 'project' && rec.project && rec.app in apps) {
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

/** 所有可能存在本插件链接的父目录（dsh 全局根 + 各注册项目根）。 */
function linkLocations(state) {
  const dirs = [globalRoot()]
  for (const name of Object.keys(state.projects)) {
    const root = projectRootOf(state, name)
    if (root !== undefined) dirs.push(root)
  }
  return dirs
}

/** 孤儿清扫：dsh 根下 realpath 落在「配置车间根/skills/」内且不在期望集的链接。 */
export async function orphanSweep({ root, state, apps, desired, results }) {
  const desiredPaths = new Set()
  for (const [name, targets] of desired) {
    for (const t of targets) {
      const parent = targetDirOf(state, apps, t)
      if (parent !== undefined) desiredPaths.add(resolve(join(parent, name)).toLowerCase())
    }
  }
  const repoPrefix = (await canonicalPath(join(root, 'skills'))).toLowerCase()
  for (const loc of linkLocations(state)) {
    let entries = []
    try {
      entries = await readdir(loc, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(loc, entry.name)
      if (!(await isLink(full))) continue
      let target
      try {
        target = await realpath(full)
      } catch {
        continue
      }
      if (!target.toLowerCase().startsWith(repoPrefix)) continue // 别人的链接，不动
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
      const expected = await canonicalPath(join(root, 'skills', entry.name))
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
  // 车间中存在而项目中不存在的 skill：external-skill（只读展示，永不纳管）
  let skills = []
  try {
    skills = (await readdir(join(root, 'skills'), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch {
    // 车间 skills/ 缺失视为空
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
export async function reconcile({ root, state, apps, groups, skills, method = 'auto', save }) {
  const { desired, warnings } = deriveDesired({ state, apps, groups, skills })
  const results = []

  // 1. synced 记录已不在期望集 → 摘除
  for (const [name, records] of Object.entries(state.synced)) {
    const want = new Set([...desired.get(name) ?? []].map(targetKey))
    const kept = []
    for (const rec of records) {
      if (want.has(targetKey(rec)) && desired.has(name)) {
        kept.push(rec)
        continue
      }
      const action = await detachOne(rec)
      results.push({ name, target: targetKey(rec), action })
    }
    state.synced[name] = kept
  }

  // 2. 孤儿清扫
  await orphanSweep({ root, state, apps, desired, results })

  // 3. 物化期望
  for (const [name, targets] of desired) {
    for (const t of targets) {
      const key = targetKey(t)
      const records = state.synced[name] ?? (state.synced[name] = [])
      const existing = records.find((x) => targetKey(x) === key)
      try {
        const r = await materializeOne({ root, state, apps, skill: name, t, method, existingRec: existing })
        const parent = targetDirOf(state, apps, t)
        const rec = { ...t, method: r.method, dir: parent === undefined ? null : join(parent, name) }
        state.synced[name] = [...state.synced[name].filter((x) => targetKey(x) !== key), rec]
        results.push({ name, target: key, action: r.action, method: r.method })
      } catch (error) {
        results.push({ name, target: key, action: 'error', error: error.message })
      }
    }
  }

  // 4. git exclude 托管块
  await updateGitExcludes(state, apps)

  // 5. 写回 state
  await save(state)

  const errors = results.filter((r) => r.action === 'error')
  return { results, warnings, errors }
}

/** 健康检查（只读，mount-sync.md 健康检查）。 */
export async function health({ root, state, apps, groups, skills }) {
  const { desired } = deriveDesired({ state, apps, groups, skills })
  const issues = []
  for (const [name, targets] of desired) {
    for (const t of targets) {
      const parent = targetDirOf(state, apps, t)
      const key = targetKey(t)
      if (parent === undefined) {
        issues.push({ name, target: key, issue: 'project-missing' })
        continue
      }
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
      const expected = await canonicalPath(join(root, 'skills', name))
      if (target.toLowerCase() !== expected.toLowerCase()) {
        issues.push({ name, target: key, issue: 'wrong-target' })
      }
    }
  }
  for (const [name, records] of Object.entries(state.synced)) {
    const want = new Set([...desired.get(name) ?? []].map(targetKey))
    for (const rec of records) {
      if (!want.has(targetKey(rec))) issues.push({ name, target: targetKey(rec), issue: 'extra-link' })
    }
  }
  const desiredPaths = new Set()
  for (const [name, targets] of desired) {
    for (const t of targets) {
      const parent = targetDirOf(state, apps, t)
      if (parent !== undefined) desiredPaths.add(resolve(join(parent, name)).toLowerCase())
    }
  }
  const repoPrefix = (await canonicalPath(join(root, 'skills'))).toLowerCase()
  for (const loc of linkLocations(state)) {
    let entries = []
    try {
      entries = await readdir(loc, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(loc, entry.name)
      if (!(await isLink(full))) continue
      let target = ''
      try {
        target = await realpath(full)
      } catch {
        continue
      }
      if (target.toLowerCase().startsWith(repoPrefix) && !desiredPaths.has(resolve(full).toLowerCase())) {
        issues.push({ name: entry.name, target: full, issue: 'orphan-link' })
      }
    }
  }
  for (const name of skills) {
    if (!SKILL_NAME.test(name)) {
      issues.push({ name, target: '', issue: 'dsh-invisible-name' })
    }
  }
  // 项目既有条目的 local-* 现场（mount-sync.md 健康表；只读分类，永不自动修改）
  for (const [pname, ppath] of Object.entries(state.projects)) {
    const { entries } = await classifyProjectEntries(root, ppath)
    for (const e of entries) {
      if (e.kind === 'local-empty' || e.kind === 'local-skill' || e.kind === 'local-foreign') {
        issues.push({ name: e.name, target: `dsh|project|${pname}`, issue: e.kind })
      }
    }
  }
  return issues
}

/** 同步矩阵（R-14）：行 = skill，列 = dsh 全局 + 各注册项目。 */
export async function matrix({ root, state, apps, groups, skills, projectEntries }) {
  const { desired } = deriveDesired({ state, apps, groups, skills })
  const columns = [
    { kind: 'global', key: 'dsh|global|', label: 'dsh 全局' },
    ...Object.keys(state.projects).map((name) => ({ kind: 'project', key: `dsh|project|${name}`, label: name })),
  ]
  const cells = {}
  for (const [skill, targets] of desired) {
    for (const t of targets) {
      const key = targetKey(t)
      cells[`${skill}\u0000${key}`] = '期望'
    }
  }
  const rows = skills.map((skill) => ({
    name: skill,
    cells: columns.map((col) => {
      const want = cells[`${skill}\u0000${col.key}`] === '期望'
      if (!want) {
        // 项目本地同名 SKILL.md 遮蔽（mount-sync.md 遮蔽语义）
        if (col.kind === 'project') {
          const entry = projectEntries?.[col.label]?.entries.find((e) => e.name === skill)
          if (entry?.kind === 'local-skill') return { state: 'shadowed' }
        }
        return { state: '不适用' }
      }
      const entry = col.kind === 'project' ? projectEntries?.[col.label]?.entries.find((e) => e.name === skill) : undefined
      if (col.kind === 'project' && entry?.kind === 'local-skill') return { state: 'shadowed' }
      if (entry && entry.kind !== 'managed-ok') return { state: '错误' }
      return { state: '生效' }
    }),
  }))
  return { columns, rows }
}
