// dsh-skill-manager — Client 侧（plugin-runtime.md Client 入口与视图设计）。
//
// 注册两个槽位：
//   settings.section   id=skills  order=16  标签「技能」——管理/搜索/同步三视图；
//                      library 返回 workshop-unconfigured 时显示未配置引导。
//   settings.plugin.item id=skill-manager order=30 ——「本地 skill 目录」配置卡片
//                      （R-22：默认为空即未配置；保存立即生效，清空回到未配置）。
//
// 运行时外部依赖只有 react；组件全部 React.createElement 构建，内联样式使用
// --dsw-* 主题变量，不注入全局样式表；数据全部来自 Host RPC（C-07）。

window.__ModuleLoader__.load({
  id: 'dsh-skill-manager',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useState, useEffect, useRef } = React
    const h = React.createElement

    // ---------- Host RPC 调用（统一信封） ----------
    const createCall = () => async (method, payload = {}) => {
      let response
      try {
        response = await fetch('/skill-manager/api', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, payload }),
        })
      } catch (error) {
        const e = new Error(`无法连接 Host 服务：${error && error.message ? error.message : String(error)}`)
        e.code = 'unreachable'
        throw e
      }
      let envelope
      try {
        envelope = await response.json()
      } catch {
        throw new Error('Host 返回了非法响应')
      }
      if (!envelope.ok) {
        const e = new Error(envelope.error && envelope.error.message ? envelope.error.message : '请求失败')
        e.code = envelope.error ? envelope.error.code : 'internal'
        e.retryable = envelope.error ? envelope.error.retryable : false
        throw e
      }
      return envelope.data
    }

    // ---------- 内联样式（--dsw-* 主题变量） ----------
    const S = {
      row: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderBottom: '1px solid var(--dsw-border-color, rgba(128,128,128,.2))', fontSize: 13 },
      badge: (color) => ({ display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 11, background: `color-mix(in srgb, ${color} 15%, transparent)`, color }),
      btn: { padding: '2px 10px', borderRadius: 6, border: '1px solid var(--dsw-border-color, rgba(128,128,128,.3))', background: 'var(--dsw-bg-2, transparent)', color: 'var(--dsw-text-1, inherit)', fontSize: 12, cursor: 'pointer' },
      input: { padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsw-border-color, rgba(128,128,128,.3))', background: 'var(--dsw-bg-1, transparent)', color: 'var(--dsw-text-1, inherit)', fontSize: 13 },
      select: { padding: '3px 6px', borderRadius: 6, border: '1px solid var(--dsw-border-color, rgba(128,128,128,.3))', background: 'var(--dsw-bg-1, transparent)', color: 'var(--dsw-text-1, inherit)', fontSize: 12 },
      panel: { padding: '10px 12px' },
      title: { fontSize: 13, fontWeight: 600, margin: '8px 0 6px' },
      error: { color: '#e06c6c', fontSize: 12, padding: '6px 8px' },
      muted: { color: 'var(--dsw-text-2, rgba(128,128,128,.8))', fontSize: 12 },
      tabs: { display: 'flex', gap: '6px', padding: '8px 12px 0' },
      tab: (active) => ({ padding: '4px 12px', borderRadius: '8px 8px 0 0', fontSize: 12, cursor: 'pointer', border: '1px solid transparent', borderBottom: active ? '2px solid var(--dsw-accent, #4a90d9)' : '2px solid transparent', color: active ? 'var(--dsw-accent, #4a90d9)' : 'var(--dsw-text-2, rgba(128,128,128,.8))' }),
      guide: { padding: '24px 16px', textAlign: 'center', color: 'var(--dsw-text-2, rgba(128,128,128,.8))', fontSize: 13 },
    }

    // ---------- 通用小组件 ----------
    function Field({ label, children }) {
      return h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-text-2, rgba(128,128,128,.8))' } },
        h('span', null, label), children)
    }

    function ErrorLine({ error }) {
      if (!error) return null
      return h('div', { style: S.error }, String(error.message || error))
    }

    function useTick() {
      const [tick, setTick] = useState(0)
      return [tick, () => setTick((t) => t + 1)]
    }

    // ---------- 插件配置卡片（设置 → 插件 → skill-manager） ----------
    function SkillManagerCard({ scope }) {
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [message, setMessage] = useState(null)
      const sync = () => {
        const snap = scope.getSnapshot()
        setDraft(snap.value && snap.value.workshopDir ? snap.value.workshopDir : '')
      }
      useEffect(() => scope.subscribe(sync), [scope])
      useEffect(() => { sync() }, [scope])

      const save = async () => {
        setBusy(true)
        setError(null)
        setMessage(null)
        try {
          await scope.set('workshopDir', draft.trim())
          setMessage('已保存，立即生效')
        } catch (e) {
          setError(e && e.message ? e.message : '保存失败')
        } finally {
          setBusy(false)
        }
      }
      const clear = async () => {
        setBusy(true)
        setError(null)
        setMessage(null)
        try {
          await scope.unset('workshopDir')
          setMessage('已清空（回到未配置状态）')
        } catch (e) {
          setError(e && e.message ? e.message : '清空失败')
        } finally {
          setBusy(false)
        }
      }

      const snap = scope.getSnapshot()
      const configured = Boolean(snap.value && snap.value.workshopDir)
      return h('div', { style: { padding: '10px 12px' } },
        h('div', { style: { fontSize: 12, marginBottom: 6 } },
          h('span', { style: { fontWeight: 600 } }, '技能车间（skill-manager）'),
          configured
            ? h('span', { style: S.badge('#4a9d5f') }, '已配置')
            : h('span', { style: S.badge('#d9a13b') }, '未配置'),
          snap.status === 'loading' ? h('span', { style: S.muted, marginLeft: 8 }, '读取中…') : null,
        ),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(Field, { label: '本地 skill 目录' },
            h('input', {
              style: { ...S.input, width: 320 },
              value: draft,
              disabled: snap.writable === false,
              placeholder: '例如 E:\\Project\\Skills（默认为空 = 未配置）',
              onChange: (e) => { setDraft(e.target.value); setMessage(null) },
            }),
          ),
          h('button', { style: S.btn, onClick: save, disabled: busy || snap.writable === false }, '保存'),
          h('button', { style: S.btn, onClick: clear, disabled: busy || snap.writable === false }, '清空'),
        ),
        h(ErrorLine, { error }),
        message ? h('div', { style: { ...S.muted, color: '#4a9d5f', marginTop: 4 } }, message) : null,
        snap.writable === false ? h('div', { style: { ...S.error, padding: '2px 0' } }, '当前配置只读（远端会话）') : null,
      )
    }

    // ---------- 技能设置页 ----------
    function SkillsSection(props) {
      const call = props.call
      const scope = props.scope
      const [tab, setTab] = useState('manage')
      const [unconfigured, setUnconfigured] = useState(false)
      const [error, setError] = useState(null)
      const [data, setData] = useState(null)
      const [reloadTick, reload] = useTick()

      useEffect(() => {
        let alive = true
        setError(null)
        Promise.all([call('library', {}), call('groups'), call('health')])
          .then(([lib, grp, health]) => {
            if (!alive) return
            setData({ lib, grp, health: health.issues })
            setUnconfigured(false)
          })
          .catch((e) => {
            if (!alive) return
            if (e && e.code === 'workshop-unconfigured') setUnconfigured(true)
            else setError(e.message || String(e))
          })
        return () => { alive = false }
      }, [reloadTick])

      if (unconfigured) {
        return h('div', { style: S.guide },
          h('div', { style: { fontSize: 14, marginBottom: 8 } }, '尚未配置本地 skill 目录'),
          h('div', null, '请到 设置 → 插件 → skill-manager 卡片 配置车间根（默认为空即未配置），配置后本页自动可用。'),
          h('button', { style: { ...S.btn, marginTop: 12 }, onClick: reload }, '刷新'),
        )
      }
      if (!data) {
        return h('div', { style: S.panel },
          h(ErrorLine, { error }),
          error ? null : h('div', { style: S.muted }, '加载中…'),
        )
      }

      return h('div', null,
        h('div', { style: S.tabs },
          h('div', { style: S.tab(tab === 'manage'), onClick: () => setTab('manage') }, '管理'),
          h('div', { style: S.tab(tab === 'search'), onClick: () => setTab('search') }, '搜索'),
          h('div', { style: S.tab(tab === 'sync'), onClick: () => setTab('sync') }, '同步'),
        ),
        h(ErrorLine, { error }),
        tab === 'manage' && h(ManageView, { call, data, reload, scope }),
        tab === 'search' && h(SearchView, { call, data, reload }),
        tab === 'sync' && h(SyncView, { call, data, reload }),
      )
    }

    // ---------- 管理视图 ----------
    function ManageView({ call, data, reload }) {
      const [origin, setOrigin] = useState('')
      const [groupFilter, setGroupFilter] = useState('')
      const [q, setQ] = useState('')
      const [list, setList] = useState(data.lib.skills)
      const [importOpen, setImportOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)

      const refresh = async (extra = {}) => {
        setBusy(true)
        setError(null)
        try {
          const lib = await call('library', { origin, group: groupFilter, q, ...extra })
          setList(lib.skills)
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      useEffect(() => { refresh() }, [origin, groupFilter, q])

      const groupNames = data.grp.groups.map((g) => g.name)
      const chips = ['', ...groupNames, '默认']
      const rowAction = async (name, action, payload = {}) => {
        setBusy(true)
        setError(null)
        try {
          if (action === 'check') await call('check', { names: [name] })
          else if (action === 'update') await call('update', { names: [name] })
          else if (action === 'disable') await call('disable', { name })
          else if (action === 'enable') await call('enable', { name })
          else if (action === 'remove') {
            if (!window.confirm(`确认删除 ${name}？（先备份到车间 distributor/backups）`)) return
            await call('remove', { name, keepFiles: false })
          } else if (action === 'restore') {
            const id = window.prompt('输入备份 id（备份列表见下方提示）')
            if (id) await call('restore', { id })
          }
          reload()
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      const move = async (dir, group) => {
        setBusy(true)
        setError(null)
        try {
          await call('groups/op', { action: 'move', dir, group: group === '默认' ? null : group })
          reload()
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      const groupOp = async (action, name, newName) => {
        setBusy(true)
        setError(null)
        try {
          if (action === 'delete' && !window.confirm(`删除组 ${name}？成员将回落「默认」组`)) return
          await call('groups/op', { action, name, newName })
          reload()
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: S.panel },
        // 工具条
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 } },
          h('select', { style: S.select, value: origin, onChange: (e) => setOrigin(e.target.value) },
            h('option', { value: '' }, '全部来源'),
            h('option', { value: 'github' }, 'GitHub'),
            h('option', { value: 'local' }, '本地'),
            h('option', { value: 'self' }, '自研'),
          ),
          h('select', { style: S.select, value: groupFilter, onChange: (e) => setGroupFilter(e.target.value) },
            h('option', { value: '' }, '全部分组'),
            groupNames.map((g) => h('option', { key: g, value: g }, g)),
            h('option', { value: '默认' }, '默认'),
          ),
          h('input', { style: { ...S.input, width: 140 }, placeholder: '过滤名称/描述', value: q, onChange: (e) => setQ(e.target.value) }),
          h('button', { style: S.btn, onClick: () => { reload() }, disabled: busy }, '刷新'),
          h('button', { style: S.btn, onClick: () => setImportOpen(!importOpen), disabled: busy }, '导入 skill'),
        ),
        // 导入面板
        importOpen && h(ImportPanel, { call, reload, onDone: () => setImportOpen(false) }),
        // 组配置条
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' } },
          h('span', { style: S.muted }, '分组:'),
          data.grp.groups.map((g) =>
            h('span', { key: g.name, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              h('span', { style: S.badge('#5a7fd9') }, `${g.name}(${g.count})`),
              h('button', { style: { ...S.btn, padding: '0 6px', fontSize: 11 }, onClick: () => groupOp('rename', g.name, window.prompt('新组名', g.name)) }, '改名'),
              h('button', { style: { ...S.btn, padding: '0 6px', fontSize: 11 }, onClick: () => groupOp('delete', g.name) }, '删'),
            ),
          ),
          h(GroupCreate, { call, reload }),
        ),
        // 行
        list.length === 0
          ? h('div', { style: S.muted, padding: 12 }, '库为空（无匹配 skill）')
          : list.map((it) => h('div', { key: it.dir, style: S.row },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h('span', { style: { fontWeight: 600 } }, it.name),
                  h('span', { style: S.badge(it.origin === 'github' ? '#5a7fd9' : it.origin === 'local' ? '#4a9d5f' : '#8a6fd9') }, it.origin),
                  it.missing && h('span', { style: S.badge('#e06c6c') }, '缺失'),
                  it.disabled && h('span', { style: S.badge('#d9a13b') }, '已禁用'),
                  !it.hasSkillMd && h('span', { style: S.badge('#d9a13b') }, '无 SKILL.md'),
                ),
                h('div', { style: S.muted }, `${it.description || '（无描述）'}${it.fingerprint ? ' · ' + it.fingerprint.slice(0, 7) : ''}`),
              ),
              h('select', {
                style: S.select,
                value: it.group || '默认',
                onChange: (e) => move(it.dir, e.target.value),
                disabled: busy,
              },
                groupNames.map((g) => h('option', { key: g, value: g }, g)),
                h('option', { value: '默认' }, '默认'),
              ),
              h('span', { style: S.muted }, (it.targets || []).join(' ')),
              it.missing
                ? h('button', { style: S.btn, onClick: () => rowAction(it.dir, 'update'), disabled: busy }, '恢复')
                : h('span', { style: { display: 'flex', gap: 4 } },
                    h('button', { style: S.btn, onClick: () => rowAction(it.dir, 'check'), disabled: busy }, '检查'),
                    it.disabled
                      ? h('button', { style: S.btn, onClick: () => rowAction(it.dir, 'enable'), disabled: busy }, '启用')
                      : h('span', { style: { display: 'flex', gap: 4 } },
                          h('button', { style: S.btn, onClick: () => rowAction(it.dir, 'update'), disabled: busy }, '更新'),
                          h('button', { style: S.btn, onClick: () => rowAction(it.dir, 'disable'), disabled: busy }, '禁用'),
                          h('button', { style: { ...S.btn, color: '#e06c6c' }, onClick: () => rowAction(it.dir, 'remove'), disabled: busy }, '删除'),
                        ),
                  ),
            )),
      )
    }

    function GroupCreate({ call, reload }) {
      const [name, setName] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const create = async () => {
        if (!name.trim()) return
        setBusy(true)
        setError(null)
        try {
          await call('groups/op', { action: 'create', name: name.trim() })
          setName('')
          reload()
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        h('input', { style: { ...S.input, width: 90 }, placeholder: '新组名', value: name, onChange: (e) => setName(e.target.value) }),
        h('button', { style: S.btn, onClick: create, disabled: busy }, '新建组'),
        h(ErrorLine, { error }),
      )
    }

    function ImportPanel({ call, reload, onDone }) {
      const [path, setPath] = useState('')
      const [as, setAs] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const doImport = async () => {
        setBusy(true)
        setError(null)
        try {
          await call('import', { path, as: as || undefined })
          onDone()
          reload()
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      return h('div', { style: { border: '1px solid var(--dsw-border-color, rgba(128,128,128,.2))', borderRadius: 8, padding: 8, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        h(Field, { label: '目录或 .zip 路径' }, h('input', { style: { ...S.input, width: 260 }, value: path, onChange: (e) => setPath(e.target.value), placeholder: 'E:\\path\\skill-dir 或 .zip' })),
        h(Field, { label: '改名(可选)' }, h('input', { style: { ...S.input, width: 120 }, value: as, onChange: (e) => setAs(e.target.value) })),
        h('button', { style: S.btn, onClick: doImport, disabled: busy || !path.trim() }, '导入'),
        h(ErrorLine, { error }),
      )
    }

    // ---------- 搜索视图 ----------
    function SearchView({ call, data, reload }) {
      const [query, setQuery] = useState('')
      const [results, setResults] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [candidates, setCandidates] = useState(null)

      const doSearch = async () => {
        setBusy(true)
        setError(null)
        try {
          const r = await call('search', { query })
          setResults(r)
          setCandidates(null)
        } catch (e) {
          setError(e.message || String(e))
          setResults(null)
        } finally {
          setBusy(false)
        }
      }
      const addFrom = async (repo, dir, ref) => {
        setBusy(true)
        setError(null)
        try {
          const r = await call('repo-skills', { repo, ref: ref || 'main' })
          if (r.candidates.length <= 1) {
            await call('add', { repo, dir: r.candidates[0] && r.candidates[0].path ? r.candidates[0].path : dir, ref: r.branch })
            reload()
          } else {
            setCandidates({ repo, branch: r.branch, list: r.candidates })
          }
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      const addChosen = async (path) => {
        setBusy(true)
        setError(null)
        try {
          await call('add', { repo: candidates.repo, dir: path || undefined, ref: candidates.branch })
          setCandidates(null)
          reload()
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: S.panel },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 } },
          h('input', { style: { ...S.input, width: 240 }, placeholder: 'skills.sh 关键词', value: query, onChange: (e) => setQuery(e.target.value) }),
          h('button', { style: S.btn, onClick: doSearch, disabled: busy }, '搜索'),
          h(Field, { label: '直接添加' },
            h(DirectAdd, { call, reload, busy, setBusy, setError }),
          ),
        ),
        h(ErrorLine, { error }),
        candidates && h('div', { style: { marginBottom: 8 } },
          h('div', { style: S.title }, `${candidates.repo} 含多个 skill，选择其一：`),
          candidates.list.map((c) => h('div', { key: c.path || '<root>', style: S.row },
            h('span', { style: { flex: 1 } }, c.path || '（仓库根）'),
            h('button', { style: S.btn, onClick: () => addChosen(c.path), disabled: busy }, '入库'),
          )),
        ),
        results && results.skills.length === 0
          ? h('div', { style: S.muted }, '无结果')
          : (results ? results.skills : []).map((s) => h('div', { key: s.key, style: S.row },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontWeight: 600 } }, s.name),
                h('div', { style: S.muted }, `${s.repo}${s.directory ? ' / ' + s.directory : ''} · 安装 ${s.installs}`),
              ),
              h('button', { style: S.btn, onClick: () => addFrom(s.repo, s.directory, ''), disabled: busy }, '入库'),
            )),
      )
    }

    function DirectAdd({ call, reload, busy, setBusy, setError }) {
      const [repo, setRepo] = useState('')
      const add = async () => {
        if (!repo.trim()) return
        setBusy(true)
        setError(null)
        try {
          const r = await call('repo-skills', { repo: repo.trim(), ref: 'main' })
          if (r.candidates.length <= 1) {
            await call('add', { repo: repo.trim(), dir: r.candidates[0] && r.candidates[0].path ? r.candidates[0].path : undefined, ref: r.branch })
            reload()
          } else {
            setError(`仓库含多个 skill：${r.candidates.map((c) => c.path || '（根）').join(', ')}，请先用搜索或指定目录`)
          }
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      return h('span', { style: { display: 'inline-flex', gap: 4, alignItems: 'center' } },
        h('input', { style: { ...S.input, width: 180 }, placeholder: 'owner/repo', value: repo, onChange: (e) => setRepo(e.target.value) }),
        h('button', { style: S.btn, onClick: add, disabled: busy }, '添加'),
      )
    }

    // ---------- 同步视图 ----------
    function SyncView({ call, data, reload }) {
      const [health, setHealth] = useState(data.health)
      const [projects, setProjects] = useState(data.grp.projects)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [matrix, setMatrix] = useState(null)
      const [tick, bumpTick] = useTick()

      useEffect(() => {
        let alive = true
        setBusy(true)
        setError(null)
        Promise.all([call('health'), call('project-skills')])
          .then(([h, ps]) => {
            if (!alive) return
            setHealth(h.issues)
            const projectEntries = ps.projects
            const columns = [{ key: 'dsh|global|', label: 'dsh 全局' }, ...Object.keys(projects).map((name) => ({ key: `dsh|project|${name}`, label: name }))]
            const rows = (data.lib ? data.lib.skills : []).map((it) => ({
              name: it.name,
              dir: it.dir,
              cells: columns.map((col) => {
                const want = (it.targets || []).includes(col.key)
                if (!want) {
                  const entry = projectEntries[col.label] && projectEntries[col.label].entries.find((e) => e.name === it.dir)
                  if (entry && entry.kind === 'local-skill') return 'shadowed'
                  return '不适用'
                }
                const entry = projectEntries[col.label] && projectEntries[col.label].entries.find((e) => e.name === it.dir)
                if (entry && entry.kind !== 'managed-ok') return '错误'
                return '生效'
              }),
            }))
            setMatrix({ columns, rows })
          })
          .catch((e) => setError(e.message || String(e)))
          .finally(() => setBusy(false))
        return () => { alive = false }
      }, [tick])
      const fix = async () => {
        setBusy(true)
        setError(null)
        try {
          await call('sync', { method: 'auto' })
          reload()
          bumpTick()
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      const projectOp = async (action, payload) => {
        setBusy(true)
        setError(null)
        try {
          if (action === 'remove' && !window.confirm(`删除项目 ${payload.name}？（${payload.cascade ? '将级联移除其挂载并摘除链接' : '仍被引用时需级联确认'}）`)) return
          const r = await call('projects', { action, ...payload })
          setProjects(r.projects)
          reload()
          bumpTick()
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: S.panel },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 } },
          h('span', { style: { fontWeight: 600 } }, `健康问题 ${health.length} 项`),
          h('button', { style: S.btn, onClick: fix, disabled: busy || health.length === 0 }, '应用并修复'),
          h(ProjectAdd, { call, reload, busy, setBusy, setError }),
        ),
        h(ErrorLine, { error }),
        health.length === 0
          ? h('div', { style: { ...S.muted, marginBottom: 8 } }, '健康：无问题')
          : health.map((issue, i) => h('div', { key: i, style: S.row },
              h('span', { style: S.badge('#e06c6c') }, issue.issue),
              h('span', { style: { flex: 1 } }, `${issue.name} @ ${issue.target || '—'}`),
            )),
        // 项目注册表
        h('div', { style: S.title }, '项目注册表'),
        Object.keys(projects).length === 0
          ? h('div', { style: S.muted }, '未注册项目')
          : Object.entries(projects).map(([name, path]) => h('div', { key: name, style: S.row },
              h('span', { style: { flex: 1 } }, h('span', { style: { fontWeight: 600 } }, name), h('span', { style: S.muted }, `  ${path}`)),
              h('button', { style: S.btn, onClick: () => projectOp('rename', { name, newName: window.prompt('新项目名', name) }), disabled: busy }, '改名'),
              h('button', { style: S.btn, onClick: () => { const p = window.prompt('新路径', path); if (p) projectOp('edit-path', { name, path: p }) }, disabled: busy }, '改路径'),
              h('button', { style: { ...S.btn, color: '#e06c6c' }, onClick: () => projectOp('remove', { name, cascade: true }), disabled: busy }, '删除'),
            )),
        // 矩阵
        matrix && h('div', null,
          h('div', { style: S.title }, '同步矩阵'),
          h('table', { style: { borderCollapse: 'collapse', fontSize: 12, width: '100%' } },
            h('thead', null, h('tr', null,
              h('th', { style: { textAlign: 'left', padding: 4 } }, 'skill'),
              matrix.columns.map((c) => h('th', { key: c.key, style: { textAlign: 'left', padding: 4 } }, c.label)),
            )),
            h('tbody', null, matrix.rows.map((row) => h('tr', { key: row.dir },
              h('td', { style: { padding: 4 } }, row.name),
              row.cells.map((cell, i) => h('td', { key: i, style: { padding: 4 } },
                h('span', { style: S.badge(cell === '生效' ? '#4a9d5f' : cell === '错误' ? '#e06c6c' : cell === 'shadowed' ? '#d9a13b' : 'rgba(128,128,128,.6)') }, cell),
              )),
            ))),
          ),
        ),
      )
    }

    function ProjectAdd({ call, reload, busy, setBusy, setError }) {
      const [name, setName] = useState('')
      const [path, setPath] = useState('')
      const add = async () => {
        setBusy(true)
        setError(null)
        try {
          await call('projects', { action: 'add', name: name.trim(), path: path.trim() })
          setName('')
          setPath('')
          reload()
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      return h('span', { style: { display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 'auto' } },
        h('input', { style: { ...S.input, width: 110 }, placeholder: '项目名', value: name, onChange: (e) => setName(e.target.value) }),
        h('input', { style: { ...S.input, width: 200 }, placeholder: '项目绝对路径', value: path, onChange: (e) => setPath(e.target.value) }),
        h('button', { style: S.btn, onClick: add, disabled: busy || !name.trim() || !path.trim() }, '注册项目'),
      )
    }

    // ---------- 插件入口 ----------
    const inject = ['slots', 'connection', 'remote', 'settingsScope']

    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: 'skill-manager' })
      const call = createCall()

      ctx.effect(() => {
        const offSection = ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'skills', order: 16, label: '技能', inject: () => ({ call, scope }) },
            SkillsSection,
          ),
        )
        const offCard = ctx.slots.inject('settings.plugin.item', () =>
          ctx.slots.register(
            { name: 'settings.plugin.item', id: 'skill-manager', order: 30, label: '技能目录', inject: () => ({ scope }) },
            SkillManagerCard,
          ),
        )
        return () => { offSection(); offCard() }
      }, 'dsh-skill-manager: settings slots')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
