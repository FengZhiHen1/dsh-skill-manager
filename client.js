// dsh-skill-manager — Client 侧（plugin-runtime.md Client 入口与视图设计）。
//
// 注册两个槽位：
//   settings.section   id=skills  order=16  标签「技能」——管理/搜索/同步三视图；
//                      library 返回 workshop-unconfigured 时显示未配置引导。
//   settings.plugin.item id=skill-manager order=30 ——「本地 skill 目录」配置卡片
//                      （R-22：默认为空即未配置；保存立即生效，清空回到未配置）。
//
// 样式对齐 DSH 原生：主题 token 使用 --dsw-alias-* 系列（ui-theme 定义），
// 按钮/输入/徽章复用 @deepseek-ai/dsh-client-ui-primitives 的 Button/Input/Pill
// 原子组件（CSS modules 内嵌、token 驱动、随主题切换）；不注入全局样式表；
// 数据全部来自 Host RPC（C-07）。

window.__ModuleLoader__.load({
  id: 'dsh-skill-manager',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useState, useEffect } = React
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { Button, Input, Pill, Modal } = primitives
    // 防御：icon 为可选装饰，缺失时降级为文本箭头，绝不让整卡渲染失败
    const ChevronIcon = typeof primitives.IconChevronDownOutline14 === 'function' ? primitives.IconChevronDownOutline14 : null
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

    // ---------- DSH 原生主题 token（--dsw-alias-*，ui-theme design-platform.css） ----------
    const T = {
      bgBase: 'var(--dsw-alias-bg-base)',
      bgLayer2: 'var(--dsw-alias-bg-layer-2)',
      bgLayer3: 'var(--dsw-alias-bg-layer-3)',
      bgModulePlatform: 'var(--dsw-alias-bg-module-platform)',
      borderL1: 'var(--dsw-alias-border-l1)',
      borderL2: 'var(--dsw-alias-border-l2)',
      brand: 'var(--dsw-alias-brand-primary)',
      labelPrimary: 'var(--dsw-alias-label-primary)',
      labelSecondary: 'var(--dsw-alias-label-secondary)',
      labelTertiary: 'var(--dsw-alias-label-tertiary)',
      labelDimmed: 'var(--dsw-alias-label-dimmed)',
      success: 'var(--dsw-alias-state-success-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
    }
    /** token 色胶囊徽章：色相随状态 token，底色 color-mix 透明晕。 */
    const badgeStyle = (color) => ({
      color,
      background: `color-mix(in srgb, ${color} 15%, transparent)`,
    })

    const S = {
      row: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderBottom: `1px solid ${T.borderL1}`, fontSize: 13 },
      select: { padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.borderL1}`, background: T.bgBase, color: T.labelPrimary, fontSize: 12 },
      panel: { padding: '10px 12px' },
      title: { fontSize: 13, fontWeight: 600, margin: '8px 0 6px', color: T.labelPrimary },
      error: { color: T.error, fontSize: 12, padding: '6px 8px' },
      muted: { color: T.labelSecondary, fontSize: 12 },
      guide: { padding: '24px 16px', textAlign: 'center', color: T.labelSecondary, fontSize: 13 },
      dangerText: { color: T.error },
      field: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.labelSecondary },
      toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
    }

    // ---------- 通用小组件 ----------
    function Field({ label, children }) {
      return h('label', { style: S.field }, h('span', null, label), children)
    }

    function ErrorLine({ error }) {
      if (!error) return null
      return h('div', { style: S.error }, String(error.message || error))
    }

    function useTick() {
      const [tick, setTick] = useState(0)
      return [tick, () => setTick((t) => t + 1)]
    }

    /** 行内次要按钮（ghost sm）。 */
    const GhostBtn = (props) => h(Button, { variant: 'ghost', size: 'sm', ...props })
    /** 行内主操作按钮（outline sm）。 */
    const OutlineBtn = (props) => h(Button, { variant: 'outline', size: 'sm', ...props })

    // ---------- 目录选择弹层（平台原语 ctx.workspaces.listDirectory + 原生 Modal） ----------
    // 对齐原生 DirectoryBrowser 交互：主目录起始、面包屑跳转、逐级下钻、显示隐藏、打开/取消。
    function DirectoryPicker({ open, onClose, onPick, workspaces }) {
      const [listing, setListing] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState(null)
      const [showHidden, setShowHidden] = useState(false)

      const load = async (path, signal) => {
        setLoading(true)
        setError(null)
        try {
          const next = await workspaces.listDirectory(path, signal)
          setListing(next)
        } catch (e) {
          setError(e && e.message ? e.message : '目录读取失败')
        } finally {
          setLoading(false)
        }
      }
      useEffect(() => {
        if (!open) return
        const controller = new AbortController()
        setListing(null)
        load(undefined, controller.signal) // 未指定路径 = Host 主目录
        return () => controller.abort()
      }, [open])

      if (!open) return null
      const rows = (listing ? listing.entries : []).filter((e) => showHidden || !e.hidden)
      return h(Modal, {
        open,
        onClose,
        title: '选择本地 skill 目录',
        description: listing ? `当前：${listing.path}` : '读取目录中…',
        footer: h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          h(GhostBtn, { onClick: onClose }, '取消'),
          h(OutlineBtn, { disabled: !listing || loading, onClick: () => { onPick(listing.path) } }, '打开'),
        ),
      },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 360, maxHeight: 380 } },
          // 面包屑
          listing && listing.crumbs.length > 0
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontSize: 12 } },
                listing.crumbs.map((crumb, i) =>
                  h('span', { key: crumb.path + i, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                    i > 0 ? h('span', { style: { color: T.labelTertiary } }, '/') : null,
                    h('button', {
                      type: 'button',
                      onClick: () => { load(crumb.path) },
                      style: { border: 'none', background: 'none', padding: '2px 4px', borderRadius: 4, font: 'inherit', fontSize: 12, color: i === listing.crumbs.length - 1 ? T.labelPrimary : T.labelSecondary, cursor: 'pointer' },
                    }, crumb.name),
                  ),
                ),
              )
            : null,
          // 隐藏文件开关
          h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.labelSecondary } },
            h('input', { type: 'checkbox', checked: showHidden, onChange: (e) => setShowHidden(e.target.checked) }),
            '显示隐藏文件',
          ),
          // 目录列表
          h('div', { style: { border: `1px solid ${T.borderL1}`, borderRadius: 8, overflowY: 'auto', flex: 1 } },
            loading && !listing
              ? h('div', { style: { padding: 12, color: T.labelTertiary, fontSize: 12 } }, '加载中…')
              : rows.length === 0
                ? h('div', { style: { padding: 12, color: T.labelTertiary, fontSize: 12 } }, '（无子目录）')
                : rows.map((entry) => h('button', {
                    type: 'button',
                    key: entry.path,
                    onClick: () => { load(entry.path) },
                    style: {
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                      padding: '6px 10px', border: 'none', background: 'none', font: 'inherit', fontSize: 13,
                      color: T.labelPrimary, cursor: 'pointer',
                    },
                  },
                    h('span', { style: { color: T.labelTertiary } }, '📁'),
                    h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
                  )),
          ),
          error ? h('div', { style: { color: T.error, fontSize: 12 } }, error) : null,
        ),
      )
    }

    // ---------- 插件配置卡片（设置 → 插件 → skill-manager） ----------
    // 与 DSH 原生 PluginCard 同构：li > header（名称/描述/未保存标记/折叠箭头）
    // + body（字段 + footer：放弃/保存）；token 与几何对齐 PluginCard.module.css。
    function SkillManagerCard({ scope, workspaces }) {
      const [open, setOpen] = useState(false)
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [failed, setFailed] = useState(null)
      const [focused, setFocused] = useState(false)
      const [pickerOpen, setPickerOpen] = useState(false)
      const sync = () => {
        const snap = scope.getSnapshot()
        setDraft(snap.value && snap.value.workshopDir ? snap.value.workshopDir : '')
      }
      useEffect(() => scope.subscribe(sync), [scope])
      useEffect(() => { sync() }, [scope])

      const snap = scope.getSnapshot()
      // 命名空间不可用/加载中都不隐藏卡片：仅禁用控件（unavailable 时仍展示，
      // 避免状态时序问题导致整卡消失）
      const current = snap.value && snap.value.workshopDir ? snap.value.workshopDir : ''
      const dirty = draft !== current
      // 可写性只看 Host 报告的 writable；status 不参与（loading/unavailable 时序
      // 不应把输入框禁掉——保存失败由 footer 报错呈现）
      const writable = snap.writable !== false
      const overridden = Boolean(snap.user && typeof snap.user === 'object' && 'workshopDir' in snap.user)

      const save = async () => {
        setBusy(true)
        setFailed(null)
        try {
          await scope.set('workshopDir', draft.trim())
        } catch (e) {
          setFailed(e && e.message ? e.message : '保存失败')
        } finally {
          setBusy(false)
        }
      }
      const discard = () => {
        setFailed(null)
        setDraft(current)
      }
      const reset = async () => {
        setBusy(true)
        setFailed(null)
        try {
          await scope.unset('workshopDir')
        } catch (e) {
          setFailed(e && e.message ? e.message : '重置失败')
        } finally {
          setBusy(false)
        }
      }

      return h('li', {
        style: {
          listStyle: 'none',
          border: `1px solid ${T.borderL2}`,
          borderRadius: 12,
          background: open ? T.bgLayer2 : T.bgLayer3,
          transition: 'border-color .16s, background .16s',
        },
      },
        h('button', {
          type: 'button',
          'aria-expanded': open,
          'aria-label': `${open ? '收起' : '展开'}: 技能车间（skill-manager）`,
          onClick: () => setOpen(!open),
          style: {
            width: '100%',
            appearance: 'none',
            border: 0,
            background: 'none',
            font: 'inherit',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderRadius: 12,
          },
        },
          h('span', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
            h('span', { style: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: T.labelPrimary } }, '技能车间（skill-manager）'),
            h('span', { style: { fontSize: 13, lineHeight: 1.5, color: T.labelTertiary } }, '配置本地 skill 车间根目录（默认为空即未配置）'),
          ),
          dirty
            ? h('span', { style: { flex: 'none', borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', fontWeight: 500, whiteSpace: 'nowrap', background: T.bgModulePlatform, color: T.labelSecondary } }, '未保存')
            : null,
          ChevronIcon
            ? h(ChevronIcon, { style: { flex: 'none', color: T.labelTertiary, transition: 'transform .16s', transform: open ? 'rotate(180deg)' : undefined } })
            : h('span', { style: { flex: 'none', color: T.labelTertiary, fontSize: 12 } }, open ? '▾' : '▸'),
        ),
        open
          ? h('div', { style: { borderTop: `1px solid ${T.borderL2}`, margin: '0 16px', paddingBottom: 8 } },
              !writable ? h('p', { style: { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: T.labelTertiary } }, '当前配置只读（远端会话）') : null,
              // 字段（对齐 ValueField 形态：label/input/hint 纵排）
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('label', { htmlFor: 'skill-manager-workshop-dir', style: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: T.labelPrimary } }, '本地 skill 目录'),
                  overridden
                    ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
                        h('span', { style: { borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', whiteSpace: 'nowrap', fontWeight: 500, background: T.bgModulePlatform, color: T.labelSecondary } }, '已覆盖'),
                        h('button', { type: 'button', disabled: busy || !writable, onClick: reset, style: { border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, lineHeight: 1.5, color: T.labelSecondary, cursor: 'pointer' } }, '重置'),
                      )
                    : null,
                ),
                // 输入框：裸 input + fields 几何（对齐原生 ValueField；不用 primitives
                // Input——其 wrap 自带边框/圆角，再传几何会叠成"两个框"）
                h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                  h('input', {
                    id: 'skill-manager-workshop-dir',
                    type: 'text',
                    value: draft,
                    disabled: !writable,
                    placeholder: '例如 E:\\Project\\Skills（默认为空 = 未配置）',
                    onChange: (e) => { setDraft(e.target.value); setFailed(null) },
                    onFocus: () => setFocused(true),
                    onBlur: () => setFocused(false),
                    style: {
                      flex: 1,
                      minWidth: 0,
                      height: 34,
                      padding: '0 12px',
                      border: `1px solid ${focused ? T.brand : T.borderL2}`,
                      borderRadius: 8,
                      background: T.bgLayer3,
                      font: 'inherit',
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: T.labelPrimary,
                      outline: 'none',
                      boxSizing: 'border-box',
                    },
                  }),
                  h(GhostBtn, { disabled: !writable, onClick: () => setPickerOpen(true) }, '选择…'),
                ),
                h(DirectoryPicker, {
                  open: pickerOpen,
                  workspaces,
                  onClose: () => setPickerOpen(false),
                  onPick: (path) => { setDraft(path); setFailed(null); setPickerOpen(false) },
                }),
                h('p', { style: { margin: 0, fontSize: 12, lineHeight: 1.5, color: T.labelTertiary } }, '绝对路径；保存后立即生效，无需重启。'),
              ),
              // footer：失败提示 + 放弃/保存（对齐 PluginCard footer）
              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: `1px solid ${T.borderL2}` } },
                failed ? h('p', { style: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: T.error } }, failed) : null,
                h('button', {
                  type: 'button',
                  disabled: !dirty || busy,
                  onClick: discard,
                  style: {
                    appearance: 'none',
                    border: `1px solid ${T.borderL2}`,
                    borderRadius: 8,
                    padding: '5px 14px',
                    font: 'inherit',
                    fontSize: 13,
                    lineHeight: 1.5,
                    cursor: 'pointer',
                    background: 'none',
                    color: T.labelSecondary,
                  },
                }, '放弃'),
                h('button', {
                  type: 'button',
                  disabled: !dirty || busy || !writable,
                  onClick: save,
                  style: {
                    appearance: 'none',
                    border: '1px solid transparent',
                    borderRadius: 8,
                    padding: '5px 14px',
                    font: 'inherit',
                    fontSize: 13,
                    lineHeight: 1.5,
                    cursor: 'pointer',
                    background: T.labelPrimary,
                    color: T.bgLayer3,
                  },
                }, busy ? '保存中…' : '保存'),
              ),
            )
          : null,
      )
    }

    // ---------- 技能设置页 ----------
    function SkillsSection(props) {
      const call = props.call
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
          h('div', { style: { fontSize: 14, marginBottom: 8, color: T.labelPrimary } }, '尚未配置本地 skill 目录'),
          h('div', null, '请到 设置 → 插件 → skill-manager 卡片 配置车间根（默认为空即未配置），配置后本页自动可用。'),
          h(OutlineBtn, { style: { marginTop: 12 }, onClick: reload }, '刷新'),
        )
      }
      if (!data) {
        return h('div', { style: S.panel },
          h(ErrorLine, { error }),
          error ? null : h('div', { style: S.muted }, '加载中…'),
        )
      }

      return h('div', null,
        h('div', { style: { display: 'flex', gap: 4, padding: '8px 12px 0' } },
          h(Pill, { active: tab === 'manage', onClick: () => setTab('manage') }, '管理'),
          h(Pill, { active: tab === 'search', onClick: () => setTab('search') }, '搜索'),
          h(Pill, { active: tab === 'sync', onClick: () => setTab('sync') }, '同步'),
        ),
        h(ErrorLine, { error }),
        tab === 'manage' && h(ManageView, { call, data, reload }),
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
      const [notice, setNotice] = useState(null)

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
      // q 输入防抖：300ms 内连续输入只发一次请求
      useEffect(() => {
        const timer = setTimeout(() => { refresh() }, 300)
        return () => clearTimeout(timer)
      }, [origin, groupFilter, q])

      const groupNames = data.grp.groups.map((g) => g.name)
      const rowAction = async (name, action, payload = {}) => {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          if (action === 'check') {
            const r = await call('check', { names: [name] })
            const it = (r || []).find((x) => x.name === name)
            setNotice(it
              ? `${name}：${it.status}${it.missing ? '（目录缺失）' : ''}${it.locally_modified ? '（本地已修改）' : ''}${it.reason ? '（' + it.reason + '）' : ''}`
              : `${name}：检查完成`)
          } else if (action === 'update') {
            const r = await call('update', { names: [name] })
            const it = (r.results || []).find((x) => x.name === name)
            setNotice(it
              ? `${name}：${it.status}${it.reason ? '（' + it.reason + '）' : ''}`
              : `${name}：更新完成`)
          } else if (action === 'disable') await call('disable', { name })
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
        h('div', { style: S.toolbar },
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
          h(Input, { style: { width: 140 }, placeholder: '过滤名称/描述', value: q, onChange: (e) => setQ(e.target.value) }),
          h(GhostBtn, { onClick: () => { reload() }, disabled: busy }, '刷新'),
          h(OutlineBtn, { onClick: () => setImportOpen(!importOpen), disabled: busy }, '导入 skill'),
        ),
        // 检查/更新结果提示
        notice ? h('div', { style: { ...S.muted, marginBottom: 4 } }, notice) : null,
        // 导入面板
        importOpen && h(ImportPanel, { call, reload, onDone: () => setImportOpen(false) }),
        // 组配置条
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' } },
          h('span', { style: S.muted }, '分组:'),
          data.grp.groups.map((g) =>
            h('span', { key: g.name, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              h(Pill, { style: badgeStyle(T.brand) }, `${g.name}(${g.count})`),
              h(GhostBtn, { onClick: () => groupOp('rename', g.name, window.prompt('新组名', g.name)) }, '改名'),
              h(GhostBtn, { onClick: () => groupOp('delete', g.name) }, '删'),
            ),
          ),
          h(GroupCreate, { call, reload }),
        ),
        // 行
        list.length === 0
          ? h('div', { style: { ...S.muted, padding: 12 } }, '库为空（无匹配 skill）')
          : list.map((it) => h('div', { key: it.dir, style: S.row },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h('span', { style: { fontWeight: 600, color: T.labelPrimary } }, it.name),
                  h(Pill, { style: badgeStyle(it.origin === 'github' ? T.brand : it.origin === 'local' ? T.success : T.labelSecondary) }, it.origin),
                  it.missing && h(Pill, { style: badgeStyle(T.error) }, '缺失'),
                  it.disabled && h(Pill, { style: badgeStyle(T.warn) }, '已禁用'),
                  !it.hasSkillMd && h(Pill, { style: badgeStyle(T.warn) }, '无 SKILL.md'),
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
                ? h(OutlineBtn, { onClick: () => rowAction(it.dir, 'update'), disabled: busy }, '恢复')
                : h('span', { style: { display: 'flex', gap: 4 } },
                    h(GhostBtn, { onClick: () => rowAction(it.dir, 'check'), disabled: busy }, '检查'),
                    it.disabled
                      ? h(OutlineBtn, { onClick: () => rowAction(it.dir, 'enable'), disabled: busy }, '启用')
                      : h('span', { style: { display: 'flex', gap: 4 } },
                          h(GhostBtn, { onClick: () => rowAction(it.dir, 'update'), disabled: busy }, '更新'),
                          h(GhostBtn, { onClick: () => rowAction(it.dir, 'disable'), disabled: busy }, '禁用'),
                          h(GhostBtn, { style: S.dangerText, onClick: () => rowAction(it.dir, 'remove'), disabled: busy }, '删除'),
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
        h(Input, { style: { width: 90 }, placeholder: '新组名', value: name, onChange: (e) => setName(e.target.value) }),
        h(OutlineBtn, { onClick: create, disabled: busy }, '新建组'),
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
      return h('div', { style: { border: `1px solid ${T.borderL1}`, borderRadius: 8, padding: 8, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        h(Field, { label: '目录或 .zip 路径' }, h(Input, { style: { width: 260 }, value: path, onChange: (e) => setPath(e.target.value), placeholder: 'E:\\path\\skill-dir 或 .zip' })),
        h(Field, { label: '改名(可选)' }, h(Input, { style: { width: 120 }, value: as, onChange: (e) => setAs(e.target.value) })),
        h(OutlineBtn, { onClick: doImport, disabled: busy || !path.trim() }, '导入'),
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
          // 失败保留上一次成功结果与失败原因，不覆盖输入（设计：搜索视图）
          setError(e.message || String(e))
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
        h('div', { style: S.toolbar },
          h(Input, { style: { width: 240 }, placeholder: 'skills.sh 关键词', value: query, onChange: (e) => setQuery(e.target.value) }),
          h(OutlineBtn, { onClick: doSearch, disabled: busy }, '搜索'),
          h(Field, { label: '直接添加' },
            h(DirectAdd, { call, reload, busy, setBusy, setError }),
          ),
        ),
        h(ErrorLine, { error }),
        candidates && h('div', { style: { marginBottom: 8 } },
          h('div', { style: S.title }, `${candidates.repo} 含多个 skill，选择其一：`),
          candidates.list.map((c) => h('div', { key: c.path || '<root>', style: S.row },
            h('span', { style: { flex: 1 } }, c.path || '（仓库根）'),
            h(OutlineBtn, { onClick: () => addChosen(c.path), disabled: busy }, '入库'),
          )),
        ),
        results && results.skills.length === 0
          ? h('div', { style: S.muted }, '无结果')
          : (results ? results.skills : []).map((s) => h('div', { key: s.key, style: S.row },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontWeight: 600, color: T.labelPrimary } }, s.name),
                h('div', { style: S.muted }, `${s.repo}${s.directory ? ' / ' + s.directory : ''} · 安装 ${s.installs}`),
              ),
              h(OutlineBtn, { onClick: () => addFrom(s.repo, s.directory, ''), disabled: busy }, '入库'),
            )),
      )
    }

    function DirectAdd({ call, reload, busy, setBusy, setError }) {
      const [repo, setRepo] = useState('')
      const [branch, setBranch] = useState('')
      const add = async () => {
        if (!repo.trim()) return
        setBusy(true)
        setError(null)
        try {
          const r = await call('repo-skills', { repo: repo.trim(), ref: branch.trim() || 'main' })
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
        h(Input, { style: { width: 180 }, placeholder: 'owner/repo', value: repo, onChange: (e) => setRepo(e.target.value) }),
        h(Input, { style: { width: 70 }, placeholder: '分支', value: branch, onChange: (e) => setBranch(e.target.value) }),
        h(OutlineBtn, { onClick: add, disabled: busy }, '添加'),
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

      const cellColor = (cell) => (
        cell === '生效' ? T.success : cell === '错误' ? T.error : cell === 'shadowed' ? T.warn : T.labelSecondary
      )
      return h('div', { style: S.panel },
        h('div', { style: S.toolbar },
          h('span', { style: { fontWeight: 600, color: T.labelPrimary } }, `健康问题 ${health.length} 项`),
          h(OutlineBtn, { onClick: fix, disabled: busy || health.length === 0 }, '应用并修复'),
          h(ProjectAdd, { call, reload, busy, setBusy, setError }),
        ),
        h(ErrorLine, { error }),
        health.length === 0
          ? h('div', { style: { ...S.muted, marginBottom: 8 } }, '健康：无问题')
          : health.map((issue, i) => h('div', { key: i, style: S.row },
              h(Pill, { style: badgeStyle(T.error) }, issue.issue),
              h('span', { style: { flex: 1 } }, `${issue.name} @ ${issue.target || '—'}`),
            )),
        // 项目注册表
        h('div', { style: S.title }, '项目注册表'),
        Object.keys(projects).length === 0
          ? h('div', { style: S.muted }, '未注册项目')
          : Object.entries(projects).map(([name, path]) => h('div', { key: name, style: S.row },
              h('span', { style: { flex: 1 } }, h('span', { style: { fontWeight: 600, color: T.labelPrimary } }, name), h('span', { style: S.muted }, `  ${path}`)),
              h(GhostBtn, { onClick: () => projectOp('rename', { name, newName: window.prompt('新项目名', name) }), disabled: busy }, '改名'),
              h(GhostBtn, { onClick: () => { const p = window.prompt('新路径', path); if (p) projectOp('edit-path', { name, path: p }) }, disabled: busy }, '改路径'),
              h(GhostBtn, { style: S.dangerText, onClick: () => projectOp('remove', { name, cascade: true }), disabled: busy }, '删除'),
            )),
        // 矩阵
        matrix && h('div', null,
          h('div', { style: S.title }, '同步矩阵'),
          h('table', { style: { borderCollapse: 'collapse', fontSize: 12, width: '100%' } },
            h('thead', null, h('tr', null,
              h('th', { style: { textAlign: 'left', padding: 4, borderBottom: `1px solid ${T.borderL1}`, color: T.labelSecondary } }, 'skill'),
              matrix.columns.map((c) => h('th', { key: c.key, style: { textAlign: 'left', padding: 4, borderBottom: `1px solid ${T.borderL1}`, color: T.labelSecondary } }, c.label)),
            )),
            h('tbody', null, matrix.rows.map((row) => h('tr', { key: row.dir },
              h('td', { style: { padding: 4, borderBottom: `1px solid ${T.borderL1}` } }, row.name),
              row.cells.map((cell, i) => h('td', { key: i, style: { padding: 4, borderBottom: `1px solid ${T.borderL1}` } },
                h(Pill, { style: badgeStyle(cellColor(cell)) }, cell),
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
        h(Input, { style: { width: 110 }, placeholder: '项目名', value: name, onChange: (e) => setName(e.target.value) }),
        h(Input, { style: { width: 200 }, placeholder: '项目绝对路径', value: path, onChange: (e) => setPath(e.target.value) }),
        h(OutlineBtn, { onClick: add, disabled: busy || !name.trim() || !path.trim() }, '注册项目'),
      )
    }

    // ---------- 插件入口 ----------
    const inject = ['slots', 'connection', 'remote', 'settingsScope', 'workspaces']

    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: 'skill-manager' })
      const call = createCall()
      const workspaces = ctx.workspaces

      ctx.effect(() => {
        const offSection = ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'skills', order: 16, label: '技能', inject: () => ({ call, scope }) },
            SkillsSection,
          ),
        )
        const offCard = ctx.slots.inject('settings.plugin.item', () =>
          ctx.slots.register(
            { name: 'settings.plugin.item', id: 'skill-manager', order: 30, label: '技能目录', inject: () => ({ scope, workspaces }) },
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
