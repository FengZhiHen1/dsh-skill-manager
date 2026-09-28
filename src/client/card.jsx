// card — 配置页：Plugins 页 → 本 bundle → 本行「配置」入口，编辑 skillsDir 与 pi 接管开关。
//
// 边界：不直接读写传输、不自管草稿——渲染官方设置表单原语，写入经 `config-page.js` 的
//       `SettingsFormModel`（草稿暂存、revision 围栏、保存后回读、离开页面丢弃全归它）。
//
// 0.1.7 接线（knowledge/client/15 §4/§4.1；DSR-025/DSR-026）：本组件是 `plugins.row.config`
// 的注册组件，页面按 `view` 分发——`'summary'` 只要一句话（行缺描述时作其回落），`'page'`
// 才是表单主体。表单不再是自绘折叠卡：官方伴生页（`ShellCard`）就是裸 `<SettingsForm>`，
// 页面自绘行标题/图标/面包屑，故这里也不自带外壳。
//
// 交互按官方语义（`SettingsForm.tsx` 原文：discards on unmount and **offers no discard control**）：
// 编辑先暂存，点「保存」**一次原子 mutate** 写入全部脏字段，页面卸载即丢弃草稿；没有「放弃」
// 控件、没有「未保存」标记。两字段进同一次 mutate 还有一个副作用：卡片路径不再存在
// 「连发两笔写、第一笔读到落后快照」的窗口（DSR-024 那个失败模式的成因），
// 故卡片不再需要 Host 权威读；技能页的 `groups`+`skills` 两步写仍需它，那部分保持不变。
// 参考：插件运行时.md「配置页」；DSR-018、DSR-019。
import { SettingsForm, SettingsValueField, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { T } from './theme.js'
import { GhostBtn } from './ui.jsx'
import { buildRepairPrompt, RepairCopy } from './repair.jsx'
import { isOn } from '../core/model/page-specs.js'

/** 官方表单框架的文案（`SettingsFormLabels`；五键齐备是契约要求）。 */
const LABELS = {
  unavailable: '本 profile 未提供该配置项（本行未激活，或设置面只读）——当前按 profile 里的行配置工作。',
  readOnly: '当前 profile 的设置面只读，无法保存。',
  saveFailed: '保存未生效：Host 未接受（校验未过或版本冲突），已回读当前生效值；草稿保留，请调整后重试。',
  save: '保存',
  saving: '保存中…',
}

/** 目录字段的文案。 */
const DIR_LABEL = '本地 skills 目录'
const DIR_HINT = '自研/本地 skill 的平铺目录，绝对路径，保存后立即生效。GitHub 入库安装到插件专属目录，不受本地编辑影响。'
const OVERRIDDEN = '已覆盖'
const RESET = '重置'

/**
 * 配置页（plugins.row.config keyed 槽位组件）。
 * @param {object} props
 * @param {'summary'|'page'} props.view 页面要的视图：`summary` = 一句话，`page` = 表单主体
 * @param {(selector: Function) => object} props.useConfigPage 渲染器由 `hooks.configPage` 合成的选择器 hook
 * @param {(field: string, text: string) => void} props.edit 暂存某字段的草稿文本
 * @param {(field: string) => void} props.resetField 暂存清除（保存后回落组合层）
 * @param {() => void} props.save 写入全部暂存编辑
 * @param {() => void} props.discard 丢弃全部暂存编辑（官方语义：离开页面时由框架调用）
 * @param {{ pickDirectory: () => Promise<string|null> }} props.uiWorkspace 原生目录选择服务面
 */
export function SkillManagerCard({ view, useConfigPage, edit, resetField, save, discard, uiWorkspace }) {
  // 快照由 `hooks` 舱的 selector hook 提供（页面下发的 form prop 是一次性快照，不可用于重渲染）。
  const state = useConfigPage((snapshot) => snapshot)

  // summary 视图：页面在行缺描述时拿它当一句话回落，只回文本，不渲表单。
  if (view === 'summary') {
    return <span>配置本地 skills 目录与 pi agent 接管（默认为空即未配置）</span>
  }

  // 只读文档下所有控件禁用；保存按钮的禁用另由官方表单按 dirty/invalid/saving 自管。
  const disabled = !state.writable
  const pickDirectory = async () => {
    try {
      const path = await uiWorkspace.pickDirectory()
      if (path) edit('skillsDir', path)
    } catch {
      // 目录选择器失败不改草稿：官方表单没有「操作级失败」的呈现位，静默保持原值
      // 比把错误塞进保存失败文案更诚实（保存失败文案专指写入未落定）。
    }
  }

  return (
    <SettingsForm labels={LABELS} state={state} onSave={save} onDiscard={discard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SettingsValueField
            id="skill-manager-skills-dir"
            label={DIR_LABEL}
            hint={DIR_HINT}
            overriddenLabel={OVERRIDDEN}
            resetLabel={RESET}
            invalidLabel="该草稿不是本字段接受的值"
            placeholder="例如 E:\Project\Skills（默认为空 = 未配置）"
            text={state.skillsDir.text}
            overridden={state.skillsDir.overridden}
            invalid={state.skillsDir.invalid}
            disabled={disabled}
            onEdit={(text) => edit('skillsDir', text)}
            onReset={() => resetField('skillsDir')}
          />
        </div>
        <GhostBtn disabled={disabled} onClick={pickDirectory}>选择…</GhostBtn>
      </div>

      {/* 接管宿主：DSH 是本插件基本盘（固定勾选不可关）；pi 可选，目录固定按默认路径探测。
          pi 是布尔字段，官方只有 number/text 两个 spec 助手，故控件自绘（官方页对布尔同样
          自绘，见 ui-settings-subagent），但草稿与写入仍走官方模型——勾选只暂存，保存才落。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: T.labelPrimary }}>接管宿主</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.labelTertiary, cursor: 'default' }} title="DSH 是本插件的基本盘，恒为接管宿主">
          <input type="checkbox" checked disabled style={{ accentColor: T.brand, width: 13, height: 13, margin: 0 }} />
          DSH
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.labelPrimary, cursor: disabled ? 'default' : 'pointer' }} title="勾选后保存生效：pi 按默认路径被接管（~/.pi/agent/skills 与各项目 .pi/skills）">
          <input
            type="checkbox"
            checked={isOn(state.pi.text)}
            disabled={disabled}
            onChange={(event) => edit('pi', event.target.checked ? 'true' : 'false')}
            style={{ accentColor: T.brand, width: 13, height: 13, margin: 0 }}
          />
          pi agent
        </label>
        {state.pi.overridden
          ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Tag tone="neutral">{OVERRIDDEN}</Tag>
                <button type="button" disabled={disabled} onClick={() => resetField('pi')} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, lineHeight: 1.5, color: T.labelSecondary, cursor: disabled ? 'default' : 'pointer' }}>{RESET}</button>
              </span>
            )
          : null}
        <span style={{ fontSize: 12, lineHeight: 1.5, color: T.labelTertiary }}>pi 固定走默认路径（~/.pi/agent），保存后生效</span>
      </div>

      {/* 保存未落定时的可复制修复提示词（AC-15 的呈现面之一）。
          官方表单只给一句 `saveFailed` 文案、不透出拒绝原因（`ConfigForm.mutate` 把
          `settings/rejected`/`settings/conflict` 折成 false 并丢弃原因），故这里补一个
          可复制的移交上下文；权威值不在其中——模型的保存路径已自行回读并判定未落定。 */}
      {state.failed
        ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8 }}>
              <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: T.error }}>
                配置写入未生效（Host 拒绝或版本冲突）。草稿已保留，可调整后重试，或复制下方提示词交给本地 Agent 排查。
              </p>
              <RepairCopy text={buildRepairPrompt({
                root: state.skillsDir.text,
                code: 'settings-write-not-applied',
                message: '配置页保存后 Host 未接受（saveFailed）',
                repair: {
                  operation: 'skill-manager 配置页保存',
                  summary: '本行配置（skillsDir / pi）的一次原子写入未被 Host 接受；表单已回读并确认未落定。',
                  facts: [
                    { label: '命名空间', value: 'skill-manager（= profile 里本插件行的 id）' },
                    { label: '尝试写入的目录', value: state.skillsDir.text === '' ? '（空 = 清除该字段）' : state.skillsDir.text },
                    { label: '尝试写入的 pi 开关', value: isOn(state.pi.text) ? 'true' : 'false' },
                    { label: '最可能的原因', value: '目录不是绝对路径；或该 profile 的行配置被 home patch / 命令行 overlay 覆盖（那两层优先于表单写入，写入会被拒）' },
                  ],
                  recommendation: [
                    '核对「本地 skills 目录」是否为绝对路径（如 E:\\Project\\Skills）',
                    '检查该 profile 的 cordis.patch.yml 与 $DSH_HOME/cordis.patch.yml 是否也写了 skill-manager 行',
                    '必要时用「重置」清掉该字段的覆盖，回落 profile 行里的组合层配置',
                  ],
                },
              })} />
            </div>
          )
        : null}
    </SettingsForm>
  )
}
