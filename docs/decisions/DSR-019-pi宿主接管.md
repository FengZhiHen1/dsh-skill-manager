# DSR-019：pi 宿主接管——挂载规则加宿主维度

> 状态：已采用（2026-09-06，用户逐项裁定）。修订 DSR-017「只管理 DSH 自身的 skill 挂载」的边界：目标宿主由 dsh 单宿主扩为 dsh/pi 双宿主。

## 上下文

用户要求插件在管理 DSH 技能挂载之外，也能接管 pi agent（`@earendil-works/pi-coding-agent`）的技能配置，且只接管 skill 挂载。

已核实的 pi 事实（本机安装 `C:\nvm4w\nodejs\node_modules\@earendil-works\pi-coding-agent`，dist bundle 源码走查，2026-09-06）：

1. pi 默认扫描两个技能目录，无需任何配置：`~/.pi/agent/skills`（user 级）与项目 cwd 的 `.pi/skills`（project 级，`includeDefaults` 固定扫描）。
2. `settings.json` 的 `skills` 数组是额外的目录级来源（用户当时配的是 `~/.claude/skills`）。
3. 加载走常规目录遍历（`existsSync` + `readdir`），Windows junction 对其透明——与 DSH 侧 junction-only 物化同理。

插件既有模型（DSR-011 配置即意图 + DSR-017 junction-only 物化 + 归属判据对账）天然可承载第二个宿主：pi 的用户级/项目级 skills 目录只是新的挂载目标。

## 真实方向与评价

- 方向 A（junction 物化到 pi 默认扫描目录）：pi 作为新宿主进入挂载规则，期望集/物化/对账/走查全链路同构；pi 侧零配置（默认目录本就被扫描）；归属判据天然保护 pi 目录内用户自放内容。
- 方向 B（改写 pi `settings.json` 的 `skills` 数组）：目录级列表与分组语义粒度不符；插件写第三方工具配置文件 = 所有权冲突，违背 DSR-006「唯一事实源」精神；跨进程写冲突风险。

## 最终决定

采用方向 A（2026-09-06 用户裁定：只做 skill 挂载；项目级要做，按工作区行选择对哪个宿主开启，默认 DSH，可勾 pi，勾选后两侧同步）。

1. **宿主维度**：挂载规则扩展为 `{ scope, project, hosts }`，`hosts ⊆ {dsh, pi}`；缺省/存量无 `hosts` 键的规则回落 `['dsh']`（schema default 承载，零迁移）。空 hosts 是死规则，settings 写路径拦截，对账容忍跳过。
2. **目标映射**：`dsh` 侧不变（`$DSH_HOME/skills`、`<ws>/.dsh/skills`）；`pi` 侧全局 = `<piAgentDir>/skills`、项目级 = `<ws>/.pi/skills`。targetKey 变为 `host:scope|project`（如 `pi:project|<workspaceId>`）。
3. **pi 目录来源**：新配置项 `piAgentDir`——空串 = 自动探测 `<home>/.pi/agent`（存在即接管入口可用）；显式绝对路径 = 直通（物化按需创建）。探测不到即 pi 不可用：pi 目标不产期望、按组出「pi 不可用」警告、UI 不出 pi 入口，行为与单宿主逐字节一致。
4. **不碰 pi 的任何配置文件**：`settings.json`（含用户既有 `skills` 数组）归用户自管，两条来源在 pi 内自然合并。
5. **UI**：范围卡行保持主复选框（勾选 = 默认 DSH）；行勾选且 pi 可用时行尾出 `[DSH][pi]` 宿主 chips；关掉最后一个宿主等效取消整行挂载，走同一遮罩确认；确认计数跨双侧。
6. **Git exclude 托管块**：按期望集涉及的宿主集合写一行或两行（`/.dsh/skills/`、`/.pi/skills/`）。
7. **测试隔离**：`resolvePiAgentDir` 注入 home 参数；测试夹具把 `piAgentDir` 钉到临时桩路径，真实 `~/.pi/agent` 不被测试触碰。

## 直接后果

- core：`intent.js`（hosts/piAgentDir schema 与校验、`resolvePiAgentDir`）、`derive.js`（hosts 展开、targetDir 双宿主映射）、`inspect.js`/`materialize.js`/`reconcile.js`（piSkillsRoot 透传与扫描根）、`service.js`（每会话解析 pi 根、overview 暴露 `agents.pi`）、`backups.js`（出库摘除含 pi 根）。
- 契约：overview 载荷增 `agents.pi: { available, skillsRoot }`；`contract.js` 增 `parseTargetKey`（client 可复用的键格式只读镜像）。
- Client：范围卡宿主 chips、`card.jsx` 增 pi agent 目录字段、targetLabel 解析 host 前缀。
- adapter 零改动（`piAgentDir` 经 settings schema 自动生效）。

## 重访条件

- pi 改变技能发现机制（默认目录或 junction 跟随行为变化）。
- 用户要求接管 pi 的 packages/prompts 等非 skill 配置（超出本插件定位，应另立插件）。
- 需要 pi-only 之外更细的宿主策略（如按组默认宿主）。
