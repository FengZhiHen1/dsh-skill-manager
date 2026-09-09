// acquire — 搜索、仓库探测与入库：把远端 skill 取进库目录。
//
// 边界：错误归类由抛出点直给 SkillManagerError，本层不做文案转译。
// 参考：入站操作.md「搜索与仓库探测」「add」。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillManagerError } from '../base/errors.js'
import { fetchZipball, ghApi, normalizeRepoSlug, resolveRemote, searchSkillsSh } from '../base/net.js'
import { atomicSwapDirAudited, pathExists, safePath } from '../base/fsys.js'
import { dirHash, parseSkillMd } from '../model/library.js'
import { copyTree, explodeZipball, nowIso, skillsFromFiles, validateInstallName, withMaterializedSkillDir } from './zipball.js'

/** skills.sh 搜索：net 层异常原样透传，本层不二次包装。 */
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
 * 仓库探测：列出含 SKILL.md 的候选目录。
 * Trees API 为主路径，结果截断或请求失败时回退 zipball 探测。
 * net 与 zipball 层的异常原样透传，本层不二次包装。
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
 * 入库：下载 zipball，落到插件库根（root，DSR-020 双根制）并登记，随后触发对账。
 * 定位子目录走非 strict：指定路径未命中时回退自动探测，不报 path-stale。
 * 撞名检查双根：插件库根占位（登记/目录）与用户根同名自研目录都拦。
 * Side Effects: 原子换装写入 root 下新目录 → 登记 skills 表 → 触发对账。
 * @throws {SkillManagerError} 解析与网络：bad-repo / remote-unreachable / bad-zipball
 * @throws {SkillManagerError} 目录定位：no-skill-md / needs-selection
 * @throws {SkillManagerError} 落库：bad-name / already-installed / name-conflict / write-failed / registration-failed
 * @throws {GhError} 下载失败按 kind 归类，由 dispatch 直通为稳定错误码
 */
export async function add({ root, userRoot = null, store, repo: repoInput, dir, ref = 'main', as, ctx }) { // quality-floor: ignore docstring-promise 函数体确有 throw SkillManagerError（already-installed/name-conflict）；扫描器将参数解构花括号配误作函数体起点致漏看
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
    // 双根制撞名：用户根（自研/本地目录）存在同名目录也拒绝——否则入库即遮蔽用户内容
    if (userRoot !== null && (await pathExists(join(userRoot, installName)))) {
      throw new SkillManagerError('name-conflict', `${installName} 与本地目录中的自研/本地 skill 同名，请先改名或移开本地目录`, false, [
        { label: '本地目录', value: join(userRoot, installName) },
        { label: '欲导入仓库', value: repoSlug },
      ])
    }
    // 入库走原子换装：同卷临时目录构建后 rename 就位，杜绝半写目录暴露给 DSH。
    // add 目标此处必不存在（上方 name-conflict 已拦截），换装退化为直达 rename。
    // tmp 清理由 withMaterializedSkillDir 的 finally 保证。
    await atomicSwapDirAudited(dest, (stage) => copyTree(tmp, stage), {
      audit: ctx?.audit ?? null,
      actor: ctx?.actor ?? null,
      skill: installName,
      srcRoot: root,
      reason: `入库（${repoSlug}）：zipball 换装就位`,
      configGen: ctx?.configGen ?? null,
    })

    // 入库元数据只投影版本事实；disabled/group 属 settings 意图，绝不写进登记表。
    // 换装已成功、登记失败不能静默：目录已在库内而台账无记录，必须显式失败让用户知情。
    try {
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
    } catch (error) {
      throw new SkillManagerError('registration-failed', `${installName} 内容已入库但登记失败：${error instanceof Error ? error.message : String(error)}`, false, [
        { label: '库内路径', value: dest },
        { label: '仓库', value: repoSlug },
      ])
    }

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
