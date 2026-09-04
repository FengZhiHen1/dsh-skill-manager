// dsh-skill-manager — 应用服务层（原 lib/api.js → P1 搬位；P2 语义收敛：
// 无台账 bundle、行状态走查、junction-only、备份目录事实源；P4 传输迁移：
// connection.rpc 通道 + createDispatch 三路队列 + Result 包装，插件运行时.md）。
// 配置（用户意图）不经过本层：UI 经 settings 域直读直写 settings.yaml 的
// skill-manager 段，Host 对账器监听配置变更后台收敛。本层只提供：
//   - 只读视图：overview（库列表+行状态+工作区投影）、warm、backups
//   - 网络/文件操作：check / search / repo-skills / add / update / remove /
//     restore / sync（11 端点终表，插件运行时.md；health/import/
//     project-skills/claim-empty/config 已随 DSR-016/017 废止）
// 队列：读请求不排队（bundle 缓存快照 + 写屏障）；文件写 FIFO 串行；
// 网络慢操作独立队列。
// 结果形状（Host 平台契约，connection.rpc）：{ok:true,value} 或
// {ok:false,error:{code,message,details:{retryable}}}；本层绝不抛出越过
// dispatch 的错误（未配置门禁等统一转 Result 失败侧）。

import { SkillManagerError } from './base/errors.js'
import { requireDir, DEFAULT_GROUP, makeGroups } from './model/intent.js'
import { createSharedCache, hashOf } from './base/cache.js'
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
    throw new SkillManagerError('workspace-unavailable', `无法读取 DSH 工作区注册表：${error instanceof Error ? error.message : String(error)}`, true)
  }
}

/**
 * 每请求会话：按当前配置读 skills 目录根，组装只读 bundle（无台账：期望集来自
 * settings 意图 + 工作区投影现算，行状态来自文件系统走查，DSR-017）。
 * globalRootPath 由 Host 经 dshHomePath 注入（挂载与同步.md「DSH skill 根」）。
 * @param {() => SettingsScope} scopeGetter - 类型为 @deepseek-ai/dsh-settings 的 SettingsScope（命名空间注册在 src/adapter/settings.js）
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
      // 参与推导的 skill 集 = 未禁用且未缺失（挂载与同步.md「挂载推导」）。
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
      // 成员归属：失效组引用回落「默认」（目录配置与状态存储.md 不变式）。
      const memberships = new Map(skills.map((dir) => {
        const g = intentSkills?.[dir]?.group
        return [dir, typeof g === 'string' && g !== '' && (g in configGroups || g === DEFAULT_GROUP) ? g : DEFAULT_GROUP]
      }))
      const groupsDoc = makeGroups(configGroups, intentSkills, new Set(skills))
      const { desired, warnings } = deriveDesired({ memberships, mounts, workspacesById, globalRootPath })
      // 行状态走查 + 孤儿集：一次扫描，代际随 bundle 引用失效（插件运行时.md 缓存表）。
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
        groups: groupsDoc.groups,
        desired,
        warnings,
        workspacesById,
        workspacesView,
        links,
        mountRows,
        orphans,
      }
    },
    /** 全量对账（junction-only，无 method 参数，DSR-017）。 */
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

    async 'search'(payload) {
      session() // 未配置门禁（R-22：search 也在门禁内）
      return acquire.search(payload.query, Number(payload.limit ?? 20), Number(payload.offset ?? 0))
    },

    async 'repo-skills'(payload) {
      session() // 未配置门禁
      return acquire.repoSkills(String(payload.repo ?? ''), payload.ref ? String(payload.ref) : 'main')
    },

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

    async 'check'(payload) {
      const s = session()
      return upstream.check({
        root: s.root,
        store: s.store,
        names: Array.isArray(payload.names) ? payload.names.map(String) : undefined,
        hash: hashOfDir,
      })
    },

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

    async 'backups'() {
      const s = session()
      return backupsMod.backups({ backupsRoot: s.backupsRoot })
    },

    async 'restore'(payload) {
      const s = session()
      const result = await backupsMod.restore({ root: s.root, store: s.store, id: String(payload.id ?? ''), backupsRoot: s.backupsRoot, ctx: s })
      await refreshCache()
      return result
    },

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

    /** 全量对账（自身即幂等收敛；method 参数随 junction-only 删除，DSR-017）。 */
    async 'sync'() {
      const s = session()
      const result = await s.reconcile()
      await refreshCache()
      return result
    },
  }
}

/**
 * 任意错误 → RPC Result 失败侧（平台契约 error 形状 {code,message,details}；
 * retryable 归入 details，由客户端 createCall 消费做重试提示）。GhError 的
 * kind 字段直通错误码（入站操作.md 网络分类）。绝不外抛——handler 抛异常会
 * 退化成平台 500 纯文本，客户端只剩 transport failure 兜底。
 */
export function toRpcFailure(error) {
  if (error instanceof SkillManagerError) {
    return { ok: false, error: { code: error.code, message: error.message, details: { retryable: error.retryable } } }
  }
  if (error && typeof error === 'object' && typeof error.kind === 'string') {
    return {
      ok: false,
      error: {
        code: error.kind,
        message: error.message ?? String(error),
        details: { retryable: ['unreachable', 'rate_limited'].includes(error.kind) },
      },
    }
  }
  return {
    ok: false,
    error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: { retryable: false } },
  }
}

/**
 * connection.rpc 通道分发器：按方法表三路排队（READ 快照直返 / NET 网络队列 /
 * 其余 WRITE FIFO），把结果与错误统一包成平台 Result。signal 刻意不透传：
 * 写操作半途而废即半成品现场，断连也必须跑完；读与网络操作短平快无取消价值。
 * @returns {(endpoint: string, payload: unknown) => Promise<{ok: boolean, value?: unknown, error?: object}>}
 */
export function createDispatch(api, { writeQueue = createQueue(), netQueue = createQueue() } = {}) {
  return async function dispatch(endpoint, payload) {
    if (typeof endpoint !== 'string' || !Object.hasOwn(api, endpoint)) {
      return {
        ok: false,
        error: { code: 'unknown-endpoint', message: `unknown skill-manager endpoint "${String(endpoint)}"`, details: { retryable: false } },
      }
    }
    const input = payload && typeof payload === 'object' ? payload : {}
    try {
      const invoke = () => Promise.resolve(api[endpoint](input))
      const value = READ_METHODS.has(endpoint)
        ? await (writeQueue.busy ? writeQueue.idle().then(invoke) : invoke())
        : NET_METHODS.has(endpoint)
          ? await netQueue.enqueue(invoke)
          : await writeQueue.enqueue(invoke)
      return { ok: true, value }
    } catch (error) {
      return toRpcFailure(error)
    }
  }
}
