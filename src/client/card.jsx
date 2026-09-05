// dsh-skill-manager — 插件配置卡片（插件运行时.md「插件配置卡片」L187/L219；设置→插件→skill-manager）。
// 与 DSH 原生 PluginCard 同构：li > header（名称/描述/未保存标记/折叠箭头）+ body（字段 + footer：放弃/保存）；
// 数据经 settings 域（ctx.settingsScope）直读直写 skillsDir；校验拒绝在 footer 回显且草稿保留，附修复复制入口（DSR-018）。
import { useState, useEffect } from 'react'
import { T } from './theme.js'
import { ChevronIcon, GhostBtn } from './ui.jsx'
import { buildRepairPrompt, RepairCopy, settingsRejectedRepair } from './repair.jsx'

export function SkillManagerCard({ scope, uiWorkspace }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [touched, setTouched] = useState(false) // 用户是否编辑过草稿
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(null) // { message, prompt }
  const [focused, setFocused] = useState(false)
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
  const ready = Boolean(snap) && snap.status !== 'loading'
  const section = snap.value && typeof snap.value === 'object' ? snap.value : {}
  const current = typeof section.skillsDir === 'string' ? section.skillsDir : ''
  const overridden = Boolean(snap && snap.user && typeof snap.user === 'object' && 'skillsDir' in snap.user)

  // 权威值（首次加载 / 外部保存 / 重置）变化时，若用户没有未保存草稿，草稿跟随之。
  useEffect(() => {
    if (!touched) setDraft(current)
  }, [current, touched])

  const dirty = touched && draft !== current

  const reject = (e) => ({
    message: e && e.message ? e.message : '保存失败',
    prompt: buildRepairPrompt({
      root: current,
      code: 'settings-validation-rejected',
      message: e && e.message ? e.message : '',
      repair: settingsRejectedRepair('skillsDir', draft.trim(), current, current),
    }),
  })

  const save = async () => {
    if (!ready) return
    setBusy(true)
    setFailed(null)
    try {
      await scope.set('skillsDir', draft.trim())
      const fresh = scope.getSnapshot()
      const v = fresh.value && typeof fresh.value === 'object' ? fresh.value : {}
      setDraft(typeof v.skillsDir === 'string' ? v.skillsDir : '')
      setTouched(false)
    } catch (e) {
      // Host 校验拒绝（如非绝对路径）以错误回显，草稿保留供修改，不落盘
      setFailed(reject(e))
    } finally {
      setBusy(false)
    }
  }
  const discard = () => {
    setFailed(null)
    setDraft(current)
    setTouched(false)
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
      setFailed(reject(e))
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

  return (
    <li style={{ listStyle: 'none', border: `1px solid ${T.borderL2}`, borderRadius: 12, background: open ? T.bgLayer2 : T.bgLayer3, transition: 'border-color .16s, background .16s' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}: 技能管理`}
        onClick={() => setOpen(!open)}
        style={{ width: '100%', appearance: 'none', border: 0, background: 'none', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12 }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: T.labelPrimary }}>技能管理</span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: T.labelTertiary }}>配置本地 skills 目录（纯 skill 保存目录，默认为空即未配置）</span>
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
          {/* 字段（对齐 ValueField 形态：label/input/hint 纵排） */}
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
          {/* footer：失败提示（含修复复制入口）+ 放弃/保存（对齐 PluginCard footer） */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: `1px solid ${T.borderL2}` }}>
            {failed
              ? (
                  <>
                    <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: T.error }}>{failed.message}</p>
                    <RepairCopy text={failed.prompt} />
                  </>
                )
              : null}
            <button type="button" disabled={!dirty || busy || !ready} onClick={discard} style={{ appearance: 'none', border: `1px solid ${T.borderL2}`, borderRadius: 8, padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: 'pointer', background: 'none', color: T.labelSecondary }}>放弃</button>
            <button type="button" disabled={!dirty || busy || !ready} onClick={save} style={{ appearance: 'none', border: '1px solid transparent', borderRadius: 8, padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: 'pointer', background: T.labelPrimary, color: T.bgLayer3 }}>{busy ? '保存中…' : '保存'}</button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
