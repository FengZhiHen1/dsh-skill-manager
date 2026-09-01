// dsh-skill-manager — HTTP API 传输层（插件运行时.md）。
// 配置（用户意图）不经过本层：UI 经 settings 域直读直写 settings.yaml 的
// skill-manager 段，Host 对账器监听配置变更后台收敛。本层只提供：
//   - 只读视图：overview（库列表+健康+工作区）、health、backups、project-skills
//   - 网络/文件操作：check/update/add/import/remove/restore/search/repo-skills/
//     claim-empty/sync
// 队列：读请求不排队（bundle 缓存快照 + 写屏障）；文件写 FIFO 串行；
// 网络慢操作独立队列。
// 信封：{ ok:true, data } / { ok:false, error:{ code, message, retryable } }（R-19）。
// 未配置门禁：skills 目录未配置时所有方法统一 skilldir-unconfigured（R-22）。

import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { SkillManagerError } from './errors.js'
import { requireDir, DEFAULT_GROUP } from './dir.js'
import { createSharedCache, hashOf } from './cache.js'
import { dirHash } from './library.js'
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
  if (error instanceof SkillManagerError) {
    writeJson(res, 200, { ok: false, error: { code: error.code, message: error.message, retryable: error.retryable } })
    return
  }
  if (error instanceof ApiError) {
    writeJson(res, 400, { ok: false, error: { code: error.code, message: error.message, retryable: false } })
    return
  }
  if (error && typeof error === 'object' && error.kind !== undefined && typeof error.kind === 'string') {
    // GhError 网络分类（入站操作.md）
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

/** 单飞队列：FIFO 串行，前序失败不阻塞后续；暴露 busy/idle 供读路径对齐写屏障。 */
export function createQueue() {
  let tail = Promise.resolve()
  let pending = 0
  return {
    /** 是否有写操作正在执行（或排队）。 */
    get busy() {
      return pending > 0
    },
    /** 当前排队（含执行中）操作全部结算后 resolve。 */
    idle() {
      return tail
    },
    enqueue(fn) {
      pending += 1
      const run = tail.then(fn)
      tail = run.then(() => undefined, () => undefined)
      return run.finally(() => {
        pending -= 1
      })
    },
  }
}

/**
 * 每请求会话：按当前配置读 skills 目录根，加载全部共享状态（写前重读，R-17）。
 * 配置意图（settings.groups/skills）在 bundle 内展平为挂载规则与组文档。
 * globalRootPath 由 Host 经 dshHomePath 注入（挂载与同步.md「DSH skill 根」）。
 * @param {() => import('@deepseek-ai/dsh-settings').SettingsScope} scopeGetter
 */
export function createSession(scopeGetter, listWorkspaces, getStore, backupsRoot, globalRootPath, shared) {
  const root = requireDir(scopeGetter())
  const store = getStore()
  return {
    root,
    store,
    backupsRoot,
    globalRootPath,
    async bundle() {
      const config = scopeGetter().get()
      const configGroups = config?.groups && typeof config.groups === 'object' ? config.groups : {}
      const intentSkills = config?.skills && typeof config.skills === 'object' ? config.skills : {}
      let workspaceRecords
      try {
        workspaceRecords = await listWorkspaces()
        stateMod.normalizeWorkspaceProjects(workspaceRecords)
      } catch (error) {
        if (error instanceof SkillManagerError && error.code === 'workspace-unavailable') throw error
        throw new SkillManagerError('workspace-unavailable', `无法读取 DSH 工作区注册表：${error instanceof Error ? error.message : String(error)}`, true)
      }
      // 库扫描（元数据 + github 记录）；意图字段由配置叠加（本地 skill 无登记）。
      const items = await library.scanLibrary(root, store, { meta: shared?.meta })
      const viewItems = items.map((it) => {
        const intent = intentSkills[it.dir]
        return intent
          ? {
              ...it,
              disabled: intent.disabled === true,
              group: typeof intent.group === 'string' && intent.group !== '' ? intent.group : DEFAULT_GROUP,
            }
          : it
      })
      const skills = viewItems.filter((it) => !it.disabled && !it.missing).map((it) => it.dir)
      // 配置挂载展平（global 的 project 归一为 null；形状非法项跳过，对账容忍）。
      const mounts = []
      for (const [group, g] of Object.entries(configGroups)) {
        for (const m of Array.isArray(g?.mounts) ? g.mounts : []) {
          if (!m || typeof m !== 'object') continue
          if (m.scope !== 'global' && m.scope !== 'project') continue
          mounts.push({
            group,
            app: 'dsh',
            scope: m.scope,
            project: m.scope === 'project' && typeof m.project === 'string' ? m.project : null,
          })
        }
      }
      const groupsDoc = groupsMod.makeGroups(configGroups, intentSkills, new Set(skills))
      const state = await stateMod.loadState(store)
      const before = JSON.stringify(state)
      stateMod.mirrorWorkspaceProjects(state, workspaceRecords, mounts)
      if (JSON.stringify(state) !== before) await stateMod.saveState(store, state)
      // 镜像刷新可能改写项目镜像，因此在写盘后重新计算摘要。
      const snapshot = stateMod.mirrorWorkspaceProjects(state, workspaceRecords, mounts)
      return {
        root,
        items: viewItems,
        skills,
        mounts,
        groups: groupsDoc.groups,
        state,
        apps: { dsh: { ...stateMod.DSH_APP } },
        workspaceProjects: snapshot.workspaceProjects,
        legacyProjects: snapshot.legacyProjects,
        workspaceIds: snapshot.workspaceIds,
      }
    },
    async saveState(state) {
      await stateMod.saveState(store, state)
    },
    async reconcile(method = 'auto') {
      const b = await this.bundle()
      return syncMod.reconcile({
        root,
        state: b.state,
        apps: b.apps,
        groups: b.groups,
        skills: b.skills,
        mounts: b.mounts,
        workspaceIds: b.workspaceIds,
        globalRootPath,
        method,
        save: (s) => this.saveState(s),
      })
    },
  }
}

/** 方法表：所有方法在未配置门禁之后执行。getStore 在请求时解析，域未就绪抛错 → internal。 */
export function buildApi(scopeGetter, { listWorkspaces = () => [], getStore, backupsRoot, globalRoot, cache } = {}) {
  const shared = cache ?? createSharedCache()
  const session = () => createSession(scopeGetter, listWorkspaces, getStore, backupsRoot, globalRoot, shared)
  const hashOfDir = hashOf(shared, dirHash)

  /**
   * 读路径统一入口：命中进程内 bundle 缓存（root 键 + TTL + 单飞冷扫）即
   * 零扫描返回冻结快照；缓存冷时并发读共享同一次扫描。
   */
  async function getBundle() {
    const root = requireDir(scopeGetter())
    if (shared.bundle !== null && shared.bundleRoot === root && Date.now() - shared.bundleAt < shared.bundleTtlMs) {
      return shared.bundle
    }
    if (shared.bundleInflight === null) {
      shared.bundleInflight = session().bundle()
        .then((b) => {
          shared.bundle = b
          shared.bundleRoot = root
          shared.bundleAt = Date.now()
          return b
        })
        .finally(() => {
          shared.bundleInflight = null
        })
    }
    return shared.bundleInflight
  }

  /**
   * 写路径收尾：重算并预热 bundle 缓存 + 清空哈希缓存，使随后的读请求
   * （UI 操作后的 reload）命中预热快照。失败不掩盖写结果：清缓存，
   * 下次读冷扫兜底。
   */
  async function refreshCache() {
    try {
      const b = await session().bundle()
      shared.bundle = b
      shared.bundleRoot = b.root
      shared.bundleAt = Date.now()
    } catch {
      shared.bundle = null
      shared.bundleRoot = null
      shared.bundleAt = 0
    } finally {
      shared.hashes.clear()
    }
  }

  /**
   * health 代际缓存：同一 bundle 引用 + TTL 内复用文件系统走查结果。
   * 写操作 refreshCache 换新 bundle 引用 → 自然失效重算。
   */
  async function getHealth(b) {
    const cached = shared.health
    if (cached !== null && cached.bundle === b && Date.now() - cached.at < shared.bundleTtlMs) {
      return cached.issues
    }
    const issues = await syncMod.health({
      root: b.root,
      state: b.state,
      apps: b.apps,
      groups: b.groups,
      skills: b.skills,
      mounts: b.mounts,
      workspaceIds: b.workspaceIds,
      globalRootPath: globalRoot,
    })
    shared.health = { bundle: b, issues, at: Date.now() }
    return issues
  }

  /** 只读视图派生：库列表（含挂载目标推导与检查缓存）+ 健康。 */
  async function deriveOverview(b) {
    const { desired, warnings } = syncMod.deriveDesired({
      state: b.state, apps: b.apps, groups: b.groups, skills: b.skills, mounts: b.mounts, workspaceIds: b.workspaceIds,
    })
    const cache = await stateMod.loadCheckCache(getStore())
    const skills = b.items
      .map((it) => ({
        ...it,
        targets: [...(desired.get(it.dir) ?? [])].map(syncMod.targetKey),
        upstream: cache.results[it.dir] ?? null,
      }))
    return {
      root: b.root,
      lib: { skills, warnings, checkedAt: cache.checkedAt },
      health: { issues: await getHealth(b) },
      workspaceProjects: b.workspaceProjects,
      legacyProjects: b.legacyProjects,
    }
  }

  return {
    /** 只读视图：技能页单请求出列表/健康/工作区（配置经 settings 域直读）。 */
    async 'overview'() {
      return deriveOverview(await getBundle())
    },

    /** 启动预热（只读）：Host 空闲时预热 bundle 扫描与 health，首次打开秒出。 */
    async 'warm'() {
      await deriveOverview(await getBundle())
      return { ok: true }
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
      const result = await inbound.add({
        root: s.root,
        store: s.store,
        repo: String(payload.repo ?? ''),
        dir: payload.dir ? String(payload.dir) : undefined,
        ref: payload.ref ? String(payload.ref) : 'main',
        as: payload.as ? String(payload.as) : undefined,
        ctx: s,
      })
      await refreshCache()
      return result
    },

    async 'check'(payload) {
      const s = session()
      return inbound.check({
        root: s.root,
        store: s.store,
        names: Array.isArray(payload.names) ? payload.names.map(String) : undefined,
        hash: hashOfDir,
      })
    },

    async 'update'(payload) {
      const s = session()
      const result = await inbound.update({
        root: s.root,
        store: s.store,
        names: Array.isArray(payload.names) ? payload.names.map(String) : undefined,
        confirmLocalChanges: payload.confirmLocalChanges === true,
        ctx: s,
        hash: hashOfDir,
      })
      await refreshCache()
      return result
    },

    async 'import'(payload) {
      const s = session()
      const result = await inbound.importSkill({ root: s.root, store: s.store, path: String(payload.path ?? ''), as: payload.as ? String(payload.as) : undefined, ctx: s })
      await refreshCache()
      return result
    },

    async 'backups'() {
      const s = session()
      return inbound.backups({ store: s.store, backupsRoot: s.backupsRoot })
    },

    async 'restore'(payload) {
      const s = session()
      const result = await inbound.restore({ root: s.root, store: s.store, id: String(payload.id ?? ''), backupsRoot: s.backupsRoot, ctx: s })
      await refreshCache()
      return result
    },

    async 'remove'(payload) {
      const s = session()
      const result = await inbound.remove({ root: s.root, store: s.store, name: String(payload.name ?? ''), keepFiles: payload.keepFiles === true, backupsRoot: s.backupsRoot, ctx: s })
      await refreshCache()
      return result
    },

    async 'project-skills'(payload = {}) {
      const b = await getBundle()
      const workspaceId = payload.workspaceId ? String(payload.workspaceId) : ''
      if (workspaceId !== '' && !b.workspaceIds.has(workspaceId)) {
        throw new SkillManagerError('workspace-not-found', `DSH 工作区「${workspaceId}」不存在或已移除`)
      }
      const entries = {}
      for (const workspace of b.workspaceProjects) {
        if (workspaceId !== '' && workspace.workspaceId !== workspaceId) continue
        entries[workspace.workspaceId] = await syncMod.classifyProjectEntries(b.root, workspace.path)
      }
      return { workspaceProjects: b.workspaceProjects, entries, legacyProjects: b.legacyProjects }
    },

    async 'claim-empty'(payload) {
      const s = session()
      const b = await s.bundle()
      const name = String(payload.name ?? '')
      const workspaceId = String(payload.workspaceId ?? '')
      if (!b.workspaceIds.has(workspaceId)) {
        throw new SkillManagerError('workspace-not-found', `DSH 工作区「${workspaceId}」不存在或已移除`)
      }
      const path = b.state.projects[workspaceId]
      const { entries, base } = await syncMod.classifyProjectEntries(s.root, path)
      const entry = entries.find((item) => item.name === name)
      if (!entry || entry.kind !== 'local-empty') {
        throw new SkillManagerError('bad-claim', `目标不是空目录现场: ${name}`)
      }
      const records = Array.isArray(b.state.synced[name]) ? b.state.synced[name] : []
      if (records.some((record) => record?.scope === 'project' && record.project === workspaceId && record.method === 'copy')) {
        throw new SkillManagerError('bad-claim', `目标仍由本插件 copy 记录管理，拒绝删除: ${name}`)
      }
      await rm(join(base, name), { recursive: true, force: true })
      const sync = await s.reconcile()
      await refreshCache()
      return { name, workspaceId, sync }
    },

    async 'sync'(payload) {
      const s = session()
      const result = await s.reconcile(payload.method ? String(payload.method) : 'auto')
      await refreshCache()
      return result
    },

    async 'health'() {
      const b = await getBundle()
      return { issues: await getHealth(b) }
    },
  }
}
