// card — 配置页：Plugins 页 → 本行（skill-manager）的「配置」入口，编辑 skillsDir 与 pi 接管开关。
//
// 边界：只读写 ctx.configForms 的 skillsDir/pi 两个字段，不走 RPC；外观与官方设置卡同构。
// pi 目录不可配：固定按默认路径探测（PI_CODING_AGENT_DIR → ~/.pi/agent）。
// 两字段统一草稿语义：无修改时保存/放弃灰掉，一切修改点保存才生效。
//
// 0.1.7 接线（client/15 §4）：本组件是 `plugins.row.config` 的注册组件，页面按 `view` 分发——
// 'summary' 只要一句话（行缺描述时作其回落），'page' 才是表单主体；外壳因此从旧列表槽的
// `<li>` 改为 `<div>`（页面把它渲染在自己的 <section> 里，行标题/图标/面包屑由页面自绘）。
// 参考：插件运行时.md「插件配置页」；DSR-018、DSR-019、DSR-025。
import { useState, useEffect } from 'react'
import { T } from './theme.js'
import { ChevronIcon, GhostBtn } from './ui.jsx'
import { buildRepairPrompt, RepairCopy, settingsWriteRepair } from './repair.jsx'
import { writeVerdict } from '../core/model/verdict.js'

/**
 * skill-manager 配置页（plugins.row.config keyed 槽位组件）。
 * @param {object} props
 * @param {'summary'|'page'} props.view 页面要的视图：`summary` = 一句话，`page` = 表单主体
 * @param {object} props.scope 本行配置的共享 ConfigForm（直读直写；与旧 SettingsScope 同形）
 * @param {{ pickDirectory: () => Promise<string|null> }} props.uiWorkspace 原生目录选择服务面
 * @param {(field: string) => Promise<unknown>} props.readConfigField Host 权威读（settings.describe 的该字段值；读不到返回 undefined）
 */
export function SkillManagerCard({ view, scope, uiWorkspace, readConfigField }) {
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
   * verdict 取自 core 的 writeVerdict：not-applied（权威值未变）/ unknown（读不到权威值）。
   */
  const failure = (verdict, field, attempted, authoritative, readError) => ({
    message: verdict === 'not-applied'
      ? `配置「${field}」写入未生效：Host 权威值仍是原值（被拒绝或已被并发写覆盖）。`
      : `配置「${field}」写入结果未确认：读不到 Host 权威值（${readError || '原因未知'}），请刷新页面核对现场。`,
    prompt: buildRepairPrompt({
      root: current,
      code: verdict === 'not-applied' ? 'settings-write-not-applied' : 'settings-write-unconfirmed',
      message: `字段 ${field} 写后裁定：${verdict}`,
      repair: settingsWriteRepair(verdict, field, attempted, authoritative, current, readError),
    }),
  })

  // 保存：按序写脏字段（skillsDir → pi），逐字段以 **Host 权威值** 裁定；第一个未落定即停，其余草稿保留。
  // 裁定只认权威值（writeVerdict）：Host 拒绝时 set 照常 resolve（客户端 recover 静默回退，DSH
  // settings-scope 语义），且镜像快照在"本笔写被后继写超越"时不回折——拿镜像比对会误报被拒
  // （2026-09-14 实证）。catch 只剩传输/围栏类失败（请求未达 Host）。
  const save = async () => {
    if (!ready) return
    setBusy(true)
    setFailed(null)
    let field = 'skillsDir'
    let attempted = draft.trim()
    try {
      if (touched && attempted !== current) {
        await scope.set('skillsDir', attempted)
        const read = await readConfigField('skillsDir')
        const verdict = writeVerdict(attempted, read.value)
        if (verdict !== 'accepted') {
          // 未生效/未确认：错误条上屏（含修复提示词），草稿保留供修改
          setFailed(failure(verdict, 'skillsDir', attempted, read.value, read.error))
          return
        }
        setDraft(attempted)
        setTouched(false)
      }
      if (piDraft !== null && piDraft !== piOn) {
        field = 'pi'
        attempted = piDraft
        await scope.set('pi', piDraft)
        const read = await readConfigField('pi')
        const verdict = writeVerdict(piDraft, read.value)
        if (verdict !== 'accepted') {
          setFailed(failure(verdict, 'pi', piDraft, read.value, read.error))
          return
        }
        setPiDraft(null)
      }
    } catch (e) {
      setFailed({
        message: `写入失败（请求未达 Host）：${e?.message ?? String(e)}`,
        prompt: buildRepairPrompt({
          root: current,
          code: 'settings-write-failed',
          message: `字段 ${field} 写入请求未达 Host`,
          repair: settingsWriteRepair('unknown', field, attempted, undefined, current),
        }),
      })
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

  // summary 视图：页面在行缺描述时拿它当一句话回落，只回文本，不渲表单外壳。
  // 必须在全部 hook 之后返回（React 规则）。
  if (view === 'summary') {
    return <span>配置本地 skills 目录与 pi agent 接管（默认为空即未配置）</span>
  }

  // 结构：div（页面自有 <section> 内）> header（名称/描述/未保存标记/折叠箭头）
  //   + 折叠 body（skillsDir 字段 + 接管宿主复选框 + footer：放弃/保存）。
  return (
    <div style={{ border: `1px solid ${T.borderL2}`, borderRadius: 12, background: open ? T.bgLayer2 : T.bgLayer3, transition: 'border-color .16s, background .16s' }}>
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
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: T.labelTertiary }}>自研/本地 skill 的平铺目录，绝对路径，保存后立即生效。GitHub 入库安装到插件专属目录，不受本地编辑影响。</p>
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
    </div>
  )
}
