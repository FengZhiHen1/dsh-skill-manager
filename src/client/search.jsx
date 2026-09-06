// search — 搜索视图：入库唯一入口，走 skills.sh 搜索或 GitHub 仓库探测。
//
// 边界：候选多选批量入库串行逐个 add，单条失败不中断批次。
// 参考：插件运行时.md「搜索视图」；DSR-007、DSR-008、DSR-017。
import { useState, useRef } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { T, S, badgeStyle, cardStyle, cardTitle, noteText, dotStyle, subCardStyle } from './theme.js'
import { GhostBtn, OutlineBtn, PrimaryBtn, ErrorLine, NoticeBar } from './ui.jsx'

/**
 * 搜索视图（settings.section 内页签组件）。
 * @param {object} props
 * @param {(endpoint: string, payload?: object) => Promise<unknown>} props.call RPC 门面
 * @param {() => void} props.reload 入库成功后重读 overview
 */
export function SearchView({ call, reload }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [candidates, setCandidates] = useState(null)
  const [selected, setSelected] = useState(new Set())

  // 多候选统一入口：搜索入库与探测仓库共用同一候选列表，复选后批量入库
  const showCandidates = (value) => {
    setCandidates(value)
    setSelected(new Set())
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

  // 探测入库统一流程（搜索行「入库」与直接添加共用，消除复制漂移）：
  // repo-skills 探测 → 单候选直接入库（候选路径优先，缺省回退传入 dir）/ 多候选进选择列表。
  const probeAndAdd = async (repo, ref, dir) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await call('repo-skills', { repo, ref })
      if (r.candidates.length <= 1) {
        await call('add', { repo, dir: r.candidates[0] ? r.candidates[0].path : dir, ref: r.branch })
        setNotice({ tone: 'ok', text: `已入库 ${repo}` })
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
      setNotice(failures.length > 0
        ? { tone: 'warn', text: `已入库 ${done} 个，失败 ${failures.length} 个（逐条原因见下方红字）` }
        : { tone: 'ok', text: `已入库 ${done} 个` })
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
          {candidates.list.map((c) => {
            const key = c.path || ''
            const checked = selected.has(key)
            return (
              <label key={key || '<root>'} style={{ ...S.row, cursor: busy ? 'default' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={() => {
                    const next = new Set(selected)
                    if (checked) next.delete(key)
                    else next.add(key)
                    setSelected(next)
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: T.labelPrimary, fontWeight: 500, fontSize: 12 }}>{c.path || '（仓库根）'}</div>
                  <div style={noteText}>{`建议名称：${suggestName(c)}`}</div>
                </span>
              </label>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
            <span style={{ ...noteText, flex: 1 }}>{`已选 ${selected.size} 个 · 共 ${candidates.list.length} 个候选`}</span>
            <PrimaryBtn onClick={addSelected} disabled={busy || selected.size === 0}>{busy ? '入库中…' : '入库所选'}</PrimaryBtn>
          </div>
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
                      <OutlineBtn onClick={() => probeAndAdd(s.repo, 'main', s.directory)} disabled={busy}>入库</OutlineBtn>
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
