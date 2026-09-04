// dsh-skill-manager — 技能设置页骨架：配置即意图 + 两视图页签（插件运行时.md L185「数据源」与「视图设计」L195）。
// 渲染即时（settings mirror 快照直读，永不等待网络）；列表/行状态/工作区来自单次 overview；
// 配置写 = scope.set('groups'|'skills', next) 整字段替换（本地即时生效，Host 对账器后台收敛；DSR-011）。
import { useState, useEffect } from 'react'
import { T, S, badgeStyle } from './theme.js'
import { ErrorLine, OutlineBtn, useTick } from './ui.jsx'
import { buildRepairPrompt, RepairCopy, settingsRejectedRepair } from './repair.jsx'
import { ManageView } from './manage.jsx'
import { SearchView } from './search.jsx'

// 配置变更通知总线：卡片保存/重置 skillsDir（settings/document-updated 由入口转发）→ 技能页自动刷新。
const settingsListeners = new Set()
export function subscribeSkillSettings(fn) {
  settingsListeners.add(fn)
  return () => settingsListeners.delete(fn)
}
export function bumpSkillSettings() {
  for (const fn of [...settingsListeners]) fn()
}

export function SkillsSection({ call, workspaces, scope }) {
  const [tab, setTab] = useState('manage')
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  // 快照显示已配置、但 Host overview 仍报 skilldir-unconfigured（配置卡片刚改、mirror 未同步）→ 回到未配置引导
  const [configOverrideUnconfigured, setConfigOverrideUnconfigured] = useState(false)
  const [reloadTick, reload] = useTick()

  // ---------- 配置即意图（settings 域直读直写，与原生卡片同构） ----------
  const [snap, setSnap] = useState(() => scope.getSnapshot())
  const [editError, setEditError] = useState(null) // { message, prompt }
  const [pendingEdit, setPendingEdit] = useState(null) // { field, value }
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

  // 写被拒检测：scope.set 失败时 settings 客户端静默回滚（mirror 恢复服务端值）→ 对比检测后提示 + 复制修复提示词。
  useEffect(() => {
    if (!pendingEdit) return
    const current = configReady ? snap.value[pendingEdit.field] : undefined
    const equal = JSON.stringify(current) === JSON.stringify(pendingEdit.value)
    if (!equal) {
      setEditError({
        message: `配置「${pendingEdit.field}」被拒绝，已恢复原值（组名保留字/非法字符或格式不合法）。`,
        prompt: buildRepairPrompt({
          root: data && data.root,
          code: 'settings-validation-rejected',
          message: `字段 ${pendingEdit.field} 写入被 Host validate 拒绝`,
          repair: settingsRejectedRepair(pendingEdit.field, pendingEdit.value, current, data && data.root),
        }),
      })
    }
    setPendingEdit(null)
  }, [snap])

  const editConfig = (field, next) => {
    setEditError(null)
    setPendingEdit({ field, value: next })
    scope.set(field, next).catch(() => {})
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
      ? [...mounts.filter((m) => `${m.scope}|${m.project ?? ''}` !== key), { scope: scopeKind, project: scopeKind === 'project' ? workspaceId : null }]
      : mounts.filter((m) => `${m.scope}|${m.project ?? ''}` !== key)
    editConfig('groups', { ...groups, [group]: { ...groups[group], mounts: next } })
  }
  const createGroup = (name) => {
    const baseMounts = ((groups['默认'] && groups['默认'].mounts) || []).map((m) => ({ ...m }))
    editConfig('groups', { ...groups, [name]: { mounts: baseMounts } })
  }
  const renameGroup = (oldName, newName) => {
    const nextGroups = {}
    for (const [name, g] of Object.entries(groups)) nextGroups[name === oldName ? newName : name] = g
    const nextSkills = {}
    for (const [dir, intent] of Object.entries(skillsIntent)) {
      nextSkills[dir] = intent.group === oldName ? { ...intent, group: newName } : intent
    }
    editConfig('groups', nextGroups)
    editConfig('skills', nextSkills)
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
  const config = { groups, skillsIntent, intentOf, editConfig, setSkillDisabled, moveSkill, toggleMount, createGroup, renameGroup, deleteGroup }

  // 单请求聚合读（低延迟路径）：overview 一次出库列表/行状态/警告/工作区投影。
  const load = () => {
    setError(null)
    return call('overview')
      .then((r) => {
        setConfigOverrideUnconfigured(false)
        setData({
          root: r.root,
          lib: r.lib,
          health: (r.health && r.health.issues) || [],
          workspaces: r.workspaces || [],
        })
      })
      .catch((e) => {
        // Host 说未配置而快照说有（配置竞态：刚保存/外部改动）→ 回到未配置引导，不停在"加载中"
        if (e && e.code === 'skilldir-unconfigured') setConfigOverrideUnconfigured(true)
        else setError(e)
      })
  }
  useEffect(() => {
    const off = subscribeSkillSettings(load)
    load()
    return off
  }, [reloadTick])

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

  // 文字页签：激活下划线 + 每页一句副标题（两视图，同步视图随 DSR-017 废止）。
  const TABS = [
    { key: 'manage', label: '管理', sub: '先为分组配置可用范围，再管理其中的 Skill。' },
    { key: 'search', label: '搜索', sub: '从 skills.sh 搜索，或直接从 GitHub 仓库入库。' },
  ]
  const activeTab = TABS.find((t) => t.key === tab)
  return (
    <div>
      <div style={{ padding: '4px 12px 0', marginBottom: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: T.labelPrimary }}>技能</div>
        <div style={{ fontSize: 13, color: T.labelTertiary, marginTop: 4 }}>{activeTab ? activeTab.sub : ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 20, padding: '0 12px', borderBottom: `1px solid ${T.borderL1}` }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{ border: 'none', background: 'none', padding: '6px 2px 8px', font: 'inherit', fontSize: 13, cursor: 'pointer', marginBottom: -1, color: tab === t.key ? T.labelPrimary : T.labelSecondary, fontWeight: tab === t.key ? 500 : 400, borderBottom: tab === t.key ? `2px solid ${T.labelPrimary}` : '2px solid transparent' }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error ? <ErrorLineWrap error={error} root={data && data.root} /> : null}
      {editError
        ? (
            <div style={{ ...badgeStyle(T.error), borderRadius: 10, padding: '8px 12px', margin: '8px 12px 0', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>{editError.message}</span>
              <RepairCopy text={editError.prompt} />
            </div>
          )
        : null}
      {tab === 'manage' && <ManageView call={call} data={data} config={config} reload={reload} />}
      {tab === 'search' && <SearchView call={call} reload={reload} />}
    </div>
  )
}

/** 页级错误呈现：RpcError 带修复复制入口（DSR-018 RPC 失败面）。 */
function ErrorLineWrap({ error, root }) {
  if (!error) return null
  return (
    <div style={{ ...badgeStyle(T.error), borderRadius: 10, padding: '8px 12px', margin: '4px 12px 0', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1 }}>{error.message || String(error)}</span>
      <RepairCopy text={buildRepairPrompt({ root, code: error.code, message: error.message, repair: error.repair })} />
    </div>
  )
}
