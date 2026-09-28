# DSR-026：配置页改用官方设置表单原语，并把圆角/阴影/遮罩归到宿主 token

> 状态：**已落地，静态闸全绿**（2026-09-28）。`npm run check` 退出 0：client 产物新鲜度 **127.5 KB**（自绘版 132.3 KB，减 4.8 KB）+ `src` 全量语法 + 分层门禁（**23** 个 core 文件）+ `node --test` **157/157**（新增 7 项）。承接 DSR-025（基线换代）；本次是它之后的**交互与视觉对齐**，不改 Host 接线与配置模型。
> ⚠ 实例级页面走查未做（同 DSR-025）——见文末「尚未验证」。

## 上下文

DSR-025 把配置页从已删的 `settings.plugin.item` 卡片迁到 Plugins 页 `plugins.row.config`，但**外观与交互仍是自绘**：553 行级别的内联样式 + 自写草稿状态机（`draft`/`touched`/`busy`/`failed`/`hoverDiscard`/`focusEl`）+ 手抄的折叠壳几何。同时全插件共有 30 余处**字面量圆角**与 4 处硬编码阴影/遮罩色。

排查时发现两件此前不知道的事（都由源码取证，非文档转述）：

1. **官方把设置表单原语整体公开了**：`@deepseek-ai/dsh-client-ui-primitives` 导出 `SettingsForm`、`SettingsFormModel`、`SettingsValueField`、`SettingsSecretField`、`settingsNumberField`/`settingsTextField`，外加 `DisclosureRow`/`Tag`/`Switch`。官方伴生页就是用它搭的——`ui-settings-shell` 的 `ShellCard` 全文只有 `<SettingsForm labels state onSave onDiscard>` + 两个 `SettingsValueField`，控制器 `ShellCardController` 只有 `SettingsFormModel` + `bind`/`actions`/`inject` 三段。⇒ 本插件没有任何理由继续自绘。
2. **官方表单的交互语义与我们保留的那套不同**：`SettingsForm.tsx` 的模块注释原文是 "discards on unmount and **offers no discard control**"，渲染出的控件只有保存一个按钮（`:63-70`），`onDiscard` 由 `useEffect` 在**卸载**时调用（`:54`）。⇒ 「放弃」按钮与「未保存」标记在官方范式里不存在。
   - 顺带纠正一个我们自己的误判：`SettingsFormActions` 里**有** `discard` 成员，只看类型面容易误读成「官方也有放弃控件」。实际它只服务卸载路径。

## 真实方向与评价

- **A（保留自绘，只换 token）**：观感能对齐，但 500 多行自维护样式与草稿状态机继续存在，且交互仍与官方分叉；官方每改一次材料（如 2026-09-16 的图标改名、半径收档）都要手工跟一次。
- **B（改用官方原语 + token 归位）**：几何/材料/禁用与失败态样式由官方 CSS 提供，草稿暂存、revision 围栏、保存后回读、离开页面丢弃全部由 `SettingsFormModel` 承担；本插件只剩「字段规格 + 投影 + 少量自有控件」。
- **C（只搬交互、不搬外观）**：两头不靠——既没拿到官方材料，又丢掉了自绘的折叠壳。

## 最终决定（B）

1. **配置页改用官方原语**（`src/client/card.jsx` 重写）：`<SettingsForm labels state onSave onDiscard>` 包一个 `SettingsValueField`（skillsDir）与一行自绘的 pi 复选框；守卫为 `{ view, useConfigPage, edit, resetField, save, discard, uiWorkspace }`。
   - **去掉**「放弃」按钮与「未保存」标记——按官方语义，编辑先暂存、点保存写入、**离开页面即丢弃**。官方 `SettingsFormLabels` 五键（`unavailable`/`readOnly`/`saveFailed`/`save`/`saving`）逐条给了中文文案。
   - 表单不再是折叠卡：官方伴生页就是裸 `<SettingsForm>`（行标题/图标/面包屑由 Plugins 页自绘），故本插件的外壳与 `open`/`hoverDiscard`/`focusEl` 等自绘交互态一并删除。
2. **新增控制器**（`src/client/config-page.js`，`ConfigPageController`），逐段镜像官方 `ShellCardController`：`new SettingsFormModel(scope, CONFIG_PAGE_SPECS)` → `bind(projection)` → `inject()` 返回 `{ hooks: { configPage: store }, ...actions() }`。`hooks` 是注入面的**保留键**，渲染器把成员拆成 `useConfigPage` selector hook（页面下发的 `form` prop 是一次性快照，不能用于重渲染）。
3. **字段规格下沉到 core**（`src/core/model/page-specs.js`，浏览器安全、零平台 import、可裸 node 单测）：`skillsDirSpec`（文本互转；空草稿 = `clear`，与官方 `settingsTextField` 同语义）与 `piSpec`（布尔文本化为 `'true'`/`'false'`）。
   - 官方只提供 number/text 两个 spec 助手，**布尔在各官方页里都是自绘控件 + 自行动作**（如 `SubagentModelSelectionFields` 的 checkbox + toggle）。本插件要保留「改动暂存、保存才生效」（与同页 skillsDir 一致，也让两字段进**同一次原子 mutate**），故用规格承载布尔、控件自绘——控件自绘，写入仍走官方模型的计划与围栏。
   - 客户端**不做**「必须是绝对路径」的预检：那条约束的权威在 Host 的 `internal/config` 校验上，越界由 Host 拒绝并回读（官方 `save()` 的既有姿态：「Host 是唯一权威，保存后从 section 回读而不是本地预测」）。
4. **字段名收敛到单一事实源**（新增 `src/core/model/config-fields.js`）：`CONFIG_NS`/`SKILLS_DIR_FIELD`/`PI_FIELD`/`DEFAULT_GROUP` 由 `intent.js` 再导出（消费方 import 不变），浏览器侧的 `page-specs.js` 也从同一处取。此前两处各写一份字面量是漂移源，而漂移**不报错**——只表现为该字段在配置页上永远读不到值。
5. **圆角/阴影/遮罩归到宿主 token**（`src/client/theme.js` 新增 `R`/`SHADOW`，`T` 加 `mask`）：
   - 半径六档 `xs 4 / sm 8 / md 12 / lg 16 / xl 20 / panel 28`。归位规则：**控件/小件 → `sm`，面/容器 → `md`，大浮层 → `lg`**；整圆（胶囊徽章、状态点）保持字面量 `999`/`50%`——官方 `Tag.module.css`/`Switch.module.css` 同样如此（形状语义不是档位）。
   - 阴影：浮层 `var(--dsw-elevation-panel)`（官方 `HoverCard` 用法），对话框 `var(--dsw-elevation-prominent)`（官方 `Menu`/`Modal` 用法）；遮罩 `background: var(--dsw-alias-bg-mask-1)`（官方 `Modal.module.css` 用法）。原先写死的 `rgba(0,0,0,.18/.28)` 与 `rgba(15,17,21,.42)` 全部去掉。
   - ⚠ **这不是兼容性修复**：宿主的半径守卫（`packages/client/ui-theme/tests/radius-styles.client.spec.ts`）只扫 DSH 自己 `packages/client/**/src/**` 的 **CSS 文件**，不约束第三方内联样式。归位的价值是「与外壳共用同一套材料」，不是「不改就会坏」。
6. **卡片不再需要 Host 权威读**：两字段进同一次原子 mutate，卡内不再存在「连发两笔写、第一笔读到落后快照」的窗口（DSR-024 那个失败模式的成因），且官方模型的保存路径自带回读与未落定判定。故 `plugins.row.config` 的注入面**去掉 `readConfigField`**；技能页的 `groups`+`skills` 两步写仍需它（那部分不变）。
7. **保存未落定时保留可复制的修复提示词**（AC-15 的呈现面之一）：官方表单只给一句 `saveFailed` 文案（`ConfigForm.mutate` 把 `settings/rejected`/`settings/conflict` 折成 `false` 并丢弃原因），故在 children 里补一个 `RepairCopy`，内容含命名空间、两字段的尝试值、最可能的原因与排查步骤。
   - ⚠ 相较自绘版，这份提示词**不再包含 Host 权威值**（那需要重新注入 `readConfigField` 并加一个失败触发的读）。取舍理由：权威值的作用是「判定是否落定」，而该判定现已由官方模型回读完成，提示词的价值回到「可移交的上下文」。

## 直接后果

- `card.jsx` 从 297 行降到约 170 行，且不再自带样式体系；`theme.js` 成为全插件唯一的半径/阴影/遮罩来源。
- 插件自有的字面量圆角与硬编码色值清零（唯一保留是 `pillBase` 的 `999`，属整圆）。产物 132.3 → **127.5 KB**。
- 配置页交互与官方一致（无放弃控件、无未保存标记、离开页面丢弃暂存）。
- 新增机械闸门 7 项（`test/page-specs.test.mjs`），其中最关键的一条是**「配置页声明的字段必须在 loader 真读的那份 `Config.dict` 里」**——把「规格与 schema 漂移」从静默故障变成会红的断言。

## 重访条件

- 官方为布尔字段补 spec 助手 → `piSpec` 与自绘复选框可撤，直接换官方字段控件。
- 官方在 `SettingsForm` 里给「操作级失败」或「拒绝原因」一个呈现位 → 第 7 条的本地提示词可简化/撤除（与 DSR-024 的重访条件同源）。
- 官方公开半径/阴影 token 的**枚举表**（现只有 CSS 变量）→ `R`/`SHADOW` 可改成从平台读取而不是本插件抄一份。

## 尚未验证（如实登记）

- **实例级页面走查未做**：未起实例、未在浏览器里看过。因此以下属**读源码 + 单测推断**：官方 `SettingsForm`/`SettingsValueField` 在本插件双字段布局下的实际观感（尤其「选择…」按钮与官方字段并排时的垂直对齐——`SettingsValueField` 自带 label/input/hint 三层，按钮挂在 `alignItems: 'center'` 的 flex 行里，落点未实测）；`settingsTextField` 语义下「清空目录 = 卸载该字段」在真页面上的用户可感知性；官方表单在 Plugins 页 `view: 'page'` 容器内的内边距是否与相邻官方页一致。
- **规格与官方模型的联调只在结构层面钉住**：`test/page-specs.test.mjs` 只断言规格对象满足 `SettingsFieldSpec` 的形状（避免为一个测试把官方客户端包拉进 devDependencies），**未**真的跑 `SettingsFormModel` 的 `plan()`/`save()`。⇒「一次原子 mutate 同时写入两个字段」这条结论来自读 `form-model.ts:300-320`（`ops` 由 `plan()` 一次性收集、单次 `scope.mutate(ops, revision)`），未在运行中观察。
