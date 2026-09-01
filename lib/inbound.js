// dsh-skill-manager — 入站操作（inbound-operations.md）。
// 覆盖：skills.sh 搜索、仓库探测、add/check/update、本地导入、出库/备份恢复、禁用启用。
// 状态全部经 store 门面读写 storage 域；备份树在 backupsRoot（$DSH_HOME/skill-manager/backups/）。

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { cp } from 'node:fs/promises'
import { SkillManagerError } from './errors.js'
import { safePath } from './dir.js'
import { unzip } from './zip.js'
import { dirHash, parseSkillMd } from './library.js'
import { loadCheckCache, saveCheckCache, loadState, saveState } from './state.js'
import { detachOne, reconcile, targetKey } from './sync.js'
import { backupId } from './store.js'
import { fetchZipball, ghApi, normalizeRepoSlug, remoteHead, resolveRemote, searchSkillsSh } from './net.js'

/**
 * 目录哈希门面：显式传入 hash（生产为带 TTL 缓存的 hashOf）时走它；
 * fresh=true 强制重算（update 的本地修改判定禁止用陈旧基线）。
 * 未传入（测试/纯函数路径）→ 直接新鲜直算。
 */
const hashDir = (hash, dir, fresh = false) => (hash !== undefined ? hash(dir, { fresh }) : dirHash(dir))

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function validateInstallName(name) {
  if (!SKILL_NAME.test(name)) {
    throw new SkillManagerError('bad-name', `非法安装名: ${name}（小写字母/数字/连字符）`)
  }
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
  if (tops.size !== 1) throw new SkillManagerError('bad-zipball', 'zipball 结构异常：顶层目录不唯一')
  const top = [...tops][0]
  const out = {}
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(`${top}/`) || name.endsWith('/')) continue
    const rel = name.slice(top.length + 1)
    if (rel.split('/').includes('.git')) continue
    // 防解包逃逸：拒绝绝对路径、盘符前缀与 .. / . 段（恶意 zip 可任意写文件）
    if (rel === '' || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').some((part) => part === '..' || part === '.')) {
      throw new SkillManagerError('bad-zipball', `zipball 含不安全路径条目: ${rel}`)
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
 * 定位 skill 目录。
 * @param {boolean} strict - true 时指定子目录未命中直接报 path-stale（update 用，
 *   防止上游重构后静默装错 skill）；false 回退自动探测（add/repo-skills 用）。
 */
function locateSkillDir(files, subdir, strict = false) {
  const candidates = skillsFromFiles(files)
  if (candidates.length === 0) throw new SkillManagerError('no-skill-md', '仓库中未找到任何 SKILL.md')
  if (subdir) {
    if (files[`${subdir.replace(/\/$/, '')}/SKILL.md`] !== undefined) return subdir.replace(/\/$/, '')
    if (strict) {
      const listing = candidates.map((c) => (c === '' ? '（仓库根）' : c)).join('、') || '无'
      throw new SkillManagerError('path-stale', `记录路径 ${subdir} 在上游已失效；仓内现有 skill: ${listing}`)
    }
    // 指定子目录未命中：回退自动探测（skills.sh 的 skillId 是名字不是路径）
  }
  if (files['SKILL.md'] !== undefined) return ''
  const shallow = Math.min(...candidates.map((c) => (c === '' ? 0 : c.split('/').length)))
  const shallowest = candidates.filter((c) => (c === '' ? 0 : c.split('/').length) === shallow)
  if (shallowest.length > 1) {
    const list = shallowest.map((c) => (c === '' ? '（仓库根）' : c)).join(', ')
    throw new SkillManagerError('needs-selection', `仓库含多个 skill，请选择其一: ${list}`)
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
      if (error instanceof SkillManagerError) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('无效的仓库标识')) throw new SkillManagerError('bad-repo', message)
      if (message.includes('无法解析')) throw new SkillManagerError('remote-unreachable', message, true)
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
  } catch {
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
export const add = withRepoErrors(async ({ root, store, repo: repoInput, dir, ref = 'main', as, ctx }) => {
  const repoSlug = normalizeRepoSlug(repoInput)
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

  const dest = safePath(root, installName)
  const existing = store.getSkill(installName)
  const destExists = await pathExists(dest)
  if (destExists) {
    if (existing && existing.repo === repoSlug) {
      throw new SkillManagerError('already-installed', `${installName} 已在库中（同仓库），请用更新`)
    }
    throw new SkillManagerError(
      'name-conflict',
      `${installName} 已存在（${existing?.origin === 'github' ? 'GitHub 来源' : '自研/本地'}），如需替换请先出库现有版本`,
    )
  }
  await mkdir(dest, { recursive: true })
  await copyTree(tmp, dest)

  await store.putSkill(installName, {
    origin: 'github',
    repo: repoSlug,
    branch: resolved.branch,
    commit: resolved.commit,
    path_in_repo: actualSubdir,
    content_hash: await dirHash(dest),
    origin_path: null,
    installed_at: nowIso(),
    disabled: false,
    group: '默认',
  })
  await rm(tmp, { recursive: true, force: true })

  const sync = await ctx.reconcile()
  return {
    name: installName,
    repo: repoSlug,
    branch: resolved.branch,
    commit: resolved.commit,
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

/** 检查结果子集 → 缓存条目（DSR-008 状态直显；checked_at 随写入刷新）。 */
function cacheEntryFromCheck(r, checkedAt) {
  return {
    checked_at: checkedAt,
    repo: r.repo,
    branch: r.branch ?? null,
    current: r.current ?? null,
    latest: r.latest ?? null,
    status: r.status,
    reason: r.reason ?? null,
    via: r.via ?? null,
    updatable: r.updatable === true,
    reachable: r.reachable === true,
    locally_modified: r.locally_modified === true,
    baseline_missing: r.baseline_missing === true,
    missing: r.missing === true,
  }
}

/** 合并有上游（repo）的检查结果进缓存；无上游条目（skipped）不入缓存。 */
async function mergeCheckCache(store, results, checkedAt = nowIso()) {
  const cache = await loadCheckCache(store)
  let touched = false
  for (const r of results) {
    if (!r || !r.repo) continue
    cache.results[r.name] = cacheEntryFromCheck(r, checkedAt)
    touched = true
  }
  if (!touched) return
  await saveCheckCache(store, cache)
}

/**
 * 检查（R-10 三态；DSR-008：并行探测 + 结果缓存）。
 * 单 skill 网络异常降级为该条 check_failed，不再拖垮整批。
 * 同 repo 同分支只探测一次上游（多目录仓库省网络往返），结果广播给各成员。
 * @param {Function} [hash] 目录哈希门面（hashOf）；缺省新鲜直算
 */
export async function check({ root, store, names, hash }) {
  const entries = new Map(store.skillEntries())
  const targets = names && names.length > 0 ? names : [...entries.keys()]
  const heads = new Map()
  for (const entry of entries.values()) {
    if (entry.origin !== 'github' || !entry.repo) continue
    const key = `${entry.repo}\0${entry.branch ?? ''}`
    if (!heads.has(key)) heads.set(key, remoteHead(entry.repo, entry.branch))
  }
  const out = await Promise.all(targets.map(async (name) => {
    const entry = entries.get(name)
    if (!entry) {
      return { name, status: 'skipped', reason: '库中无记录（未入库或已出库）' }
    }
    if (entry.origin !== 'github' || !entry.repo) {
      return { name, status: 'skipped', reason: entry.origin === 'self' ? '自研目录，无上游可比' : '本地导入，无上游可比' }
    }
    const dest = safePath(root, name)
    try {
      const head = await (heads.get(`${entry.repo}\0${entry.branch ?? ''}`)
        ?? Promise.resolve({ sha: null, status: 'unreachable', via: null, reason: '上游探测缺失' }))
      let modified = null
      const missing = !(await pathExists(dest))
      if (!missing) {
        if (entry.content_hash == null) {
          // 缺少历史基线时无法安全断言“未修改”；不把当前内容静默写成新基线。
          modified = null
        } else {
          modified = (await hashDir(hash, dest)) !== entry.content_hash
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
  await mergeCheckCache(store, out)
  return out
}

/**
 * 更新（R-10；目录缺失时即使 commit 未变也拉回）。
 * 覆盖发生前由 Host 强制要求确认，避免 UI 外的 API 调用绕过风险提示。
 */
export async function update({ root, store, names, confirmLocalChanges = false, ctx, hash }) {
  const entries = new Map(store.skillEntries())
  const targets = names && names.length > 0 ? names : [...entries.keys()]
  const localChanges = []
  for (const name of targets) {
    const entry = entries.get(name)
    if (!entry?.repo) continue
    const dest = safePath(root, name)
    if (!(await pathExists(dest))) continue
    if (entry.content_hash == null) {
      localChanges.push(name)
      continue
    }
    // 破坏性路径：必须新鲜哈希，绝不信任缓存基线（防止覆盖用户刚做的修改）。
    if (await hashDir(hash, dest, true) !== entry.content_hash) localChanges.push(name)
  }
  if (localChanges.length > 0 && !confirmLocalChanges) {
    throw new SkillManagerError(
      'local-changes-confirmation-required',
      `检测到本地修改，更新会覆盖：${localChanges.join('、')}。请确认后继续。`,
    )
  }
  const results = []
  let changed = false
  for (const name of targets) {
    const entry = entries.get(name)
    if (!entry) {
      results.push({ name, status: 'skipped', reason: '库中无记录（非第三方 skill 或未入库）' })
      continue
    }
    if (entry.origin !== 'github' || !entry.repo) {
      results.push({ name, status: 'skipped', reason: '本地导入或自研，无上游' })
      continue
    }
    const head = await remoteHead(entry.repo, entry.branch)
    if (!head.sha) {
      results.push({ name, status: 'skipped', reason: `上游不可达（${head.reason}）` })
      continue
    }
    const dest = safePath(root, name)
    if (await pathExists(dest) && head.sha === entry.commit) {
      results.push({ name, status: 'skipped', reason: '已是最新' })
      continue
    }
    try {
      const payload = await fetchZipball(entry.repo, entry.branch)
      // strict：记录的 path_in_repo 失效时报 path-stale + 候选（inbound-operations.md）
      const { tmp } = await materializeSkillDir(payload, entry.path_in_repo ?? undefined, true)
      if (await pathExists(dest)) await rm(dest, { recursive: true, force: true })
      await mkdir(dest, { recursive: true })
      await copyTree(tmp, dest)
      await rm(tmp, { recursive: true, force: true })

      await store.putSkill(name, {
        ...entry,
        commit: head.sha,
        installed_at: nowIso(),
        content_hash: await hashDir(hash, dest, true),
      })
      changed = true

      results.push({ name, status: 'updated', commit: head.sha, via: head.via })
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
    const entry = entries.get(r.name)
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
  if (cacheEntries.length > 0) await mergeCheckCache(store, cacheEntries)
  return { results, sync }
}

/** 本地导入（R-11）。 */
export async function importSkill({ root, store, path: inputPath, as, ctx }) {
  const src = resolve(inputPath.replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? `%${v}%`))
  if (!(await pathExists(src))) throw new SkillManagerError('not-found', `路径不存在: ${inputPath}`)
  let skillDir
  let tmp = null
  const info = await stat(src)
  if (info.isFile()) {
    if (!src.toLowerCase().endsWith('.zip')) throw new SkillManagerError('bad-import', '文件导入仅支持 .zip')
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
      throw new SkillManagerError('no-skill-md', `目录中未找到 SKILL.md: ${src}`)
    }
    skillDir = src
  }
  const installName = as || skillDir.split(/[\\/]/).pop()
  validateInstallName(installName)
  const dest = safePath(root, installName)
  if (await pathExists(dest)) {
    if (tmp) await rm(tmp, { recursive: true, force: true })
    throw new SkillManagerError('name-conflict', `${installName} 已存在，可用改名导入`)
  }
  await mkdir(dest, { recursive: true })
  await copyTree(skillDir, dest)
  if (tmp) await rm(tmp, { recursive: true, force: true })

  await store.putSkill(installName, {
    origin: 'local',
    repo: null,
    branch: null,
    commit: null,
    path_in_repo: null,
    // 本地 skill 无版本管理：不建立内容基线（content_hash 仅 github 更新门禁用）。
    content_hash: null,
    origin_path: src,
    installed_at: nowIso(),
  })
  const sync = await ctx.reconcile()
  return { name: installName, source: 'local', sync }
}

/** 出库（R-12）：备份 → 摘除物化 → 删除目录 → 删记录 → 清缓存。 */
export async function remove({ root, store, name, keepFiles, backupsRoot, ctx }) {
  const src = safePath(root, name)
  if (!(await pathExists(src))) throw new SkillManagerError('not-found', `库中不存在 skill: ${name}`)
  const record = store.getSkill(name) ?? null

  let backup = null
  if (!keepFiles) {
    const id = backupId(name)
    backup = join(backupsRoot, id)
    await mkdir(backup, { recursive: true })
    await copyTree(src, backup)
    const createdAt = nowIso()
    await writeFile(
      join(backup, '_backup_meta.json'),
      JSON.stringify({ name, record, created_at: createdAt }, null, 2),
      'utf8',
    )
    await store.putBackup(id, { name, created_at: createdAt })
  }

  const state = await loadState(store)
  const detached = []
  for (const rec of state.synced[name] ?? []) {
    if ((await detachOne(rec)) === 'removed') detached.push(targetKey(rec))
  }
  delete state.synced[name]
  await saveState(store, state)

  await rm(src, { recursive: true, force: true, maxRetries: 3 })
  if (record) await store.deleteSkill(name)

  // DSR-008：出库后清理检查缓存条目，避免残留状态。
  await store.deleteCheck(name)
  return { name, backup, detached }
}

/** 备份列表（R-12）：域登记 ∪ 备份目录实际内容。 */
export async function backups({ store, backupsRoot }) {
  let entries = []
  try {
    entries = await readdir(backupsRoot, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') entries = []
    else throw error
  }
  const registered = new Map(store.backupEntries())
  const out = []
  for (const entry of entries.filter((d) => d.isDirectory())) {
    let meta = {}
    try {
      meta = JSON.parse(await readFile(join(backupsRoot, entry.name, '_backup_meta.json'), 'utf8'))
    } catch {
      // 无元数据仍展示
    }
    const reg = registered.get(entry.name)
    out.push({
      id: entry.name,
      name: meta.name || reg?.name || entry.name,
      time: meta.created_at || reg?.created_at || '',
      has_meta: Boolean(meta.name),
    })
  }
  return out
}

/** 恢复（R-12）：备份必须在 backups 表登记且为备份目录直接子目录。 */
export async function restore({ root, store, id, backupsRoot, ctx }) {
  const registration = typeof id === 'string' && !id.includes('/') && !id.includes('\\') && id !== '.' && id !== '..'
    ? store.getBackup(id)
    : undefined
  if (!registration) throw new SkillManagerError('not-found', `备份不存在: ${id}`)
  const src = join(backupsRoot, id)
  if (!(await pathExists(src))) throw new SkillManagerError('not-found', `备份目录缺失: ${id}`)
  let meta = {}
  try {
    meta = JSON.parse(await readFile(join(src, '_backup_meta.json'), 'utf8'))
  } catch {
    // 无元数据
  }
  const name = meta.name || registration.name || id
  const dest = safePath(root, name)
  if (await pathExists(dest)) throw new SkillManagerError('name-conflict', `${name} 已存在，无法恢复`)
  await mkdir(dest, { recursive: true })
  await copyTree(src, dest)
  await rm(join(dest, '_backup_meta.json'), { force: true })

  // 恢复 github/local 记录（含基线；意图字段已废弃，组归属以配置为准）。
  // 无元数据或无记录的备份 = 本地文件恢复，不写登记（本地 skill 无版本管理）。
  const record = meta.record && typeof meta.record === 'object' ? { ...meta.record } : null
  delete record?.disabled
  delete record?.group
  if (record && record.origin !== 'self') {
    record.content_hash = record.content_hash ?? await dirHash(dest)
    await store.putSkill(name, record)
  }

  const sync = await ctx.reconcile()
  return { name, sync }
}
