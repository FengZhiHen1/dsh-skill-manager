// reconcile — 全量对账：推导期望集 → 摘除孤儿链接 → 物化期望 → 维护 git exclude 托管块。
//
// 边界：无状态写回；未配置目录由 service 层 requireDir 门禁先行拦截。
// 审计（DSR-022）：本层是「谁在什么时候动了哪条链接」的编排点——每一次真实变更（摘除/物化/
//   exclude 写入）经 materialize 的 op 边界落台账；批次结束补一条 batch summary，并在台账
//   自身写失败时往 results 追加 audit-degraded 行（可见但不阻断，业务照常结算）。
//   audit 缺省 = 不记（供无台账上下文复用）。
// 参考：挂载与同步.md「对账流程」「审计台账」；DSR-015/017/022。

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deriveDesired, targetKey } from './derive.js'
import { findOrphanLinks, scanMountLinks } from './inspect.js'
import { materializeOne, removeLink } from './materialize.js'

const EXCLUDE_BEGIN = '# >>> dsh-skill-manager'
const EXCLUDE_END = '# <<< dsh-skill-manager'
/** 宿主 → git exclude 行（托管块按期望集涉及的宿主集合写一或两行）。 */
const EXCLUDE_LINES = { dsh: '/.dsh/skills/', pi: '/.pi/skills/' }

/**
 * 全量对账：推导期望集 → 摘除孤儿链接（归属本插件且不在期望集）→
 * 物化期望（junction-only）→ 维护活动工作区的 git exclude 托管块。
 * 幂等：任意子项失败不影响其他子项，失败进 results。
 * piSkillsRoot 非空时 pi 宿主目标参与同一流程（.pi/skills 物化与 exclude 行）。
 * 双根制（DSR-020）：libraryRoot/srcRootOf 分流 github 条目的源根；缺省 = 单根（用户根）兼容。
 * @param {object} opts - 对账输入；audit/actor/configGen 为台账上下文（缺省不记）
 * @returns {Promise<{results: Array, warnings: Array, errors: Array}>}
 */
export async function reconcile({ root, memberships, mounts, workspacesById, globalRootPath, piSkillsRoot = null, piScanRoot = piSkillsRoot, libraryRoot = null, srcRootOf = null, audit = null, actor = null, configGen = null }) {
  const { desired, warnings } = deriveDesired({ memberships, mounts, workspacesById, globalRootPath, piSkillsRoot })
  const results = []
  // 真实变更计数（供 summary）：noop 不计数、不落条，「执行了但没变化」由此与「没执行」区分。
  let changed = 0

  // 1. 摘除 = 孤儿清扫：owned 且不在期望集 → 删链接（归属判据见 inspect.js）。
  //    扫描语义用 piScanRoot（开关开或规则引用 pi 才扫）：关开关后 pi 残留链接在此步摘除。
  //    逐条隔离（与物化同构）：单条摘除失败进 results，不中断其余子项。
  const links = await scanMountLinks({ root, globalRootPath, workspacesById, piSkillsRoot: piScanRoot, libraryRoot })
  const orphans = await findOrphanLinks({ root, desired, globalRootPath, workspacesById, piSkillsRoot, libraryRoot, links })
  for (const link of orphans) {
    const reason = '孤儿链接（归属本插件且不在期望集）'
    try {
      await removeLink({ path: link.path, audit, actor, skill: link.name, reason, target: link.target, srcRoot: root, configGen })
      changed += 1
      results.push({ name: link.name, target: link.parent, action: 'removed', reason })
    } catch (error) {
      results.push({ name: link.name, target: link.parent, action: 'error', error: error instanceof Error ? error.message : String(error), code: error.code })
    }
  }

  // 2. 物化活动期望（junction-only）；源根按条目来源分流（github→插件库根，其余→用户根）。
  for (const [skill, targets] of desired) {
    const srcRoot = srcRootOf ? srcRootOf(skill) : root
    for (const t of targets) {
      const key = targetKey(t)
      try {
        const r = await materializeOne({ root: srcRoot, skill, t, workspacesById, globalRootPath, piSkillsRoot, libraryRoot, audit, actor, configGen })
        if (r.action === 'mounted') changed += 1
        results.push({ name: skill, target: key, action: r.action, method: 'junction' })
      } catch (error) {
        results.push({ name: skill, target: key, action: 'error', error: error.message, code: error.code })
      }
    }
  }

  // 3. Git exclude 托管块（只更新有 project 级期望的活动工作区；非 Git 项目跳过）。
  changed += await updateGitExcludes({ desired, workspacesById, results, audit, actor, configGen })

  // 4. 批次收尾：summary + 双上限截断 + 台账自证降级。顺序固定——summary 行也计入截断前缀。
  if (audit !== null) {
    await audit.note({ op: 'batch', actor, evaluated: desired.size, orphans: orphans.length, changed, configGen })
    const { failures, file } = await audit.endBatch()
    if (failures > 0) {
      results.push({ name: 'audit', target: file, action: 'audit-degraded', code: 'audit-degraded', error: `审计台账写入失败 ${String(failures)} 次（挂载业务未受影响，详见该行 target）` })
    }
  }

  const errors = results.filter((r) => r.action === 'error')
  return { results, warnings, errors }
}

/** 各工作区期望集涉及的宿主集合（workspaceId → Set<'dsh'|'pi'>）。 */
function projectHostSets(desired) {
  const map = new Map()
  for (const targets of desired.values()) {
    for (const t of targets) {
      if (t.scope === 'project' && typeof t.project === 'string' && t.project !== '') {
        if (!map.has(t.project)) map.set(t.project, new Set())
        map.get(t.project).add(t.host ?? 'dsh')
      }
    }
  }
  return map
}

/**
 * 为活动工作区根写或清 .git/info/exclude 托管块；写失败进 results 单条错误，不中断整单。
 * @returns {Promise<number>} 实际写入次数（供 summary 的 changed 计数）
 */
async function updateGitExcludes({ desired, workspacesById, results, audit = null, actor = null, configGen = null }) {
  const wanted = projectHostSets(desired)
  let written = 0
  for (const [workspaceId, ws] of workspacesById) {
    const excludeFile = join(ws.path, '.git', 'info', 'exclude')
    let text = ''
    try {
      text = await readFile(excludeFile, 'utf8')
    } catch {
      continue // 非 Git 项目或不可读：跳过
    }
    const stripped = stripExcludeBlock(text)
    const next = wanted.has(workspaceId) ? withExcludeBlock(stripped, wanted.get(workspaceId)) : stripped
    if (next === text) continue // 内容未变：不动文件也不落条
    const op = audit === null
      ? null
      : await audit.begin({ op: 'exclude-write', actor, path: excludeFile, skill: null, target: null, srcRoot: null, reason: wanted.has(workspaceId) ? `托管块登记宿主：${[...wanted.get(workspaceId)].join(',')}` : '托管块清空（该工作区已无 project 级期望）', configGen })
    try {
      await writeFile(excludeFile, next, 'utf8')
    } catch (error) {
      await op?.fail(error)
      results.push({ name: 'git-exclude', target: workspaceId, action: 'error', error: error instanceof Error ? error.message : String(error), code: 'write-failed' })
      continue
    }
    await op?.done({ result: 'written' })
    written += 1
  }
  return written
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

function withExcludeBlock(text, hosts) {
  const lines = ['dsh', 'pi'].filter((h) => hosts.has(h)).map((h) => EXCLUDE_LINES[h])
  const block = `${EXCLUDE_BEGIN}\n${lines.join('\n')}\n${EXCLUDE_END}`
  const base = text.replace(/\n+$/, '')
  return base === '' ? `${block}\n` : `${base}\n\n${block}\n`
}
