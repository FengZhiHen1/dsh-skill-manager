// dsh-skill-manager — Client 侧（plugin-runtime.md Client 入口与视图设计）。
//
// 注册两个槽位：
//   settings.section   id=skills  order=16  标签「技能」——管理/搜索/同步三视图；
//                      library 返回 workshop-unconfigured 时显示未配置引导。
//   settings.plugin.item id=skill-manager order=30 ——「本地 skill 目录」配置卡片
//                      （R-22：默认为空即未配置；保存立即生效，清空回到未配置）。
//
// 配置卡片的数据通道：不走 ctx.settingsScope——settings 网关只对硬编码白名单
// （api-proxy WEB_SETTINGS_NAMESPACES）开放，第三方命名空间读写会被
// settings-not-exposed 拒绝；卡片改经 connection RPC 通道
// /dsh-skill-manager（endpoint config：get/set/reset）读写，Host 进程内持久化到
// settings.yaml 的 skill-manager 段（对齐 dsh-background）。
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
    const { Button, Input, Pill } = primitives
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

    /** 更新本地修改时的真实遮罩对话框；不使用 window.confirm，确保风险与操作范围可见。 */
    function UpdateConfirmationDialog({ name, detail, busy, onCancel, onConfirm }) {
      const [acknowledged, setAcknowledged] = useState(false)
      return h('div', {
        role: 'presentation',
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(15, 17, 21, .42)',
          padding: 20,
        },
      },
        h('div', {
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': 'skill-manager-update-confirm-title',
          style: {
            width: 'min(480px, 100%)',
            borderRadius: 16,
            border: `1px solid ${T.borderL2}`,
            background: T.bgLayer3,
            color: T.labelPrimary,
            boxShadow: '0 18px 48px rgba(0,0,0,.28)',
            padding: 20,
          },
        },
          h('div', { id: 'skill-manager-update-confirm-title', style: { fontSize: 16, fontWeight: 600, marginBottom: 8 } }, `更新 ${name}？`),
          h('div', { style: { color: T.labelSecondary, fontSize: 13, lineHeight: 1.55, marginBottom: 12 } }, detail || '检测到与锁基线不同的本地修改。'),
          h('div', { style: { borderRadius: 10, padding: '10px 12px', marginBottom: 14, ...badgeStyle(T.warn), fontSize: 12, lineHeight: 1.55 } },
            '更新会替换此 Skill 目录；不会自动备份本地修改。请先自行备份需要保留的内容。',
          ),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.labelSecondary, marginBottom: 16, cursor: 'pointer' } },
            h('input', { type: 'checkbox', checked: acknowledged, onChange: (event) => setAcknowledged(event.target.checked) }),
            h('span', { style: { color: T.labelPrimary } }, '我已确认覆盖本地修改；继续后会刷新锁记录、Git 历史和 DSH 挂载。'),
          ),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            h(OutlineBtn, { onClick: onCancel, disabled: busy }, '取消'),
            h(Button, { size: 'sm', onClick: onConfirm, disabled: busy || !acknowledged }, busy ? '更新中…' : '继续更新'),
          ),
        ),
      )
    }

    // ---------- 插件配置卡片（设置 → 插件 → skill-manager） ----------
    // 与 DSH 原生 PluginCard 同构：li > header（名称/描述/未保存标记/折叠箭头）
    // + body（字段 + footer：放弃/保存）；token 与几何对齐 PluginCard.module.css。
    // 数据经 connection RPC 通道读写（settings 网关不对第三方命名空间开放）。
    function SkillManagerCard({ config, workspaces }) {
      const [open, setOpen] = useState(false)
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [failed, setFailed] = useState(null)
      const [focused, setFocused] = useState(false)
      // Host 权威值（解析后）与用户层覆盖标记；保存/重置后按返回值回填。
      const [current, setCurrent] = useState('')
      const [overridden, setOverridden] = useState(false)

      useEffect(() => {
        let alive = true
        config.get()
          .then((v) => {
            if (!alive) return
            const dir = v && typeof v.workshopDir === 'string' ? v.workshopDir : ''
            setCurrent(dir)
            setOverridden(Boolean(v && v.overridden))
            setDraft(dir)
          })
          .catch((e) => { if (alive) setFailed(e && e.message ? e.message : '读取配置失败') })
        return () => { alive = false }
      }, [config])

      const dirty = draft !== current

      const save = async () => {
        setBusy(true)
        setFailed(null)
        try {
          const v = await config.set(draft.trim())
          const dir = v && typeof v.workshopDir === 'string' ? v.workshopDir : ''
          setCurrent(dir)
          setOverridden(Boolean(v && v.overridden))
          setDraft(dir)
        } catch (e) {
          // Host 校验拒绝（如非绝对路径）会以信封错误回显，草稿保留供修改
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
          const v = await config.reset()
          const dir = v && typeof v.workshopDir === 'string' ? v.workshopDir : ''
          setCurrent(dir)
          setOverridden(Boolean(v && v.overridden))
          setDraft(dir)
        } catch (e) {
          setFailed(e && e.message ? e.message : '重置失败')
        } finally {
          setBusy(false)
        }
      }
      // 原生目录选择：系统选择器（Host native capability）返回绝对路径；
      // 取消返回 null 不动草稿；失败提示在 footer。不用浏览器 showDirectoryPicker——
      // File System Access API 不暴露绝对路径，而车间配置需要绝对路径。
      const pickDirectory = async () => {
        setBusy(true)
        setFailed(null)
        try {
          const path = await workspaces.pickDirectory()
          if (path) setDraft(path)
        } catch (e) {
          setFailed(e && e.message ? `选择目录失败：${e.message}` : '选择目录失败')
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
              // 字段（对齐 ValueField 形态：label/input/hint 纵排）
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('label', { htmlFor: 'skill-manager-workshop-dir', style: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: T.labelPrimary } }, '本地 skill 目录'),
                  overridden
                    ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
                        h('span', { style: { borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', whiteSpace: 'nowrap', fontWeight: 500, background: T.bgModulePlatform, color: T.labelSecondary } }, '已覆盖'),
                        h('button', { type: 'button', disabled: busy, onClick: reset, style: { border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, lineHeight: 1.5, color: T.labelSecondary, cursor: 'pointer' } }, '重置'),
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
                  h(GhostBtn, { disabled: busy, onClick: pickDirectory }, '选择…'),
                ),
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
                  disabled: !dirty || busy,
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
      const [groupFilter, setGroupFilter] = useState('默认')
      const [q, setQ] = useState('')
      const [list, setList] = useState(data.lib.skills)
      const [importOpen, setImportOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [pendingUpdate, setPendingUpdate] = useState(null)

      useEffect(() => { setList(data.lib.skills) }, [data.lib])

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
      const countForGroup = (group) => data.lib.skills.filter((item) => (group === '默认' ? item.group === '默认' : item.group === group)).length
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
            const it = (r.results || []).find((item) => item.name === name)
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
          if (action === 'update' && e?.code === 'local-changes-confirmation-required' && payload.confirmLocalChanges !== true) {
            setPendingUpdate({ name, detail: e.message || '检测到本地修改。' })
          } else {
            setError(e.message || String(e))
          }
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
          if (action === 'delete' && groupFilter === name) setGroupFilter('默认')
          if (action === 'rename' && groupFilter === name && newName) setGroupFilter(newName)
          reload()
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: S.panel },
        // 分组优先：先选择当前组并配置它的全局/工作区使用范围，再浏览技能库。
        h('div', { style: { marginBottom: 10 } },
          h('div', { style: S.title }, '分组'),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 7 } },
            h(Pill, { active: groupFilter === '', onClick: () => setGroupFilter('') }, `全部 · ${data.lib.skills.length}`),
            h(Pill, { active: groupFilter === '默认', onClick: () => setGroupFilter('默认') }, `默认 · ${countForGroup('默认')}`),
            data.grp.groups.map((group) => h('span', { key: group.name, style: { display: 'inline-flex', alignItems: 'center', gap: 2 } },
              h(Pill, { active: groupFilter === group.name, onClick: () => setGroupFilter(group.name) }, `${group.name} · ${group.count}`),
              h(GhostBtn, { onClick: () => groupOp('rename', group.name, window.prompt('新组名', group.name)), disabled: busy }, '改名'),
              h(GhostBtn, { onClick: () => groupOp('delete', group.name), disabled: busy, style: S.dangerText }, '删'),
            )),
            h(GroupCreate, { call, reload }),
          ),
          groupFilter === ''
            ? h('div', { style: { ...S.muted, padding: '8px 0' } }, '当前查看全部技能。选择一个分组后可配置它的全局和 DSH 工作区使用范围。')
            : h(GroupScopePanel, {
                call,
                group: groupFilter,
                mounts: data.grp.mounts,
                workspaceProjects: data.grp.workspaceProjects || [],
                busy,
                onError: setError,
                onChanged: reload,
              }),
        ),
        h('div', { style: S.title }, '技能库'),
        // 工具条
        h('div', { style: S.toolbar },
          h('select', { style: S.select, value: origin, onChange: (e) => setOrigin(e.target.value) },
            h('option', { value: '' }, '全部来源'),
            h('option', { value: 'github' }, 'GitHub'),
            h('option', { value: 'local' }, '本地'),
            h('option', { value: 'self' }, '自研'),
          ),
          h(Input, { style: { width: 140 }, placeholder: '过滤名称/描述', value: q, onChange: (e) => setQ(e.target.value) }),
          h(GhostBtn, { onClick: () => { reload() }, disabled: busy }, '刷新'),
          h(OutlineBtn, { onClick: () => setImportOpen(!importOpen), disabled: busy }, '导入 skill'),
        ),
        // 检查/更新结果提示
        notice ? h('div', { style: { ...S.muted, marginBottom: 4 } }, notice) : null,
        // 导入面板
        importOpen && h(ImportPanel, { call, reload, onDone: () => setImportOpen(false) }),
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
        pendingUpdate && h(UpdateConfirmationDialog, {
          name: pendingUpdate.name,
          detail: pendingUpdate.detail,
          busy,
          onCancel: () => setPendingUpdate(null),
          onConfirm: () => {
            const name = pendingUpdate.name
            setPendingUpdate(null)
            rowAction(name, 'update', { confirmLocalChanges: true })
          },
        }),
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

    /** 当前分组的使用范围：只对 DSH 全局与 Host 返回的活动工作区写挂载规则。 */
    function GroupScopePanel({ call, group, mounts, workspaceProjects, busy, onError, onChanged }) {
      const [scopeBusy, setScopeBusy] = useState(false)
      const disabled = busy || scopeBusy
      const enabled = (scope, workspaceId) => mounts.some((mount) => (
        mount.group === group
        && mount.app === 'dsh'
        && mount.scope === scope
        && (scope === 'global' || mount.project === workspaceId)
      ))
      const toggle = async (scope, workspaceId, checked) => {
        setScopeBusy(true)
        onError(null)
        try {
          await call('mounts', {
            action: checked ? 'add' : 'remove',
            group,
            app: 'dsh',
            scope,
            workspaceId: scope === 'project' ? workspaceId : undefined,
          })
          onChanged()
        } catch (error) {
          onError(error.message || String(error))
        } finally {
          setScopeBusy(false)
        }
      }
      return h('div', { style: { border: `1px solid ${T.borderL1}`, borderRadius: 10, padding: '9px 10px', background: T.bgLayer2 } },
        h('div', { style: { fontSize: 12, fontWeight: 600, color: T.labelPrimary, marginBottom: 7 } }, `当前分组：${group}`),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: workspaceProjects.length ? 6 : 0, fontSize: 12, color: T.labelSecondary, cursor: disabled ? 'default' : 'pointer' } },
          h('input', {
            type: 'checkbox',
            checked: enabled('global'),
            disabled,
            onChange: (event) => toggle('global', null, event.target.checked),
          }),
          'DSH 全局',
        ),
        workspaceProjects.length === 0
          ? h('div', { style: S.muted }, '当前没有 DSH 工作区；请在 DSH 原生工作区界面创建或打开项目。')
          : workspaceProjects.map((workspace) => h('label', {
              key: workspace.workspaceId,
              style: { display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', fontSize: 12, color: T.labelSecondary, cursor: disabled ? 'default' : 'pointer' },
            },
              h('input', {
                type: 'checkbox',
                checked: enabled('project', workspace.workspaceId),
                disabled,
                onChange: (event) => toggle('project', workspace.workspaceId, event.target.checked),
              }),
              h('span', { style: { color: T.labelPrimary, fontWeight: 500 } }, workspace.title),
              h('span', { style: S.muted }, workspace.path),
            )),
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
      const [workspaceProjects, setWorkspaceProjects] = useState(data.grp.workspaceProjects || [])
      const [legacyProjects, setLegacyProjects] = useState(data.grp.legacyProjects || [])
      const [projectEntries, setProjectEntries] = useState({})
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [matrix, setMatrix] = useState(null)
      const [tick, bumpTick] = useTick()

      useEffect(() => {
        let alive = true
        setBusy(true)
        setError(null)
        Promise.all([call('health'), call('project-skills')])
          .then(([healthResult, projectResult]) => {
            if (!alive) return
            const active = projectResult.workspaceProjects || []
            const entries = projectResult.entries || {}
            const columns = [
              { key: 'dsh|global|', label: 'DSH 全局', workspaceId: null },
              ...active.map((workspace) => ({
                key: `dsh|project|${workspace.workspaceId}`,
                label: workspace.title,
                workspaceId: workspace.workspaceId,
              })),
            ]
            const rows = (data.lib ? data.lib.skills : []).map((item) => ({
              name: item.name,
              dir: item.dir,
              cells: columns.map((column) => {
                const wanted = (item.targets || []).includes(column.key)
                if (column.workspaceId === null) return wanted ? '生效' : '不适用'
                const entry = entries[column.workspaceId]?.entries?.find((candidate) => candidate.name === item.dir)
                if (!wanted) return entry?.kind === 'local-skill' ? 'shadowed' : '不适用'
                if (entry && entry.kind !== 'managed-ok') return '错误'
                return '生效'
              }),
            }))
            setHealth(healthResult.issues || [])
            setWorkspaceProjects(active)
            setLegacyProjects(projectResult.legacyProjects || [])
            setProjectEntries(entries)
            setMatrix({ columns, rows })
          })
          .catch((e) => { if (alive) setError(e.message || String(e)) })
          .finally(() => { if (alive) setBusy(false) })
        return () => { alive = false }
      }, [tick, data.lib])

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
      const claimEmpty = async (workspaceId, name) => {
        setBusy(true)
        setError(null)
        try {
          await call('claim-empty', { workspaceId, name })
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
      const workspaceById = new Map(workspaceProjects.map((workspace) => [workspace.workspaceId, workspace]))
      const describeTarget = (target) => {
        const prefix = 'dsh|project|'
        if (typeof target === 'string' && target.startsWith(prefix)) {
          const workspace = workspaceById.get(target.slice(prefix.length))
          return workspace ? `${workspace.title} (${workspace.workspaceId.slice(0, 8)})` : target
        }
        return target || '—'
      }

      return h('div', { style: S.panel },
        h('div', { style: S.toolbar },
          h('span', { style: { fontWeight: 600, color: T.labelPrimary } }, `健康问题 ${health.length} 项`),
          h(OutlineBtn, { onClick: fix, disabled: busy || health.length === 0 }, '应用并修复'),
        ),
        h(ErrorLine, { error }),
        health.length === 0
          ? h('div', { style: { ...S.muted, marginBottom: 8 } }, '健康：无问题')
          : health.map((issue, index) => h('div', { key: `${issue.issue}-${index}`, style: S.row },
              h(Pill, { style: badgeStyle(issue.issue === 'workspace-unmatched' ? T.warn : T.error) }, issue.issue),
              h('span', { style: { flex: 1 } }, `${issue.name} @ ${describeTarget(issue.target)}`),
            )),

        h('div', { style: S.title }, 'DSH 工作区项目'),
        h('div', { style: { ...S.muted, marginBottom: 5 } }, '自动从 DSH 工作区获取；请在 DSH 原生工作区界面创建、改名或移除项目。'),
        workspaceProjects.length === 0
          ? h('div', { style: S.muted }, '当前没有 DSH 工作区')
          : workspaceProjects.map((workspace) => h('div', { key: workspace.workspaceId, style: S.row },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontWeight: 600, color: T.labelPrimary } }, workspace.title),
                h('div', { style: S.muted }, `${workspace.path} · ${workspace.workspaceId}`),
              ),
              h(Pill, { style: badgeStyle(workspace.mountCount > 0 ? T.success : T.labelSecondary) }, `${workspace.mountCount} 个组使用`),
            )),
        legacyProjects.length > 0 && h('div', { style: { marginTop: 8 } },
          h('div', { style: S.title }, '未匹配工作区的遗留项'),
          legacyProjects.map((legacy) => h('div', { key: legacy.project, style: { ...S.row, color: T.warn } },
            h(Pill, { style: badgeStyle(T.warn) }, 'workspace-unmatched'),
            h('span', { style: { flex: 1 } }, `${legacy.project} · ${legacy.path}`),
            h('span', { style: S.muted }, `保留 ${legacy.syncedCount} 个既有链接`),
          )),
        ),

        Object.keys(projectEntries).length > 0 && h('div', null,
          h('div', { style: S.title }, '工作区本地条目'),
          workspaceProjects.map((workspace) => {
            const entries = projectEntries[workspace.workspaceId]?.entries || []
            const visible = entries.filter((entry) => entry.kind !== 'managed-ok')
            if (visible.length === 0) return null
            return h('div', { key: `${workspace.workspaceId}-entries`, style: { marginBottom: 6 } },
              h('div', { style: { ...S.muted, marginBottom: 2 } }, workspace.title),
              visible.map((entry) => h('div', { key: entry.name, style: S.row },
                h('span', { style: { flex: 1 } }, `${entry.name} · ${entry.kind}`),
                entry.kind === 'local-empty'
                  ? h(OutlineBtn, { onClick: () => claimEmpty(workspace.workspaceId, entry.name), disabled: busy }, '清理并接管')
                  : null,
              )),
            )
          }),
        ),

        matrix && h('div', null,
          h('div', { style: S.title }, '同步矩阵'),
          h('table', { style: { borderCollapse: 'collapse', fontSize: 12, width: '100%' } },
            h('thead', null, h('tr', null,
              h('th', { style: { textAlign: 'left', padding: 4, borderBottom: `1px solid ${T.borderL1}`, color: T.labelSecondary } }, 'skill'),
              matrix.columns.map((column) => h('th', { key: column.key, style: { textAlign: 'left', padding: 4, borderBottom: `1px solid ${T.borderL1}`, color: T.labelSecondary } }, column.label)),
            )),
            h('tbody', null, matrix.rows.map((row) => h('tr', { key: row.dir },
              h('td', { style: { padding: 4, borderBottom: `1px solid ${T.borderL1}` } }, row.name),
              row.cells.map((cell, index) => h('td', { key: index, style: { padding: 4, borderBottom: `1px solid ${T.borderL1}` } },
                h(Pill, { style: badgeStyle(cellColor(cell)) }, cell),
              )),
            ))),
          ),
        ),
      )
    }

    // ---------- 插件入口 ----------
    const inject = ['slots', 'connection', 'workspaces']

    // 配置卡片经 connection RPC 通道读写 workshopDir（settings 网关不对
    // 第三方命名空间开放，见文件头注释）。返回 { workshopDir, overridden }。
    const createConfigClient = (connection) => {
      const call = async (op, payload = {}) => {
        const r = await connection.rpc.call('/dsh-skill-manager', 'config', { op, ...payload })
        if (!r.ok) throw new Error(r.error && r.error.message ? r.error.message : (op === 'set' ? '保存失败' : '配置操作失败'))
        return r.value
      }
      return {
        get: () => call('get'),
        set: (workshopDir) => call('set', { workshopDir }),
        reset: () => call('reset'),
      }
    }

    function apply(ctx) {
      const call = createCall()
      const workspaces = ctx.workspaces
      const config = createConfigClient(ctx.connection)

      ctx.effect(() => {
        const offSection = ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'skills', order: 16, label: '技能', inject: () => ({ call }) },
            SkillsSection,
          ),
        )
        const offCard = ctx.slots.inject('settings.plugin.item', () =>
          ctx.slots.register(
            { name: 'settings.plugin.item', id: 'skill-manager', order: 30, label: '技能目录', inject: () => ({ config, workspaces }) },
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
