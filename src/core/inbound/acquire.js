// dsh-skill-manager — 搜索、仓库探测、入库（入站操作.md；DSR-015 inbound 层）。
// 自原 lib/inbound.js 搬位（P1，逻辑未动）。解包原语在 zipball.js；
// 检查/更新在 upstream.js；导入/出库/备份恢复在 backups.js。

import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillManagerError } from '../base/errors.js'
import { fetchZipball, ghApi, normalizeRepoSlug, resolveRemote, searchSkillsSh } from '../base/net.js'
import { atomicSwapDir, safePath } from '../base/fsys.js'
import { dirHash, parseSkillMd } from '../model/library.js'
import { copyTree, explodeZipball, materializeSkillDir, nowIso, pathExists, skillsFromFiles, validateInstallName } from './zipball.js'

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
  // 原子换装入库（DSR-017）：同卷临时目录构建后 rename 就位，杜绝半写目录
  // 经 junction 实时暴露给 DSH。add 目标不存在（上方 name-conflict 已拦截），
  // 换装退化为直达 rename。
  await atomicSwapDir(dest, async (stage) => {
    await copyTree(tmp, stage)
    await rm(tmp, { recursive: true, force: true })
  })

  // 入库元数据只投影版本事实；disabled/group 是 settings 意图，绝不写入（DSR-011/017）。
  await store.putSkill(installName, {
    origin: 'github',
    repo: repoSlug,
    branch: resolved.branch,
    commit: resolved.commit,
    path_in_repo: actualSubdir,
    content_hash: await dirHash(dest),
    origin_path: null,
    installed_at: nowIso(),
  })

  const sync = await ctx.reconcile()
  return {
    name: installName,
    repo: repoSlug,
    branch: resolved.branch,
    commit: resolved.commit,
    sync,
  }
})
