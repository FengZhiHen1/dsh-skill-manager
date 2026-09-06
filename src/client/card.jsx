// card — 插件配置卡片：设置 → 插件 → skill-manager 的 skillsDir / piAgentDir 编辑入口。
//
// 边界：只读写 ctx.settingsScope 的两个字段，不走 RPC；布局与原生 PluginCard 同构。
// 参考：插件运行时.md「插件配置卡片」；DSR-018、DSR-019。
import { useState, useEffect } from 'react'
import { T } from './theme.js'
import { ChevronIcon, GhostBtn } from './ui.jsx'
import { buildRepairPrompt, RepairCopy, settingsRejectedRepair } from './repair.jsx'

/** 字段登记：key = settings 键；picker = 是否有原生目录选择按钮。 */
const FIELDS = [
  { key: 'skillsDir', label: '本地 skills 目录', placeholder: '例如 E:\\Project\\Skills（默认为空 = 未配置）', hint: '绝对路径；保存后立即生效，无需重启。', picker: true },
  { key: 'piAgentDir', label: 'pi agent 目录（可选）', placeholder: '留空自动探测 ~/.pi/agent', hint: '探测到即出现 pi 挂载入口（勾选才生效）；探测不到即不接管 pi。', picker: false },
]

/**
 * skill-manager 配置卡片（settings.plugin.item keyed 槽位组件）。
 * @param {object} props
 * @param {object} props.scope skill-manager settings scope（直读直写）
 * @param {{ pickDirectory: () => Promise<string|null> }} props.uiWorkspace 原生目录选择服务面
 */
export function SkillManagerCard({ scope, uiWorkspace }) {
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState({ skillsDir: '', piAgentDir: '' })
  const [touched, setTouched] = useState({}) // field -> true（用户编辑过草稿）
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(null) // { message, prompt }
  const [focused, setFocused] = useState(null) // 聚焦字段 key（描边高亮）
  // Host 权威快照：value=解析值、user=用户层；user 层含某字段键即该字段「已覆盖」。
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
  const user = snap.user && typeof snap.user === 'object' ? snap.user : {}
  const currentOf = (key) => (typeof section[key] === 'string' ? section[key] : '')

  // 权威快照（首次加载 / 外部保存 / 重置）变化时，未编辑过的字段草稿跟随之。
  const snapValueKey = JSON.stringify([currentOf('skillsDir'), currentOf('piAgentDir')])
  useEffect(() => {
    setDrafts((prev) => ({
      skillsDir: touched.skillsDir ? prev.skillsDir : currentOf('skillsDir'),
      piAgentDir: touched.piAgentDir ? prev.piAgentDir : currentOf('piAgentDir'),
    }))
    // 仅跟随权威值；touched 变化不该重置草稿（故依赖快照值串而非 snap 对象本身）
  }, [snapValueKey])

  const dirtyKeys = FIELDS.map((f) => f.key).filter((key) => touched[key] && drafts[key] !== currentOf(key))
  const dirty = dirtyKeys.length > 0

  /**
   * 失败呈现：组装 footer 显示的 message 与可复制的修复提示词。
   * code 区分被拒与传输失败两类。
   */
  const reject = (key, message, code) => ({
    message,
    prompt: buildRepairPrompt({
      root: currentOf('skillsDir'),
      code,
      message,
      repair: settingsRejectedRepair(key, (drafts[key] ?? '').trim(), currentOf(key), currentOf('skillsDir')),
    }),
  })

  // 保存：逐字段写入并逐个核对权威快照（被拒判定 = 写 resolve 后快照该字段 ≠ 尝试值）。
  // Host validate 拒绝时 set 照常 resolve（客户端 recover 静默回滚，DSH settings-scope.ts 语义）；
  // catch 只剩传输/围栏类失败。多字段按序写，第一个被拒即停，其余字段草稿保留。
  const save = async () => {
    if (!ready) return
    setBusy(true)
    setFailed(null)
    try {
      for (const key of dirtyKeys) {
        const attempted = (drafts[key] ?? '').trim()
        try {
          await scope.set(key, attempted)
        } catch (e) {
          setFailed(reject(key, `写入「${key}」失败（请求未达 Host）：${e?.message ?? String(e)}`, 'settings-write-failed'))
          return
        }
        const fresh = scope.getSnapshot()
        const v = fresh.value && typeof fresh.value === 'object' ? fresh.value : {}
        const committed = typeof v[key] === 'string' ? v[key] : ''
        if (committed !== attempted) {
          // 权威快照 ≠ 尝试值 → 被 validate 拒绝已回滚：回显且草稿保留供修改
          setFailed(reject(key, `「${key}」保存被 Host 校验拒绝，已回滚为「${committed || '未配置'}」（非空必须是绝对路径）。`, 'settings-validation-rejected'))
          return
        }
      }
      setDrafts((prev) => ({ ...prev, ...Object.fromEntries(dirtyKeys.map((key) => [key, (prev[key] ?? '').trim()])) }))
      setTouched({})
    } finally {
      setBusy(false)
    }
  }
  const discard = () => {
    setFailed(null)
    setDrafts((prev) => ({ ...prev, ...Object.fromEntries(dirtyKeys.map((key) => [key, currentOf(key)])) }))
    setTouched({})
  }
  const reset = async (key) => {
    if (!ready) return
    setBusy(true)
    setFailed(null)
    try {
      // unset 该字段：value 回落到默认空串、user 层 key 消失 → 去掉「已覆盖」标记。
      await scope.unset(key)
      const fresh = scope.getSnapshot()
      const v = fresh.value && typeof fresh.value === 'object' ? fresh.value : {}
      setDrafts((prev) => ({ ...prev, [key]: typeof v[key] === 'string' ? v[key] : '' }))
      setTouched((prev) => ({ ...prev, [key]: false }))
    } catch (e) {
      setFailed(reject(key, `重置「${key}」失败（请求未达 Host）：${e?.message ?? String(e)}`, 'settings-write-failed'))
    } finally {
      setBusy(false)
    }
  }
  // 原生目录选择：uiWorkspace 服务面（Host native picker）返回绝对路径；取消返回 null 不动草稿。
  // 注意：pickDirectory 在 uiWorkspace 面上，不在 workspaces（Workspace Controller 管理面）上。
  // 不用浏览器 showDirectoryPicker——File System Access API 不暴露绝对路径，而目录配置需要绝对路径。
  const pickDirectory = async (key) => {
    setBusy(true)
    setFailed(null)
    try {
      const path = await uiWorkspace.pickDirectory()
      if (path) { setDrafts((prev) => ({ ...prev, [key]: path })); setTouched((prev) => ({ ...prev, [key]: true })) }
    } catch (e) {
      setFailed({
        message: e && e.message ? `选择目录失败：${e.message}` : '选择目录失败',
        prompt: buildRepairPrompt({
          root: currentOf('skillsDir'),
          code: 'directory-picker-failed',
          message: e && e.message ? e.message : '',
          repair: null,
        }),
      })
    } finally {
      setBusy(false)
    }
  }

  // 结构：li > header（名称/描述/未保存标记/折叠箭头）+ 折叠 body（字段区 ×2 + footer：放弃/保存）。
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
          {/* 字段（对齐 ValueField 形态：label/input/hint 纵排），按 FIELDS 登记渲染 */}
          {FIELDS.map((field) => (
            <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label htmlFor={`skill-manager-${field.key}`} style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: T.labelPrimary }}>{field.label}</label>
                {field.key in user
                  ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', whiteSpace: 'nowrap', fontWeight: 500, background: T.bgModulePlatform, color: T.labelSecondary }}>已覆盖</span>
                        <button type="button" disabled={busy || !ready} onClick={() => reset(field.key)} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, lineHeight: 1.5, color: T.labelSecondary, cursor: 'pointer' }}>重置</button>
                      </span>
                    )
                  : null}
              </div>
              {/* 输入框：裸 input + fields 几何（对齐原生 ValueField；不用 primitives Input——其 wrap 自带边框/圆角，再传几何会叠成"两个框"） */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id={`skill-manager-${field.key}`}
                  type="text"
                  value={drafts[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => { setDrafts((prev) => ({ ...prev, [field.key]: e.target.value })); setTouched((prev) => ({ ...prev, [field.key]: true })); setFailed(null) }}
                  onFocus={() => setFocused(field.key)}
                  onBlur={() => setFocused(null)}
                  style={{ flex: 1, minWidth: 0, height: 34, padding: '0 12px', border: `1px solid ${focused === field.key ? T.brand : T.borderL2}`, borderRadius: 8, background: T.bgLayer3, font: 'inherit', fontSize: 13, lineHeight: 1.5, color: T.labelPrimary, outline: 'none', boxSizing: 'border-box' }}
                />
                {field.picker ? <GhostBtn disabled={busy || !ready} onClick={() => pickDirectory(field.key)}>选择…</GhostBtn> : null}
              </div>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: T.labelTertiary }}>{field.hint}</p>
            </div>
          ))}
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
