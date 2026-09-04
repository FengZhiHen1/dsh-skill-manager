// dsh-skill-manager — 上游检查与更新（入站操作.md；DSR-015 inbound 层）。
// 自原 lib/inbound.js 搬位（P1，逻辑未动）。解包原语在 zipball.js。

import { rm } from 'node:fs/promises'
import { SkillManagerError } from '../base/errors.js'
import { fetchZipball, remoteHead } from '../base/net.js'
import { atomicSwapDir, safePath } from '../base/fsys.js'
import { dirHash } from '../model/library.js'
import { copyTree, materializeSkillDir, nowIso, pathExists } from './zipball.js'

/**
 * 目录哈希门面：显式传入 hash（生产为带 TTL 缓存的 hashOf）时走它；
 * fresh=true 强制重算（update 的本地修改判定禁止用陈旧基线）。
 * 未传入（测试/纯函数路径）→ 直接新鲜直算。
 */
const hashDir = (hash, dir, fresh = false) => (hash !== undefined ? hash(dir, { fresh }) : dirHash(dir))

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

/**
 * 合并有上游（repo）的检查结果进缓存；无上游条目（skipped）不入缓存。
 * 两表面无独立缓存对象（DSR-017）：逐条 putCheck，键即安装名。
 */
async function mergeCheckCache(store, results, checkedAt = nowIso()) {
  for (const r of results) {
    if (!r || !r.repo) continue
    await store.putCheck(r.name, cacheEntryFromCheck(r, checkedAt))
  }
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
      results.push({ name, status: 'skipped', reason: '已是最新' })
      continue
    }
    try {
      const payload = await fetchZipball(entry.repo, entry.branch)
      // strict：记录的 path_in_repo 失效时报 path-stale + 候选（入站操作.md）
      const { tmp } = await materializeSkillDir(payload, entry.path_in_repo ?? undefined, true)
      // 覆盖语义（原子换装，DSR-017/入站操作.md）：新版在临时位置构建完成并
      // 校验后 rename 交换替换旧目录，再清理旧目录；不存在删旧后重写的半写窗口。
      await atomicSwapDir(dest, async (stage) => {
        await copyTree(tmp, stage)
        await rm(tmp, { recursive: true, force: true })
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
      // 单条失败不中断批次（入站操作.md 批量更新语义）
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
