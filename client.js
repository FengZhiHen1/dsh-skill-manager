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
    /**
     * 状态徽章（DSR-008 约定）：原生 pending pill 几何（高 ~19px、圆角 999、11px）。
     * 正常态灰底灰字，可更新深色字，仅真警告用彩色。
     */
    const pillBase = {
      display: 'inline-block',
      padding: '1px 8px',
      borderRadius: 999,
      fontSize: 11,
      lineHeight: '17px',
      background: T.bgModulePlatform,
      color: T.labelSecondary,
      whiteSpace: 'nowrap',
    }
    const statusPillStyle = (kind) => {
      if (kind === 'updatable') return { ...pillBase, color: T.labelPrimary, fontWeight: 500 }
      if (kind === 'warn') return { ...pillBase, ...badgeStyle(T.warn) }
      if (kind === 'error') return { ...pillBase, ...badgeStyle(T.error) }
      return pillBase
    }

    const S = {
      row: { display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', border: `1px solid ${T.borderL1}`, borderRadius: 12, marginBottom: 8, fontSize: 13 },
      select: { padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.borderL1}`, background: T.bgBase, color: T.labelPrimary, fontSize: 12 },
      panel: { padding: '10px 12px' },
      error: { color: T.error, fontSize: 12, padding: '6px 8px' },
      muted: { color: T.labelSecondary, fontSize: 12 },
      guide: { padding: '24px 16px', textAlign: 'center', color: T.labelSecondary, fontSize: 13 },
      dangerText: { color: T.error },
      toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
    }
    // ---------- 设计稿样式基元（01–09 帧视觉语言；色值全部走 token） ----------
    // 白底描边卡（范围卡/表单卡/对话框）；浅色底卡（仓库卡/项目卡/信息条）；状态点
    const cardStyle = { border: `1px solid ${T.borderL1}`, borderRadius: 12, background: T.bgLayer3 }
    const subCardStyle = { borderRadius: 10, background: T.bgModulePlatform }
    const dotStyle = (color) => ({ width: 7, height: 7, borderRadius: 4, background: color, flex: 'none' })
    const sectionHead = { fontSize: 14, fontWeight: 600, color: T.labelPrimary }
    const cardTitle = { fontSize: 13, fontWeight: 600, color: T.labelPrimary }
    const noteText = { fontSize: 11, color: T.labelSecondary }
    const dividerStyle = { height: 1, background: T.borderL1, flex: 'none' }

    // ---------- 通用小组件 ----------
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

    /** 菜单项：hover 高亮（bgModulePlatform），支持悬停展开子菜单。 */
    function MenuItem({ label, danger, disabled, onClick, onEnter, trailing, children }) {
      const [hover, setHover] = useState(false)
      return h('div', {
        style: {
          position: 'relative',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          padding: '7px 12px',
          borderRadius: 6,
          fontSize: 12,
          whiteSpace: 'nowrap',
          cursor: disabled ? 'default' : 'pointer',
          color: danger ? T.error : T.labelPrimary,
          background: hover && !disabled ? T.bgModulePlatform : 'transparent',
        },
        onClick: disabled ? undefined : onClick,
        onMouseEnter: () => { setHover(true); if (onEnter) onEnter() },
        onMouseLeave: () => setHover(false),
      }, h('span', null, label), trailing || null, children)
    }

    const menuCardStyle = {
      position: 'absolute',
      zIndex: 41,
      minWidth: 150,
      background: T.bgLayer3,
      border: `1px solid ${T.borderL2}`,
      borderRadius: 12,
      boxShadow: '0 8px 24px rgba(0,0,0,.18)',
      padding: 6,
    }
    const menuDivider = h('div', { style: { height: 1, margin: '5px 6px', background: T.borderL2 } })

    /**
     * 行操作 ⋯ 菜单（DSR-008）：立即更新/禁用|启用/移动到分组▸（悬停展开子菜单）/删除。
     * 点击遮罩或任意动作后关闭；目录缺失的行只保留 恢复/删除。
     */
    function RowMenu({ it, groupNames, busy, onAction, onMove, onClose }) {
      const [subOpen, setSubOpen] = useState(false)
      const current = it.group || '默认'
      const allGroups = [...new Set([...groupNames, '默认'])]
      const pick = (group) => {
        if (group !== current) onMove(group)
        onClose()
      }
      return h(React.Fragment, null,
        h('div', { style: { position: 'fixed', inset: 0, zIndex: 40 }, onClick: onClose }),
        h('div', { style: { ...menuCardStyle, right: 4, top: 'calc(100% - 6px)' } },
          it.missing
            ? h(MenuItem, { label: '恢复', disabled: busy, onClick: () => { onClose(); onAction('update') } })
            : it.disabled
              ? h(MenuItem, { label: '启用', disabled: busy, onClick: () => { onClose(); onAction('enable') } })
              : h(React.Fragment, null,
                  h(MenuItem, { label: '立即更新', disabled: busy, onClick: () => { onClose(); onAction('update') } }),
                  h(MenuItem, { label: '禁用', disabled: busy, onClick: () => { onClose(); onAction('disable') } }),
                ),
          !it.missing && menuDivider,
          !it.missing && h(MenuItem, {
            label: '移动到分组',
            disabled: busy,
            onEnter: () => setSubOpen(true),
            onClick: () => setSubOpen((v) => !v),
            trailing: h('span', { style: { color: T.labelSecondary } }, '▸'),
          },
            subOpen && h('div', { style: { ...menuCardStyle, right: '100%', top: -7, marginRight: 6, minWidth: 124, zIndex: 42 } },
              allGroups.map((group) => h('div', {
                key: group,
                style: {
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer',
                  color: group === current ? T.labelPrimary : T.labelSecondary,
                  fontWeight: group === current ? 500 : 400,
                },
                onClick: (event) => { event.stopPropagation(); pick(group) },
              },
                h('span', { style: { width: 12, color: T.labelPrimary } }, group === current ? '✓' : ''),
                group,
              )),
            ),
          ),
          menuDivider,
          h(MenuItem, { label: '删除', danger: true, disabled: busy, onClick: () => { onClose(); onAction('remove') } }),
        ),
      )
    }

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

      // 文字页签（设计稿 01–05 帧：激活下划线 + 每页一句副标题）
      const TABS = [
        { key: 'manage', label: '管理', sub: '先为分组配置可用范围，再管理其中的 Skill。' },
        { key: 'search', label: '搜索', sub: '从 skills.sh 搜索，或直接从 GitHub 仓库入库。' },
        { key: 'sync', label: '同步', sub: '查看 DSH 工作区与各 Skill 的挂载状态。' },
      ]
      const activeTab = TABS.find((t) => t.key === tab)
      return h('div', null,
        // 01–05 帧：内容顶部为「技能」标题 + 当前页副标题（壳层只渲染导航，内容标题归本区）
        h('div', { style: { padding: '4px 12px 0', marginBottom: 12 } },
          h('div', { style: { fontSize: 20, fontWeight: 600, color: T.labelPrimary } }, '技能'),
          h('div', { style: { fontSize: 13, color: T.labelTertiary, marginTop: 4 } }, activeTab ? activeTab.sub : ''),
        ),
        h('div', { style: { display: 'flex', gap: 20, padding: '0 12px', borderBottom: `1px solid ${T.borderL1}` } },
          TABS.map((t) => h('button', {
            key: t.key,
            type: 'button',
            onClick: () => setTab(t.key),
            style: {
              border: 'none', background: 'none', padding: '6px 2px 8px', font: 'inherit', fontSize: 13,
              cursor: 'pointer', marginBottom: -1,
              color: tab === t.key ? T.labelPrimary : T.labelSecondary,
              fontWeight: tab === t.key ? 500 : 400,
              borderBottom: tab === t.key ? `2px solid ${T.labelPrimary}` : '2px solid transparent',
            },
          }, t.label)),
        ),
        h(ErrorLine, { error }),
        tab === 'manage' && h(ManageView, { call, workspaces: props.workspaces, data, reload, onGoSync: () => setTab('sync') }),
        tab === 'search' && h(SearchView, { call, data, reload }),
        tab === 'sync' && h(SyncView, { call, data, reload }),
      )
    }

    // ---------- 管理视图 ----------
    function ManageView({ call, workspaces, data, reload, onGoSync }) {
      const [origin, setOrigin] = useState('')
      const [groupFilter, setGroupFilter] = useState('默认')
      const [q, setQ] = useState('')
      const [list, setList] = useState(data.lib.skills)
      const [importOpen, setImportOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [pendingUpdate, setPendingUpdate] = useState(null)
      const [menuFor, setMenuFor] = useState(null)
      const [createOpen, setCreateOpen] = useState(false)

      // data.lib 变化（含全局刷新后）按当前筛选重新拉取，保留 origin/group/q 过滤条件
      useEffect(() => { refresh() }, [data.lib])

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
      // DSR-008：全局刷新 = 重新扫描列表 + 并行检查全部上游，结果缓存后随 library 下发
      const refreshAll = async () => {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const r = await call('check', {})
          const failed = (r || []).filter((it) => it.status === 'check_failed').length
          setNotice(failed > 0 ? `检查完成；${failed} 个上游不可达` : '检查完成')
          reload()
        } catch (e) {
          setError(e.message || String(e))
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
      const ORIGIN_LABEL = { github: 'GitHub', local: '本地', self: '自研' }
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

      // DSR-009：新建成功后跳到新组，便于立即配置它的使用范围；失败抛回对话框内联显示
      const createGroup = async (name) => {
        await call('groups/op', { action: 'create', name })
        setCreateOpen(false)
        setGroupFilter(name)
        setNotice(`已创建分组「${name}」`)
        reload()
      }

      // 04 帧：导入打开时整页切换为导入卡片（含「导入后」说明区），取消返回管理页
      if (importOpen) {
        return h('div', { style: S.panel },
          h(ImportPanel, {
            call,
            workspaces,
            busy,
            onDone: () => { setImportOpen(false); setNotice('导入完成'); reload() },
            onCancel: () => setImportOpen(false),
          }),
        )
      }

      return h('div', { style: S.panel },
        // 分组优先：先选择当前组并配置它的全局/工作区使用范围，再浏览技能库。
        h('div', { style: { marginBottom: 14 } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 } },
            h('span', { style: sectionHead }, '分组'),
            h('span', { style: noteText }, `${data.lib.skills.length} 个 Skill`),
          ),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 } },
            h(Pill, { active: groupFilter === '', onClick: () => setGroupFilter('') }, `全部 · ${data.lib.skills.length}`),
            h(Pill, { active: groupFilter === '默认', onClick: () => setGroupFilter('默认') }, `默认 · ${countForGroup('默认')}`),
            data.grp.groups.map((group) =>
              h(Pill, { key: group.name, active: groupFilter === group.name, onClick: () => setGroupFilter(group.name) }, `${group.name} · ${group.count}`)),
            // DSR-009：胶囊行只保留新建入口；改名/删除收进「当前分组」卡片
            h(Pill, { active: false, onClick: () => setCreateOpen(true) }, '＋ 新建分组'),
          ),
          groupFilter === ''
            ? h('div', { style: { ...cardStyle, padding: '12px 14px' } },
                h('div', { style: cardTitle }, '当前查看：全部技能'),
                h('div', { style: { ...noteText, marginTop: 4 } }, '选择一个分组后，可配置它在 DSH 全局与各工作区的可用范围。'),
              )
            : h(GroupScopePanel, {
                call,
                group: groupFilter,
                mounts: data.grp.mounts,
                workspaceProjects: data.grp.workspaceProjects || [],
                busy,
                onError: setError,
                onChanged: reload,
                onGroupOp: groupOp,
              }),
        ),
        // 同步健康提示（对齐 01 帧）：琥珀底 + 状态点 + 右侧「查看」文字入口
        (data.health || []).length > 0 && h('div', { style: { ...badgeStyle(T.warn), borderRadius: 10, padding: '9px 12px', marginBottom: 14, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: dotStyle(T.warn) }),
          h('span', { style: { flex: 1 } }, `发现 ${data.health.length} 个同步问题${data.health.some((i) => i.issue === 'workspace-unmatched') ? '；含未匹配工作区的遗留项' : ''}。`),
          h('button', {
            type: 'button',
            onClick: onGoSync,
            style: { border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, fontWeight: 500, color: 'inherit', cursor: 'pointer' },
          }, '查看'),
        ),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 } },
          h('span', { style: sectionHead }, '技能库'),
          h('span', { style: noteText }, `${groupFilter === '' ? '全部' : groupFilter} · ${list.length} 个`),
          data.lib.checkedAt ? h('span', { style: noteText }, `上游状态检查于 ${fmtCheckedAt(data.lib.checkedAt)}`) : null,
        ),
        // 工具条（对齐 01/07 帧：搜索在前，来源筛选其后，操作靠右；导入为主按钮）
        h('div', { style: { ...S.toolbar, marginBottom: 12 } },
          h(Input, { style: { flex: 1, minWidth: 140 }, placeholder: '搜索名称 / 描述…', value: q, onChange: (e) => setQ(e.target.value) }),
          h('select', { style: { ...S.select, border: 'none', background: T.bgModulePlatform, borderRadius: 8, padding: '5px 10px' }, value: origin, onChange: (e) => setOrigin(e.target.value) },
            h('option', { value: '' }, '全部来源'),
            h('option', { value: 'github' }, 'GitHub'),
            h('option', { value: 'local' }, '本地'),
            h('option', { value: 'self' }, '自研'),
          ),
          h(GhostBtn, { onClick: refreshAll, disabled: busy, title: '重新扫描列表并检查全部上游状态' }, '↻ 刷新'),
          h(Button, { size: 'sm', onClick: () => setImportOpen(true), disabled: busy }, '＋ 导入 skill'),
        ),
        // 检查/更新结果提示
        notice ? h('div', { style: { ...S.muted, marginBottom: 6 } }, notice) : null,
        // 行（01/07 帧：描边卡片，名称 13/600 + meta 11 弱化）
        list.length === 0
          ? h('div', { style: { ...S.muted, padding: 12 } }, '库为空（无匹配 skill）')
          : list.map((it) => h('div', { key: it.dir, style: { ...S.row, position: 'relative' } },
              h('div', { style: { flex: 1, minWidth: 0 }, title: it.description || '' },
                h('div', { style: { fontWeight: 600, color: T.labelPrimary } }, it.name),
                h('div', { style: noteText },
                  `${ORIGIN_LABEL[it.origin] || it.origin} · ${it.group}${(it.targets || []).length > 0 ? ' · ' + it.targets.join(' ') : ''}${it.fingerprint ? ' · ' + it.fingerprint.slice(0, 7) : ''}`,
                ),
              ),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                it.missing && h('span', { style: statusPillStyle('error') }, '缺失'),
                it.disabled && h('span', { style: statusPillStyle('warn') }, '已禁用'),
                !it.hasSkillMd && h('span', { style: statusPillStyle('warn') }, '无 SKILL.md'),
                it.upstream && it.upstream.status === 'updatable' && h('span', { style: statusPillStyle('updatable') }, '可更新'),
                it.upstream && it.upstream.status === 'up_to_date' && h('span', { style: statusPillStyle('normal') }, '已是最新'),
                it.upstream && it.upstream.status === 'check_failed' && h('span', { style: statusPillStyle('warn') }, '检查失败'),
                it.upstream && it.upstream.locally_modified && h('span', { style: statusPillStyle('warn') }, '本地有修改'),
                h('button', {
                  type: 'button',
                  title: '行操作',
                  disabled: busy,
                  onClick: () => setMenuFor(menuFor === it.dir ? null : it.dir),
                  style: {
                    border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer',
                    fontSize: 16, lineHeight: 1, padding: '3px 6px', borderRadius: 6,
                    color: menuFor === it.dir ? T.labelPrimary : T.labelSecondary,
                  },
                }, '⋯'),
              ),
              menuFor === it.dir && h(RowMenu, {
                it,
                groupNames,
                busy,
                onAction: (action) => rowAction(it.dir, action),
                onMove: (group) => move(it.dir, group),
                onClose: () => setMenuFor(null),
              }),
            )),
        createOpen && h(CreateGroupDialog, {
          onCancel: () => setCreateOpen(false),
          onCreate: createGroup,
        }),
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

    /** DSR-009：新建分组走模态对话框（与更新确认同一遮罩语言）；新组复制「默认」组挂载规则起步。 */
    function CreateGroupDialog({ onCancel, onCreate }) {
      const [name, setName] = useState('')
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const submit = async () => {
        const trimmed = name.trim()
        if (!trimmed) {
          setError('请输入组名')
          return
        }
        setBusy(true)
        setError(null)
        try {
          await onCreate(trimmed)
        } catch (e) {
          setError(e.message || String(e))
          setBusy(false)
        }
      }
      return h('div', {
        role: 'presentation',
        style: {
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(15, 17, 21, .42)', padding: 20,
        },
        onClick: onCancel,
      },
        h('div', {
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': 'skill-manager-create-group-title',
          style: {
            width: 'min(400px, 100%)', borderRadius: 16, padding: 20,
            border: `1px solid ${T.borderL2}`, background: T.bgLayer3, color: T.labelPrimary,
            boxShadow: '0 18px 48px rgba(0,0,0,.28)',
          },
          onClick: (e) => e.stopPropagation(),
        },
          h('div', { id: 'skill-manager-create-group-title', style: { fontSize: 16, fontWeight: 600, marginBottom: 8 } }, '新建分组'),
          h('div', { style: { color: T.labelSecondary, fontSize: 13, lineHeight: 1.55, marginBottom: 12 } }, '创建命名分组，按主题组织 Skill 并配置其可用范围。'),
          h('div', { style: { fontSize: 12, fontWeight: 500, marginBottom: 6 } }, '组名'),
          h(Input, {
            value: name,
            autoFocus: true,
            placeholder: '新组名',
            onChange: (e) => setName(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') onCancel()
            },
          }),
          error ? h('div', { style: { fontSize: 12, color: T.error, marginTop: 6 } }, error) : null,
          h('div', { style: { fontSize: 11, color: T.labelSecondary, marginTop: 8 } }, '新组复制「默认」组的挂载规则作为起步；组名 1–30 字符。'),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 } },
            h(OutlineBtn, { onClick: onCancel, disabled: busy }, '取消'),
            h(Button, { size: 'sm', onClick: submit, disabled: busy }, busy ? '新建中…' : '新建'),
          ),
        ),
      )
    }

    /** 当前分组的使用范围：只对 DSH 全局与 Host 返回的活动工作区写挂载规则。 */
    function GroupScopePanel({ call, group, mounts, workspaceProjects, busy, onError, onChanged, onGroupOp }) {
      const [scopeBusy, setScopeBusy] = useState(false)
      const [renaming, setRenaming] = useState(false)
      const [newName, setNewName] = useState('')
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
      // DSR-009：改名/删除入口收进当前分组卡片；「默认」是虚拟组，不可管理
      const manageable = group !== '默认'
      const submitRename = () => {
        const trimmed = newName.trim()
        setRenaming(false)
        if (trimmed && trimmed !== group) onGroupOp('rename', group, trimmed)
      }
      const entryStyle = (danger) => ({
        border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 11,
        color: danger ? T.error : T.labelSecondary, cursor: disabled ? 'default' : 'pointer',
      })
      // 07/09 帧：白底描边卡；标题行（改名中变内联编辑）；行间分隔线；底部后果注释
      return h('div', { style: { ...cardStyle, padding: '12px 14px' } },
        renaming
          ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
              h(Input, {
                style: { width: 160 },
                value: newName,
                autoFocus: true,
                onChange: (e) => setNewName(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') submitRename()
                  if (e.key === 'Escape') setRenaming(false)
                },
              }),
              h(Button, { size: 'sm', onClick: submitRename, disabled }, '保存'),
              h(GhostBtn, { onClick: () => setRenaming(false) }, '取消'),
            )
          : h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 } },
              h('span', { style: cardTitle }, `当前分组：${group}`),
              manageable && h('span', { style: { flex: 1 } }),
              manageable && h('button', { type: 'button', style: entryStyle(false), disabled, onClick: () => { setNewName(group); setRenaming(true) } }, '改名'),
              manageable && h('button', { type: 'button', style: entryStyle(true), disabled, onClick: () => onGroupOp('delete', group) }, '删除'),
            ),
        renaming && h('div', { style: { ...noteText, marginBottom: 8 } }, '改名立即生效：分组成员与挂载规则同步改名，Skill 本体不受影响。'),
        h('div', { style: dividerStyle }),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', fontSize: 12, cursor: disabled ? 'default' : 'pointer' } },
          h('input', {
            type: 'checkbox',
            checked: enabled('global'),
            disabled,
            onChange: (event) => toggle('global', null, event.target.checked),
          }),
          h('span', { style: { fontWeight: 500, color: T.labelPrimary } }, 'DSH 全局'),
          h('span', { style: noteText }, '对所有 DSH 项目生效'),
        ),
        h('div', { style: dividerStyle }),
        workspaceProjects.length === 0
          ? h('div', { style: { ...S.muted, padding: '8px 0' } }, '当前没有 DSH 工作区；请在 DSH 原生工作区界面创建或打开项目。')
          : h(React.Fragment, null,
              h('div', { style: { fontSize: 10, color: T.labelTertiary, padding: '7px 0 1px' } }, '工作区项目'),
              workspaceProjects.map((workspace) => h('label', {
                key: workspace.workspaceId,
                style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', fontSize: 12, cursor: disabled ? 'default' : 'pointer' },
              },
                h('input', {
                  type: 'checkbox',
                  checked: enabled('project', workspace.workspaceId),
                  disabled,
                  onChange: (event) => toggle('project', workspace.workspaceId, event.target.checked),
                }),
                h('span', { style: { fontWeight: 500, color: T.labelPrimary } }, workspace.title),
                h('span', { style: noteText }, `${workspace.path} · workspaceId: ${workspace.workspaceId.slice(0, 8)}…`),
              )),
            ),
        h('div', { style: dividerStyle }),
        h('div', { style: { ...noteText, paddingTop: 8 } }, '取消勾选会移除该分组在该目标下的全部 Skill 链接。'),
        manageable && h('div', { style: { ...noteText, paddingTop: 4 } }, '删除组：成员回落「默认」组，执行前需确认。'),
      )
    }

    function ImportPanel({ call, workspaces, onDone, onCancel }) {
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
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      // 04 帧：整页导入卡片（字段纵排 + 底部按钮）+「导入后」说明区
      const browse = async () => {
        if (!workspaces || typeof workspaces.pickDirectory !== 'function') return
        try {
          const picked = await workspaces.pickDirectory()
          if (picked) setPath(picked)
        } catch (e) {
          setError(e && e.message ? `选择目录失败：${e.message}` : '选择目录失败')
        }
      }
      return h('div', null,
        h('div', { style: { ...cardStyle, borderRadius: 14, padding: 16, marginBottom: 18 } },
          h('div', { style: { fontSize: 15, fontWeight: 600, color: T.labelPrimary, marginBottom: 4 } }, '导入本地 Skill'),
          h('div', { style: { ...noteText, marginBottom: 14 } }, '选择包含 SKILL.md 的目录，或导入 .zip 压缩包。'),
          h('div', { style: { fontSize: 11, fontWeight: 500, color: T.labelPrimary, marginBottom: 6 } }, '目录或 .zip 路径'),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 } },
            h(Input, { style: { flex: 1 }, value: path, onChange: (e) => setPath(e.target.value), placeholder: 'E:\\path\\skill-dir 或 .zip' }),
            h(OutlineBtn, { onClick: browse, disabled: busy || !workspaces }, '浏览…'),
          ),
          h('div', { style: { fontSize: 11, fontWeight: 500, color: T.labelPrimary, marginBottom: 6 } }, '安装名称（可选）'),
          h(Input, { style: { width: 230, marginBottom: 6 }, value: as, onChange: (e) => setAs(e.target.value), placeholder: '留空使用 SKILL.md 中的名称' }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 } },
            h('span', { style: { flex: 1, fontSize: 10, color: T.labelTertiary } }, '仅允许小写字母、数字和连字符；留空则使用 SKILL.md 中的名称。'),
            error ? h('span', { style: { fontSize: 12, color: T.error } }, error) : null,
            h(OutlineBtn, { onClick: onCancel, disabled: busy }, '取消'),
            h(Button, { size: 'sm', onClick: doImport, disabled: busy || !path.trim() }, busy ? '导入中…' : '导入'),
          ),
        ),
        h('div', { style: { ...sectionHead, marginBottom: 8 } }, '导入后'),
        h('div', { style: { ...subCardStyle, padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 8 } },
          h('span', { style: { ...dotStyle(T.success), marginTop: 5 } }),
          h('div', null,
            h('div', { style: { fontSize: 12, color: T.labelPrimary } }, '创建本地来源锁记录，并将文件复制到技能车间。'),
            h('div', { style: { ...noteText, marginTop: 2 } }, '自动忽略 .git 与 __pycache__。'),
          ),
        ),
        h('div', { style: { ...subCardStyle, padding: '10px 12px', display: 'flex', gap: 8 } },
          h('span', { style: { ...dotStyle(T.success), marginTop: 5 } }),
          h('div', null,
            h('div', { style: { fontSize: 12, color: T.labelPrimary } }, '写入 Git 历史，并按分组挂载到 DSH Skills 目录。'),
            h('div', { style: { ...noteText, marginTop: 2 } }, '目标已存在时会拒绝并提示改名。'),
          ),
        ),
      )
    }

    // ---------- 搜索视图 ----------
    function SearchView({ call, data, reload }) {
      const [query, setQuery] = useState('')
      const [results, setResults] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [candidates, setCandidates] = useState(null)
      const [selected, setSelected] = useState(new Set())

      // 多候选统一入口：搜索入库与直接添加（探测仓库）共用（DSR-007/DSR-008 复选批量入库）
      const showCandidates = (value) => {
        setCandidates(value)
        setSelected(new Set())
        setNotice(null)
        setError(null)
      }

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
            setNotice(`已入库 ${repo}`)
            reload()
          } else {
            showCandidates({ repo, branch: r.branch, list: r.candidates })
          }
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      const suggestName = (c) => (c.path ? c.path.split('/').pop() : (candidates.repo.split('/')[1] || candidates.repo))
      // 批量入库：串行逐个 add（每次 add 自带锁/提交/同步），单条失败不中断批次
      const addSelected = async () => {
        if (!candidates || selected.size === 0) return
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
            setError(failures.join('；'))
          } else {
            setCandidates(null)
            setSelected(new Set())
          }
          setNotice(`已入库 ${done} 个${failures.length > 0 ? `；失败 ${failures.length} 个` : ''}`)
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: S.panel },
        // 02 帧：搜索 skills.sh（搜索为主按钮）
        h('div', { style: { ...cardTitle, marginBottom: 8 } }, '搜索 skills.sh'),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 } },
          h(Input, {
            style: { flex: 1 },
            placeholder: 'skills.sh 关键词',
            value: query,
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') doSearch() },
          }),
          h(Button, { size: 'sm', onClick: doSearch, disabled: busy || !query.trim() }, busy ? '搜索中…' : '搜索'),
        ),
        // 02 帧：GitHub 仓库探测卡片（DSR-007）
        h(DirectAdd, { call, reload, busy, setBusy, setError, onCandidates: showCandidates, onAdded: () => setNotice('已入库') }),
        h(ErrorLine, { error }),
        notice ? h('div', { style: { ...S.muted, marginBottom: 6 } }, notice) : null,
        candidates && h('div', { style: { marginBottom: 10 } },
          h(GhostBtn, { onClick: () => { setCandidates(null); setSelected(new Set()) }, disabled: busy }, '← 返回搜索'),
          // 03 帧：仓库信息用浅底卡
          h('div', { style: { ...subCardStyle, padding: '10px 12px', margin: '8px 0 12px' } },
            h('div', { style: { fontWeight: 500, color: T.labelPrimary, fontSize: 13 } }, candidates.repo),
            h('div', { style: { ...noteText, marginTop: 2 } }, `${candidates.branch} · GitHub Trees API`),
            h('div', { style: { ...noteText, marginTop: 2 } }, `发现 ${candidates.list.length} 个含 SKILL.md 的目录，可多选入库。`),
          ),
          h('div', { style: { ...cardTitle, marginBottom: 8 } }, '选择要入库的 Skill（可多选）'),
          candidates.list.map((c) => {
            const key = c.path || ''
            const checked = selected.has(key)
            return h('label', { key: key || '<root>', style: { ...S.row, cursor: busy ? 'default' : 'pointer' } },
              h('input', {
                type: 'checkbox',
                checked,
                disabled: busy,
                onChange: () => {
                  const next = new Set(selected)
                  if (checked) next.delete(key)
                  else next.add(key)
                  setSelected(next)
                },
              }),
              h('span', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { color: T.labelPrimary, fontWeight: 500, fontSize: 12 } }, c.path || '（仓库根）'),
                h('div', { style: noteText }, `建议名称：${suggestName(c)}`),
              ),
            )
          }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' } },
            h('span', { style: { ...noteText, flex: 1 } }, `已选 ${selected.size} 个 · 共 ${candidates.list.length} 个候选`),
            h(Button, { size: 'sm', onClick: addSelected, disabled: busy || selected.size === 0 }, busy ? '入库中…' : '入库所选'),
          ),
          h('div', { style: { ...badgeStyle(T.warn), borderRadius: 10, padding: '9px 12px', fontSize: 11, lineHeight: 1.6, display: 'flex', gap: 8 } },
            h('span', { style: { ...dotStyle(T.warn), marginTop: 5 } }),
            h('div', null,
              h('div', null, '同名且同仓库时改用更新；同名异源时需先出库。'),
              h('div', null, '分支按指定值 → main → master 回退。'),
            ),
          ),
        ),
        results && results.skills.length === 0
          ? h('div', { style: S.muted }, '无结果')
          : (results && results.skills.length > 0
              ? h('div', null,
                  h('div', { style: { ...cardTitle, margin: '4px 0 8px' } }, `“${results.query || query}” 的搜索结果 · ${results.skills.length} 个`),
                  results.skills.map((s) => h('div', { key: s.key, style: S.row },
                    h('div', { style: { flex: 1, minWidth: 0 } },
                      h('div', { style: { fontWeight: 600, color: T.labelPrimary } }, s.name),
                      h('div', { style: noteText }, `${s.repo}${s.directory ? ' / ' + s.directory : ''} · 安装 ${s.installs}`),
                    ),
                    h(OutlineBtn, { onClick: () => addFrom(s.repo, s.directory, ''), disabled: busy }, '入库'),
                  )),
                )
              : null),
      )
    }

    /** DSR-007：直接添加入口语义为「探测仓库」；多候选交给搜索视图的候选列表选择。 */
    function DirectAdd({ call, reload, busy, setBusy, setError, onCandidates, onAdded }) {
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
            if (onAdded) onAdded()
            reload()
          } else {
            onCandidates({ repo: repo.trim(), branch: r.branch, list: r.candidates })
          }
        } catch (e) {
          setError(e.message || String(e))
        } finally {
          setBusy(false)
        }
      }
      // 02 帧：白底描边卡「从 GitHub 仓库添加」，探测为浅色按钮
      return h('div', { style: { ...cardStyle, padding: '12px 14px', marginBottom: 14 } },
        h('div', { style: { ...cardTitle, marginBottom: 10 } }, '从 GitHub 仓库添加'),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(Input, { style: { flex: 1 }, placeholder: 'owner/repo', value: repo, onChange: (e) => setRepo(e.target.value) }),
          h(Input, { style: { width: 110 }, placeholder: '分支（可选）', value: branch, onChange: (e) => setBranch(e.target.value) }),
          h(OutlineBtn, { onClick: add, disabled: busy || !repo.trim() }, '探测仓库'),
        ),
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

      // 05 帧：健康问题按严重级着色卡片（状态点 + 加粗标题 + 后果说明）
      const ISSUE_DESC = {
        'wrong-target': '目标指向错误；修复会重建受管链接。',
        'workspace-unmatched': '旧记录已保留；普通修复不会删除其既有链接。',
      }
      const healthCard = (color, title, desc, key) => h('div', {
        key,
        style: { ...badgeStyle(color), borderRadius: 10, padding: '9px 12px', marginBottom: 8, fontSize: 12, display: 'flex', gap: 8 },
      },
        h('span', { style: { ...dotStyle(color), marginTop: 5 } }),
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { fontWeight: 600 } }, title),
          desc ? h('div', { style: { fontSize: 11, marginTop: 2 } }, desc) : null,
        ),
      )

      return h('div', { style: S.panel },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h('span', { style: cardTitle }, `健康问题 ${health.length} 项`),
          h('span', { style: { flex: 1 } }),
          h(Button, { size: 'sm', onClick: fix, disabled: busy || health.length === 0 }, busy ? '修复中…' : '应用并修复'),
        ),
        h(ErrorLine, { error }),
        health.length === 0
          ? h('div', { style: { ...subCardStyle, padding: '10px 12px', marginBottom: 16, fontSize: 12, color: T.labelSecondary, display: 'flex', gap: 8, alignItems: 'center' } },
              h('span', { style: dotStyle(T.success) }),
              '各项目录与挂载期望一致，无需修复。',
            )
          : health.map((issue, index) => healthCard(
              issue.issue === 'workspace-unmatched' ? T.warn : T.error,
              `${issue.issue} · ${issue.name} @ ${describeTarget(issue.target)}`,
              ISSUE_DESC[issue.issue] || null,
              `${issue.issue}-${index}`,
            )),

        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, margin: '8px 0 8px' } },
          h('span', { style: sectionHead }, 'DSH 工作区项目'),
          h('span', { style: noteText }, '自动获取，不在此页注册或编辑'),
        ),
        workspaceProjects.length === 0
          ? h('div', { style: { ...S.muted, marginBottom: 14 } }, '当前没有 DSH 工作区')
          : workspaceProjects.map((workspace) => h('div', { key: workspace.workspaceId, style: { ...subCardStyle, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 } },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontWeight: 500, fontSize: 12, color: T.labelPrimary } }, workspace.title),
                h('div', { style: noteText }, `${workspace.path} · workspaceId: ${workspace.workspaceId.slice(0, 8)}…`),
              ),
              h('span', { style: pillBase }, `${workspace.mountCount} 个组使用`),
            )),
        legacyProjects.length > 0 && h('div', { style: { marginTop: 4, marginBottom: 8 } },
          h('div', { style: { ...cardTitle, marginBottom: 6 } }, '未匹配工作区的遗留项'),
          legacyProjects.map((legacy) => healthCard(T.warn, `workspace-unmatched · ${legacy.project}`, `${legacy.path} · 保留 ${legacy.syncedCount} 个既有链接`, legacy.project)),
        ),

        matrix && h('div', null,
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, margin: '6px 0 8px' } },
            h('span', { style: sectionHead }, '同步矩阵'),
            h('span', { style: noteText }, '项目较多时可左右滚动'),
          ),
          // DSR-008：列多时横向滚动，Skill 列冻结在左侧（sticky 需不透明底色）
          h('div', { style: { overflowX: 'auto', paddingBottom: 4 } },
            h('table', { style: { borderCollapse: 'separate', borderSpacing: '0 4px', fontSize: 12, minWidth: '100%' } },
              h('thead', null, h('tr', null,
                h('th', { style: { textAlign: 'left', padding: '5px 12px', background: T.bgModulePlatform, color: T.labelSecondary, fontWeight: 400, fontSize: 11, whiteSpace: 'nowrap', position: 'sticky', left: 0, zIndex: 1, borderRadius: '8px 0 0 8px' } }, 'Skill'),
                matrix.columns.map((column, ci) => h('th', { key: column.key, style: { textAlign: 'left', padding: '5px 12px', background: T.bgModulePlatform, color: T.labelSecondary, fontWeight: 400, fontSize: 11, whiteSpace: 'nowrap', borderRadius: ci === matrix.columns.length - 1 ? '0 8px 8px 0' : undefined } }, column.label)),
              )),
              h('tbody', null, matrix.rows.map((row) => h('tr', { key: row.dir },
                h('td', { style: { padding: '4px 12px', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: T.bgLayer3, zIndex: 1, color: T.labelPrimary } }, row.name),
                row.cells.map((cell, index) => h('td', { key: index, style: { padding: '4px 12px' } },
                  h('span', { style: cell === '不适用' ? pillBase : { ...pillBase, ...badgeStyle(cellColor(cell)), fontWeight: 500 } }, cell),
                )),
              ))),
            ),
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
            { name: 'settings.section', id: 'skills', order: 16, label: '技能', inject: () => ({ call, workspaces }) },
            SkillsSection,
          ),
        )
        const offCard = ctx.slots.inject('settings.plugin.item', () =>
          ctx.slots.register(
            // rc.7 起该槽为 keyed：key = 本卡片编辑的 settings 命名空间
            { name: 'settings.plugin.item', key: 'skill-manager', order: 30, label: '技能目录', inject: () => ({ config, workspaces }) },
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
