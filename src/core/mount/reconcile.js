// reconcile — 全量对账：推导期望集 → 摘除孤儿链接 → 物化期望 → 维护 git exclude 托管块。
//
// 边界：无状态写回；未配置目录由 service 层 requireDir 门禁先行拦截。
// 参考：挂载与同步.md「对账流程」；DSR-015/017。

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deriveDesired, targetKey } from './derive.js'
import { findOrphanLinks, scanMountLinks } from './inspect.js'
import { materializeOne, removeLink } from './materialize.js'

const EXCLUDE_BEGIN = '# >>> dsh-skill-manager'
const EXCLUDE_END = '# <<< dsh-skill-manager'
const EXCLUDE_LINE = '/.dsh/skills/'

/**
 * 全量对账：推导期望集 → 摘除孤儿链接（归属本插件且不在期望集）→
 * 物化期望（junction-only）→ 维护活动工作区的 git exclude 托管块。
 * 幂等：任意子项失败不影响其他子项，失败进 results。
 * @returns {Promise<{results: Array, warnings: Array, errors: Array}>}
 */
export async function reconcile({ root, memberships, mounts, workspacesById, globalRootPath }) {
  const { desired, warnings } = deriveDesired({ memberships, mounts, workspacesById, globalRootPath })
  const results = []

  // 1. 摘除 = 孤儿清扫（同一归属判据，无第二张台账）：owned 且不在期望集 → 删链接。
  //    逐条隔离（与物化同构）：单条摘除失败进 results，不中断其余子项。
  const links = await scanMountLinks({ root, globalRootPath, workspacesById })
  const orphans = await findOrphanLinks({ root, desired, globalRootPath, workspacesById, links })
  for (const link of orphans) {
    try {
      await removeLink(link.path)
      results.push({ name: link.name, target: link.parent, action: 'removed', reason: '孤儿链接（归属本插件且不在期望集）' })
    } catch (error) {
      results.push({ name: link.name, target: link.parent, action: 'error', error: error instanceof Error ? error.message : String(error), code: error.code })
    }
  }

  // 2. 物化活动期望（junction-only）。
  for (const [skill, targets] of desired) {
    for (const t of targets) {
      const key = targetKey(t)
      try {
        const r = await materializeOne({ root, skill, t, workspacesById, globalRootPath })
        results.push({ name: skill, target: key, action: r.action, method: 'junction' })
      } catch (error) {
        results.push({ name: skill, target: key, action: 'error', error: error.message, code: error.code })
      }
    }
  }

  // 3. Git exclude 托管块（只更新有 project 级期望的活动工作区；非 Git 项目跳过）。
  await updateGitExcludes({ desired, workspacesById, results })

  const errors = results.filter((r) => r.action === 'error')
  return { results, warnings, errors }
}

/** 需要写 exclude 托管块的工作区集合（desired 中 project 作用域目标的 workspaceId）。 */
function projectIdsWithDesired(desired) {
  const ids = new Set()
  for (const targets of desired.values()) {
    for (const t of targets) {
      if (t.scope === 'project' && typeof t.project === 'string' && t.project !== '') ids.add(t.project)
    }
  }
  return ids
}

/** 为活动工作区根写或清 .git/info/exclude 托管块；写失败进 results 单条错误，不中断整单。 */
async function updateGitExcludes({ desired, workspacesById, results }) {
  const wanted = projectIdsWithDesired(desired)
  for (const [workspaceId, ws] of workspacesById) {
    const excludeFile = join(ws.path, '.git', 'info', 'exclude')
    let text = ''
    try {
      text = await readFile(excludeFile, 'utf8')
    } catch {
      continue // 非 Git 项目或不可读：跳过
    }
    const stripped = stripExcludeBlock(text)
    const next = wanted.has(workspaceId) ? withExcludeBlock(stripped) : stripped
    if (next === text) continue
    try {
      await writeFile(excludeFile, next, 'utf8')
    } catch (error) {
      results.push({ name: 'git-exclude', target: workspaceId, action: 'error', error: error instanceof Error ? error.message : String(error), code: 'write-failed' })
    }
  }
}

function stripExcludeBlock(text) {
  let out = text
  while (out.includes(EXCLUDE_BEGIN) && out.includes(EXCLUDE_END)) {
    const pre = out.split(EXCLUDE_BEGIN, 1)[0]
    const rest = out.slice(out.indexOf(EXCLUDE_BEGIN) + EXCLUDE_BEGIN.length)
    const post = rest.slice(rest.indexOf(EXCLUDE_END) + EXCLUDE_END.length)
    out = `${pre.replace(/\n+$/, '')}${post ? `\n${post.replace(/^\n+/, '')}` : ''}`
  }
  return out.replace(/\n+$/, '')
}

function withExcludeBlock(text) {
  const block = `${EXCLUDE_BEGIN}\n${EXCLUDE_LINE}\n${EXCLUDE_END}`
  const base = text.replace(/\n+$/, '')
  return base === '' ? `${block}\n` : `${base}\n\n${block}\n`
}
