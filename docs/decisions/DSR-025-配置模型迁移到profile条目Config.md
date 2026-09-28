# DSR-025：配置模型迁移到「profile 条目 Config + volatile」——配置页随 `settings.plugin.item` 废除迁往 Plugins 页

> 状态：**已落地，静态闸全绿**（2026-09-28）。`npm run check` 退出 0（client 产物新鲜度 + `src` 全量语法 + 分层门禁 21 个 core 文件 + `node --test` **150/150**）。本次为**基线换代适配**：目标基线 DSH `0.1.7-rc.2`（源码 tag `dsh-v0.1.7-rc.2` / `477b4f42`，现场 `dshl env` 现查）。
> ⚠ **实例级实测（test profile 启动冒烟 + 页面走查）尚未做**——见文末「尚未验证」。

## 上下文

知识库由 `v0.1.2-rc.1` 升到 active `v0.1.7-rc.2` 后，本插件的配置面**整体**落在被删除的符号集上。源码零命中取证（`git grep` 于 tag `dsh-v0.1.7-rc.2` 的 `packages/`，非文档转述）：

| 旧符号 | 新树命中 | 后果 |
|---|---|---|
| `ctx.settings.register(ns, schema, {validate})` | 0 | Host `apply` 抛 `TypeError: ctx.settings.register is not a function` ⇒ 行 FAILED |
| `SettingsScope` / `settingsScope` / `installSection` / `describeForWire` | 0 | 编译期/运行期符号归零 |
| `settings/updated` | 0 | 监听永不触发 |
| 槽位 `settings.plugin.item` | 仅 1 处**注释** | client 半区**加载即抛错**：`slot "…" is not declared` |

⇒ 迁移前本插件在新基线上是「Host 半区 `apply` 抛错 + Client 半区加载即抛错」，即**整插件不可用**，而非局部退化。

同时两条静默面必须一起处理（都不报错，只表现为行为消失）：

1. **`.volatile()` 的来源**：新配置模型要求即时字段在 `Config` 里标 `.volatile()`，而该方法是 `@deepseek-ai/schemastery` 3.18.4 的扩展；`schemastery`（裸名）3.18.2 及更早**没有它**（实测 0 命中）。而模块解析规则是「一般模块导入**先按 importer 的 Node 搜索路径取物理候选，未命中才进 runtime interception**」——本插件 `dependencies` 里那份物理副本 `schemastery@3.18.0` 会把解析钉死在旧版上，`.volatile()` 在 import 期抛 `TypeError`。
2. **图标体系整体换代**：旧 75 个带尺寸后缀的导出全灭（新 190 个，size-neutral 命名）。本插件两处受影响，且**都不编译报错**——`nav-icon.js` 手抄的宿主几何换代失真（显示一枚与外壳不同代的图标），`ui.jsx` 用动态属性取 `IconChevronDownOutline14` 拿到 `undefined` 后静默降级成文本箭头。

## 真实方向与评价

- **A（保留旧写法，等平台兼容层）**：不存在。旧符号是**删除**而非改签名，上游未提供兼容包。
- **B（只把配置页从设置页搬走，Host 继续用旧 settings 面）**：不可行——`settings.register` 已不存在，Host 配置读面没有旧路径可留。
- **C（按新模型迁移，配置页挂 Plugins 页 `plugins.row.config`）**：唯一可行方向。本仓库 `dsh-guardrails` v1.6.0 已完成同一次迁移并在 test 实例通过门禁，是可直接对照的**已验证先例**（同为自绘卡片、同属「本行配置」语义）。
- **D（降级为「无配置页，只认 profile patch 手改」）**：技术上能加载，但把「配置即意图」这一核心模型砍掉，且用户必须手改 YAML——与本插件 R-22 的验收面直接冲突。

## 最终决定（C）

1. **Host 配置边界重写**（`src/adapter/settings.js`）：
   - `export const Config = configSchema(z)`，五个字段**全部** `.volatile()`；`apply(ctx, config)` 在操作时经 `readConfig()` 现读 `ref.get()` 解包。
   - `Config` **必须挂在 default 导出对象上**（`export default { name, inject, Config, apply }`）：loader 读 `plugin.Config`，而它取插件模块走 `unwrapExports` 的 `exports.default ?? exports`——对象式形态下具名 `export const Config` 到不了那里，丢了它本行会**静默失去 schema**。
   - schemastery 实例由 adapter **注入** core（`configSchema(z)`），因为 `.volatile()` 只存在于 `@deepseek-ai/schemastery`，而分层门禁 R1 禁止 core import `@deepseek-ai/*`。与 `core/model/store.js` 既有的 `buildSkillManagerSpec({defineDomain, domainTable})` 同一 DI 形态。
   - 只读门面 `configReader(config)` 保留 `{ get() }` 形状，于是 `core/service.js`/`requireDir`/`piState` 的接缝**一行未改**。
2. **包元数据重排**：`@deepseek-ai/schemastery` 由 `dependencies` 上移到 `peerDependencies` + 同版本 `devDependencies`（`^3.18.4`），`@deepseek-ai/dsh-storage-domain` 由 `*` 抬到 `^0.1.7-rc.2`。前者让解析落到平台那份带 `.volatile()` 的副本；后者使**版本门禁**生效（peer 不满足运行中版本 ⇒ 整行 `disabled: true`，实例照常启动只在 stderr 留一行）。
3. **对账触发面换代**：`scope.watch(...)` → `ctx.on('loader/volatile-update', ...)`（loader 把 volatile 值提交进运行中 fiber 后**只派发给所属 fiber**，正是「本行配置变了」）。防抖 200ms 与 WRITE FIFO 归队语义不变（DSR-021）。
4. **迁移时序收紧**：旧 storage 意图迁移改为**等本 fiber 结算后**再发起。原因是写面 `ctx.settings.update` 要求该 ns 已出现在 `describe()` 结果里，而 `describe()` 只收 `FiberState.ACTIVE` 的行——在 `apply` 内直接写会撞 `Plugin entry "…" is no longer configurable`。该时序已由单测钉住（fiber 闸未放行前不得开任何域）。
5. **跨字段校验换挂点**：`.check()` 在本基线**不存在**（仅上游文档提到，源码零命中）。改为两处：`apply` 内对**已解析**配置校验（非法即行挂载失败，响亮）；`ctx.on('internal/config')` waterfall 拦设置页写入的候选（`config-editor` 在落盘前走这条瀑布，抛错 ⇒ 写被拒且不落盘）。waterfall 拿到的是**原始** config（`!!js` 尚未求值），故对表达式占位对象一律跳过（`isOpaque`）——旧代 `validate` 作用在已解析值上，这是本次引入的差异。
6. **Client 接线换代**：`ctx.settingsScope.bind({namespace})` → `ctx.configForms.get('skill-manager')`。**`ConfigForm` 与旧 `SettingsScope` 逐方法对应**（`getSnapshot`/`subscribe`/`set`/`unset`），故技能页与配置页的读写代码原样沿用；`inject` 去掉 `settingsScope`、补 `configForms`。配置页注册改为 `configForms.whileServed(['skill-manager'], () => slots.inject('plugins.row.config', () => slots.register({ name: 'plugins.row.config', key: 'dsh-skill-manager#skill-manager', … })))`；组件按 `view` 分发（`summary` = 一句话回落，`page` = 表单主体），外壳由旧列表槽的 `<li>` 改 `<div>`（页面把它渲染在自己的 `<section>` 里）。
7. **图标同步换代**：`IconChevronDownOutline14` → `IconChevronDownOutlineRegular`（决策笔记 `.agents/notes/implemented/architecture/2026-09-16-size-neutral-product-icon-weights.md` 把 Medium 留给「刻意的强调」，卡片折叠箭头属其余消费方）；`nav-icon.js` 手抄几何换成现行 `IconSkillOutlineArtwork`（17×17 描边 + 1.3px，导航图标属 Medium 既定用途）。
8. **页面策略显式关闭自动表单**：`ctx.settings.configure({ auto: false }, ctx.fiber)`——本插件自绘配置页，避免将来客户端按 schema 自动出第二份重复表单。

## 直接后果

- **升级顺序成为硬约束**：本版**不得**挂到 `0.1.7-rc.2` 以下运行时。已挂 web 的旧版本（`github:FengZhiHen1/dsh-skill-manager`，stable-dev 运行时仍 `0.1.2-rc.1`）**在用户升级该实例之前不要更新**——更新会因 peer 门禁把整行置 `disabled`，插件直接消失。正确顺序：**先把实例升到 `0.1.7-rc.2`，再挂载/更新本插件**。
- 配置真相从 `$DSH_HOME/settings.yaml` 的 `skill-manager` 段变成 profile `cordis.patch.yml` 的 `skill-manager` 行 `config`。settings.yaml 在新基线只作一次性导入源（导入后改名 `.imported`）。
- 命名空间仍是 `skill-manager`（= 行 id，**不是包名**）；运行期 Loader entry id 是 `include:skill-manager`。改 patch 行 id 而不改 `CONFIG_NS` 会让配置页与命名空间**静默解绑**——已由 `test/index.test.mjs` 直接读 `cordis.patch.yml` 钉住两者一致。
- 「写后裁定以 Host 权威值为准」（DSR-024）在本代**更有必要**：`internal/config` 拒绝的候选由 loader 记 warn 并保留原引用，而 profile patch 此时已落盘 —— 正是「持久层已写、运行期未生效」，只有权威读能抓到。
- 新增/改写回归闸：`Config` 全量 volatile 与摆放合法性（真的调用一次 schema，因为违规在解析期抛）、`readConfig` 对普通值与非法输入的行为、`validateConfigIntent` 的 `!!js` 容忍、adapter 的 `fiber 结算 → 迁移 → openStore` 时序、`internal/config` 三态（本 fiber 非法抛 / 合法放行 / 他 fiber 不拦）、`apply` 挂载期校验、`Config` 必须挂在 default 对象上、行 id 与 `CONFIG_NS` 一致。

## 重访条件

- 上游为 volatile 摆放或跨字段校验提供更直接的声明面（如 `Config` 级 schema 约束） → `internal/config` 挂点与 `isOpaque` 容忍可撤。
- 上游若恢复「插件自选命名空间」或提供 `Config` 的具名导出读取路径 → 第 1 条的「Config 必须挂 default 对象」约束可放宽。
- 平台为配置写入提供带原因的合成回执（含 validate 结果）→ 与 DSR-024 同款条件，`readConfigField` 退役。

## 尚未验证（如实登记）

- **实例级实测未做**：本轮只跑静态闸（单测 + 分层 + 语法 + 产物新鲜度）。**未**起实例、**未**做页面走查——按 AGENTS.md 红线，实例启停只能由用户在启动器侧执行。
- 因此以下均属**读源码/单测推断**，未经真实启动观察：`Config` 在本插件上的 `.volatile()` 与 `union`/`dict`/`.default()` 组合能否通过 loader 的 Standard-Schema 校验（本地探针已在**真实 3.18.4** 上跑通解析与解包，但未经过 loader）；peer 门禁 `disabling profile plugin …` 的实机文案；`plugins.row.config` 在真页面上被渲染（key 拼写、`view` 分发、`whileServed` 撤下）。
- `Config.toJSON()` 在本基线返回 `{uid, refs}` 形状（本地探针观测），与旧代「`{type, dict, meta}` 可自省」不同；settings 面按 `'toJSON' in schema` 认它并自行处理，本插件不解析该结构。若将来需要自省 volatile 标记，须另找判据。
