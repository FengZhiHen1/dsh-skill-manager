// dsh-skill-manager — junction 物化与摘除（挂载与同步.md「物化」；DSR-015 mount 层）。
// 自原 lib/sync.js 搬位（P1，逻辑未动）：copy 兜底与 method 参数按批次纪律保留，
// junction-only 收敛在 P2。removeLink 原为模块内私有 helper，供 reconcile 兄弟模块使用而导出。

import { cp, lstat, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SkillManagerError } from '../base/errors.js'
import { canonicalPath, pathsEqual, readLinkTarget, safePath, withinRoot } from '../base/fsys.js'
import { dirHash } from '../model/library.js'
import { activeWorkspaceIds, targetDirOf } from './derive.js'

const EXCLUDE_BEGIN = '# >>> dsh-skill-manager'
const EXCLUDE_END = '# <<< dsh-skill-manager'

/** 是否为链接（junction 在 lstat 下也是 symlink）。 */
export async function isLink(path) {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch {
    return false
  }
}

export async function removeLink(path) {
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
  // copy 副本记录内容哈希：之后仅未改动的 copy 才允许被替换/摘除（挂载与同步.md）。
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

/** 维护项目 .git/info/exclude 托管块（挂载与同步.md 对账流程第 4 步）。 */
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
