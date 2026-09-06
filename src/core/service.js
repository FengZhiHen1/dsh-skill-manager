// service — 应用服务层：UI/Host 的全部读写端点在此编排。
//
// 边界：配置不经过本层，UI 直读写 settings.yaml；本层绝不抛出越过 dispatch 的错误。
// 队列：读请求不入队但受写屏障对齐（写进行中读等写队列结算）；文件写 FIFO 串行；网络慢操作独立队列。
// 出站载荷经 contract.js 校验（Host 侧回归闸），Client 侧同模块复验。
// 参考：插件运行时.md「RPC 传输」「请求调度与缓存」；DSR-013/014/017。

import { SkillManagerError, buildRepair } from './base/errors.js'
import { requireDir, DEFAULT_GROUP } from './model/intent.js'
import { createSharedCache, hashOf } from './base/cache.js'
import { ContractError, parseEndpointPayload } from './model/contract.js'
import { dirHash } from './model/library.js'
import * as library from './model/library.js'
import { readCheckCache } from './model/store.js'
import { deriveDesired, projectWorkspaces, targetKey } from './mount/derive.js'
import { SKILL_NAME, findOrphanLinks, scanMountLinks, walkMountState } from './mount/inspect.js'
import * as reconcileMod from './mount/reconcile.js'
import * as acquire from './inbound/acquire.js'
import * as upstream from './inbound/upstream.js'
import * as backupsMod from './inbound/backups.js'

/** 读方法：不排队，直接走进程内 bundle 缓存快照（写屏障由 createQueue.busy 对齐）。 */
const READ_METHODS = new Set(['overview', 'warm', 'backups'])
/** 网络慢方法：独立队列，绝不阻塞读写。 */
const NET_METHODS = new Set(['check', 'search', 'repo-skills'])
// 其余方法（add/update/remove/restore/sync）= 文件写操作，FIFO 串行。

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

/** 工作区投影读取：注册表异常统一 workspace-unavailable（不读写任何项目目录）。 */
async function readWorkspaceProjection(listWorkspaces) {
  try {
    return projectWorkspaces(await listWorkspaces())
  } catch (error) {
    if (error instanceof SkillManagerError && error.code === 'workspace-unavailable') throw error
    throw new SkillManagerError(
      'workspace-unavailable',
      `无法读取 DSH 工作区注册表：${error instanceof Error ? error.message : String(error)}`,
      true,
      [{ label: '注册表错误', value: error instanceof Error ? error.message : String(error) }],
    )
  }
}

/**
 * 每请求会话：按当下配置解析 skills 目录根，组装只读 bundle 快照。
 * 无台账：期望集由 settings 意图与工作区投影现算，行状态由文件系统走查现算。
 * globalRootPath 由 Host 注入，本层不自行推导 DSH 根。
 * @param {() => SettingsScope} scopeGetter - settings 句柄取器，命名空间注册见 adapter/settings.js
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
      const workspacesById = await readWorkspaceProjection(listWorkspaces)
      // 库扫描（目录 + 入库元数据）；意图字段由 settings 叠加（本地 skill 无登记）。
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
      // 参与推导的 skill 集 = 未禁用且未缺失。
      const skills = viewItems.filter((it) => !it.disabled && !it.missing).map((it) => it.dir)
      // 配置挂载展平（global 的 project 归一为 null；形状非法项跳过，对账容忍）。
      const mounts = []
      for (const [group, g] of Object.entries(configGroups)) {
        for (const m of Array.isArray(g?.mounts) ? g.mounts : []) {
          if (!m || typeof m !== 'object') continue
          if (m.scope !== 'global' && m.scope !== 'project') continue
          mounts.push({
            group,
            scope: m.scope,
            project: m.scope === 'project' && typeof m.project === 'string' && m.project !== '' ? m.project : null,
          })
        }
      }
      // 成员归属：失效组引用回落「默认」，不因此拒绝整份配置。
      const memberships = new Map(skills.map((dir) => {
        const g = intentSkills?.[dir]?.group
        return [dir, typeof g === 'string' && g !== '' && (g in configGroups || g === DEFAULT_GROUP) ? g : DEFAULT_GROUP]
      }))
      const { desired, warnings } = deriveDesired({ memberships, mounts, workspacesById, globalRootPath })
      // 行状态走查与孤儿集共用同一次扫描，结果随 bundle 快照一起失效。
      const links = await scanMountLinks({ root, globalRootPath, workspacesById })
      const mountRows = await walkMountState({ root, desired, links, globalRootPath, workspacesById })
      const orphans = await findOrphanLinks({ root, desired, globalRootPath, workspacesById, links })
      const mountCount = new Map([...workspacesById.keys()].map((id) => [id, 0]))
      const counted = new Set()
      for (const m of mounts) {
        if (m.scope === 'project' && m.project != null && mountCount.has(m.project)) {
          const key = `${m.project}\0${m.group}`
          if (!counted.has(key)) {
            counted.add(key)
            mountCount.set(m.project, mountCount.get(m.project) + 1)
          }
        }
      }
      const workspacesView = [...workspacesById.values()].map((ws) => ({ ...ws, mountCount: mountCount.get(ws.workspaceId) ?? 0 }))
      return {
        root,
        items: viewItems,
        skills,
        mounts,
        memberships,
        desired,
        warnings,
        workspacesById,
        workspacesView,
        links,
        mountRows,
        orphans,
      }
    },
    /** 全量对账：现算期望并收敛挂载，junction-only。 */
    async reconcile() {
      const b = await this.bundle()
      return reconcileMod.reconcile({
        root,
        memberships: b.memberships,
        mounts: b.mounts,
        workspacesById: b.workspacesById,
        globalRootPath,
      })
    },
  }
}

/** 方法表：所有方法在未配置门禁之后执行。getStore 在请求时解析，域未就绪抛错 → internal。 */
export function buildApi(scopeGetter, { listWorkspaces = () => [], getStore, backupsRoot, globalRoot, cache, logger } = {}) {
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
      const gen = shared.bundleGen
      shared.bundleInflight = session().bundle()
        .then((b) => {
          // 代际守卫：冷扫在途期间发生写后刷新（gen 递进）→ 本快照已旧，
          // 返回给本次调用方但不回写共享缓存（迟到响应不覆盖新快照）。
          if (shared.bundleGen === gen) {
            shared.bundle = b
            shared.bundleRoot = root
            shared.bundleAt = Date.now()
          }
          return b
        })
        .finally(() => {
          shared.bundleInflight = null
        })
    }
    return shared.bundleInflight
  }

  /**
   * 写路径收尾：递进缓存代际（使在途旧冷扫的回写失效），重算并预热 bundle 快照，
   * 同时清空哈希缓存。于是写后的读请求（UI reload）直接命中热缓存。
   * 失败不掩盖写结果：清缓存，让下次读走冷扫兜底；诊断记 logger。
   */
  async function refreshCache() {
    shared.bundleGen += 1
    try {
      const b = await session().bundle()
      shared.bundle = b
      shared.bundleRoot = b.root
      shared.bundleAt = Date.now()
    } catch (error) {
      shared.bundle = null
      shared.bundleRoot = null
      shared.bundleAt = 0
      logger?.warn?.(`dsh-skill-manager: 写后缓存重建失败（下次读走冷扫兜底）：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      shared.hashes.clear()
    }
  }

  /** 行状态问题全集（走查 issue + 孤儿），bundle 代际内零额外 IO。 */
  function mountIssuesOf(b) {
    const issues = []
    for (const [name, rows] of b.mountRows) {
      for (const row of rows) issues.push({ name, target: row.target, issue: row.issue })
    }
    for (const l of b.orphans) issues.push({ name: l.name, target: l.path, issue: 'orphan-link' })
    return issues
  }

  /** 只读视图派生（同步：扫描与走查已在 bundle 冷扫中完成）。 */
  function deriveOverview(b) {
    const checkCache = readCheckCache(getStore())
    const skills = b.items.map((it) => ({
      ...it,
      nameVisible: SKILL_NAME.test(it.dir),
      targets: [...(b.desired.get(it.dir) ?? [])].map(targetKey),
      mount: (b.mountRows.get(it.dir) ?? []).map((row) => ({ ...row })),
      upstream: checkCache.results[it.dir] ?? null,
    }))
    return {
      root: b.root,
      lib: { skills, warnings: [...b.warnings], checkedAt: checkCache.checkedAt },
      health: { issues: mountIssuesOf(b) },
      workspaces: b.workspacesView,
    }
  }

  return {
    /** 只读视图：技能页单请求出列表/行状态/工作区（配置经 settings 域直读）。 */
    async 'overview'() {
      return deriveOverview(await getBundle())
    },

    /** 启动预热（只读）：Host 空闲时预热 bundle 扫描与行状态，首次打开秒出。 */
    async 'warm'() {
      deriveOverview(await getBundle())
      return { ok: true }
    },

    /** skills.sh 搜索：网络队列端点。门禁只查目录配置（不依赖 storage 域就绪——搜索不碰台账）。 */
    async 'search'(payload) {
      requireDir(scopeGetter())
      const limit = Number(payload.limit ?? 20)
      const offset = Number(payload.offset ?? 0)
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
        throw new SkillManagerError('bad-payload', `search 参数非法：limit=${String(payload.limit ?? 20)}（1–100 整数），offset=${String(payload.offset ?? 0)}（非负整数）`)
      }
      return acquire.search(String(payload.query ?? ''), limit, offset)
    },

    /** 仓库探测：列出该仓库内含 SKILL.md 的候选目录（同 search 只挂目录门禁）。 */
    async 'repo-skills'(payload) {
      requireDir(scopeGetter())
      return acquire.repoSkills(String(payload.repo ?? ''), payload.ref ? String(payload.ref) : 'main')
    },

    /** 入库：zipball 落地为原子换装，随后登记并触发对账。 */
    async 'add'(payload) {
      const s = session()
      const result = await acquire.add({
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

    /** 上游检查：三态结果逐条回填 check_cache。 */
    async 'check'(payload) {
      const s = session()
      return upstream.check({
        root: s.root,
        store: s.store,
        names: Array.isArray(payload.names) ? payload.names.map(String) : undefined,
        hash: hashOfDir,
      })
    },

    /** 覆盖更新：检出本地修改时必须带显式确认。 */
    async 'update'(payload) {
      const s = session()
      const result = await upstream.update({
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

    /** 备份列表：以备份目录实际内容为事实源。 */
    async 'backups'() {
      const s = session()
      return backupsMod.backups({ backupsRoot: s.backupsRoot })
    },

    /** 从备份恢复：目标占位则拒绝，就位走原子换装。 */
    async 'restore'(payload) {
      const s = session()
      const result = await backupsMod.restore({ root: s.root, store: s.store, id: String(payload.id ?? ''), backupsRoot: s.backupsRoot, ctx: s })
      await refreshCache()
      return result
    },

    /** 出库：仅限 github 来源登记，先自动备份再摘链与删目录。 */
    async 'remove'(payload) {
      const s = session()
      const workspacesById = await readWorkspaceProjection(listWorkspaces)
      const result = await backupsMod.remove({
        root: s.root,
        store: s.store,
        name: String(payload.name ?? ''),
        backupsRoot: s.backupsRoot,
        workspacesById,
        globalRootPath: globalRoot,
      })
      await refreshCache()
      return result
    },

    /** 全量对账端点：自身幂等收敛，收敛后预热读缓存。 */
    async 'sync'() {
      const s = session()
      const result = await s.reconcile()
      await refreshCache()
      return result
    },
  }
}

/**
 * 任意错误 → RPC Result 失败侧，绝不外抛。
 * 外抛会让 handler 退化成平台 500 纯文本，客户端只剩 transport failure 兜底。
 * SkillManagerError 用自身 code/retryable/facts；GhError 的 kind 直通错误码；
 * ContractError（出站校验违例）归 contract-violation，不可重试。
 * 其余一律归 internal 且不可重试。
 * repair 由 base/errors.js 的码表模板加动态 facts 组装。
 * @param {string} operation - 端点名，注入 repair.operation
 */
export function toRpcFailure(error, operation) {
  if (error instanceof SkillManagerError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: { retryable: error.retryable, repair: buildRepair(error.code, { operation, facts: error.facts }) },
      },
    }
  }
  if (error instanceof ContractError) {
    return {
      ok: false,
      error: { code: 'contract-violation', message: error.message, details: { retryable: false, repair: buildRepair('contract-violation', { operation }) } },
    }
  }
  if (error && typeof error === 'object' && typeof error.kind === 'string') {
    const code = error.kind
    const retryable = ['unreachable', 'rate-limited'].includes(code)
    return {
      ok: false,
      error: { code, message: error.message ?? String(error), details: { retryable, repair: buildRepair(code, { operation }) } },
    }
  }
  return {
    ok: false,
    error: {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: { retryable: false, repair: buildRepair('internal', { operation }) },
    },
  }
}

/**
 * connection.rpc 通道分发器：按方法表三路排队，结果与错误统一包成平台 Result。
 * READ 直返快照（写屏障对齐）/ NET 走网络队列 / 其余走 WRITE FIFO。
 * 出站载荷默认经 contract.js 校验（validate=false 仅供假 api 的队列语义测试关闭）。
 * signal 刻意不透传：写操作半途而废即半成品现场，断连也必须跑完。
 * 读与网络操作短平快，无取消价值。
 * @returns {(endpoint: string, payload: unknown) => Promise<{ok: boolean, value?: unknown, error?: object}>}
 */
export function createDispatch(api, { writeQueue = createQueue(), netQueue = createQueue(), validate = true } = {}) {
  return async function dispatch(endpoint, payload) {
    if (typeof endpoint !== 'string' || !Object.hasOwn(api, endpoint)) {
      return {
        ok: false,
        error: {
          code: 'unknown-endpoint',
          message: `unknown skill-manager endpoint "${String(endpoint)}"`,
          details: { retryable: false, repair: buildRepair('unknown-endpoint', { operation: String(endpoint) }) },
        },
      }
    }
    const input = payload && typeof payload === 'object' ? payload : {}
    try {
      const invoke = () => Promise.resolve(api[endpoint](input))
      const raw = READ_METHODS.has(endpoint)
        ? await (writeQueue.busy ? writeQueue.idle().then(invoke) : invoke())
        : NET_METHODS.has(endpoint)
          ? await netQueue.enqueue(invoke)
          : await writeQueue.enqueue(invoke)
      // 出站校验：Host 自身回归在此拦截，脏载荷不出通道
      const value = validate ? parseEndpointPayload(endpoint, raw) : raw
      return { ok: true, value }
    } catch (error) {
      return toRpcFailure(error, endpoint)
    }
  }
}
