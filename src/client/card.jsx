// card — 插件配置卡片：设置 → 插件 → skill-manager 的 skillsDir 编辑与 pi 接管开关。
//
// 边界：只读写 ctx.settingsScope 的 skillsDir/pi 两个字段，不走 RPC；布局与原生 PluginCard 同构。
// pi 目录不可配：固定按默认路径探测（PI_CODING_AGENT_DIR → ~/.pi/agent）。
// 两字段统一草稿语义（与原生配置卡一致）：无修改时保存/放弃灰掉，一切修改点保存才生效。
// 参考：插件运行时.md「插件配置卡片」；DSR-018、DSR-019。
import { useState, useEffect } from 'react'
import { T } from './theme.js'
import { ChevronIcon, GhostBtn } from './ui.jsx'
import { buildRepairPrompt, RepairCopy, settingsRejectedRepair } from './repair.jsx'

/**
 * skill-manager 配置卡片（settings.plugin.item keyed 槽位组件）。
 * @param {object} props
 * @param {object} props.scope skill-manager settings scope（直读直写）
 * @param {{ pickDirectory: () => Promise<string|null> }} props.uiWorkspace 原生目录选择服务面
 */
export function SkillManagerCard({ scope, uiWorkspace }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [touched, setTouched] = useState(false) // 用户是否编辑过草稿
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(null) // { message, prompt }
  const [focused, setFocused] = useState(false)
  // 交互态对齐原生 PluginCard.module.css（knowledge client/15 §4.1）：
  // 禁用 = opacity 0.4 + 默认光标；放弃 hover 加深；focus 给品牌色 outline（onFocus 近似 :focus-visible，鼠标点击也会短暂出现）。
  const [hoverDiscard, setHoverDiscard] = useState(false)
  const [focusEl, setFocusEl] = useState(null) // 'header' | 'discard' | 'save'
  // Host 权威快照：value=解析值、user=用户层；user 层含 skillsDir 即「已覆盖」。
  const [snap, setSnap] = useState(() => scope.getSnapshot())

  // 订阅 settings 语义快照（文档 commit / 本卡写后由 scope 主动发布）。
  useEffect(() => {
    let alive = true
    const apply = () => { if (alive) setSnap(scope.getSnapshot()) }
    const off = scope.subscribe(apply)
    apply()
    return () => { alive = false; off() }
  }, [scope])

  // 首次 Host 应答前不渲染「未配置」，也不允许写入（避免读前写）。
  // 就绪判据与 section.jsx 统一：仅 'ready' 为就绪（第三态出现时两处结论一致）。
  const ready = snap.status === 'ready'
  const section = snap.value && typeof snap.value === 'object' ? snap.value : {}
  const current = typeof section.skillsDir === 'string' ? section.skillsDir : ''
  const overridden = Boolean(snap && snap.user && typeof snap.user === 'object' && 'skillsDir' in snap.user)
  const piOn = section.pi === true

  // 权威值（首次加载 / 外部保存 / 重置）变化时，若用户没有未保存草稿，草稿跟随之。
  useEffect(() => {
    if (!touched) setDraft(current)
  }, [current, touched])

  // pi 复选框同为草稿字段（null = 未动）：全部修改统一走保存生效，与原生配置卡同语义。
  const [piDraft, setPiDraft] = useState(null)
  const dirty = (touched && draft !== current) || (piDraft !== null && piDraft !== piOn)

  /**
   * 失败呈现：组装 footer 显示的 message 与可复制的修复提示词。
   * code 区分被拒与传输失败两类。
   */
  const reject = (message, code) => ({
    message,
    prompt: buildRepairPrompt({
      root: current,
      code,
      message,
      repair: settingsRejectedRepair('skillsDir', draft.trim(), current, current),
    }),
  })

  // 保存：按序写脏字段（skillsDir → pi），逐个核对权威快照；第一个被拒即停，其余草稿保留。
  const save = async () => {
    if (!ready) return
    setBusy(true)
    setFailed(null)
    const attempted = draft.trim()
    try {
      // Host validate 拒绝时 set 照常 resolve（客户端 recover 静默回滚，
      // DSH settings-scope.ts 语义）；catch 只剩传输/围栏类失败。
      if (touched && attempted !== current) {
        await scope.set('skillsDir', attempted)
        const fresh = scope.getSnapshot()
        const v = fresh.value && typeof fresh.value === 'object' ? fresh.value : {}
        const committed = typeof v.skillsDir === 'string' ? v.skillsDir : ''
        if (committed !== attempted) {
          // 权威快照 ≠ 尝试值 → 被 validate 拒绝已回滚：回显且草稿保留供修改
          setFailed(reject(`保存被 Host 校验拒绝，已回滚为「${committed || '未配置'}」（非空目录必须是绝对路径）。`, 'settings-validation-rejected'))
          return
        }
        setDraft(committed)
        setTouched(false)
      }
      if (piDraft !== null && piDraft !== piOn) {
        await scope.set('pi', piDraft)
        const fresh = scope.getSnapshot()
        const v = fresh.value && typeof fresh.value === 'object' ? fresh.value : {}
        if ((v.pi === true) !== piDraft) {
          setFailed({
            message: '接管开关保存被拒绝，已恢复原值。',
            prompt: buildRepairPrompt({ root: current, code: 'settings-validation-rejected', message: '字段 pi 写入被 Host validate 拒绝', repair: settingsRejectedRepair('pi', piDraft, v.pi, current) }),
          })
          return
        }
        setPiDraft(null)
      }
    } catch (e) {
      setFailed(reject(`写入失败（请求未达 Host）：${e?.message ?? String(e)}`, 'settings-write-failed'))
    } finally {
      setBusy(false)
    }
  }
  const discard = () => {
    setFailed(null)
    setDraft(current)
    setTouched(false)
    setPiDraft(null)
  }
  const reset = async () => {
    if (!ready) return
    setBusy(true)
    setFailed(null)
    try {
      // unset 该字段：value 回落到默认空串、user 层 key 消失 → 去掉「已覆盖」标记。
      await scope.unset('skillsDir')
      const fresh = scope.getSnapshot()
      const v = fresh.value && typeof fresh.value === 'object' ? fresh.value : {}
      setDraft(typeof v.skillsDir === 'string' ? v.skillsDir : '')
      setTouched(false)
    } catch (e) {
      setFailed(reject(`重置失败（请求未达 Host）：${e?.message ?? String(e)}`, 'settings-write-failed'))
    } finally {
      setBusy(false)
    }
  }
  // 原生目录选择：uiWorkspace 服务面（Host native picker）返回绝对路径；取消返回 null 不动草稿。
  // 注意：pickDirectory 在 uiWorkspace 面上，不在 workspaces（Workspace Controller 管理面）上。
  // 不用浏览器 showDirectoryPicker——File System Access API 不暴露绝对路径，而目录配置需要绝对路径。
  const pickDirectory = async () => {
    setBusy(true)
    setFailed(null)
    try {
      const path = await uiWorkspace.pickDirectory()
      if (path) { setDraft(path); setTouched(true) }
    } catch (e) {
      setFailed({
        message: e && e.message ? `选择目录失败：${e.message}` : '选择目录失败',
        prompt: buildRepairPrompt({
          root: current,
          code: 'directory-picker-failed',
          message: e && e.message ? e.message : '',
          repair: null,
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  // 结构：li > header（名称/描述/未保存标记/折叠箭头）+ 折叠 body（skillsDir 字段 + 接管宿主复选框 + footer：放弃/保存）。
  return (
    <li style={{ listStyle: 'none', border: `1px solid ${T.borderL2}`, borderRadius: 12, background: open ? T.bgLayer2 : T.bgLayer3, transition: 'border-color .16s, background .16s' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}: 技能管理`}
        onClick={() => setOpen(!open)}
        onFocus={() => setFocusEl('header')}
        onBlur={() => setFocusEl(null)}
        style={{ width: '100%', appearance: 'none', border: 0, background: 'none', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, ...(focusEl === 'header' ? { outline: `2px solid ${T.brand}`, outlineOffset: -2 } : {}) }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: T.labelPrimary }}>技能管理</span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: T.labelTertiary }}>配置本地 skills 目录与 pi agent 接管（默认为空即未配置）</span>
        </span>
        {dirty
          ? <span style={{ flex: 'none', borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', fontWeight: 500, whiteSpace: 'nowrap', background: T.bgModulePlatform, color: T.labelSecondary }}>未保存</span>
          : null}
        {ChevronIcon
          ? <ChevronIcon style={{ flex: 'none', color: T.labelTertiary, transition: 'transform .16s', transform: open ? 'rotate(180deg)' : undefined }} />
          : <span style={{ flex: 'none', color: T.labelTertiary, fontSize: 12 }}>{open ? '▾' : '▸'}</span>}
      </button>
      {open ? (
        <div style={{ borderTop: `1px solid ${T.borderL2}`, margin: '0 16px', paddingBottom: 8 }}>
          {/* 字段（对齐 ValueField 形态：label/input/hint 纵排）；路径项只有 skills 目录一个 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label htmlFor="skill-manager-skills-dir" style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: T.labelPrimary }}>本地 skills 目录</label>
              {overridden
                ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', whiteSpace: 'nowrap', fontWeight: 500, background: T.bgModulePlatform, color: T.labelSecondary }}>已覆盖</span>
                      <button type="button" disabled={busy || !ready} onClick={reset} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, lineHeight: 1.5, color: T.labelSecondary, cursor: 'pointer' }}>重置</button>
                    </span>
                  )
                : null}
            </div>
            {/* 输入框：裸 input + fields 几何（对齐原生 ValueField；不用 primitives Input——其 wrap 自带边框/圆角，再传几何会叠成"两个框"） */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                id="skill-manager-skills-dir"
                type="text"
                value={draft}
                placeholder="例如 E:\Project\Skills（默认为空 = 未配置）"
                onChange={(e) => { setDraft(e.target.value); setTouched(true); setFailed(null) }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={{ flex: 1, minWidth: 0, height: 34, padding: '0 12px', border: `1px solid ${focused ? T.brand : T.borderL2}`, borderRadius: 8, background: T.bgLayer3, font: 'inherit', fontSize: 13, lineHeight: 1.5, color: T.labelPrimary, outline: 'none', boxSizing: 'border-box' }}
              />
              <GhostBtn disabled={busy || !ready} onClick={pickDirectory}>选择…</GhostBtn>
            </div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: T.labelTertiary }}>绝对路径；保存后立即生效，无需重启。</p>
          </div>
          {/* 接管宿主：DSH 是本插件基本盘（固定勾选不可关）；pi 可选，目录固定按默认路径探测 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '2px 0 12px' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: T.labelPrimary }}>接管宿主</span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.labelTertiary, cursor: 'default' }} title="DSH 是本插件的基本盘，恒为接管宿主">
              <input type="checkbox" checked disabled style={{ accentColor: T.brand, width: 13, height: 13, margin: 0 }} />
              DSH
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.labelPrimary, cursor: ready && !busy ? 'pointer' : 'default' }} title="勾选后保存生效：pi 按默认路径被接管（~/.pi/agent/skills 与各项目 .pi/skills）">
              <input type="checkbox" checked={piDraft ?? piOn} disabled={busy || !ready} onChange={(e) => { setPiDraft(e.target.checked); setFailed(null) }} style={{ accentColor: T.brand, width: 13, height: 13, margin: 0 }} />
              pi agent
            </label>
            <span style={{ fontSize: 12, lineHeight: 1.5, color: T.labelTertiary }}>pi 固定走默认路径（~/.pi/agent），保存后生效</span>
          </div>
          {/* footer：失败提示（含修复复制入口）+ 放弃/保存（对齐 PluginCard footer；
              交互态复刻 PluginCard.module.css：禁用 opacity .4、放弃 hover 加深、focus 品牌色 outline） */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: `1px solid ${T.borderL2}` }}>
            {failed
              ? (
                  <>
                    <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: T.error }}>{failed.message}</p>
                    <RepairCopy text={failed.prompt} />
                  </>
                )
              : null}
            {(() => {
              const blocked = !dirty || busy || !ready
              const focusStyle = (el) => (focusEl === el ? { outline: `2px solid ${T.brand}`, outlineOffset: 1 } : {})
              return (
                <>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={discard}
                    onMouseEnter={() => setHoverDiscard(true)}
                    onMouseLeave={() => setHoverDiscard(false)}
                    onFocus={() => setFocusEl('discard')}
                    onBlur={() => setFocusEl(null)}
                    style={{ appearance: 'none', border: `1px solid ${!blocked && hoverDiscard ? T.labelDimmed : T.borderL2}`, borderRadius: 8, padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: blocked ? 'default' : 'pointer', background: 'none', color: !blocked && hoverDiscard ? T.labelPrimary : T.labelSecondary, opacity: blocked ? 0.4 : 1, ...focusStyle('discard') }}
                  >
                    放弃
                  </button>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={save}
                    onFocus={() => setFocusEl('save')}
                    onBlur={() => setFocusEl(null)}
                    style={{ appearance: 'none', border: '1px solid transparent', borderRadius: 8, padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: blocked ? 'default' : 'pointer', background: T.labelPrimary, color: T.bgLayer3, opacity: blocked ? 0.4 : 1, ...focusStyle('save') }}
                  >
                    {busy ? '保存中…' : '保存'}
                  </button>
                </>
              )
            })()}
          </div>
        </div>
      ) : null}
    </li>
  )
}
