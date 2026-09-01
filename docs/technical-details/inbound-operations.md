# 入站操作

## 权威范围

本文唯一拥有库内容的扫描、搜索、仓库探测、入库、检查、更新、本地导入、出库、备份恢复的操作语义、失败模式和后置条件，以及禁用/启用的行为语义。目录语义、settings 意图形状与状态域形状归 `storage-model.md`，挂载对账归 `mount-sync.md`，RPC 传输与调度归 `plugin-runtime.md`。以下操作均要求本地 skills 目录已配置；未配置时由传输层统一返回 `skilldir-unconfigured`（见 `plugin-runtime.md`），本文不重复该门禁。

## 结论先行

- 文件/网络类库操作经 RPC 方法执行；**配置类操作（禁用/启用、换组、建组/改名/删组、挂载开关）不经 RPC**，由浏览器端直写 settings 命名空间、Host 对账器监听配置变更后台收敛（DSR-011）。
- 本地 skill（`self`/`local`）无版本管理：不登记 `self`、不建内容基线；目录删除即从列表消失。

## 操作总览

| 操作 | 输入 | 主要结果 | 是否触发对账 |
|---|---|---|---|
| `overview` | 无 | 库列表、健康、工作区投影（聚合只读视图） | 否 |
| `warm` | 无 | 预热扫描与健康缓存 | 否 |
| `search` | 关键词、limit、offset | skills.sh 结果 | 否 |
| `repo-skills` | 仓库、分支 | 仓内候选列表 | 否 |
| `add` | 仓库、子目录或候选、分支、改名 | 入库结果 | 是 |
| `check` | 无或名称列表 | 三态检查，结果写 `check_cache` | 否 |
| `update` | 名称列表、本地修改确认标志 | 逐条更新结果 | 是，发生更新后 |
| `import` | 本地路径、改名 | 导入结果 | 是 |
| `backups` | 无 | 备份列表 | 否 |
| `restore` | 备份 id | 恢复结果 | 是 |
| `remove` | 名称、是否保留文件 | 出库结果 | 否，摘除已同步记录 |
| `sync` | 物化方法 | 对账结果 | 自身即对账 |
| `health` | 无 | 健康问题列表 | 否 |
| `project-skills` | 可选 workspaceId | 项目条目分类 | 否 |
| `claim-empty` | workspaceId、名称 | 空目录接管 | 是 |

## 库扫描

- 扫描配置目录的直接子目录（跳过 `.` 开头者），含 `SKILL.md` 者解析 frontmatter，合入 `skills` 表的入库元数据。
- 来源判定取 `skills.origin`：`github / local / self`；目录存在而表中无记录者视为 `self`（自研/本地文件），**不登记** storage——本地 skill 无版本管理。
- 表中 `origin: "github"` 但目录缺失的条目补入列表，标记 `missing=true`，作为恢复入口；`local` 记录目录缺失时不补入（无上游可恢复，目录删除即从列表消失）。
- 列表项包含：名称、目录名、描述、来源、是否有 SKILL.md、上游记录（repo/branch/commit）、缺失状态；意图字段（`disabled`/`group`）与挂载目标由 API 层叠加配置后下发。
- 扫描只读目录，不写 `skills` 表（无登记、无基线回填）。

## 搜索与仓库探测

- `search` 调用 skills.sh 搜索接口（`https://skills.sh/api/search`，参数 `q/limit/offset`），超时 15 秒；过滤 `source` 两段均不含点的 GitHub 来源；返回 `query/count/skills`（`skills` 含名称、仓库、目录、热度、链接）。
- `repo-skills` 先解析分支（指定值 → `main` → `master` 回退），再优先请求 GitHub Trees API 递归树；`truncated` 或 API 失败时下载 zipball 在临时目录探测。
- 候选定义：目录含 `SKILL.md` 即候选，仓库根含 `SKILL.md` 时 `path` 为空串。
- 返回 `via` 为 `api` 或 `zipball`，便于排障；同时返回解析到的 `branch` 与 `commit`。
- 网络错误分类：`not_found`、`rate_limited`、`unreachable`、`http_error`。

## add

主路径：

1. 规范化仓库 slug，解析分支 commit，下载 zipball 到内存并按候选目录物化到临时目录。
2. 定位 skill 目录：有 `dir` 先精确匹配；未命中时回退自动探测（skills.sh 的目录名不是路径）；无 `dir` 时仓库根优先，否则取最浅候选；多于一个最浅候选返回候选清单而不是报错。
3. 确定安装名：显式改名优先；skill 位于仓库根时取 SKILL.md 的 `name`；否则取目录名。
4. 校验安装名、冲突与可写性；冲突规则按需求 R-09。
5. 复制目录到 `<配置目录>/<安装名>`（忽略 `.git` 与 `__pycache__`），写 `skills` 记录（`origin: "github"`、`repo/branch/commit/path_in_repo/installed_at/content_hash`）。
6. 触发对账，使新 skill 按所属组挂载（组归属取 settings 意图，默认 `默认` 组）。

失败语义：

| 失败 | `code` | 处置 |
|---|---|---|
| 仓库格式非法 | `bad-repo` | 终止 |
| 分支不可达 | `remote-unreachable` | 终止，提示已尝试 `branch/main/master` |
| 仓库无 SKILL.md | `no-skill-md` | 终止 |
| 多候选未选择 | `needs-selection` | 返回候选，等待选择 |
| 同名同仓库 | `already-installed` | 提示改用 update |
| 同名异源或撞本地目录 | `name-conflict` | 提示先出库 |
| 下载失败 | `download-failed` / 网络分类 | 临时目录自动清理 |

zipball 解包有防逃逸校验：拒绝绝对路径、盘符前缀与 `..` / `.` 段（`bad-zipball`）。

## check

- 逐条比较 `skills.commit` 与上游最新 commit；网络状态把条目归为 `updatable / up_to_date / check_failed` 三态；无记录或无上游的条目为 `skipped` 并附原因。
- 同时计算目录是否存在、`content_hash` 是否与基线一致；没有内容基线时返回 `baseline_missing=true`，不把当前目录静默写成新基线。
- 上游探测主路径 GitHub API，失败回退 `git ls-remote`；返回 `via`。
- 目录缺失时仍可判定上游状态，并标记 `missing=true`。
- 检查过程不改 `skills` 表。
- 目标集：`names` 指定或全部 `skills` 表记录；**禁用不影响目标集**（`disabled` 只是挂载意图，DSR-011）。
- 批量并行（DSR-008）：同 repo 同分支只探测一次上游并广播给各成员，所有目标并发；单条网络异常只降级为该条 `check_failed`，不拖垮整批。
- 结果缓存（DSR-008）：`origin: "github"` 的条目合并写入 `check_cache` 表并刷新 `checked_at`；无上游的 `skipped` 条目不入缓存。

## update

- 对每个名称：表中无记录、`origin` 非 `github`、上游不可达、已有目录且 commit 相同，分别跳过并给原因；目录缺失时即使 commit 相同也执行恢复（拉回）。
- 覆盖门禁（Host 强制）：任何待更新目录与 `content_hash` 基线不同（或无可用基线）且调用方未携带 `confirmLocalChanges: true` 时，整批拒绝并返回 `local-changes-confirmation-required`，不下载不覆盖；本地修改判定强制 fresh 重算目录哈希，不信任缓存。Client 的遮罩确认对话框只是该边界的交互入口，直接 API 调用不能绕过。
- 更新定位：`path_in_repo` 有值时精确匹配，且为 strict 模式——上游路径失效时返回 `path-stale` 并在消息中列出仓内现有候选；无记录时走自动探测。
- 覆盖语义：删除旧目录后整体重放新版；成功后更新 `skills` 记录的 `commit/installed_at/content_hash`，并在有变更时触发对账，使 copy 物化目标同步刷新。
- 批量更新中单条失败不中断其余条目，结果数组按名称原序返回。
- 成功（或确认已是最新）的条目把检查缓存翻转为 `up_to_date`（DSR-008），行徽章无需等下一次全局检查。

## import

- 输入为目录或 `.zip` 文件；路径先展开 `%VAR%` 形式的环境变量。
- 目录要求根下有 `SKILL.md`；zip 解压后走与 add 相同的定位逻辑（多候选同样报 `needs-selection`）。
- 安装名与 add 相同规则校验（显式改名优先，否则取目录名）；目标已存在则拒绝并提示改名。
- 复制时忽略 `.git` 与 `__pycache__`。
- `skills` 记录写 `origin: "local"`、`repo: null`、`origin_path`、`installed_at`；**不写 `content_hash`**（本地 skill 无版本管理），然后触发对账。

## remove

执行顺序不可交换：

1. 确认 `<配置目录>/<name>` 存在。
2. 如不保留文件，备份整目录到 `$DSH_HOME/skill-manager/backups/<name>-<时间戳紧凑串>/`，内写 `_backup_meta.json`（名称、`skills` 记录快照、时间），并在 `backups` 表登记。
3. 摘除 `synced` 表中该 name 的全部物化记录；只删链接或本插件 copy，真实目录保持不动。
4. 删除 `<配置目录>/<name>`。
5. 删除 `skills` 表记录。
6. 删除 `check_cache` 表中该 skill 的缓存条目（DSR-008）。

- `keep_files` 等价语义：跳过步骤 2，其余相同；此时 `backup` 为 `null`。
- **出库不触碰 settings 意图**（`skills` 段的 `disabled`/`group` 条目原样保留）；同名 skill 日后再入库或恢复时自然落回原组。
- 任一步骤失败时，已完成的删除步骤不回滚；错误对象携带已完成动作，供 UI 展示。

## backups 列表

- 返回备份目录实际内容与 `backups` 表登记的并集：以备份目录直接子目录为准，逐个读取 `_backup_meta.json` 补充名称与时间；无元数据的备份仍展示（`has_meta=false`）。

## restore

- 备份 id 必须是不含路径分隔符的普通目录名、在 `backups` 表中有登记，且对应目录在 `$DSH_HOME/skill-manager/backups/` 下实际存在。
- 目标 `<配置目录>/<name>` 存在时拒绝（`name-conflict`）。
- 复制备份内容到配置目录，剥除其中的 `_backup_meta.json`；按 `_backup_meta.json` 的 `skills` 记录快照恢复登记，**剥除旧记录的 `disabled`/`group` 意图字段**（组归属以 settings 中残留的意图为准）；`content_hash` 缺失时以恢复结果重算基线。
- 无元数据或无记录的备份 = 本地文件恢复，不写 `skills` 登记（本地 skill 无版本管理）；`origin: "self"` 的旧快照同样不登记。
- 触发对账；失败时目标目录必须清理，避免半恢复。

## disable 与 enable（配置语义）

禁用/启用不是 RPC 端点，而是 settings 意图写（DSR-011）：

1. 禁用：Client 把 `skills` 段的 `<目录名>` 意图置 `disabled: true`（字段级原子写，本地即时生效）。
2. Host 对账器监听配置变更，200ms 防抖后执行对账：禁用条目退出挂载期望集，其全部物化被摘除；目录原地不动。
3. 启用：`disabled` 置回 `false`，对账按所属组重新物化。

- 禁用条目在库列表中标记「已禁用」；`check`/`update` 的默认目标集不受禁用影响（版本管理与挂载意图分离）。
- 删除配置目录中已被禁用的目录后，该条目从列表消失（本地目录无版本管理）；github 条目目录缺失时仍保留 `missing` 恢复入口。

## skill 生命周期状态

| 状态 | 目录 | `skills` 表 | settings 意图 | DSH 根 | 可见性 |
|---|---|---|---|---|---|
| 可用 | 存在 | github/local 有记录；self 无记录 | 可有可无 | 按组挂载 | 列表与 DSH |
| 缺失 | 无 | github 有记录 | 保留 | 无期望链接 | 列表标记 missing |
| 禁用 | 存在 | 有记录或无记录（self） | `disabled: true` | 无 | 列表标记 disabled |
| 已出库 | 无 | 无 | 保留（不自动清除） | 无 | 仅在备份列表 |
