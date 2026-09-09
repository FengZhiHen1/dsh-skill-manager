// manage — 管理视图（与搜索视图并列）：主从两段式——左栏分组导航，右栏当前组范围配置与技能库行列表。
//
// 边界：列表纯前端过滤零请求，写入只经 settings 意图与 call 门面；targetKey 推导单源在 derive.js，失效组回落在 service.js。
// 参考：插件运行时.md「管理视图」、挂载与同步.md「行状态走查」；DSR-008/009/017/018。
import { useState, useMemo, useEffect, useRef } from 'react'
import { Input, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { T, S, badgeStyle, cardStyle, cardTitle, noteText, dotStyle, sectionHead, statusPillStyle, dividerStyle, navItemStyle, navItemActiveStyle, pillBase } from './theme.js'
import { GhostBtn, OutlineBtn, PrimaryBtn, ErrorLine, NoticeBar, RowMenu, MenuItem, menuCardStyle, ChevronIcon, UpdateConfirmationDialog, ConfirmDialog, ModalShell } from './ui.jsx'
import { buildRepairPrompt, RepairCopy, mountIssueRepair } from './repair.jsx'
import { parseTargetKey } from '../core/model/contract.js'

const ORIGIN_LABEL = { github: 'GitHub', local: '本地', self: '自研' }
/** 来源筛选项（工具条下拉）：'' = 全部。 */
const ORIGIN_OPTIONS = [
  { id: '', label: '全部来源' },
  { id: 'github', label: 'GitHub' },
  { id: 'self', label: '自研/本地' },
]

/** targetKey（`host:scope|project` 格式）转成人话显示名；pi 宿主带「pi」标记。 */
function targetLabel(target, workspaces) {
  const p = typeof target === 'string' ? parseTargetKey(target) : null
  if (!p) return String(target ?? '—')
  if (p.scope === 'global') return p.host === 'pi' ? 'pi 用户级' : 'DSH 全局'
  const ws = workspaces.find((w) => w.workspaceId === p.project)
  const base = ws ? ws.title : `工作区 ${p.project.slice(0, 8)}…`
  return p.host === 'pi' ? `${base} · pi` : base
}

/**
 * 行主状态判别（CORE-01）：每行至多一个主徽章，优先级 缺失 > 挂载失败 > 已禁用 > 可更新 > 检查失败。
 * 常态（已是最新 / 正常挂载）不占位——正常行零徽章，需关注的行才醒目。
 * 返回 null 即无徽章；issues 非空表示徽章可点击展开挂载明细。
 */
function primaryStatus(it) {
  const mountIssues = it.mount.filter((row) => row.issue && row.issue !== 'ok')
  if (it.missing) return { kind: 'error', label: '缺失', issues: null }
  if (mountIssues.length > 0) return { kind: 'error', label: `挂载失败 ${mountIssues.length}`, issues: mountIssues }
  if (it.disabled) return { kind: 'warn', label: '已禁用', issues: null }
  if (it.upstream && it.upstream.status === 'updatable') return { kind: 'updatable', label: '可更新', issues: null }
  if (it.upstream && it.upstream.status === 'check_failed') return { kind: 'warn', label: '检查失败', issues: null }
  return null
}

/** 行次要标记：不抢主徽章，收进 ⋯ 菜单顶部状态区。 */
function secondaryFlags(it) {
  const flags = []
  if (it.upstream && it.upstream.locally_modified) flags.push('本地有修改')
  if (!it.hasSkillMd && !it.missing) flags.push('无 SKILL.md')
  if (it.nameVisible === false) flags.push('安装名文法不可见')
  return flags
}

/**
 * 管理视图：主从布局，左栏分组导航选择当前组，右栏上段为当前组使用范围，下段为技能库行。
 * 使用范围 settings 直写即时生效；过滤纯前端零请求。
 * 行主徽章来自 overview 快照随附的走查，次要标记在 ⋯ 菜单顶部；⋯ 菜单按来源分化。
 * 出库/删组/取消挂载/覆盖更新等破坏性动作一律遮罩确认；失败带复制入口。
 * @param {object} props
 * @param {Function} props.call RPC 门面
 * @param {object} props.data overview 聚合（root/lib/health/workspaces）
 * @param {object} props.config 配置意图读写门面（SkillsSection 组装）
 * @param {() => void} props.reload 重读 overview
 * @param {(text: string) => void} props.showToast 成功事件瞬态 Toast（warn/error 不走这里）
 */
export function ManageView({ call, data, config, reload, showToast }) {
  const [origin, setOrigin] = useState('')
  const [originOpen, setOriginOpen] = useState(false)
  const [groupFilter, setGroupFilter] = useState('默认')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  // 行操作成功后的行高亮（C：反馈落在事情发生的对象上）：dir 命中行品牌色晕渐隐
  const [flashDir, setFlashDir] = useState(null)
  // 互斥模态收敛为单一判别状态（CORE-01）：同时至多一个对话框，非法组合不可表示。
  const [dialog, setDialog] = useState(null)
  // dialog 形状：{ kind:'update', name, detail } | { kind:'remove', name }
  //   | { kind:'group-delete', name } | { kind:'create' }
  const [menuFor, setMenuFor] = useState(null)
  const [expandedMount, setExpandedMount] = useState(null)

  // 行高亮渐隐窗：1.6s 后清除（配合行背景 transition 淡出）
  useEffect(() => {
    if (!flashDir) return undefined
    const t = setTimeout(() => setFlashDir(null), 1600)
    return () => clearTimeout(t)
  }, [flashDir])

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

  // 非行级警告条：未匹配工作区引用等推导警告与孤儿链接现场，逐条列出并附修复复制入口。
  const warningLines = []
  for (const w of data.lib.warnings) {
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
  for (const issue of data.health.filter((i) => i.issue === 'orphan-link')) {
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
    // 出库先过遮罩确认（与更新/取消挂载同一对话框语言）；确认后带 confirmed 重入执行
    if (action === 'remove' && payload.confirmed !== true) { setDialog({ kind: 'remove', name }); return }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (action === 'update') {
        if (payload.confirmLocalChanges !== true) {
          const checks = await call('check', { names: [name] })
          const check = checks.find((item) => item.name === name)
          if (check?.locally_modified || check?.baseline_missing) {
            setDialog({
              kind: 'update',
              name,
              detail: `当前 ${check.current ? check.current.slice(0, 7) : '未知'} → 上游 ${check.latest ? check.latest.slice(0, 7) : '待检查'}。`,
            })
            return
          }
        }
        const r = await call('update', { names: [name], confirmLocalChanges: payload.confirmLocalChanges === true })
        // 批量语义下单条失败不断批（ok:true + failed/skipped 结果），结果必须按 tone 上屏。
        // 否则用户确认后石沉大海：失败只进灰字等于无反馈。
        const it = r.results.find((item) => item.name === name)
        if (it?.status === 'updated') {
          showToast(`${name} 已更新至 ${String(it.commit || '').slice(0, 7)}（${it.via === 'ls-remote' ? 'git' : 'API'} 通道）`)
          setFlashDir(name) // 行高亮渐隐：反馈落在事情发生的对象上
        } else if (it) setNotice({ tone: 'warn', text: `${name} 更新未完成（${it.status}）：${it.reason || it.error || '未返回原因'}` })
        else setNotice({ tone: 'warn', text: `${name}：更新结果未含该条目，请点「↻ 刷新」核对行状态` })
      } else if (action === 'remove') {
        const r = await call('remove', { name })
        showToast(r.backup ? `${name} 已出库，备份于 ${r.backup}` : `${name} 已出库（目录本已缺失，无物可备）`)
      }
      reload()
    } catch (e) {
      if (action === 'update' && e?.code === 'local-changes-confirmation-required' && payload.confirmLocalChanges !== true) {
        setDialog({ kind: 'update', name, detail: e.message || '检测到本地修改。' })
      } else {
        setError(e)
      }
    } finally {
      setBusy(false)
    }
  }

  // ↻ 刷新：重查全部上游，执行一次安全对账，再重读列表。
  // 这是 Agent 按修复提示词修完现场后的收敛入口。check 与 sync 的结果合并为一条通知：
  // 分开回写会后写覆盖前写，丢掉上游不可达计数；有问题一律 warn 态。
  // 错误同理：两阶段各失败各记（不允许后写覆盖前写），任一失败绝不出绿色「现场一致」。
  const refreshAll = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const failures = []
      let checkFailed = -1
      try {
        const r = await call('check', {})
        checkFailed = r.filter((it) => it.status === 'check_failed').length
      } catch (e) {
        failures.push(`上游检查失败：${e?.message ?? String(e)}`)
      }
      let syncProblems = -1
      try {
        const s = await call('sync', {})
        syncProblems = s.errors.length + s.warnings.length
      } catch (e) {
        failures.push(`现场对账失败：${e?.message ?? String(e)}`)
      }
      const parts = []
      if (checkFailed > 0) parts.push(`${checkFailed} 个上游不可达`)
      if (syncProblems > 0) parts.push(`${syncProblems} 项现场需要关注（见行状态/警告条）`)
      if (failures.length > 0) {
        // 阶段级失败进错误条（含修复复制入口），部分结果另给 warn 通知
        setError(new Error(failures.join('；')))
        setNotice({ tone: 'warn', text: parts.length > 0 ? `刷新部分完成：${parts.join('；')}` : '刷新未全部完成，详见错误条' })
      } else {
        if (parts.length > 0) {
          setNotice({ tone: 'warn', text: `刷新完成：${parts.join('；')}` })
        } else {
          showToast('刷新完成：现场一致')
        }
      }
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
      setDialog({ kind: 'group-delete', name }) // 删组波及成员归属与挂载规则，走遮罩确认（不用 window.confirm）
    } else if (action === 'rename') {
      renameGroup(name, newName)
      if (groupFilter === name && newName) setGroupFilter(newName)
    }
  }
  const confirmDeleteGroup = () => {
    const name = dialog?.kind === 'group-delete' ? dialog.name : null
    setDialog(null)
    if (!name) return
    deleteGroup(name)
    if (groupFilter === name) setGroupFilter('默认')
  }
  // 新建成功后跳到新组，便于立即配置它的使用范围。
  // 「成功」只在写落定后说：撞名/Host 拒绝/传输失败时错误条已上屏，此处再弹成功 toast
  // 就成了「提示新增成功但组里没有」（2026-09-09 走查）。
  const doCreateGroup = async (name) => {
    setDialog(null)
    if (!await config.createGroup(name)) return
    setGroupFilter(name)
    showToast(`已创建分组「${name}」`)
  }

  return (
    <div style={S.panel}>
      {/* 主从布局：左栏分组导航（纵列可滚动，容纳无上限分组），右栏为当前组详情 */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <GroupNav
          groups={groups}
          selected={groupFilter}
          total={displaySkills.length}
          countForGroup={countForGroup}
          onSelect={setGroupFilter}
          onCreate={() => setDialog({ kind: 'create' })}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {groupFilter === ''
            ? (
                <div style={{ ...cardStyle, padding: '12px 14px' }}>
                  <div style={cardTitle}>当前查看：全部技能</div>
                  <div style={{ ...noteText, marginTop: 4 }}>选择左侧分组，可配置它在 DSH 全局与各工作区的可用范围。</div>
                </div>
              )
            : <GroupScopePanel config={config} group={groupFilter} workspaces={data.workspaces} skills={data.lib.skills} onGroupOp={groupOp} piAvailable={data.agents?.pi?.available === true} />}

          {/* 非行级警告条（琥珀晕卡逐条，附修复复制入口） */}
          {warningLines.map((w) => (
            <div key={w.key} style={{ ...badgeStyle(T.warn), borderRadius: 10, padding: '9px 12px', margin: '8px 0', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={dotStyle(T.warn)} />
              {/* 长路径是无空格长 token：minWidth:0 放开收缩 + break-all 允许断行，否则按钮被顶出面板 */}
              <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{w.text}</span>
              <RepairCopy text={w.prompt} />
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '14px 0 10px' }}>
            <span style={sectionHead}>技能库</span>
            <span style={noteText}>{`${groupFilter === '' ? '全部' : groupFilter} · ${list.length} 个`}</span>
            {data.lib.checkedAt ? <span style={noteText}>{`上游状态检查于 ${fmtCheckedAt(data.lib.checkedAt)}`}</span> : null}
          </div>
          {/* 库工具条：搜索过滤 / 来源筛选 / ↻ 刷新；无本地导入入口 */}
          <div style={{ ...S.toolbar, marginBottom: 12 }}>
            <Input style={{ flex: 1, minWidth: 140 }} placeholder="搜索名称 / 描述…" value={q} onChange={(e) => setQ(e.target.value)} />
            {/* 来源筛选：宿主 Menu（portal 逃逸面板裁剪，选中态 ✓，compact 小字号），不用原生 select——其弹出层由 OS 绘制无法美化 */}
            <Menu
              open={originOpen}
              portal
              compact
              anchor={(
                <button type="button" disabled={busy} onClick={() => setOriginOpen((v) => !v)} style={S.filterTrigger}>
                  {ORIGIN_OPTIONS.find((o) => o.id === origin)?.label ?? '全部来源'}
                  {ChevronIcon
                    ? <ChevronIcon style={{ color: T.labelSecondary, transition: 'transform .16s', transform: originOpen ? 'rotate(180deg)' : undefined }} />
                    : <span style={{ color: T.labelSecondary, fontSize: 10 }}>{originOpen ? '▴' : '▾'}</span>}
                </button>
              )}
              items={ORIGIN_OPTIONS}
              selectedId={origin}
              onSelect={(id) => { setOrigin(id); setOriginOpen(false) }}
              onClose={() => setOriginOpen(false)}
            />
            <GhostBtn onClick={refreshAll} disabled={busy} title="重新检查全部上游、执行一次安全对账并刷新列表">↻ 刷新</GhostBtn>
          </div>
          {notice ? <NoticeBar notice={notice} /> : null}
          {error ? <ErrorLine error={error} /> : null}

          {/* 行：单容器卡 + 分隔线高密度列表；主徽章互斥，次要标记在 ⋯ 菜单顶部 */}
          {list.length === 0
            ? <div style={{ ...S.muted, padding: 12 }}>库为空（无匹配 skill）</div>
            : (
                <div style={{ ...cardStyle, padding: 0 }}>
                  {list.map((it, idx) => {
                    const status = primaryStatus(it)
                    const mountIssues = status?.issues || []
                    return (
                      <div key={it.dir} style={{ position: 'relative' }}>
                        {idx > 0 ? <div style={dividerStyle} /> : null}
                        <div style={{ ...S.listRow, background: flashDir === it.dir ? `color-mix(in srgb, ${T.brand} 10%, transparent)` : 'transparent', transition: 'background-color 1.4s' }}>
                          <div style={{ flex: 1, minWidth: 0 }} title={it.description}>
                            <div style={{ fontWeight: 600, color: T.labelPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                            <div style={{ ...noteText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {[
                                ORIGIN_LABEL[it.origin] || it.origin,
                                // 右栏已按左栏分组收窄；仅「全部」视图补组名与挂载目标，避免逐行重复
                                groupFilter === '' ? it.group : null,
                                groupFilter === '' && it.targets.length > 0 ? it.targets.map((t) => targetLabel(t, data.workspaces)).join(' / ') : null,
                                it.commit ? it.commit.slice(0, 7) : null,
                              ].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            {status && (mountIssues.length > 0 ? (
                              <button
                                type="button"
                                title="点击展开挂载失败明细与修复提示词"
                                onClick={() => setExpandedMount(expandedMount === it.dir ? null : it.dir)}
                                style={{ ...statusPillStyle('error'), border: 'none', font: 'inherit', cursor: 'pointer' }}
                              >
                                {`${status.label} · ${expandedMount === it.dir ? '收起' : '展开'}`}
                              </button>
                            ) : <span style={statusPillStyle(status.kind)}>{status.label}</span>)}
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
                              flags={secondaryFlags(it)}
                              busy={busy}
                              triggerRect={menuFor.rect}
                              onAction={(action) => rowAction(it.dir, action)}
                              onMove={(group) => moveSkill(it.dir, group)}
                              onClose={() => setMenuFor(null)}
                            />
                          )}
                        </div>
                        {/* 展开面板与问题存续绑定：消解即塌缩，不留空壳（2026-09-06 走查修复） */}
                        {expandedMount === it.dir && mountIssues.length > 0 && (
                          <div style={{ ...subRowPanel }}>
                            {mountIssues.map((row, midx) => {
                              const repair = mountIssueRepair(row.issue, { name: it.dir, targetLabel: targetLabel(row.target, data.workspaces), path: row.path, root: data.root })
                              return (
                                <div key={`${row.target}-${midx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
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
                </div>
              )}
        </div>
      </div>

      {dialog?.kind === 'create' && <CreateGroupDialog onCancel={() => setDialog(null)} onCreate={doCreateGroup} />}
      {dialog?.kind === 'update' && (
        <UpdateConfirmationDialog
          name={dialog.name}
          detail={dialog.detail}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const name = dialog.name
            setDialog(null)
            rowAction(name, 'update', { confirmLocalChanges: true })
          }}
        />
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmDialog
          title={`出库「${dialog.name}」？`}
          body="仅 GitHub 来源的 Skill 可出库（自研/本地目录无删除入口，在技能目录内自管）。"
          warning="执行顺序：先把整目录自动备份到 DSH HOME 备份区 → 摘除全部挂载链接 → 删除库内目录 → 清理登记与检查缓存。settings 里的分组归属不随出库消失，重新入库自然落回原组。"
          confirmLabel="确认出库"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const name = dialog.name
            setDialog(null)
            rowAction(name, 'remove', { confirmed: true })
          }}
        />
      )}
      {dialog?.kind === 'group-delete' && (
        <ConfirmDialog
          title={`删除分组「${dialog.name}」？`}
          body={`该组当前 ${countForGroup(dialog.name)} 个成员，删除后成员回落「默认」组。`}
          warning="不删除任何 Skill 文件；但该组的挂载规则随之移除，按此规则挂出去的链接会在对账时被摘除（回落「默认」组的规则）。"
          confirmLabel="确认删除分组"
          onCancel={() => setDialog(null)}
          onConfirm={confirmDeleteGroup}
        />
      )}
    </div>
  )
}

/** 挂载失败明细展开面板（白底描边，贴行下方）。 */
const subRowPanel = {
  margin: '0 12px 8px',
  padding: '8px 12px',
  borderRadius: 10,
  background: T.bgLayer3,
  border: `1px solid ${T.borderL1}`,
}

/**
 * 左栏分组导航：全部/默认/自定义组纵列，计数随行。
 * 分组数无上限：列高封顶内滚，组名超长截断并 title 悬浮。
 */
function GroupNav({ groups, selected, total, countForGroup, onSelect, onCreate }) {
  const itemRefs = useRef(new Map())
  const names = Object.keys(groups).filter((group) => group !== '默认')
  // 选中项滚入视野：列高封顶内滚，十几个组时新组正落在折线以下——不滚就呈现为
  // 「提示新增成功，但组里没有」（2026-09-09 走查）。nearest 保证已在视野内时页面不跳。
  useEffect(() => {
    if (!selected) return
    itemRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' })
  }, [selected, names.length])
  const renderItem = (key, label, count) => (
    <button
      key={key || '<all>'}
      ref={(el) => { if (el) itemRefs.current.set(key, el); else itemRefs.current.delete(key) }}
      type="button"
      title={label}
      onClick={() => onSelect(key)}
      style={{ ...navItemStyle, ...(selected === key ? navItemActiveStyle : null) }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{label}</span>
      <span style={{ ...noteText, flex: 'none' }}>{count}</span>
    </button>
  )
  return (
    <div style={{ flex: 'none', width: 140 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '0 4px' }}>
        <span style={cardTitle}>分组</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onCreate} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 11, color: T.labelSecondary, cursor: 'pointer' }}>＋ 新建</button>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {renderItem('', '全部', total)}
        {renderItem('默认', '默认', countForGroup('默认'))}
        {/* 「默认」上一行已固定渲染，map 中排除防重复；groups 表合法含「默认」键，它是真实组非回落伪组 */}
        {names.map((group) => renderItem(group, group, countForGroup(group)))}
      </div>
    </div>
  )
}

/**
 * 范围勾选行（DSH 全局与工作区共用）：hover 浅底反馈，勾选态品牌色晕 + 品牌色复选框。
 * hint（路径等辅助文本）截断并 title 悬浮全文；count >0 时尾部出 pill；trailing 为行尾扩展位（宿主 chips）。
 */
function ScopeRow({ checked, title, hint, count, onToggle, trailing }) {
  const [hover, setHover] = useState(false)
  return (
    <label
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: checked ? `color-mix(in srgb, ${T.brand} 8%, transparent)` : hover ? T.bgModulePlatform : 'transparent' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <input type="checkbox" checked={checked} onChange={(event) => onToggle(event.target.checked)} style={{ accentColor: T.brand, width: 13, height: 13, margin: 0, flex: 'none' }} />
      <span style={{ fontWeight: 500, color: T.labelPrimary, flex: 'none' }}>{title}</span>
      {hint
        ? <span style={{ ...noteText, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={hint}>{hint}</span>
        : <span style={{ flex: 1 }} />}
      {count > 0 ? <span style={{ ...pillBase, flex: 'none' }}>{`${count} 个组使用`}</span> : null}
      {trailing || null}
    </label>
  )
}

/** 宿主 chip：行内切换该挂载目标在哪个宿主生效（DSH / pi）；active 用品牌色晕，未选灰底。 */
function HostChip({ label, active, onToggle, title }) {
  return (
    <button
      type="button"
      title={title}
      // 嵌在 label 行内：拦住默认激活与冒泡，点 chip 不触发行复选框
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(!active) }}
      style={{
        ...pillBase, border: 'none', font: 'inherit', fontSize: 10, padding: '0 7px', cursor: 'pointer',
        ...(active
          ? { background: `color-mix(in srgb, ${T.brand} 16%, transparent)`, color: T.labelPrimary, fontWeight: 500 }
          : { background: T.bgModulePlatform, color: T.labelTertiary }),
      }}
    >
      {label}
    </button>
  )
}

/** 新建分组模态（与更新确认同一遮罩语言）；客户端预检长度与保留字，完整规则 Host validate 兜底。 */
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
      <div style={{ fontSize: 11, color: T.labelSecondary, marginTop: 8 }}>新组复制「默认」组的挂载规则作为起步（不含 DSH 全局，全局需显式勾选）；组名 1–30 字符。</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <OutlineBtn onClick={onCancel}>取消</OutlineBtn>
        <PrimaryBtn onClick={submit}>新建</PrimaryBtn>
      </div>
    </ModalShell>
  )
}

/**
 * 当前分组的使用范围：直写 settings 配置，本地即时生效，后台对账收敛。
 * 工作区两区收纳：已勾选常显，未勾选收进折叠区；超阈值出过滤框，过滤时平铺全部匹配项。
 * 列表区为内嵌滚动面板，7 行封顶内滚，不随工作区数撑高卡片。
 * 宿主维度：行勾选默认仅 DSH；pi 可用时行尾出 [DSH][pi] chips，勾 pi 即同步物化两侧。
 * 防御：取消勾选会经对账移除该组在此目标下的全部链接。
 * 波及半径与「点一下复选框」的心智不对称，移除数 >0 时必须走遮罩确认。
 */
function GroupScopePanel({ config, group, workspaces, skills, onGroupOp, piAvailable = false }) {
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [opsOpen, setOpsOpen] = useState(false)
  const [showAllWs, setShowAllWs] = useState(false)
  const [wsFilter, setWsFilter] = useState('')
  const [pendingUnmount, setPendingUnmount] = useState(null) // {scopeKind, workspaceId, count, targetName, hosts}
  const { groups, toggleMount, toggleHost } = config
  const mounts = (groups[group] && groups[group].mounts) || []
  const findMount = (scopeKind, workspaceId) => mounts.find((mount) => (
    mount.scope === scopeKind && (scopeKind === 'global' || mount.project === workspaceId)
  ))
  const enabled = (scopeKind, workspaceId) => Boolean(findMount(scopeKind, workspaceId))
  // 宿主集：存量规则无 hosts 键按 ['dsh'] 回落（与 schema default 同源语义）
  const hostsOf = (scopeKind, workspaceId) => {
    const m = findMount(scopeKind, workspaceId)
    if (!m) return []
    return Array.isArray(m.hosts) && m.hosts.length > 0 ? m.hosts : ['dsh']
  }
  // 失效组回落，与 Host 端同源：组引用不存在 → 成员按「默认」推导。
  const effectiveGroup = (skill) => {
    const g = skill.group || '默认'
    return Object.prototype.hasOwnProperty.call(groups, g) ? g : '默认'
  }
  const linksOnTarget = (scopeKind, workspaceId) => {
    const base = scopeKind === 'global' ? 'global|global' : `project|${workspaceId}`
    return skills.filter((s) => effectiveGroup(s) === group && (s.targets.includes(`dsh:${base}`) || s.targets.includes(`pi:${base}`))).length
  }
  const toggle = (scopeKind, workspaceId, checked) => {
    if (!checked) {
      const count = linksOnTarget(scopeKind, workspaceId)
      if (count > 0) {
        const ws = scopeKind === 'project' ? workspaces.find((w) => w.workspaceId === workspaceId) : null
        setPendingUnmount({ scopeKind, workspaceId, count, targetName: ws ? ws.title : '全局', hosts: hostsOf(scopeKind, workspaceId) })
        return
      }
    }
    toggleMount(group, scopeKind, workspaceId, checked)
  }
  // 宿主 chip 开关：关最后一个宿主 = 取消整行挂载（走同一确认路径）
  const toggleHostChip = (scopeKind, workspaceId, host, on) => {
    if (on) {
      toggleHost(group, scopeKind, workspaceId, host, true)
      return
    }
    if (hostsOf(scopeKind, workspaceId).length <= 1) {
      toggle(scopeKind, workspaceId, false)
      return
    }
    toggleHost(group, scopeKind, workspaceId, host, false)
  }
  // 行尾宿主 chips：仅行已勾选且 pi 可用时出现；勾选 = 该宿主侧物化
  const hostChipsFor = (scopeKind, workspaceId) => {
    if (!piAvailable || !enabled(scopeKind, workspaceId)) return null
    const hosts = hostsOf(scopeKind, workspaceId)
    return (
      <span style={{ display: 'inline-flex', gap: 4, flex: 'none' }}>
        <HostChip label="DSH" title="DSH 侧生效（全局根 / 工作区 .dsh/skills）" active={hosts.includes('dsh')} onToggle={(on) => toggleHostChip(scopeKind, workspaceId, 'dsh', on)} />
        <HostChip label="pi" title="pi 侧生效（pi 用户级 / 工作区 .pi/skills）" active={hosts.includes('pi')} onToggle={(on) => toggleHostChip(scopeKind, workspaceId, 'pi', on)} />
      </span>
    )
  }
  const confirmUnmount = () => {
    toggleMount(group, pendingUnmount.scopeKind, pendingUnmount.workspaceId, false)
    setPendingUnmount(null)
  }
  // 「默认」是虚拟组，不可改名/删除；分组操作入口收进标题 ⋯ 菜单
  const manageable = group !== '默认'
  const submitRename = () => {
    const trimmed = newName.trim()
    setRenaming(false)
    if (trimmed && trimmed !== group) onGroupOp('rename', group, trimmed)
  }

  // 工作区两区推导：过滤中平铺全部匹配项；否则已启用区常显，其余进折叠区。
  const wsChecked = (w) => enabled('project', w.workspaceId)
  const enabledWs = workspaces.filter(wsChecked)
  const restCount = workspaces.length - enabledWs.length
  const filtering = wsFilter.trim() !== ''
  const visibleWs = filtering
    ? workspaces.filter((w) => `${w.title}\n${w.path}`.toLowerCase().includes(wsFilter.trim().toLowerCase()))
    : (showAllWs ? workspaces : enabledWs)

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
              {manageable && (
                <span style={{ position: 'relative' }}>
                  <button
                    type="button"
                    title="分组操作"
                    onClick={() => setOpsOpen((v) => !v)}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '3px 6px', borderRadius: 6, color: opsOpen ? T.labelPrimary : T.labelSecondary }}
                  >
                    ⋯
                  </button>
                  {opsOpen && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpsOpen(false)} />
                      <div style={{ ...menuCardStyle, top: '100%', right: 0, marginTop: 4 }}>
                        <MenuItem label="改名" onClick={() => { setOpsOpen(false); setNewName(group); setRenaming(true) }} />
                        <MenuItem label="删除分组" danger onClick={() => { setOpsOpen(false); onGroupOp('delete', group) }} />
                      </div>
                    </>
                  )}
                </span>
              )}
            </div>
          )}
      {renaming && <div style={{ ...noteText, marginBottom: 8 }}>改名立即生效：分组成员与挂载规则同步改名，Skill 本体不受影响。</div>}
      <div style={dividerStyle} />
      <div style={{ padding: '4px 0' }}>
        <ScopeRow
          checked={enabled('global')}
          title={piAvailable ? '全局' : 'DSH 全局'}
          hint={piAvailable ? 'DSH 全局与 pi 用户级，按右侧宿主选择生效面' : '对所有 DSH 项目生效'}
          count={0}
          onToggle={(checked) => toggle('global', null, checked)}
          trailing={hostChipsFor('global', null)}
        />
      </div>
      <div style={dividerStyle} />
      {workspaces.length === 0
        ? <div style={{ ...S.muted, padding: '8px 0' }}>当前没有 DSH 工作区；请在 DSH 原生工作区界面创建或打开项目。</div>
        : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px 6px' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.labelSecondary }}>工作区项目</span>
                <span style={{ flex: 1 }} />
                <span style={pillBase}>{`已启用 ${enabledWs.length} · 共 ${workspaces.length}`}</span>
              </div>
              {/* 过滤框只在工作区足够多时出现；少数工作区不值得常驻一个输入框。
                  间隙挂包装 div：primitives Input 的 style 落在内层 input 上，margin 推不开外框 */}
              {workspaces.length > 8 && (
                <div style={{ marginBottom: 8 }}>
                  <Input placeholder="过滤工作区…" value={wsFilter} onChange={(e) => setWsFilter(e.target.value)} />
                </div>
              )}
              {/* 内嵌滚动面板：行高约 29px，7 行封顶（上界理由：设置面板可视高度有限，超出内滚不撑破卡片） */}
              {(visibleWs.length > 0 || filtering) && (
                <div style={{ border: `1px solid ${T.borderL1}`, borderRadius: 10, padding: 2, maxHeight: 208, overflowY: 'auto', scrollbarWidth: 'thin' }}>
                  {visibleWs.map((workspace) => (
                    <ScopeRow
                      key={workspace.workspaceId}
                      checked={wsChecked(workspace)}
                      title={workspace.title}
                      hint={workspace.path}
                      count={workspace.mountCount}
                      onToggle={(checked) => toggle('project', workspace.workspaceId, checked)}
                      trailing={hostChipsFor('project', workspace.workspaceId)}
                    />
                  ))}
                  {filtering && visibleWs.length === 0 && <div style={{ ...S.muted, padding: '8px 10px' }}>无匹配工作区</div>}
                </div>
              )}
              {!filtering && restCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllWs((v) => !v)}
                  style={{ display: 'block', width: '100%', border: `1px dashed ${T.borderL2}`, background: 'transparent', borderRadius: 8, padding: '6px 10px', marginTop: 6, font: 'inherit', fontSize: 11, color: T.labelSecondary, cursor: 'pointer', textAlign: 'center' }}
                >
                  {showAllWs ? '▾ 收起其他工作区' : `▸ 展开其他 ${restCount} 个工作区（勾选即启用）`}
                </button>
              )}
            </>
          )}
      {pendingUnmount && (
        <ModalShell title="确认取消挂载" width={420} onMaskClick={() => setPendingUnmount(null)}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>取消「{group}」在「{pendingUnmount.targetName}」的挂载？</div>
          <div style={{ color: T.labelSecondary, fontSize: 13, lineHeight: 1.55, marginBottom: 12 }}>
            {`该分组有 ${pendingUnmount.count} 个 Skill 挂载在此目标下，取消后对账会移除这些链接。`}
          </div>
          <div style={{ borderRadius: 10, padding: '10px 12px', marginBottom: 14, ...badgeStyle(T.warn), fontSize: 12, lineHeight: 1.55 }}>
            {`只移除链接指针，不删除技能库文件${pendingUnmount.hosts.includes('pi') ? '；本目标含 pi 宿主，.pi/skills 与 pi 用户级链接一并摘除' : ''}；重新勾选即可恢复挂载。`}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <OutlineBtn onClick={() => setPendingUnmount(null)}>取消</OutlineBtn>
            <PrimaryBtn onClick={confirmUnmount}>{`确认移除 ${pendingUnmount.count} 条链接`}</PrimaryBtn>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
