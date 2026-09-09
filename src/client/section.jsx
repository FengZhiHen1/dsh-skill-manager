// section — 技能设置页骨架：配置即意图 + 管理/搜索两视图页签。
//
// 边界：配置渲染零网络（settings mirror 快照直读），数据读全部经 overview RPC。
// 参考：插件运行时.md「配置即意图」「视图设计」；DSR-011、DSR-017、DSR-018。
import { useState, useEffect, useRef } from 'react'
import { T, S, badgeStyle } from './theme.js'
import { ErrorLine, OutlineBtn, useTick, useToast, ToastHost } from './ui.jsx'
import { buildRepairPrompt, RepairCopy, settingsRejectedRepair } from './repair.jsx'
import { ManageView } from './manage.jsx'
import { SearchView } from './search.jsx'

/**
 * 写后自动收敛的等待窗口：必须大于 Host 对账器的 200ms 防抖（src/adapter/index.js），
 * 让后台对账先落地；即便如此也无需赌时序——随后的 sync 经写队列串行，
 * 与任何在途对账排队相差不远，返回即代表现场已收敛。
 */
const CONVERGE_DELAY_MS = 400

/**
 * 技能页（settings.section 槽位注入组件）。
 * @param {object} props
 * @param {(endpoint: string, payload?: object) => Promise<unknown>} props.call RPC 门面
 * @param {object} props.workspaces 工作区服务面（GroupScopePanel 用）
 * @param {object} props.scope skill-manager settings scope（直读直写）
 * @param {(fn: () => void) => () => void} props.subscribeSkillSettings 配置变更总线订阅（入口 apply 闭包持有）
 */
export function SkillsSection({ call, workspaces, scope, subscribeSkillSettings }) {
  const [tab, setTab] = useState('manage')
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  // 快照显示已配置、但 Host overview 仍报 skilldir-unconfigured → 回到未配置引导
  const [configOverrideUnconfigured, setConfigOverrideUnconfigured] = useState(false)
  const [reloadTick, reload] = useTick()
  // 成功事件瞬态 Toast（宿主原语，顶中浮层自动消散）；warn/error 仍走内联卡（需行动的不自动消失）
  const [toast, showToast, dismissToast] = useToast()

  // ---------- 配置即意图：settings 域直读直写，与原生卡片同构 ----------
  // 写为 scope.set('groups'|'skills', next) 整字段替换：本地即时生效，Host 对账器后台收敛。
  const [snap, setSnap] = useState(() => scope.getSnapshot())
  const [editError, setEditError] = useState(null) // { message, prompt|null }
  useEffect(() => {
    let alive = true
    const apply = () => { if (alive) setSnap(scope.getSnapshot()) }
    const off = scope.subscribe(apply)
    apply()
    return () => { alive = false; off() }
  }, [scope])

  const configReady = snap.status === 'ready' && snap.value && typeof snap.value === 'object'
  const groups = configReady && snap.value.groups && typeof snap.value.groups === 'object' ? snap.value.groups : {}
  const skillsIntent = configReady && snap.value.skills && typeof snap.value.skills === 'object' ? snap.value.skills : {}
  const skillsDir = configReady && typeof snap.value.skillsDir === 'string' ? snap.value.skillsDir : ''

  /**
   * 配置写与拒绝检测，依据 DSH settings-scope.ts 的客户端语义。
   * Host validate 拒绝时 mutate 应答 ok=false，客户端 recover 重载镜像静默回退，set() 照常 resolve 不抛。
   * 因此被拒判定 = 写 resolve 后权威快照的该字段 ≠ 尝试值。
   * set() 抛错只剩传输/围栏类失败（请求未达 Host），单独呈错。
   * 被拒与抛回两态都有明确反馈，无静默。
   * 检测按字段独立比对：多字段编辑（如组改名连改两处）互不误伤。
   * @returns {Promise<boolean>} 该字段是否已被 Host 接受（权威快照与尝试值等值）。
   *   调用方拿到 true 才能说「成功」：先报成功再等结果会把被拒的写说成成功（2026-09-09 走查）。
   *   接受时排一次写后收敛（converge），界面自动反映对账结果，无需人工点「↻ 刷新」。
   */
  const editConfig = (field, next) => {
    setEditError(null)
    return (async () => {
      try {
        await scope.set(field, next)
      } catch (error) {
        setEditError({
          message: `配置「${field}」写入失败（请求未达 Host）：${error?.message ?? String(error)}`,
          prompt: null,
        })
        return false
      }
      const after = scope.getSnapshot()
      const value = after && after.value && typeof after.value === 'object' ? after.value : {}
      if (JSON.stringify(value[field]) !== JSON.stringify(next)) {
        setEditError({
          message: `配置「${field}」被拒绝，已恢复原值（组名保留字/非法字符或格式不合法）。`,
          prompt: buildRepairPrompt({
            root: data && data.root,
            code: 'settings-validation-rejected',
            message: `字段 ${field} 写入被 Host validate 拒绝`,
            repair: settingsRejectedRepair(field, next, value[field], data && data.root),
          }),
        })
        return false
      }
      converge()
      return true
    })()
  }
  const intentOf = (dir) => skillsIntent[dir] || { disabled: false, group: '默认' }
  const setSkillDisabled = (dir, disabled) => {
    editConfig('skills', { ...skillsIntent, [dir]: { ...intentOf(dir), disabled } })
  }
  const moveSkill = (dir, group) => {
    editConfig('skills', { ...skillsIntent, [dir]: { ...intentOf(dir), group } })
  }
  const toggleMount = (group, scopeKind, workspaceId, checked) => {
    const mounts = (groups[group] && groups[group].mounts) || []
    const key = `${scopeKind}|${workspaceId ?? ''}`
    const exists = mounts.some((m) => `${m.scope}|${m.project ?? ''}` === key)
    if (exists === checked) return
    const next = checked
      // 新挂载默认仅 DSH 宿主（用户可在行内宿主 chip 增勾 pi）
      ? [...mounts.filter((m) => `${m.scope}|${m.project ?? ''}` !== key), { scope: scopeKind, project: scopeKind === 'project' ? workspaceId : null, hosts: ['dsh'] }]
      : mounts.filter((m) => `${m.scope}|${m.project ?? ''}` !== key)
    editConfig('groups', { ...groups, [group]: { ...groups[group], mounts: next } })
  }
  // 宿主开关：在挂载规则上增删单个宿主；关掉最后一个宿主 = 死规则，
  // UI 层会把该路径改道取消挂载确认（pendingUnmount），本函数双保险不落空 hosts。
  const toggleHost = (group, scopeKind, workspaceId, host, on) => {
    const mounts = (groups[group] && groups[group].mounts) || []
    const key = `${scopeKind}|${workspaceId ?? ''}`
    const next = mounts.map((m) => {
      if (`${m.scope}|${m.project ?? ''}` !== key) return m
      const hosts = Array.isArray(m.hosts) && m.hosts.length > 0 ? m.hosts : ['dsh']
      const nextHosts = on ? [...new Set([...hosts, host])] : hosts.filter((h) => h !== host)
      return nextHosts.length === 0 ? m : { ...m, hosts: nextHosts }
    })
    editConfig('groups', { ...groups, [group]: { ...groups[group], mounts: next } })
  }
  /**
   * 新建分组：复制「默认」组的挂载规则起步，但**不继承全局作用域**（挂 DSH 全局 = 对该 HOME 的所有会话生效，
   * 只能由用户显式勾选；2026-09-09 口径调整）。项目级规则照抄——那是用户已在默认组表达过的具体意图。
   * @returns {Promise<boolean>} 是否真的落盘（撞名/被 Host 拒绝/传输失败均 false，原因已进错误条）。
   */
  const createGroup = (name) => {
    // 防御：groups 字段是全量覆盖写，撞名会静默覆盖既有组的挂载规则。
    // 撞「默认」还会把默认组重置成复制品，故客户端先拒，Host 不拦。
    if (Object.prototype.hasOwnProperty.call(groups, name)) {
      setEditError({ message: `分组「${name}」已存在，已拒绝创建（避免覆盖既有组的挂载规则）`, prompt: null })
      return Promise.resolve(false)
    }
    const baseMounts = ((groups['默认'] && groups['默认'].mounts) || [])
      .filter((m) => m.scope !== 'global')
      .map((m) => ({ ...m }))
    return editConfig('groups', { ...groups, [name]: { mounts: baseMounts } })
  }
  const renameGroup = (oldName, newName) => {
    // 防御：nextGroups 以 newName 为键——撞既有组名会静默覆盖目标组的规则与成员。
    if (Object.prototype.hasOwnProperty.call(groups, newName)) {
      setEditError({ message: `分组「${newName}」已存在，已拒绝改名（改名会覆盖目标组的规则与成员）`, prompt: null })
      return false
    }
    const nextGroups = {}
    for (const [name, g] of Object.entries(groups)) nextGroups[name === oldName ? newName : name] = g
    const nextSkills = {}
    for (const [dir, intent] of Object.entries(skillsIntent)) {
      nextSkills[dir] = intent.group === oldName ? { ...intent, group: newName } : intent
    }
    editConfig('groups', nextGroups)
    editConfig('skills', nextSkills)
    return true
  }
  const deleteGroup = (name) => {
    const nextGroups = {}
    for (const [n, g] of Object.entries(groups)) if (n !== name) nextGroups[n] = g
    const nextSkills = {}
    for (const [dir, intent] of Object.entries(skillsIntent)) {
      nextSkills[dir] = intent.group === name ? { ...intent, group: '默认' } : intent
    }
    editConfig('groups', nextGroups)
    editConfig('skills', nextSkills)
  }
  const config = { groups, skillsIntent, intentOf, editConfig, setSkillDisabled, moveSkill, toggleMount, toggleHost, createGroup, renameGroup, deleteGroup }

  // 单请求聚合读（低延迟路径）：overview 一次出库列表/行状态/警告/工作区投影。
  // 序号守卫：reloadTick/settings 总线/首刷三源并发时，只有最新一次加载落地，
  // 迟到的旧响应是恒等迁移（既不盖数据也不盖错误）。载荷形状由 createCall 契约保证。
  const loadSeq = useRef(0)
  /**
   * @param {Error|null} [cause] 需要先上屏的前置错误（写后对账失败）：仍要重读 overview 呈现现场，
   *   但失败原因不能被一次成功的读抹掉。普通重读不传，照常清错误。
   */
  const load = (cause = null) => {
    setError(cause)
    const seq = ++loadSeq.current
    return call('overview')
      .then((r) => {
        if (seq !== loadSeq.current) return // 迟到响应不生效
        setConfigOverrideUnconfigured(false)
        setData({
          root: r.root,
          lib: r.lib,
          health: r.health.issues,
          workspaces: r.workspaces,
        })
      })
      .catch((e) => {
        if (seq !== loadSeq.current) return // 迟到的失败同理不覆盖
        // Host 报未配置而快照显示已配置：配置刚保存或外部修改、mirror 未同步，不停在"加载中"
        if (e && e.code === 'skilldir-unconfigured') setConfigOverrideUnconfigured(true)
        else setError(e)
      })
  }
  /**
   * 写后自动收敛刷新（2026-09-09 走查：改完配置必须人工点「↻ 刷新」才见新现场）。
   * 为什么不能立刻重读：settings 提交一 resolve 客户端快照就新了，而 Host 对账器还在
   * 200ms 防抖窗口里，此刻读到的仍是旧物化现场。故：过窗口 → 显式 sync 一次
   * （写队列串行、幂等收敛并预热 bundle 读缓存）→ 重读 overview。
   * 一次编辑连打多次（组改名写两字段）由防抖合并成一次刷新，不抖动。
   */
  const convergeTimer = useRef(null)
  const converge = () => {
    clearTimeout(convergeTimer.current)
    convergeTimer.current = setTimeout(() => {
      void (async () => {
        let cause = null
        try {
          await call('sync', {})
        } catch (error) {
          // 未配置是正常空态（load 的引导分支负责呈现），不当作对账失败上报
          if (error && error.code !== 'skilldir-unconfigured') cause = error
        }
        load(cause)
      })()
    }, CONVERGE_DELAY_MS)
  }
  useEffect(() => () => clearTimeout(convergeTimer.current), [])

  useEffect(() => {
    // 外部改动（手改 settings.yaml、别处写入）经此总线进来：同样先收敛再刷新，口径一致。
    const off = subscribeSkillSettings(converge)
    load()
    return off
  }, [reloadTick, subscribeSkillSettings])

  // 配置未就绪（mirror 加载中）→ 骨架；未配置 → 直接引导（不等 overview，配置渲染零网络）。
  if (!configReady) {
    return <div style={S.panel}><div style={S.muted}>加载中…</div></div>
  }
  if (!skillsDir || configOverrideUnconfigured) {
    return (
      <div style={S.guide}>
        <div style={{ fontSize: 14, marginBottom: 8, color: T.labelPrimary }}>尚未配置本地 skill 目录</div>
        <div>请到 设置 → 插件 → skill-manager 卡片 配置本地 skills 目录（默认为空即未配置），配置后本页自动可用。</div>
        <OutlineBtn style={{ marginTop: 12 }} onClick={reload}>刷新</OutlineBtn>
      </div>
    )
  }
  if (!data) {
    return (
      <div style={S.panel}>
        {error ? (
          <ErrorLineWrap error={error} root={skillsDir} />
        ) : (
          <div style={S.muted}>加载中…</div>
        )}
      </div>
    )
  }

  // 文字页签：激活下划线 + 每页一句副标题，当前为管理/搜索两视图。
  const TABS = [
    { key: 'manage', label: '管理', sub: '先为分组配置可用范围，再管理其中的 Skill。' },
    { key: 'search', label: '搜索', sub: '从 skills.sh 搜索，或直接从 GitHub 仓库入库。' },
  ]
  const activeTab = TABS.find((t) => t.key === tab)
  return (
    <div>
      {/* 页头与页签零横向内缩：外壳 .options 的 24px 就是页边距，官方节（通用/插件）不自加内缩。
          字号 18/600 + 副标题 13 tertiary + 0.5px border-l2 分隔线，与 PluginsSettingsSection 同一口径。 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: T.labelPrimary }}>技能</div>
        <div style={{ fontSize: 13, lineHeight: '20px', color: T.labelTertiary, marginTop: 4 }}>{activeTab ? activeTab.sub : ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 22, marginTop: 2, borderBottom: `0.5px solid ${T.borderL2}` }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            // 官方页签口径：13/20px tertiary → primary，激活只加 2px 下划线不改字重；下划线压住分隔线
            style={{ border: 'none', background: 'none', padding: '7px 1px 9px', font: 'inherit', fontSize: 13, lineHeight: '20px', cursor: 'pointer', marginBottom: -1, color: tab === t.key ? T.labelPrimary : T.labelTertiary, borderBottom: tab === t.key ? `2px solid ${T.labelPrimary}` : '2px solid transparent' }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error ? <ErrorLineWrap error={error} root={data && data.root} /> : null}
      {editError
        ? (
            <div style={{ ...badgeStyle(T.error), borderRadius: 10, padding: '8px 12px', margin: '8px 0 0', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{editError.message}</span>
              {editError.prompt ? <RepairCopy text={editError.prompt} /> : null}
            </div>
          )
        : null}
      {tab === 'manage' && <ManageView call={call} data={data} config={config} reload={reload} showToast={showToast} />}
      {tab === 'search' && <SearchView call={call} reload={reload} showToast={showToast} />}
      <ToastHost toast={toast} onDone={dismissToast} />
    </div>
  )
}

/** 页级错误呈现：RpcError 文案附修复提示词复制入口。 */
function ErrorLineWrap({ error, root }) {
  if (!error) return null
  return (
    <div style={{ ...badgeStyle(T.error), borderRadius: 10, padding: '8px 12px', margin: '4px 0 0', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{error.message || String(error)}</span>
      <RepairCopy text={buildRepairPrompt({ root, code: error.code, message: error.message, repair: error.repair })} />
    </div>
  )
}
