// dsh-skill-manager — 入站操作（inbound-operations.md；语义基线 distributor fetch.py）。
// 覆盖：skills.sh 搜索、仓库探测、add/check/update、本地导入、出库/备份恢复、禁用启用。

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { cp } from 'node:fs/promises'
import { WorkshopError } from './errors.js'
import { workshopPath } from './workshop.js'
import { commitPaths, logHash } from './git.js'
import { unzip } from './zip.js'
import { dirHash, loadLock, parseSkillMd, saveLock, SKILLS_REL, DISABLED_REL } from './library.js'
import { removeMember, setMembership, DEFAULT_GROUP } from './groups.js'
import { saveGroups } from './groups.js'
import { loadCheckCache, saveCheckCache, saveState } from './state.js'
import { detachOne, reconcile } from './sync.js'
import { targetKey } from './sync.js'
import { fetchZipball, ghApi, normalizeRepoSlug, remoteHead, resolveRemote, searchSkillsSh } from './net.js'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function validateInstallName(name) {
  if (!SKILL_NAME.test(name)) {
    throw new WorkshopError('bad-name', `非法安装名: ${name}（小写字母/数字/连字符）`)
  }
}

/** 本地时区时间戳 YYYYMMDD-HHMMSS（与 distributor CLI 的 CST 展示一致）。 */
function localStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function nowIso() {
  return new Date().toISOString()
}

/** zipball 字节 → {顶层目录名, 文件: {相对路径: Buffer}}。 */
function explodeZipball(payload) {
  const files = unzip(payload)
  const tops = new Set()
  for (const name of Object.keys(files)) {
    const top = name.split('/')[0]
    if (top !== '' && !name.endsWith('/')) tops.add(top)
  }
  if (tops.size !== 1) throw new WorkshopError('bad-zipball', 'zipball 结构异常：顶层目录不唯一')
  const top = [...tops][0]
  const out = {}
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(`${top}/`) || name.endsWith('/')) continue
    const rel = name.slice(top.length + 1)
    if (rel.split('/').includes('.git')) continue
    // 防解包逃逸：拒绝绝对路径、盘符前缀与 .. / . 段（恶意 zip 可任意写文件）
    if (rel === '' || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').some((part) => part === '..' || part === '.')) {
      throw new WorkshopError('bad-zipball', `zipball 含不安全路径条目: ${rel}`)
    }
    out[rel] = data
  }
  return { top, files: out }
}

/** 目录树中全部 SKILL.md 候选（path 为空串表示仓库根即 skill）。 */
function skillsFromFiles(files) {
  const hits = []
  for (const rel of Object.keys(files)) {
    const parts = rel.split('/')
    if (parts[parts.length - 1] !== 'SKILL.md') continue
    const dir = parts.slice(0, -1).join('/')
    hits.push(dir === '' ? '' : dir)
  }
  return [...new Set(hits)].sort()
}

function skillsFromTree(tree) {
  const dirs = new Set()
  for (const node of tree) {
    if (node.type !== 'blob') continue
    const p = node.path ?? ''
    if (p === 'SKILL.md') dirs.add('')
    else if (p.endsWith('/SKILL.md')) dirs.add(p.slice(0, -('/SKILL.md').length))
  }
  return [...dirs].sort().map((d) => ({ path: d, name: d === '' ? '' : d.split('/').pop() }))
}

/**
 * 定位 skill 目录（fetch.py _locate_skill_dir 语义）。
 * @param {boolean} strict - true 时指定子目录未命中直接报 path-stale（update 用，
 *   防止上游重构后静默装错 skill）；false 回退自动探测（add/repo-skills 用）。
 */
function locateSkillDir(files, subdir, strict = false) {
  const candidates = skillsFromFiles(files)
  if (candidates.length === 0) throw new WorkshopError('no-skill-md', '仓库中未找到任何 SKILL.md')
  if (subdir) {
    if (files[`${subdir.replace(/\/$/, '')}/SKILL.md`] !== undefined) return subdir.replace(/\/$/, '')
    if (strict) {
      const listing = candidates.map((c) => (c === '' ? '（仓库根）' : c)).join('、') || '无'
      throw new WorkshopError('path-stale', `锁记录路径 ${subdir} 在上游已失效；仓内现有 skill: ${listing}`)
    }
    // 指定子目录未命中：回退自动探测（skills.sh 的 skillId 是名字不是路径）
  }
  if (files['SKILL.md'] !== undefined) return ''
  const shallow = Math.min(...candidates.map((c) => (c === '' ? 0 : c.split('/').length)))
  const shallowest = candidates.filter((c) => (c === '' ? 0 : c.split('/').length) === shallow)
  if (shallowest.length > 1) {
    const list = shallowest.map((c) => (c === '' ? '（仓库根）' : c)).join(', ')
    throw new WorkshopError('needs-selection', `仓库含多个 skill，请选择其一: ${list}`)
  }
  return shallowest[0]
}

/** 把 zipball 内一个 skill 目录物化到临时目录，返回 {tmp, dir}（dir 相对路径）。 */
async function materializeSkillDir(payload, subdir, strict = false) {
  const { files } = explodeZipball(payload)
  const dir = locateSkillDir(files, subdir, strict)
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-sm-'))
  const prefix = dir === '' ? '' : `${dir}/`
  for (const [rel, data] of Object.entries(files)) {
    if (!rel.startsWith(prefix)) continue
    const target = join(tmp, rel.slice(prefix.length))
    if (target.includes('__pycache__')) continue
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, data)
  }
  return { tmp, dir }
}

/** skills.sh 搜索（R-07）。 */
export async function search(query, limit = 20, offset = 0) {
  return searchSkillsSh(String(query ?? ''), limit, offset)
}

function withRepoErrors(fn) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (error) {
      if (error instanceof WorkshopError) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('无效的仓库标识')) throw new WorkshopError('bad-repo', message)
      if (message.includes('无法解析')) throw new WorkshopError('remote-unreachable', message, true)
      throw error
    }
  }
}

/** 仓库探测（R-08）：Trees API 主路径，truncated/失败回退 zipball。 */
export const repoSkills = withRepoErrors(async (repoSlugInput, branch = 'main') => {
  const repoSlug = normalizeRepoSlug(repoSlugInput)
  const resolved = await resolveRemote(repoSlug, branch)
  try {
    const data = await ghApi(`/repos/${repoSlug}/git/trees/${resolved.branch}?recursive=1`)
    if (!data.truncated) {
      return {
        repo: repoSlug,
        branch: resolved.branch,
        commit: resolved.commit,
        candidates: skillsFromTree(data.tree ?? []),
        via: 'api',
      }
    }
  } catch (error) {
    // 回退 zipball 探测
  }
  const payload = await fetchZipball(repoSlug, resolved.branch)
  const { files } = explodeZipball(payload)
  return {
    repo: repoSlug,
    branch: resolved.branch,
    commit: resolved.commit,
    candidates: skillsFromFiles(files).map((p) => ({ path: p, name: p === '' ? '' : p.split('/').pop() })),
    via: 'zipball',
  }
})

/** 入库（R-08/R-09）。 */
export const add = withRepoErrors(async ({ root, repo: repoInput, dir, ref = 'main', as, ctx }) => {
  const repoSlug = normalizeRepoSlug(repoInput)
  const lock = await loadLock(root)
  const resolved = await resolveRemote(repoSlug, ref)
  const payload = await fetchZipball(repoSlug, resolved.branch)
  const { tmp, dir: skillDir } = await materializeSkillDir(payload, dir)

  const actualSubdir = skillDir === '' ? null : skillDir
  let installName
  if (as) {
    installName = as
  } else if (skillDir === '') {
    const meta = parseSkillMd(await readFile(join(tmp, 'SKILL.md'), 'utf8'))
    installName = meta.name || skillDir
  } else {
    installName = skillDir.split('/').pop()
  }
  validateInstallName(installName)

  const dest = workshopPath(root, join(SKILLS_REL, installName))
  const existing = lock.skills[installName]
  const destExists = await pathExists(dest)
  if (destExists) {
    if (existing && existing.repo === repoSlug) {
      throw new WorkshopError('already-installed', `${installName} 已在库中（同仓库），请用更新`)
    }
    throw new WorkshopError(
      'name-conflict',
      `skills/${installName} 已存在（${existing ? 'GitHub 来源' : '自研/本地'}），如需替换请先出库现有版本`,
    )
  }
  await mkdir(dest, { recursive: true })
  await copyTree(tmp, dest)

  lock.skills[installName] = {
    repo: repoSlug,
    branch: resolved.branch,
    commit: resolved.commit,
    path_in_repo: actualSubdir,
    installed_at: nowIso(),
    license: null,
    content_hash: await dirHash(dest),
  }
  await saveLock(root, lock)
  await rm(tmp, { recursive: true, force: true })

  const committed = await commitPaths(root, [`${SKILLS_REL}/${installName}`, 'skills.lock.json'], `feat(skills): 引入 ${repoSlug}@${resolved.commit.slice(0, 7)} 作为 ${installName}`)
  const sync = await ctx.reconcile()
  return {
    name: installName,
    repo: repoSlug,
    branch: resolved.branch,
    commit: resolved.commit,
    committed,
    sync,
  }
})

async function pathExists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function copyTree(src, dest) {
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '__pycache__') continue
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true })
      await copyTree(from, to)
    } else if (entry.isFile()) {
      await cp(from, to)
    }
  }
}

/** 检查结果子集 → 缓存条目（DSR-008 状态直显）。 */
function cacheEntryFromCheck(r) {
  return {
    repo: r.repo,
    branch: r.branch,
    current: r.current ?? null,
    latest: r.latest ?? null,
    status: r.status,
    reason: r.reason ?? null,
    via: r.via ?? null,
    updatable: r.updatable === true,
    reachable: r.reachable === true,
    locally_modified: r.locally_modified ?? null,
    baseline_missing: r.baseline_missing === true,
    missing: r.missing === true,
  }
}

/** 合并有上游（repo）的检查结果进缓存并刷新检查时间；无上游条目（skipped）不入缓存。 */
async function mergeCheckCache(root, results, checkedAt) {
  const cache = await loadCheckCache(root)
  let touched = false
  for (const r of results) {
    if (!r || !r.repo) continue
    cache.results[r.name] = cacheEntryFromCheck(r)
    touched = true
  }
  if (!touched) return
  cache.checkedAt = checkedAt ?? nowIso()
  await saveCheckCache(root, cache)
}

/**
 * 检查（R-10 三态；DSR-008：并行探测 + 结果缓存）。
 * 单 skill 网络异常降级为该条 check_failed，不再拖垮整批。
 */
export async function check({ root, names }) {
  const lock = await loadLock(root)
  const targets = names && names.length > 0 ? names : Object.keys(lock.skills)
  const out = await Promise.all(targets.map(async (name) => {
    const entry = lock.skills[name]
    if (!entry) {
      return { name, status: 'skipped', reason: '不在锁文件中' }
    }
    if (!entry.repo) {
      return { name, status: 'skipped', reason: '本地导入，无上游可比' }
    }
    const dest = workshopPath(root, join(SKILLS_REL, name))
    try {
      const head = await remoteHead(entry.repo, entry.branch)
      let modified = null
      const missing = !(await pathExists(dest))
      if (!missing) {
        const current = await dirHash(dest)
        if (entry.content_hash == null) {
          // 缺少历史基线时无法安全断言“未修改”；不把当前内容静默写成新基线。
          modified = null
        } else {
          modified = current !== entry.content_hash
        }
      }
      const status = head.status === 'ok' ? (head.sha !== entry.commit ? 'updatable' : 'up_to_date') : 'check_failed'
      return {
        name,
        repo: entry.repo,
        branch: entry.branch,
        current: entry.commit,
        latest: head.sha,
        status,
        reason: head.reason,
        via: head.via,
        updatable: status === 'updatable',
        reachable: head.status === 'ok',
        locally_modified: modified,
        baseline_missing: !missing && entry.content_hash == null,
        missing,
      }
    } catch (error) {
      return {
        name,
        repo: entry.repo,
        branch: entry.branch,
        current: entry.commit,
        latest: null,
        status: 'check_failed',
        reason: error instanceof Error ? error.message : String(error),
        via: null,
        updatable: false,
        reachable: false,
        locally_modified: null,
        baseline_missing: false,
        missing: !(await pathExists(dest)),
      }
    }
  }))
  await mergeCheckCache(root, out)
  return out
}

/**
 * 更新（R-10；目录缺失时即使 commit 未变也拉回）。
 * 覆盖发生前由 Host 强制要求确认，避免 UI 外的 API 调用绕过风险提示。
 */
export async function update({ root, names, confirmLocalChanges = false, ctx }) {
  const lock = await loadLock(root)
  const targets = names && names.length > 0 ? names : Object.keys(lock.skills)
  const localChanges = []
  for (const name of targets) {
    const entry = lock.skills[name]
    if (!entry?.repo) continue
    const dest = workshopPath(root, join(SKILLS_REL, name))
    if (!(await pathExists(dest))) continue
    if (entry.content_hash == null) {
      localChanges.push(name)
      continue
    }
    if (await dirHash(dest) !== entry.content_hash) localChanges.push(name)
  }
  if (localChanges.length > 0 && !confirmLocalChanges) {
    throw new WorkshopError(
      'local-changes-confirmation-required',
      `检测到本地修改，更新会覆盖：${localChanges.join('、')}。请确认后继续。`,
    )
  }
  const results = []
  let changed = false
  for (const name of targets) {
    const entry = lock.skills[name]
    if (!entry) {
      results.push({ name, status: 'skipped', reason: '不在锁文件中（非第三方 skill 或未入库）' })
      continue
    }
    if (!entry.repo) {
      results.push({ name, status: 'skipped', reason: '本地导入，无上游' })
      continue
    }
    const head = await remoteHead(entry.repo, entry.branch)
    if (!head.sha) {
      results.push({ name, status: 'skipped', reason: `上游不可达（${head.reason}）` })
      continue
    }
    const dest = workshopPath(root, join(SKILLS_REL, name))
    if (await pathExists(dest) && head.sha === entry.commit) {
      results.push({ name, status: 'skipped', reason: '已是最新' })
      continue
    }
    try {
      const payload = await fetchZipball(entry.repo, entry.branch)
      // strict：锁记录的 path_in_repo 失效时报 path-stale + 候选（inbound-operations.md）
      const { tmp, dir: skillDir } = await materializeSkillDir(payload, entry.path_in_repo ?? undefined, true)
      if (await pathExists(dest)) await rm(dest, { recursive: true, force: true })
      await mkdir(dest, { recursive: true })
      await copyTree(tmp, dest)
      await rm(tmp, { recursive: true, force: true })

      entry.commit = head.sha
      entry.installed_at = nowIso()
      entry.content_hash = await dirHash(dest)
      await saveLock(root, lock)
      changed = true

      const committed = await commitPaths(root, [`${SKILLS_REL}/${name}`, 'skills.lock.json'], `chore(skills): 更新 ${name} 至 ${entry.repo}@${head.sha.slice(0, 7)}`)
      results.push({ name, status: 'updated', commit: head.sha, committed, via: head.via })
    } catch (error) {
      // 单条失败不中断批次（inbound-operations.md 批量更新语义）
      results.push({ name, status: 'skipped', reason: error instanceof Error ? error.message : String(error) })
    }
  }
  let sync = null
  if (changed) {
    sync = await ctx.reconcile()
  }
  // DSR-008：更新结果直接回填检查缓存，行徽章无需等下一次全局检查即翻转为已是最新。
  const cacheEntries = []
  for (const r of results) {
    const entry = lock.skills[r.name]
    if (r.status === 'updated') {
      cacheEntries.push({
        name: r.name, repo: entry?.repo, branch: entry?.branch,
        current: r.commit, latest: r.commit, status: 'up_to_date', via: r.via,
        updatable: false, reachable: true, locally_modified: false, baseline_missing: false, missing: false,
      })
    } else if (r.status === 'skipped' && r.reason === '已是最新') {
      cacheEntries.push({
        name: r.name, repo: entry?.repo, branch: entry?.branch,
        current: entry?.commit ?? null, latest: entry?.commit ?? null, status: 'up_to_date',
        updatable: false, reachable: true, locally_modified: false, baseline_missing: false, missing: false,
      })
    }
  }
  if (cacheEntries.length > 0) await mergeCheckCache(root, cacheEntries)
  return { results, sync }
}

/** 本地导入（R-11）。 */
export async function importSkill({ root, path: inputPath, as, ctx }) {
  const src = resolve(inputPath.replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? `%${v}%`))
  if (!(await pathExists(src))) throw new WorkshopError('not-found', `路径不存在: ${inputPath}`)
  const lock = await loadLock(root)
  let skillDir
  let tmp = null
  const info = await stat(src)
  if (info.isFile()) {
    if (!src.toLowerCase().endsWith('.zip')) throw new WorkshopError('bad-import', '文件导入仅支持 .zip')
    const payload = await readFile(src)
    const { files } = explodeZipball(payload)
    const dir = locateSkillDir(files, undefined)
    tmp = await mkdtemp(join(tmpdir(), 'dsh-sm-'))
    const prefix = dir === '' ? '' : `${dir}/`
    for (const [rel, data] of Object.entries(files)) {
      if (!rel.startsWith(prefix)) continue
      const target = join(tmp, rel.slice(prefix.length))
      if (target.includes('__pycache__')) continue
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, data)
    }
    skillDir = tmp
  } else {
    if (!(await pathExists(join(src, 'SKILL.md')))) {
      throw new WorkshopError('no-skill-md', `目录中未找到 SKILL.md: ${src}`)
    }
    skillDir = src
  }
  const installName = as || skillDir.split(/[\\/]/).pop()
  validateInstallName(installName)
  const dest = workshopPath(root, join(SKILLS_REL, installName))
  if (await pathExists(dest)) {
    if (tmp) await rm(tmp, { recursive: true, force: true })
    throw new WorkshopError('name-conflict', `skills/${installName} 已存在，可用改名导入`)
  }
  await mkdir(dest, { recursive: true })
  await copyTree(skillDir, dest)
  if (tmp) await rm(tmp, { recursive: true, force: true })

  lock.skills[installName] = {
    repo: null,
    source: 'local',
    origin_path: src,
    installed_at: nowIso(),
    content_hash: await dirHash(dest),
  }
  await saveLock(root, lock)
  const committed = await commitPaths(root, [`${SKILLS_REL}/${installName}`, 'skills.lock.json'], `feat(skills): 本地导入 ${installName}`)
  const sync = await ctx.reconcile()
  return { name: installName, source: 'local', committed, sync }
}

/** 出库（R-12）：备份 → 摘除 → 删除 → 清锁清组 → 提交。 */
export async function remove({ root, name, keepFiles, ctx }) {
  const src = workshopPath(root, join(SKILLS_REL, name))
  if (!(await pathExists(src))) throw new WorkshopError('not-found', `库中不存在 skill: ${name}`)
  const lock = await loadLock(root)
  const lockedEntry = lock.skills[name] ?? null
  const groupsDoc = await ctx.loadGroups()
  const groupName = Object.entries(groupsDoc.groups).find(([, m]) => m.includes(name))?.[0] ?? null

  let backup = null
  if (!keepFiles) {
    const backupsDir = workshopPath(root, 'distributor/backups')
    await mkdir(backupsDir, { recursive: true })
    const stamp = localStamp()
    backup = join(backupsDir, `${stamp}-${name}`)
    await mkdir(backup, { recursive: true })
    await copyTree(src, backup)
    await writeFile(
      join(backup, '_backup_meta.json'),
      Buffer.from(JSON.stringify({ name, locked: lockedEntry, group: groupName }, null, 2), 'utf8'),
    )
  }

  const state = await ctx.loadState()
  const detached = []
  for (const rec of state.synced[name] ?? []) {
    if ((await detachOne(rec)) === 'removed') detached.push(targetKey(rec))
  }
  delete state.synced[name]
  await saveState(root, state)

  await rm(src, { recursive: true, force: true, maxRetries: 3 })
  removeMember(groupsDoc, name)
  await saveGroups(root, groupsDoc)
  if (lock.skills[name]) {
    delete lock.skills[name]
    await saveLock(root, lock)
  }

  const committed = await commitPaths(
    root,
    [`${SKILLS_REL}/${name}`, 'skills.lock.json', 'distributor/groups.json'],
    `chore(skills): 移除 ${name}（备份于 distributor/backups）`,
  )
  // DSR-008：出库后清理检查缓存条目，避免残留状态。
  const cache = await loadCheckCache(root)
  if (cache.results[name]) {
    delete cache.results[name]
    await saveCheckCache(root, cache)
  }
  return { name, backup, detached, committed }
}

/** 备份列表（R-12）。 */
export async function backups({ root }) {
  const dir = workshopPath(root, 'distributor/backups')
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const out = []
  for (const entry of entries.filter((d) => d.isDirectory())) {
    let meta = {}
    try {
      meta = JSON.parse(await readFile(join(dir, entry.name, '_backup_meta.json'), 'utf8'))
    } catch {
      // 无元数据仍展示
    }
    const m = /^(\d{8}-\d{6})-(.+)$/.exec(entry.name)
    out.push({
      id: entry.name,
      name: meta.name || (m ? m[2] : entry.name),
      time: m ? m[1] : '',
      has_meta: Boolean(meta.name),
    })
  }
  return out
}

/** 恢复（R-12）：备份必须为 backups/ 直接子目录。 */
export async function restore({ root, id, ctx }) {
  const backupsDir = workshopPath(root, 'distributor/backups')
  const src = join(backupsDir, id)
  if (id.includes('/') || id.includes('\\') || id === '.' || id === '..' || !(await pathExists(src))) {
    throw new WorkshopError('not-found', `备份不存在: ${id}`)
  }
  let meta = {}
  try {
    meta = JSON.parse(await readFile(join(src, '_backup_meta.json'), 'utf8'))
  } catch {
    // 无元数据
  }
  const name = meta.name || id
  const dest = workshopPath(root, join(SKILLS_REL, name))
  if (await pathExists(dest)) throw new WorkshopError('name-conflict', `skills/${name} 已存在，无法恢复`)
  await mkdir(dest, { recursive: true })
  await copyTree(src, dest)
  await rm(join(dest, '_backup_meta.json'), { force: true })

  if (meta.locked) {
    const lock = await loadLock(root)
    lock.skills[name] = meta.locked
    await saveLock(root, lock)
  }
  const groupName = meta.group
  if (groupName && groupName !== '默认') {
    const groupsDoc = await ctx.loadGroups()
    if (!(groupName in groupsDoc.groups)) groupsDoc.groups[groupName] = []
    if (!groupsDoc.groups[groupName].includes(name)) groupsDoc.groups[groupName].push(name)
    await saveGroups(root, groupsDoc)
  }

  const committed = await commitPaths(
    root,
    [`${SKILLS_REL}/${name}`, 'skills.lock.json', 'distributor/groups.json'],
    `chore(skills): 从备份恢复 ${name}`,
  )
  const sync = await ctx.reconcile()
  return { name, committed, sync }
}

/** 禁用（R-13）：移入 .disabled/，保存元数据，从锁与分组摘除，不删除文件。 */
export async function disable({ root, name, ctx }) {
  const src = workshopPath(root, join(SKILLS_REL, name))
  if (!(await pathExists(src))) throw new WorkshopError('not-found', `库中不存在 skill: ${name}`)
  const lock = await loadLock(root)
  const lockedEntry = lock.skills[name] ?? null
  const groupsDoc = await ctx.loadGroups()
  const groupName = Object.entries(groupsDoc.groups).find(([, m]) => m.includes(name))?.[0] ?? null
  await writeFile(
    join(src, '_disable_meta.json'),
    Buffer.from(JSON.stringify({ name, locked: lockedEntry, group: groupName, disabled_at: nowIso() }, null, 2), 'utf8'),
  )
  const disabledDir = workshopPath(root, DISABLED_REL)
  await mkdir(disabledDir, { recursive: true })
  await rename(src, join(disabledDir, name))
  removeMember(groupsDoc, name)
  await saveGroups(root, groupsDoc)
  if (lock.skills[name]) {
    delete lock.skills[name]
    await saveLock(root, lock)
  }
  await commitPaths(root, [`${SKILLS_REL}/${name}`, 'skills.lock.json', 'distributor/groups.json'], `chore(skills): 禁用 ${name}`)
  const sync = await ctx.reconcile()
  return { name, sync }
}

/** 启用（R-13）：反向恢复。 */
export async function enable({ root, name, ctx }) {
  const metaFile = workshopPath(root, join(DISABLED_REL, name, '_disable_meta.json'))
  let meta = {}
  try {
    meta = JSON.parse(await readFile(metaFile, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new WorkshopError('not-found', `未找到禁用记录: ${name}`)
    throw error
  }
  const src = workshopPath(root, join(DISABLED_REL, name))
  const dest = workshopPath(root, join(SKILLS_REL, name))
  if (await pathExists(dest)) throw new WorkshopError('name-conflict', `skills/${name} 已存在`)
  await rename(src, dest)
  await rm(join(dest, '_disable_meta.json'), { force: true })
  if (meta.locked) {
    const lock = await loadLock(root)
    lock.skills[name] = meta.locked
    await saveLock(root, lock)
  }
  const groupName = meta.group
  if (groupName && groupName !== '默认') {
    const groupsDoc = await ctx.loadGroups()
    if (!(groupName in groupsDoc.groups)) groupsDoc.groups[groupName] = []
    if (!groupsDoc.groups[groupName].includes(name)) groupsDoc.groups[groupName].push(name)
    await saveGroups(root, groupsDoc)
  }
  await commitPaths(root, [`${SKILLS_REL}/${name}`, 'skills.lock.json', 'distributor/groups.json'], `chore(skills): 启用 ${name}`)
  const sync = await ctx.reconcile()
  return { name, sync }
}

export { setMembership, DEFAULT_GROUP, logHash }
