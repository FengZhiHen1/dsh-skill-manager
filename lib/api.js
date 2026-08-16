// dsh-skill-manager — HTTP API 传输层（plugin-runtime.md）。
// 单飞队列：所有请求 FIFO 串行，读写共用队列保证一致快照（R-17）。
// 信封：{ ok:true, data } / { ok:false, error:{ code, message, retryable } }（R-19）。
// 未配置门禁：车间根未配置时所有方法统一 workshop-unconfigured（R-22）。

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { WorkshopError } from './errors.js'
import { requireRoot } from './workshop.js'
import * as workshopFiles from './workshop.js'
import * as library from './library.js'
import * as groupsMod from './groups.js'
import * as stateMod from './state.js'
import * as syncMod from './sync.js'
import * as inbound from './inbound.js'

const MAX_BODY_BYTES = 1 << 20

export class ApiError extends Error {
  code
  retryable
  constructor(code, message, retryable = false) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.retryable = retryable
  }
}

export async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new ApiError('bad-request', 'request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError('bad-request', 'request body is not valid JSON')
  }
}

export function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function writeOk(res, value) {
  writeJson(res, 200, { ok: true, data: value })
}

/** 任意错误 → 信封；未知错误归类 internal，不冒泡杀死 Host。 */
export function writeError(res, error) {
  if (error instanceof WorkshopError) {
    writeJson(res, 200, { ok: false, error: { code: error.code, message: error.message, retryable: error.retryable } })
    return
  }
  if (error instanceof ApiError) {
    writeJson(res, 400, { ok: false, error: { code: error.code, message: error.message, retryable: false } })
    return
  }
  if (error && typeof error === 'object' && error.kind !== undefined && typeof error.kind === 'string') {
    // GhError 网络分类（inbound-operations.md）
    writeJson(res, 200, {
      ok: false,
      error: {
        code: error.kind,
        message: error.message ?? String(error),
        retryable: ['unreachable', 'rate_limited'].includes(error.kind),
      },
    })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message, retryable: false } })
}

/** 单飞队列：串行执行，前序失败不阻塞后续。 */
export function createQueue() {
  let tail = Promise.resolve()
  return {
    enqueue(fn) {
      const run = tail.then(fn)
      tail = run.catch(() => {})
      return run
    },
  }
}

/** 车间 skill 目录名集合。 */
async function skillDirs(root) {
  let entries = []
  try {
    entries = await readdir(join(root, 'skills'), { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  return entries.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
}

/**
 * 每请求会话：按当前配置读车间根，加载全部共享文档（写前重读，R-17）。
 * @param {() => import('@deepseek-ai/dsh-settings').SettingsScope} scopeGetter
 */
function createSession(scopeGetter) {
  const root = requireRoot(scopeGetter())
  return {
    root,
    async bundle() {
      const [state, appsDoc, groups, skills, stateMissing] = await Promise.all([
        stateMod.loadState(root),
        stateMod.ensureDshApp(root),
        groupsMod.loadGroups(root, new Set(await skillDirs(root))),
        skillDirs(root),
        stateMod.stateFileMissing(root),
      ])
      // 默认挂载种子：仅全新车间（文件缺失）时写入（workshop-files.md）
      if (stateMissing && state.mounts.length === 0) {
        const seed = stateMod.defaultSeedMounts(appsDoc.apps)
        if (seed.length > 0) {
          state.mounts = seed
          await stateMod.saveState(root, state)
        }
      }
      return { state, apps: appsDoc.apps, groups: groupsDoc(groups), skills }
    },
    async saveState(state) {
      await stateMod.saveState(root, state)
    },
    async saveGroups(doc) {
      await groupsMod.saveGroups(root, doc)
    },
    async reconcile(method = 'auto') {
      const b = await this.bundle()
      return syncMod.reconcile({
        root,
        state: b.state,
        apps: b.apps,
        groups: b.groups,
        skills: b.skills,
        method,
        save: (s) => this.saveState(s),
      })
    },
    async loadLock() {
      return library.loadLock(root)
    },
  }
}

function groupsDoc(doc) {
  return doc.groups
}

/** 方法表：所有方法在未配置门禁之后执行。 */
export function buildApi(scopeGetter) {
  const session = () => createSession(scopeGetter)

  return {
    async 'library'(payload) {
      const s = session()
      const b = await s.bundle()
      const items = await library.scanLibrary(s.root, b.groups)
      const { desired, warnings } = syncMod.deriveDesired({ state: b.state, apps: b.apps, groups: b.groups, skills: b.skills })
      const origin = payload.origin ? String(payload.origin) : ''
      const groupFilter = payload.group ? String(payload.group) : ''
      const q = payload.q ? String(payload.q).toLowerCase() : ''
      const skills = items
        .filter((it) => (origin === '' || it.origin === origin))
        .filter((it) => (groupFilter === '' || (groupFilter === '默认' ? it.group === null : it.group === groupFilter)))
        .filter((it) => (q === '' || it.name.toLowerCase().includes(q) || it.description.toLowerCase().includes(q)))
        .map((it) => ({
          ...it,
          group: it.group ?? '默认',
          targets: [...(desired.get(it.dir) ?? [])].map(syncMod.targetKey),
        }))
      return { skills, warnings }
    },

    async 'groups'() {
      const s = session()
      const b = await s.bundle()
      const membership = {}
      for (const [group, members] of Object.entries(b.groups)) {
        for (const m of members) membership[m] = group
      }
      return {
        groups: groupsMod.groupSummary(b.groups),
        membership,
        mounts: b.state.mounts,
        projects: b.state.projects,
        apps: b.apps,
      }
    },

    async 'groups/op'(payload) {
      const s = session()
      const b = await s.bundle()
      const action = String(payload.action ?? '')
      const doc = { version: 1, groups: { ...b.groups } }
      if (action === 'create') {
        const newGroup = String(payload.name ?? '')
        groupsMod.createGroup(doc, newGroup)
        // 新建组时复制默认组现有挂载规则作为起步（mount-sync.md）
        for (const m of b.state.mounts) {
          if (m.group !== '默认') continue
          const copy = { ...m, group: newGroup }
          const dup = b.state.mounts.some(
            (x) => x.group === newGroup && x.app === copy.app && x.scope === copy.scope && (x.project ?? '') === (copy.project ?? ''),
          )
          if (!dup) b.state.mounts.push(copy)
        }
        await s.saveState(b.state)
      } else if (action === 'rename') groupsMod.renameGroup(doc, String(payload.name ?? ''), String(payload.newName ?? ''))
      else if (action === 'delete') groupsMod.deleteGroup(doc, String(payload.name ?? ''))
      else if (action === 'move') {
        const dir = String(payload.dir ?? '')
        if (!b.skills.includes(dir)) throw new WorkshopError('not-found', `库中不存在 skill: ${dir}`)
        groupsMod.setMembership(doc, dir, payload.group ? String(payload.group) : null)
      } else throw new WorkshopError('bad-request', `未知的分组操作: ${action}`)
      await s.saveGroups(doc)
      const sync = await s.reconcile()
      return { groups: groupsMod.groupSummary(doc.groups), sync }
    },

    async 'search'(payload) {
      session() // 未配置门禁（R-22：search 也在门禁内）
      return inbound.search(payload.query, Number(payload.limit ?? 20), Number(payload.offset ?? 0))
    },

    async 'repo-skills'(payload) {
      session() // 未配置门禁
      return inbound.repoSkills(String(payload.repo ?? ''), payload.ref ? String(payload.ref) : 'main')
    },

    async 'add'(payload) {
      const s = session()
      return inbound.add({
        root: s.root,
        repo: String(payload.repo ?? ''),
        dir: payload.dir ? String(payload.dir) : undefined,
        ref: payload.ref ? String(payload.ref) : 'main',
        as: payload.as ? String(payload.as) : undefined,
        ctx: s,
      })
    },

    async 'check'(payload) {
      const s = session()
      return inbound.check({ root: s.root, names: Array.isArray(payload.names) ? payload.names.map(String) : undefined })
    },

    async 'update'(payload) {
      const s = session()
      return inbound.update({
        root: s.root,
        names: Array.isArray(payload.names) ? payload.names.map(String) : undefined,
        ctx: s,
      })
    },

    async 'import'(payload) {
      const s = session()
      return inbound.importSkill({ root: s.root, path: String(payload.path ?? ''), as: payload.as ? String(payload.as) : undefined, ctx: s })
    },

    async 'backups'() {
      const s = session()
      return inbound.backups({ root: s.root })
    },

    async 'restore'(payload) {
      const s = session()
      return inbound.restore({ root: s.root, id: String(payload.id ?? ''), ctx: s })
    },

    async 'remove'(payload) {
      const s = session()
      return inbound.remove({ root: s.root, name: String(payload.name ?? ''), keepFiles: payload.keepFiles === true, ctx: s })
    },

    async 'disable'(payload) {
      const s = session()
      return inbound.disable({ root: s.root, name: String(payload.name ?? ''), ctx: s })
    },

    async 'enable'(payload) {
      const s = session()
      return inbound.enable({ root: s.root, name: String(payload.name ?? ''), ctx: s })
    },

    async 'mounts'(payload) {
      const s = session()
      const b = await s.bundle()
      const action = String(payload.action ?? '')
      const mount = {
        group: String(payload.group ?? ''),
        app: String(payload.app ?? 'dsh'),
        scope: String(payload.scope ?? 'global'),
        project: payload.project ? String(payload.project) : null,
      }
      if (mount.group !== '默认' && !(mount.group in b.groups)) {
        throw new WorkshopError('group-not-found', `组「${mount.group}」不存在`)
      }
      if (action === 'add') {
        stateMod.validateMountShape(b.state, b.apps, mount)
        stateMod.addMount(b.state, mount)
      } else if (action === 'remove') {
        stateMod.removeMount(b.state, mount)
      } else throw new WorkshopError('bad-request', `未知的挂载操作: ${action}`)
      await s.saveState(b.state)
      const sync = await s.reconcile()
      return { sync }
    },

    async 'projects'(payload) {
      const s = session()
      const b = await s.bundle()
      const action = String(payload.action ?? '')
      if (action === 'add') {
        await stateMod.projectOps.add(b.state, String(payload.name ?? ''), String(payload.path ?? ''))
      } else if (action === 'rename') {
        stateMod.projectOps.rename(b.state, String(payload.name ?? ''), String(payload.newName ?? ''))
      } else if (action === 'edit-path') {
        await editProjectPath(s, b, String(payload.name ?? ''), String(payload.path ?? ''))
        await s.saveState(b.state)
        const sync = await s.reconcile()
        return { projects: b.state.projects, mounts: b.state.mounts, sync }
      } else if (action === 'remove') {
        const name = String(payload.name ?? '')
        const referenced = stateMod.projectReferenced(b.state, name)
        if (referenced && payload.cascade !== true) {
          throw new WorkshopError('project-referenced', `项目 ${name} 仍被挂载引用，请确认级联删除`)
        }
        if (referenced) b.state.mounts = b.state.mounts.filter((m) => m.project !== name)
        stateMod.projectOps.remove(b.state, name)
      } else throw new WorkshopError('bad-request', `未知的项目操作: ${action}`)
      await s.saveState(b.state)
      const sync = await s.reconcile()
      return { projects: b.state.projects, mounts: b.state.mounts, sync }
    },

    async 'project-skills'(payload) {
      const s = session()
      const b = await s.bundle()
      const out = {}
      for (const [name, path] of Object.entries(b.state.projects)) {
        if (payload.project && payload.project !== name) continue
        out[name] = await syncMod.classifyProjectEntries(s.root, path)
      }
      return { projects: out }
    },

    async 'claim-empty'(payload) {
      const s = session()
      const b = await s.bundle()
      const name = String(payload.name ?? '')
      const project = String(payload.project ?? '')
      const path = b.state.projects[project]
      if (!path) throw new WorkshopError('project-not-found', `项目「${project}」未注册`)
      const { entries, base } = await syncMod.classifyProjectEntries(s.root, path)
      const entry = entries.find((e) => e.name === name)
      if (!entry || entry.kind !== 'local-empty') {
        throw new WorkshopError('bad-claim', `目标不是空目录现场: ${name}`)
      }
      const { rm } = await import('node:fs/promises')
      await rm(join(base, name), { recursive: true, force: true })
      const sync = await s.reconcile()
      return { name, sync }
    },

    async 'sync'(payload) {
      const s = session()
      return s.reconcile(payload.method ? String(payload.method) : 'auto')
    },

    async 'health'() {
      const s = session()
      const b = await s.bundle()
      return { issues: await syncMod.health({ root: s.root, state: b.state, apps: b.apps, groups: b.groups, skills: b.skills }) }
    },
  }
}

/** 改项目路径：先摘除旧位置链接，全部成功才写新路径（mount-sync.md）。 */
async function editProjectPath(s, b, name, newPath) {
  if (!b.state.projects[name]) throw new WorkshopError('project-not-found', `项目「${name}」不存在`)
  await stateMod.validateProjectPath(newPath)
  for (const [other, existing] of Object.entries(b.state.projects)) {
    if (other !== name && existing === newPath) throw new WorkshopError('project-exists', `路径已被项目注册：${newPath}`)
  }
  const failures = []
  for (const [skill, records] of Object.entries(b.state.synced)) {
    const kept = []
    for (const rec of records) {
      const belongs = rec.scope === 'project' && rec.project === name
      if (belongs) {
        try {
          await syncMod.detachOne(rec)
          continue // 摘除成功，不保留记录
        } catch (error) {
          failures.push(`${skill} @ ${rec.dir}: ${error.message}`)
        }
      }
      kept.push(rec)
    }
    b.state.synced[skill] = kept
  }
  if (failures.length > 0) {
    throw new WorkshopError('detach-failed', `摘除旧位置链接失败（未做任何变更，请处理后重试）: ${failures.join('; ')}`)
  }
  b.state.projects[name] = newPath
}
