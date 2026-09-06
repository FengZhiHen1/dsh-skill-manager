// upstream — 上游检查与更新：远程探测、本地修改判定、库内更新落盘。
//
// 边界：解包与临时目录生命周期在 zipball.js，失败不漏 tmp。
// 参考：入站操作.md「check」「update」；DSR-015。

import { SkillManagerError } from '../base/errors.js'
import { fetchZipball, remoteHead } from '../base/net.js'
import { atomicSwapDir, safePath } from '../base/fsys.js'
import { dirHash } from '../model/library.js'
import { copyTree, nowIso, pathExists, withMaterializedSkillDir } from './zipball.js'

/**
 * 目录哈希门面：按入参三态分流。
 * 传入 hash → 走传入实现，生产侧带 TTL 缓存；fresh=true → 绕过缓存重算。
 * 未传入 → 新鲜直算，即测试与纯函数路径。
 * why 强制重算：update 的本地修改判定必须以当下内容为准，禁陈旧基线。
 */
const hashDir = (hash, dir, fresh = false) => (hash !== undefined ? hash(dir, { fresh }) : dirHash(dir))

/** 检查结果子集 → 缓存条目，checked_at 随写入时刻刷新。 */
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

/**
 * 合并有上游 repo 的检查结果进缓存。
 * 无上游的 skipped 条目不入缓存，逐条 putCheck，键即安装名。
 */
async function mergeCheckCache(store, results, checkedAt = nowIso()) {
  for (const r of results) {
    if (!r || !r.repo) continue
    await store.putCheck(r.name, cacheEntryFromCheck(r, checkedAt))
  }
}

/**
 * 检查上游状态，返回每个 skill 的三态结果。
 * 单条网络异常降级为该条 check_failed，不再拖垮整批。
 * 同 repo 同分支只探测一次上游，结果广播给各成员。
 * Side Effects: 检查结果逐条写 check_cache。
 * @param {Function} [hash] - 目录哈希门面，缺省新鲜直算
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
 * 更新到上游最新版，目录缺失时即使 commit 未变也拉回。
 * 覆盖发生前由 Host 强制要求确认，避免 UI 外的 API 调用绕过风险提示。
 * 单条失败不中断批次，失败原因进该条 reason。
 * Side Effects: 原子换装库目录、写 skills 表与 check_cache、changed 时触发对账。
 * @throws {SkillManagerError} local-changes-confirmation-required — 检出本地修改且未显式确认
 * @throws {SkillManagerError} path-stale — 记录的 path_in_repo 在上游已失效
 */
export async function update({ root, store, names, confirmLocalChanges = false, ctx, hash }) { // quality-floor: ignore docstring-promise 函数体确有 throw SkillManagerError（local-changes-confirmation-required）；扫描器将参数解构花括号配误作函数体起点致漏看
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
      false,
      [{ label: '含本地修改的条目', value: localChanges.join('、') }],
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
      // upToDate 是结构化标志：缓存回填写判定不依赖 reason 文案
      results.push({ name, status: 'skipped', reason: '已是最新', upToDate: true })
      continue
    }
    try {
      const payload = await fetchZipball(entry.repo, entry.branch)
      // 覆盖走原子换装：新版在临时位置构建并校验完成后才整体替换旧目录。
      // 因此不存在"先删旧再重写"的半写窗口。
      // strict=true：记录的 path_in_repo 在上游失效时报 path-stale 并附候选目录。
      // 临时目录由 withMaterializedSkillDir 的 finally 清理，失败也不漏 tmp。
      await withMaterializedSkillDir(payload, entry.path_in_repo ?? undefined, true, async ({ tmp }) => {
        await atomicSwapDir(dest, (stage) => copyTree(tmp, stage))
      })

      await store.putSkill(name, {
        ...entry,
        commit: head.sha,
        installed_at: nowIso(),
        content_hash: await hashDir(hash, dest, true),
      })
      changed = true

      results.push({ name, status: 'updated', commit: head.sha, via: head.via })
    } catch (error) {
      // 单条失败不中断批次，失败原因进该条 reason。
      results.push({ name, status: 'skipped', reason: error instanceof Error ? error.message : String(error) })
    }
  }
  let sync = null
  if (changed) {
    sync = await ctx.reconcile()
  }
  // 更新结果直接回填检查缓存，行徽章无需等下一次全局检查即翻转为已是最新。
  const cacheEntries = []
  for (const r of results) {
    const entry = entries.get(r.name)
    if (r.status === 'updated') {
      cacheEntries.push({
        name: r.name, repo: entry?.repo, branch: entry?.branch,
        current: r.commit, latest: r.commit, status: 'up_to_date', via: r.via,
        updatable: false, reachable: true, locally_modified: false, baseline_missing: false, missing: false,
      })
    } else if (r.status === 'skipped' && r.upToDate === true) {
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
