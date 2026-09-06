// search — 搜索视图：入库唯一入口，走 skills.sh 搜索或 GitHub 仓库探测。
//
// 边界：候选多选批量入库串行逐个 add，单条失败不中断批次。
// 参考：插件运行时.md「搜索视图」；DSR-007、DSR-008、DSR-017。
import { useState, useRef } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { T, S, badgeStyle, cardStyle, cardTitle, noteText, dotStyle, subCardStyle, dividerStyle } from './theme.js'
import { GhostBtn, OutlineBtn, PrimaryBtn, ErrorLine, NoticeBar } from './ui.jsx'

/**
 * 搜索视图（settings.section 内页签组件）。
 * @param {object} props
 * @param {(endpoint: string, payload?: object) => Promise<unknown>} props.call RPC 门面
 * @param {() => void} props.reload 入库成功后重读 overview
 * @param {(text: string) => void} props.showToast 成功事件瞬态 Toast
 */
export function SearchView({ call, reload, showToast }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [candidates, setCandidates] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [candFilter, setCandFilter] = useState('')

  // 多候选统一入口：仅 DirectAdd（只知道仓库）进入候选列表。
  // intentDir = 入库动作自带的目录意图（搜索行直达失败的回退）：按建议名预选，帮用户守住原意图。
  const showCandidates = (value, intentDir) => {
    setCandidates(value)
    const intentName = typeof intentDir === 'string' && intentDir !== '' ? intentDir.split('/').pop() : null
    const pre = new Set()
    if (intentName) {
      for (const c of value.list) {
        const base = c.path ? c.path.split('/').pop() : ''
        if (base === intentName) pre.add(c.path || '')
      }
    }
    setSelected(pre)
    setCandFilter('')
    setNotice(null)
    setError(null)
  }

  // 在途闸门（ref 而非 state：渲染周期间连击也拦得住）。
  // 并发闸门收进函数体——Enter、按钮、行内「入库」都走同一路径，闸门不挂 UI 属性。
  const inFlight = useRef(false)

  const doSearch = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await call('search', { query })
      setResults(r)
      setCandidates(null)
    } catch (e) {
      // 失败时保留上一次成功结果与失败原因，不覆盖当前输入
      setError(e)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  // 搜索结果行入库：skills.sh 结果自带精确目录，意图不降级——直接 add 不经仓库探测
  // （分支回退 main→master 与目录定位兜底在 Host add 内部，探测对此路径是多余的）。
  // 目录意图失效（上游搬家 → needs-selection）时回退探测进候选列表，并按意图名预选。
  const addFromResult = async (repo, directory) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await call('add', { repo, dir: directory || undefined, ref: 'main' })
      showToast(`已入库 ${r.name}`)
      reload()
    } catch (e) {
      if (e?.code === 'needs-selection') {
        try {
          const r = await call('repo-skills', { repo, ref: 'main' })
          showCandidates({ repo, branch: r.branch, list: r.candidates }, directory)
          setNotice({ tone: 'warn', text: '该 skill 在仓库中的位置已变化（注册表目录信息过期），请在下方候选中确认——已按名称为你预选。' })
          return
        } catch (probeError) {
          setError(probeError)
          return
        }
      }
      setError(e)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  // 直接添加入库流程（仅 DirectAdd 用——只知道仓库时才有探测必要）：
  // repo-skills 探测 → 单候选直接入库 / 多候选进选择列表。
  const probeAndAdd = async (repo, ref, dir) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await call('repo-skills', { repo, ref })
      if (r.candidates.length <= 1) {
        await call('add', { repo, dir: r.candidates[0] ? r.candidates[0].path : dir, ref: r.branch })
        showToast(`已入库 ${repo}`)
        reload()
      } else {
        showCandidates({ repo, branch: r.branch, list: r.candidates })
      }
    } catch (e) {
      setError(e)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const suggestName = (c) => (c.path ? c.path.split('/').pop() : (candidates.repo.split('/')[1] || candidates.repo))
  // 批量入库：串行逐个 add（每次 add 自带入库记录与对账），单条失败不中断批次
  const addSelected = async () => {
    if (!candidates || selected.size === 0 || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    const picked = candidates.list.filter((c) => selected.has(c.path || ''))
    const failures = []
    let done = 0
    try {
      for (const c of picked) {
        try {
          await call('add', { repo: candidates.repo, dir: c.path || undefined, ref: candidates.branch })
          done += 1
        } catch (e) {
          failures.push(`${c.path || '（仓库根）'}：${e.message || e}`)
        }
      }
      if (done > 0) reload()
      if (failures.length > 0) {
        setError({ message: failures.join('；') })
      } else {
        setCandidates(null)
        setSelected(new Set())
      }
      if (failures.length > 0) {
        setNotice({ tone: 'warn', text: `已入库 ${done} 个，失败 ${failures.length} 个（逐条原因见下方红字）` })
      } else {
        showToast(`已入库 ${done} 个`)
      }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <div style={S.panel}>
      {/* 两个入库入口同一卡片语言：搜索 skills.sh（搜索为主按钮，Enter 快捷） */}
      <div style={{ ...cardStyle, padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ ...cardTitle, marginBottom: 10 }}>搜索 skills.sh</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Input
            style={{ flex: 1 }}
            placeholder="skills.sh 关键词"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
          />
          <PrimaryBtn onClick={doSearch} disabled={busy || !query.trim()}>{busy ? '搜索中…' : '搜索'}</PrimaryBtn>
        </div>
      </div>
      {/* 直接添加的语义是探测仓库；多候选交给候选列表选择。notice 必须是
          {tone,text} 形状——NoticeBar 按对象字段渲染，裸字符串会渲染成空反馈条。 */}
      <DirectAdd busy={busy} onProbeAdd={probeAndAdd} />
      {error ? <ErrorLine error={error} /> : null}
      {notice ? <NoticeBar notice={notice} /> : null}
      {/* 空态引导：未搜索且无候选时给一句提示，避免半页空白 */}
      {!results && !candidates && !error && (
        <div style={{ ...S.muted, padding: '4px 2px' }}>输入关键词搜索 skills.sh 注册表，或直接探测 GitHub 仓库入库。</div>
      )}
      {candidates && (
        <div style={{ marginBottom: 10 }}>
          <GhostBtn onClick={() => { setCandidates(null); setSelected(new Set()) }} disabled={busy}>← 返回搜索</GhostBtn>
          <div style={{ ...subCardStyle, padding: '10px 12px', margin: '8px 0 12px' }}>
            <div style={{ fontWeight: 500, color: T.labelPrimary, fontSize: 13 }}>{candidates.repo}</div>
            <div style={{ ...noteText, marginTop: 2 }}>{`${candidates.branch} · GitHub Trees API`}</div>
            <div style={{ ...noteText, marginTop: 2 }}>{`发现 ${candidates.list.length} 个含 SKILL.md 的目录，可多选入库。`}</div>
          </div>
          <div style={{ ...cardTitle, marginBottom: 8 }}>选择要入库的 Skill（可多选）</div>
          {/* 候选多（>8）时出过滤框：长候选列表无过滤不可用（如 37 个候选的仓库） */}
          {candidates.list.length > 8 && (
            <div style={{ marginBottom: 8 }}>
              <Input placeholder="过滤候选…" value={candFilter} onChange={(e) => setCandFilter(e.target.value)} />
            </div>
          )}
          {/* 容器卡 + 分隔线高密度列表 + 内嵌操作条（操作条在滚动区外，不随列表滚丢） */}
          {(() => {
            const query = candFilter.trim().toLowerCase()
            const visible = query === '' ? candidates.list : candidates.list.filter((c) => `${c.path}\n${suggestName(c)}`.toLowerCase().includes(query))
            return (
              <div style={{ ...cardStyle, padding: 0, marginBottom: 10 }}>
                <div style={{ maxHeight: 296, overflowY: 'auto', scrollbarWidth: 'thin' }}>
                  {visible.map((c, idx) => {
                    const key = c.path || ''
                    const checked = selected.has(key)
                    return (
                      <div key={key || '<root>'}>
                        {idx > 0 ? <div style={dividerStyle} /> : null}
                        <label style={{ ...S.listRow, cursor: busy ? 'default' : 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            style={{ accentColor: T.brand, width: 13, height: 13, margin: 0, flex: 'none' }}
                            onChange={() => {
                              const next = new Set(selected)
                              if (checked) next.delete(key)
                              else next.add(key)
                              setSelected(next)
                            }}
                          />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: T.labelPrimary, fontWeight: 500, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.path || '（仓库根）'}>{c.path || '（仓库根）'}</div>
                            <div style={noteText}>{`建议名称：${suggestName(c)}`}</div>
                          </span>
                        </label>
                      </div>
                    )
                  })}
                  {visible.length === 0 && <div style={{ ...S.muted, padding: '10px 12px' }}>无匹配候选</div>}
                </div>
                <div style={dividerStyle} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
                  <span style={{ ...noteText, flex: 1 }}>{`已选 ${selected.size} 个 · 共 ${candidates.list.length} 个候选`}</span>
                  <PrimaryBtn onClick={addSelected} disabled={busy || selected.size === 0}>{busy ? '入库中…' : '入库所选'}</PrimaryBtn>
                </div>
              </div>
            )
          })()}
          <div style={{ ...badgeStyle(T.warn), borderRadius: 10, padding: '9px 12px', fontSize: 11, lineHeight: 1.6, display: 'flex', gap: 8 }}>
            <span style={{ ...dotStyle(T.warn), marginTop: 5 }} />
            <div>
              <div>同名且同仓库时改用更新；同名异源时需先出库。</div>
              <div>分支按指定值 → main → master 回退。</div>
            </div>
          </div>
        </div>
      )}
      {results && results.skills.length === 0
        ? <div style={S.muted}>无结果</div>
        : (results && results.skills.length > 0
            ? (
                <div>
                  <div style={{ ...cardTitle, margin: '4px 0 8px' }}>{`“${results.query || query}” 的搜索结果 · ${results.skills.length} 个`}</div>
                  {results.skills.map((s) => (
                    <div key={s.key} style={S.row}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: T.labelPrimary }}>{s.name}</div>
                        <div style={noteText}>{`${s.repo}${s.directory ? ' / ' + s.directory : ''} · 安装 ${s.installs}`}</div>
                      </div>
                      {/* 目录意图精确：直接入库，不经仓库探测（分支/定位兜底在 Host add 内部） */}
                      <OutlineBtn onClick={() => addFromResult(s.repo, s.directory)} disabled={busy}>入库</OutlineBtn>
                    </div>
                  ))}
                </div>
              )
            : null)}
    </div>
  )
}

/** 直接添加入口（纯输入采集）：探测/入库流程逻辑在 SearchView 的 probeAndAdd，本组件不持有请求状态。 */
function DirectAdd({ busy, onProbeAdd }) {
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('')
  const submit = () => {
    if (!repo.trim()) return
    onProbeAdd(repo.trim(), branch.trim() || 'main', undefined)
  }
  return (
    <div style={{ ...cardStyle, padding: '12px 14px', marginBottom: 14 }}>
      <div style={{ ...cardTitle, marginBottom: 10 }}>从 GitHub 仓库添加</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          style={{ flex: 1 }}
          placeholder="owner/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <Input
          style={{ width: 110 }}
          placeholder="分支（可选）"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <OutlineBtn onClick={submit} disabled={busy || !repo.trim()}>探测仓库</OutlineBtn>
      </div>
    </div>
  )
}
