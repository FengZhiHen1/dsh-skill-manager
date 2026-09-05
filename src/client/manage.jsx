// dsh-skill-manager — 管理视图（插件运行时.md「视图设计·管理视图」L197-208：分组优先、两视图、行徽章与 ⋯ 菜单按来源分化）。
// 列表过滤纯前端（零请求）；行状态徽章来自 overview（走查随快照下发）；挂载失败徽章点击展开明细并复制修复提示词（DSR-018）。
import { useState, useMemo } from 'react'
import { Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import { T, S, badgeStyle, cardStyle, cardTitle, noteText, dotStyle, sectionHead, statusPillStyle } from './theme.js'
import { GhostBtn, OutlineBtn, PrimaryBtn, ErrorLine, NoticeBar, RowMenu, UpdateConfirmationDialog, ModalShell } from './ui.jsx'
import { buildRepairPrompt, RepairCopy, mountIssueRepair } from './repair.jsx'

const ORIGIN_LABEL = { github: 'GitHub', local: '本地', self: '自研' }

/** targetKey（`scope|project`，derive.js 单源）转人话。 */
function targetLabel(target, workspaces) {
  if (typeof target !== 'string') return String(target ?? '—')
  if (target.startsWith('global|')) return 'DSH 全局'
  const id = target.slice('project|'.length)
  const ws = workspaces.find((w) => w.workspaceId === id)
  return ws ? ws.title : `工作区 ${id.slice(0, 8)}…`
}

export function ManageView({ call, data, config, reload }) {
  const [origin, setOrigin] = useState('')
  const [groupFilter, setGroupFilter] = useState('默认')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [pendingUpdate, setPendingUpdate] = useState(null)
  const [menuFor, setMenuFor] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [expandedMount, setExpandedMount] = useState(null)

  const { groups, skillsIntent, setSkillDisabled, moveSkill, renameGroup, deleteGroup } = config

  // 显示行 = 库元数据（只读视图）叠加配置意图（settings，本地即时）
  const displaySkills = useMemo(() => data.lib.skills.map((it) => {
    const intent = skillsIntent[it.dir]
    return intent ? { ...it, disabled: intent.disabled === true, group: intent.group } : it
  }), [data.lib.skills, skillsIntent])

  // 列表本地过滤（低延迟路径）：origin/group/q 均为纯前端条件，零请求零延迟。
  const list = useMemo(() => {
    const query = q.trim().toLowerCase()
    return displaySkills.filter((it) => (
      (origin === '' || it.origin === origin)
      && (groupFilter === '' || it.group === groupFilter)
      && (query === '' || it.name.toLowerCase().includes(query) || (it.description || '').toLowerCase().includes(query))
    ))
  }, [displaySkills, origin, groupFilter, q])

  const groupNames = Object.keys(groups)
  const countForGroup = (group) => displaySkills.filter((item) => item.group === group).length

  // 非行级警告条（挂载与同步.md：未匹配工作区引用等推导警告 + 孤儿链接现场），逐条列出并附复制入口。
  const warningLines = []
  for (const w of data.lib.warnings || []) {
    warningLines.push({
      key: `w-${warningLines.length}`,
      text: String(w),
      prompt: buildRepairPrompt({
        root: data.root,
        code: 'reconcile-warning',
        message: String(w),
        repair: { operation: 'sync', summary: String(w), facts: [{ label: '配置目录', value: String(data.root || '') }], recommendation: ['核对 settings 中引用的分组与工作区是否仍存在', '点「↻ 刷新」触发对账，失效引用会被跳过并保留现场'] },
      }),
    })
  }
  for (const issue of (data.health || []).filter((i) => i.issue === 'orphan-link')) {
    warningLines.push({
      key: `o-${issue.name}-${issue.target}`,
      text: `孤儿链接：${issue.name} @ ${issue.target}`,
      prompt: buildRepairPrompt({ root: data.root, code: 'orphan-link', message: `指向本配置目录的链接不在挂载期望集中：${issue.name}`, repair: mountIssueRepair('orphan-link', { name: issue.name, targetLabel: issue.target, path: issue.path || issue.target, root: data.root }) }),
    })
  }

  const rowAction = async (name, action, payload = {}) => {
    // 配置层操作（禁用/启用）：settings 直写，本地即时生效（0 延迟），Host 对账器后台收敛
    if (action === 'disable') { setSkillDisabled(name, true); return }
    if (action === 'enable') { setSkillDisabled(name, false); return }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (action === 'update') {
        if (payload.confirmLocalChanges !== true) {
          const checks = await call('check', { names: [name] })
          const check = (checks || []).find((item) => item.name === name)
          if (check?.locally_modified || check?.baseline_missing) {
            setPendingUpdate({
              name,
              detail: `当前 ${check.current ? check.current.slice(0, 7) : '未知'} → 上游 ${check.latest ? check.latest.slice(0, 7) : '待检查'}。`,
            })
            return
          }
        }
        const r = await call('update', { names: [name], confirmLocalChanges: payload.confirmLocalChanges === true })
        // 批量语义下单条失败不断批（ok:true + skipped 结果）——结果必须按 tone 上屏，
        // 否则用户确认后石沉大海（2026-09-05 走查反馈：skipped 只进灰字等于无反馈）。
        const it = (r.results || []).find((item) => item.name === name)
        if (it?.status === 'updated') setNotice({ tone: 'ok', text: `${name} 已更新至 ${String(it.commit || '').slice(0, 7)}（${it.via === 'ls-remote' ? 'git' : 'API'} 通道）` })
        else if (it) setNotice({ tone: 'warn', text: `${name} 更新未完成（${it.status}）：${it.reason || it.error || '未返回原因'}` })
        else setNotice({ tone: 'warn', text: `${name}：更新结果未含该条目，请点「↻ 刷新」核对行状态` })
      } else if (action === 'remove') {
        if (!window.confirm(`确认出库 ${name}？删除前自动备份到 DSH HOME 备份区（自有目录无删除入口）。`)) return
        const r = await call('remove', { name })
        setNotice({ tone: 'ok', text: r.backup ? `${name} 已出库，备份于 ${r.backup}` : `${name} 已出库（目录本已缺失，无物可备）` })
      }
      reload()
    } catch (e) {
      if (action === 'update' && e?.code === 'local-changes-confirmation-required' && payload.confirmLocalChanges !== true) {
        setPendingUpdate({ name, detail: e.message || '检测到本地修改。' })
      } else {
        setError(e)
      }
    } finally {
      setBusy(false)
    }
  }

  // ↻ 刷新（DSR-008/017）：重查全部上游 + 执行一次安全对账 + 刷新列表——Agent 按修复提示词修完现场后的收敛入口。
  // check 与 sync 的结果合并为一条通知（后写覆盖前写会丢上游不可达计数）；有问题一律 warn 态。
  const refreshAll = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      let checkFailed = -1
      try {
        const r = await call('check', {})
        checkFailed = (r || []).filter((it) => it.status === 'check_failed').length
      } catch (e) {
        setError(e)
      }
      let syncProblems = -1
      try {
        const s = await call('sync', {})
        syncProblems = (s?.errors || []).length + (s?.warnings || []).length
      } catch (e) {
        setError(e)
      }
      const parts = []
      if (checkFailed > 0) parts.push(`${checkFailed} 个上游不可达`)
      if (syncProblems > 0) parts.push(`${syncProblems} 项现场需要关注（见行状态/警告条）`)
      setNotice(parts.length > 0
        ? { tone: 'warn', text: `刷新完成：${parts.join('；')}` }
        : { tone: 'ok', text: '刷新完成：现场一致' })
      reload()
    } finally {
      setBusy(false)
    }
  }

  const fmtCheckedAt = (iso) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const groupOp = (action, name, newName) => {
    if (action === 'delete') {
      if (!window.confirm(`删除组 ${name}？成员将回落「默认」组`)) return
      deleteGroup(name)
      if (groupFilter === name) setGroupFilter('默认')
    } else if (action === 'rename') {
      renameGroup(name, newName)
      if (groupFilter === name && newName) setGroupFilter(newName)
    }
  }
  // DSR-009：新建成功后跳到新组，便于立即配置它的使用范围。
  const doCreateGroup = (name) => {
    config.createGroup(name)
    setCreateOpen(false)
    setGroupFilter(name)
    setNotice({ tone: 'ok', text: `已创建分组「${name}」` })
  }

  return (
    <div style={S.panel}>
      {/* 分组优先：先选择当前组并配置它的全局/工作区使用范围，再浏览技能库（胶囊行是纯选择器，DSR-009） */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span style={sectionHead}>分组</span>
          <span style={noteText}>{`${data.lib.skills.length} 个 Skill`}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <Pill active={groupFilter === ''} onClick={() => setGroupFilter('')}>{`全部 · ${data.lib.skills.length}`}</Pill>
          <Pill active={groupFilter === '默认'} onClick={() => setGroupFilter('默认')}>{`默认 · ${countForGroup('默认')}`}</Pill>
          {/* 「默认」上一行已固定渲染（groups 表合法含「默认」键，be9b15d 后不再只是回落伪组），map 中排除防重复 */}
          {groupNames.filter((group) => group !== '默认').map((group) => (
            <Pill key={group} active={groupFilter === group} onClick={() => setGroupFilter(group)}>{`${group} · ${countForGroup(group)}`}</Pill>
          ))}
          <Pill active={false} onClick={() => setCreateOpen(true)}>＋ 新建分组</Pill>
        </div>
        {groupFilter === ''
          ? (
              <div style={{ ...cardStyle, padding: '12px 14px' }}>
                <div style={cardTitle}>当前查看：全部技能</div>
                <div style={{ ...noteText, marginTop: 4 }}>选择一个分组后，可配置它在 DSH 全局与各工作区的可用范围。</div>
              </div>
            )
          : <GroupScopePanel config={config} group={groupFilter} workspaces={data.workspaces} onGroupOp={groupOp} />}
      </div>

      {/* 非行级警告条（琥珀晕卡逐条，附修复复制入口，DSR-018） */}
      {warningLines.map((w) => (
        <div key={w.key} style={{ ...badgeStyle(T.warn), borderRadius: 10, padding: '9px 12px', marginBottom: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={dotStyle(T.warn)} />
          <span style={{ flex: 1 }}>{w.text}</span>
          <RepairCopy text={w.prompt} />
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={sectionHead}>技能库</span>
        <span style={noteText}>{`${groupFilter === '' ? '全部' : groupFilter} · ${list.length} 个`}</span>
        {data.lib.checkedAt ? <span style={noteText}>{`上游状态检查于 ${fmtCheckedAt(data.lib.checkedAt)}`}</span> : null}
      </div>
      {/* 库工具条：搜索过滤 / 来源筛选 / ↻ 刷新（本地导入入口随 DSR-017 废止） */}
      <div style={{ ...S.toolbar, marginBottom: 12 }}>
        <Input style={{ flex: 1, minWidth: 140 }} placeholder="搜索名称 / 描述…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ ...S.select, border: 'none', background: T.bgModulePlatform, borderRadius: 8, padding: '5px 10px' }} value={origin} onChange={(e) => setOrigin(e.target.value)}>
          <option value="">全部来源</option>
          <option value="github">GitHub</option>
          <option value="self">自研/本地</option>
        </select>
        <GhostBtn onClick={refreshAll} disabled={busy} title="重新检查全部上游、执行一次安全对账并刷新列表">↻ 刷新</GhostBtn>
      </div>
      {notice ? <NoticeBar notice={notice} /> : null}
      {error ? <ErrorLine error={error} /> : null}

      {/* 行：描边卡片 + 状态徽章 + ⋯ 菜单（按 origin 分化）；挂载失败徽章点击展开明细 */}
      {list.length === 0
        ? <div style={{ ...S.muted, padding: 12 }}>库为空（无匹配 skill）</div>
        : list.map((it) => {
            const mountIssues = (it.mount || []).filter((row) => row.issue && row.issue !== 'ok')
            return (
              <div key={it.dir} style={{ position: 'relative' }}>
                <div style={S.row}>
                  <div style={{ flex: 1, minWidth: 0 }} title={it.description || ''}>
                    <div style={{ fontWeight: 600, color: T.labelPrimary }}>{it.name}</div>
                    <div style={noteText}>
                      {[
                        ORIGIN_LABEL[it.origin] || it.origin,
                        it.group,
                        (it.targets || []).length > 0 ? (it.targets || []).map((t) => targetLabel(t, data.workspaces)).join(' / ') : null,
                        it.commit ? it.commit.slice(0, 7) : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {it.missing && <span style={statusPillStyle('error')}>缺失</span>}
                    {it.disabled && <span style={statusPillStyle('warn')}>已禁用</span>}
                    {!it.hasSkillMd && !it.missing && <span style={statusPillStyle('warn')}>无 SKILL.md</span>}
                    {it.nameVisible === false && <span style={statusPillStyle('warn')} title="安装名不符合小写连字符文法，DSH 不可见">名文法</span>}
                    {mountIssues.length > 0 && (
                      <button
                        type="button"
                        title="点击展开挂载失败明细与修复提示词"
                        onClick={() => setExpandedMount(expandedMount === it.dir ? null : it.dir)}
                        style={{ ...statusPillStyle('error'), border: 'none', font: 'inherit', cursor: 'pointer' }}
                      >
                        {`挂载失败 ${mountIssues.length} · ${expandedMount === it.dir ? '收起' : '展开'}`}
                      </button>
                    )}
                    {it.upstream && it.upstream.status === 'updatable' && <span style={statusPillStyle('updatable')}>可更新</span>}
                    {it.upstream && it.upstream.status === 'up_to_date' && <span style={statusPillStyle('normal')}>已是最新</span>}
                    {it.upstream && it.upstream.status === 'check_failed' && <span style={statusPillStyle('warn')}>检查失败</span>}
                    {it.upstream && it.upstream.locally_modified && <span style={statusPillStyle('warn')}>本地有修改</span>}
                    <button
                      type="button"
                      title="行操作"
                      disabled={busy}
                      onClick={(e) => setMenuFor(menuFor?.dir === it.dir ? null : { dir: it.dir, rect: e.currentTarget.getBoundingClientRect() })}
                      style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', fontSize: 16, lineHeight: 1, padding: '3px 6px', borderRadius: 6, color: menuFor?.dir === it.dir ? T.labelPrimary : T.labelSecondary }}
                    >
                      ⋯
                    </button>
                  </div>
                  {menuFor?.dir === it.dir && (
                    <RowMenu
                      it={it}
                      groupNames={groupNames}
                      busy={busy}
                      triggerRect={menuFor.rect}
                      onAction={(action) => rowAction(it.dir, action)}
                      onMove={(group) => moveSkill(it.dir, group)}
                      onClose={() => setMenuFor(null)}
                    />
                  )}
                </div>
                {expandedMount === it.dir && (
                  <div style={{ ...subRowPanel }}>
                    {mountIssues.map((row, idx) => {
                      const repair = mountIssueRepair(row.issue, { name: it.dir, targetLabel: targetLabel(row.target, data.workspaces), path: row.path, root: data.root })
                      return (
                        <div key={`${row.target}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                          <span style={dotStyle(T.error)} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontWeight: 500, color: T.labelPrimary }}>{`${targetLabel(row.target, data.workspaces)} · ${row.issue}`}</span>
                            {row.path ? <span style={{ ...noteText, display: 'block', wordBreak: 'break-all' }}>{row.path}</span> : null}
                          </span>
                          <RepairCopy text={buildRepairPrompt({ root: data.root, code: row.issue, message: `${it.dir} → ${row.path || targetLabel(row.target, data.workspaces)}`, repair })} />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

      {createOpen && <CreateGroupDialog onCancel={() => setCreateOpen(false)} onCreate={doCreateGroup} />}
      {pendingUpdate && (
        <UpdateConfirmationDialog
          name={pendingUpdate.name}
          detail={pendingUpdate.detail}
          busy={busy}
          onCancel={() => setPendingUpdate(null)}
          onConfirm={() => {
            const name = pendingUpdate.name
            setPendingUpdate(null)
            rowAction(name, 'update', { confirmLocalChanges: true })
          }}
        />
      )}
    </div>
  )
}

/** 挂载失败明细展开面板（白底描边，贴行下方）。 */
const subRowPanel = {
  margin: '-4px 0 10px',
  padding: '8px 12px',
  borderRadius: 10,
  background: T.bgLayer3,
  border: `1px solid ${T.borderL1}`,
}

/** DSR-009：新建分组模态（与更新确认同一遮罩语言）；客户端预检长度与保留字，完整规则 Host validate 兜底。 */
function CreateGroupDialog({ onCancel, onCreate }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) { setError('请输入组名'); return }
    if (trimmed.length > 30) { setError('组名最长 30 字符'); return }
    if (trimmed === '默认' || trimmed === '全部') { setError('「默认」「全部」是保留字'); return }
    onCreate(trimmed)
  }
  return (
    <ModalShell title="新建分组" width={400} onMaskClick={onCancel}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>新建分组</div>
      <div style={{ color: T.labelSecondary, fontSize: 13, lineHeight: 1.55, marginBottom: 12 }}>创建命名分组，按主题组织 Skill 并配置其可用范围。</div>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>组名</div>
      <Input
        value={name}
        autoFocus
        placeholder="新组名"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      {error ? <div style={{ fontSize: 12, color: T.error, marginTop: 6 }}>{error}</div> : null}
      <div style={{ fontSize: 11, color: T.labelSecondary, marginTop: 8 }}>新组复制「默认」组的挂载规则作为起步；组名 1–30 字符。</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <OutlineBtn onClick={onCancel}>取消</OutlineBtn>
        <PrimaryBtn onClick={submit}>新建</PrimaryBtn>
      </div>
    </ModalShell>
  )
}

/** 当前分组的使用范围：直接编辑 settings 配置（本地即时生效，后台对账收敛；插件运行时.md L202）。 */
function GroupScopePanel({ config, group, workspaces, onGroupOp }) {
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const { groups, toggleMount } = config
  const mounts = (groups[group] && groups[group].mounts) || []
  const enabled = (scopeKind, workspaceId) => mounts.some((mount) => (
    mount.scope === scopeKind && (scopeKind === 'global' || mount.project === workspaceId)
  ))
  const toggle = (scopeKind, workspaceId, checked) => toggleMount(group, scopeKind, workspaceId, checked)
  // 「默认」是虚拟组，不可改名/删除（DSR-009 入口收进本卡）
  const manageable = group !== '默认'
  const submitRename = () => {
    const trimmed = newName.trim()
    setRenaming(false)
    if (trimmed && trimmed !== group) onGroupOp('rename', group, trimmed)
  }
  const entryStyle = (danger) => ({ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 11, color: danger ? T.error : T.labelSecondary, cursor: 'pointer' })
  return (
    <div style={{ ...cardStyle, padding: '12px 14px' }}>
      {renaming
        ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Input
                style={{ width: 160 }}
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename()
                  if (e.key === 'Escape') setRenaming(false)
                }}
              />
              <PrimaryBtn onClick={submitRename}>保存</PrimaryBtn>
              <GhostBtn onClick={() => setRenaming(false)}>取消</GhostBtn>
            </div>
          )
        : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={cardTitle}>{`当前分组：${group}`}</span>
              {manageable && <span style={{ flex: 1 }} />}
              {manageable && <button type="button" style={entryStyle(false)} onClick={() => { setNewName(group); setRenaming(true) }}>改名</button>}
              {manageable && <button type="button" style={entryStyle(true)} onClick={() => onGroupOp('delete', group)}>删除</button>}
            </div>
          )}
      {renaming && <div style={{ ...noteText, marginBottom: 8 }}>改名立即生效：分组成员与挂载规则同步改名，Skill 本体不受影响。</div>}
      <div style={{ height: 1, background: T.borderL1, flex: 'none' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled('global')} onChange={(event) => toggle('global', null, event.target.checked)} />
        <span style={{ fontWeight: 500, color: T.labelPrimary }}>DSH 全局</span>
        <span style={noteText}>对所有 DSH 项目生效</span>
      </label>
      <div style={{ height: 1, background: T.borderL1, flex: 'none' }} />
      {workspaces.length === 0
        ? <div style={{ ...S.muted, padding: '8px 0' }}>当前没有 DSH 工作区；请在 DSH 原生工作区界面创建或打开项目。</div>
        : (
            <>
              <div style={{ fontSize: 10, color: T.labelTertiary, padding: '7px 0 1px' }}>工作区项目</div>
              {workspaces.map((workspace) => (
                <label key={workspace.workspaceId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={enabled('project', workspace.workspaceId)} onChange={(event) => toggle('project', workspace.workspaceId, event.target.checked)} />
                  <span style={{ fontWeight: 500, color: T.labelPrimary }}>{workspace.title}</span>
                  <span style={noteText}>{`${workspace.path} · ${workspace.mountCount} 个组使用`}</span>
                </label>
              ))}
            </>
          )}
      <div style={{ height: 1, background: T.borderL1, flex: 'none' }} />
      <div style={{ ...noteText, paddingTop: 8 }}>取消勾选会移除该分组在该目标下的全部 Skill 链接。</div>
      {manageable && <div style={{ ...noteText, paddingTop: 4 }}>删除组：成员回落「默认」组，执行前需确认。</div>}
    </div>
  )
}
