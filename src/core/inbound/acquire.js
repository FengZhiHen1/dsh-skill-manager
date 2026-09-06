// dsh-skill-manager — 搜索、仓库探测、入库（入站操作.md；DSR-015 inbound 层）。
// 自原 lib/inbound.js 搬位（P1）。解包原语在 zipball.js；检查/更新在 upstream.js；
// 入库/出库/备份恢复在 backups.js。错误归类由抛出点（net/zipball/base）直给
// SkillManagerError，本层不再做文案转译。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillManagerError } from '../base/errors.js'
import { fetchZipball, ghApi, normalizeRepoSlug, resolveRemote, searchSkillsSh } from '../base/net.js'
import { atomicSwapDir, safePath } from '../base/fsys.js'
import { dirHash, parseSkillMd } from '../model/library.js'
import { copyTree, explodeZipball, nowIso, pathExists, skillsFromFiles, validateInstallName, withMaterializedSkillDir } from './zipball.js'

/** skills.sh 搜索（R-07）。错误语义：net 层异常（remote-unreachable）原样透传。 */
export async function search(query, limit = 20, offset = 0) {
  return searchSkillsSh(String(query ?? ''), limit, offset)
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
 * 仓库探测（R-08）：Trees API 主路径，truncated/失败回退 zipball。
 * 错误语义：net/zipball 层异常（bad-repo/remote-unreachable/bad-zipball）原样透传。
 */
export async function repoSkills(repoSlugInput, branch = 'main') {
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
  } catch { // quality-floor: ignore silent-catch Trees API 失败/截断统一回退 zipball 探测：网络分类不因此丢失（zipball 通道再失败会自行抛码）
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
}

/**
 * 入库（R-08/R-09）。
 * Side Effects: 下载 zipball → 原子换装写入 root 下新目录 → 登记 skills 表 → 触发对账。
 * @throws {SkillManagerError} bad-repo / remote-unreachable / bad-zipball / no-skill-md /
 *   needs-selection / path-stale / bad-name / already-installed / name-conflict / write-failed
 */
export async function add({ root, store, repo: repoInput, dir, ref = 'main', as, ctx }) { // quality-floor: ignore docstring-promise 函数体确有 throw SkillManagerError（already-installed/name-conflict）；扫描器将参数解构花括号配误作函数体起点致漏看
  const repoSlug = normalizeRepoSlug(repoInput)
  const resolved = await resolveRemote(repoSlug, ref)
  const payload = await fetchZipball(repoSlug, resolved.branch)
  return withMaterializedSkillDir(payload, dir, false, async ({ tmp, dir: skillDir }) => {
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
        throw new SkillManagerError('already-installed', `${installName} 已在库中（同仓库），请用更新`, false, [
          { label: 'skill', value: installName },
          { label: '仓库', value: repoSlug },
          { label: '已登记 commit', value: existing.commit ?? '未知' },
        ])
      }
      throw new SkillManagerError(
        'name-conflict',
        `${installName} 已存在（${existing?.origin === 'github' ? 'GitHub 来源' : '自研/本地'}），如需替换请先出库现有版本`,
        false,
        [
          { label: '目标路径', value: dest },
          { label: '现有条目来源', value: existing ? String(existing.origin) : '无登记（仅目录占位）' },
          { label: '欲导入仓库', value: repoSlug },
        ],
      )
    }
    // 原子换装入库（DSR-017）：同卷临时目录构建后 rename 就位，杜绝半写目录
    // 经 junction 实时暴露给 DSH。add 目标不存在（上方 name-conflict 已拦截），
    // 换装退化为直达 rename；tmp 清理由 withMaterializedSkillDir 的 finally 保证。
    await atomicSwapDir(dest, (stage) => copyTree(tmp, stage))

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
}
