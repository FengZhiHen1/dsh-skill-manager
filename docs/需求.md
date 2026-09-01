# dsh-skill-manager 需求

## 权威范围

本文唯一拥有 `dsh-skill-manager` 的目标、用户、场景、功能范围、需求约束、非目标与验收语义。技术机制归 `technical-details/`，选型理由归 `decisions/`。本文不指定实现模块、语言或目录。

## 结论先行

- 目标：让 DSH Web 设置页成为本地 skills 目录（纯 skill 保存目录）的管理入口。
- 已确认结论：设计基线已经用户确认；真实插件包形态；目录由设置中的插件配置选项「本地 skill 目录」提供，默认为空即未配置（DSR-005）；只管理 dsh 挂载；功能覆盖管理、搜索下载、本地导入与同步；DSH 工作区是项目配置唯一来源（DSR-006）；项目级既有 skill 采用最小接管策略；目录为纯 skill 平铺目录、distributor CLI 兼容放弃（DSR-010）；用户意图（分组、挂载、禁用、目录配置）的唯一事实源为 settings 命名空间，storage 域降级为运行时投影（DSR-011）；部署走 bundle 通道：test 直挂、web 经 `github:` 依赖（DSR-012）。
- 待验证结论：`missing evidence` 中列出的实测验证项。
- 下一重点：先读范围与约束，再读验收条件。

## 背景与问题

用户在本机维护一个本地 skills 目录（skill 平铺、各含 `SKILL.md`）。DSH 自身会从 `~/.dsh/skills` 与项目 `.dsh/skills` 发现 skill，但没有管理这些目录的界面：入库、分组、挂载与更新都要手工搬目录、建链接。

本插件要补上 DSH 设置页管理面：目录即库，挂载目标就是 DSH 自己的 skill 根，不需要改动 DSH 组合配置来发现 skill。早期版本曾与 distributor CLI 车间共存；DSR-010 起目录语义纯化，CLI 兼容与 git 提交历史放弃；DSR-011 起管理意图迁入 settings 命名空间，storage 域只保留运行时投影。

## 用户与场景

- 主要用户：本机 DSH Web GUI 用户。
- 管理场景：在设置页查看库内 skill，建组、换组、配置全局与项目挂载，删除前备份。
- 获取场景：搜索 skills.sh 或输入 owner/repo，选择候选 skill 入库并自动按默认组上架。
- 维护场景：检查第三方 skill 上游更新，确认本地修改，执行更新或恢复缺失目录。
- 同步场景：查看 skill 与目标矩阵，一键修复缺失、指向错误与孤儿链接。
- 本地场景：把本地目录或 zip 中的 skill 导入库中。

## 范围与功能需求

- R-01 插件形态：以真实插件包交付，Host 进程持久挂载，跨会话与重启存在；Host 半提供持久服务，Client 半提供设置页。验收：重启 DSH 后设置页与既有配置仍在。
- R-02 事实源：库内容的唯一事实源是配置目录本身（直接子目录含 `SKILL.md` 即 DSH 可见成员）；用户意图（目录路径、分组与挂载规则、禁用与组归属）的唯一事实源是 settings 命名空间 `skill-manager`；运行时投影（入库元数据、物化记录、工作区镜像、检查缓存、备份登记）的唯一事实源是 DSH storage 域 `skill_manager`。验收：目录扫描结果与库列表一致；重启后分组、挂载与禁用保持（settings.yaml 与 storage 域均为持久介质）。
- R-03 分组模型：单组归属，无组 skill 归虚拟组 `默认`；挂载只定义在组上。验收：换组后该 skill 的生效位置立即按新组挂载计算。
- R-04 App 边界：插件只维护 `app=dsh` 的挂载与物化记录；不向其他 App 的根写任何内容。验收：执行一次同步后，dsh 根之外的目录不受影响。
- R-05 库视图：列出每个 skill 的名称、目录名、描述、来源 `self/github/local`、上游记录（repo/branch/commit）、所属组、生效位置、缺失或禁用状态；上游检查状态读缓存直显并标注检查时间，页面打开不发网络请求。验收：列表与配置目录内容一致。
- R-06 分组管理：支持创建、重命名、删除分组与行内换组；删除分组时成员回落 `默认` 组。验收：操作后分组快照与库列表分组归属一致。
- R-07 搜索：调用 skills.sh 搜索接口，过滤非 GitHub 来源，展示名称、仓库、目录、热度。验收：输入关键词得到结构化结果；失败时给出可读错误，不阻塞其他视图。
- R-08 入库：支持从搜索结果选择候选，或输入 owner/repo 直接入库；GitHub Trees API 探测多 skill 仓库，失败回退 zipball 探测；分支按指定值 → `main` → `master` 回退。验收：单 skill 仓库一次入库；多 skill 仓库先返回候选列表，选择后入库。
- R-09 冲突规则：同名已存在且记录同仓库时拒绝 add 并提示改用 update；同名存在且不同来源时拒绝并提示先出库。验收：两种冲突都不覆盖现有目录。
- R-10 检查与更新：第三方 skill 检查为 `updatable / up_to_date / check_failed` 三态；同时报告本地内容是否相对 `content_hash` 基线修改、目录是否缺失；更新按记录的 `path_in_repo` 定位，路径失效时报候选；目录缺失时即使上游 commit 未变也要拉回。若目标存在本地修改（或缺少内容基线），Host 必须拒绝未携带显式确认的覆盖更新，Client 显示带遮罩的确认对话框后才以确认标志重试。验收：三态检查、目录缺失与本地修改均有可复现用例。
- R-11 本地导入：导入目录或 `.zip`，定位 SKILL.md，允许改名，写入本地来源记录；本地 skill 无版本管理，不建内容基线。验收：导入后列表可见，DSH 名字文法校验生效。
- R-12 出库与恢复：删除前把 skill 备份到 `$DSH_HOME/skill-manager/backups/` 并写 `_backup_meta.json` 与备份登记，摘除物化链接，删除 `skills` 记录；出库不清除 settings 意图；可从备份列表恢复，恢复按 `_backup_meta.json` 快照还原来源记录（github/local），组归属以 settings 中残留的意图为准。验收：出库后源目录、链接、记录全部消失，恢复后还原。
- R-13 禁用与启用：禁用/启用是 settings 意图写（`skills` 段的 `disabled` 标记）；Host 对账器监听配置变更后收敛——禁用摘除其全部物化，目录原地不动；启用后按所属组重新物化。禁用只影响挂载期望，不排除在 `check`/`update` 默认目标集之外。验收：禁用后 DSH 根无该 skill 且列表标记禁用；启用后与禁用前语义一致。
- R-14 同步矩阵与健康：按 skill × 目标展示全局 `~/.dsh/skills` 与当前 DSH 工作区项目的 `<工作区路径>/.dsh/skills` 期望状态；一键对账物化应有链接、摘除多余、修复指向错误、清理孤儿链接；健康报告覆盖 `missing-link`、`wrong-target`、`target-exists`、`project-missing`、`workspace-unmatched`、`extra-link`、`orphan-link`、`local-empty`、`local-skill`、`local-foreign`、`dsh-invisible-name` 十一类问题。验收：制造每类问题后 `sync` 全部修复（只读类与 `workspace-unmatched` 除外，见其语义）。
- R-15 工作区项目配置：项目目标直接从 DSH 工作区注册表获取，以稳定 `workspaceId` 作为挂载键、当前工作区路径作为目标路径；用户可在分组上配置全局或工作区挂载，但不得在技能页手工注册、改名、改路径或删除项目；`projects` 表自动镜像活动工作区（含按规范化路径归一旧键）。验收：新建、改名、删除 DSH 工作区后，技能页项目投影随之刷新；已引用的工作区删除后仅报可读问题且不自动删除真实目录。
- R-16 设置页：`settings.section` 注册 `id=skills`、`order=16`、中文标签 `技能`，提供管理、搜索、同步三视图；本地导入入口并入管理视图工具条；「本地 skill 目录」配置卡片注册在设置「插件」区（`settings.plugin.item`，key=`skill-manager`）。验收：页面出现且不挤占既有 `general/models/plugins/agent-presets/better-sidebar` 顺序。
- R-17 操作安全：文件/网络变更操作在插件内 FIFO 串行执行；读操作走冻结快照，写操作进行中时先等写屏障结算；配置写经 settings 字段级原子写承载；storage 状态写入经域写链持久化先行（backend 落盘成功才更新内存）。验收：两个插件标签页同时提交不会产生交错状态；域介质损坏时插件报错而非静默丢数据。
- R-19 错误协议：所有 RPC 返回统一 JSON 信封，失败含稳定 `code` 与可读 `message`；网络与文件系统错误不得使 Host 插件崩溃。验收：断网、仓库不存在、路径不可写时 UI 均显示对应错误。
- R-21 项目级既有条目：对当前 DSH 工作区中已存在的 `.dsh/skills` 条目按最小接管策略处理。指向配置目录正确位置的链接记录为已接管；指向错误的链接在用户执行对账时修复；空目录且无 SKILL.md 时仅经用户显式点击 `清理并接管` 后删除并建立正确链接；含 SKILL.md 的真实目录与无 SKILL.md 的非空目录永不自动修改；项目中存在而配置目录中不存在的 skill 按项目条目分类（`local-skill` 等）只读展示、永不纳管。验收：五类现场全部有可复现用例，且除用户显式动作外无任何删除或覆盖。
- R-20 卸载清理：插件行移除后，HTTP 路由、Client 槽位与所有进程内资源消失；配置目录内容、settings 配置、storage 域数据与已建链接不因卸载被删除。验收：从 Profile 移除插件后 DSH 可启动，已挂载 skill 仍留在 DSH 根。
- R-22 目录配置：本地 skills 目录由设置中插件配置选项「本地 skill 目录」提供（settings 命名空间 `skill-manager` 的 `skillsDir` 字段），默认为空即未配置；目录语义为纯 skill 平铺目录（直接子目录含 `SKILL.md` 即成员，无任何插件状态文件）；未配置时插件不访问任何目录，所有库 RPC 返回 `skilldir-unconfigured`，技能页显示未配置引导；配置值必须是绝对路径（保存期形式校验），目录存在性是运行期条件——目录缺失/不可访问时所有库 RPC 返回 `skilldir-missing`，插件保持存活、不阻塞启动（存在性不放进注册期 validate，否则目录被删后插件下次启动整体加载失败）；配置保存后立即生效（`applies: live`），无需重启。验收：未配置时无任何目录读写且各管理操作返回可读错误；配置指向目录后列表与同步可用；修改配置后立即按新目录工作；配置指向不存在目录时返回 `skilldir-missing` 且插件存活。

## 约束

- C-01 安装名必须匹配 DSH skill 名文法 `^[a-z0-9]+(?:-[a-z0-9]+)*$`；已存在但不匹配的名字只报告为 `DSH 不可见` 风险，不自动改名。
- C-02 挂载目标只允许 dsh 全局根 `~/.dsh/skills` 与当前 DSH 工作区 `<工作区路径>/.dsh/skills`；不写 claude、codex、pi、gemini 根。
- C-03 物化方式 junction 优先，copy 仅作回退；只允许删除本插件管理的链接与 copy 记录；除用户显式确认清理的空目录外，真实目录冲突必须拒绝覆盖。
- C-06 插件不得向会话注入模型可见工具、Prompt 或 Skill provider；本主题没有 Agent Plane 行。
- C-07 浏览器 Client 不持久化任何本地状态；库数据来自 Host RPC，配置来自 settings 域快照，刷新后重读。
- C-08 配置目录内不出现插件写入的状态文件或元数据目录；意图只写 settings 命名空间（`settings.yaml`），运行时投影只写 storage 域，备份只写 `$DSH_HOME/skill-manager/`。

## 非目标

- 不管理 claude 等既有 App 挂载。
- 不与 distributor CLI 互通，不维护其文件格式（DSR-010）。
- 不做旧车间布局的自动迁移；旧锁的上游基线由维护者一次性手工抢救（DSR-010）。
- 不为库目录维护 git 提交历史（DSR-010）。
- 不提供模型可调用的 skill 管理工具。
- 不实现多用户、远端权限或审计。
- 不发布到 npm，不为其他机器设计安装器。
- 不在 v1 引入 GitHub token、私有仓库认证或代理 UI。

## 验收条件

- AC-01 安装验证：Profile `--dump-config` 只出现一行 `skill-manager`，无重复 Service Provider，设置页出现且排序正确。
- AC-02 入库验证：从 GitHub 安装一个第三方 skill 后，`skills` 表出现对应记录，`~/.dsh/skills/<name>` 为 junction 并指向 `<配置目录>/<name>`。
- AC-03 DSH 发现验证：新建会话的 skill 目录包含该 skill；当前会话的发现时机记录实测结果，若当前会话不即时，文档标注为已知限制。
- AC-04 更新验证：用仓库旧 commit 记录发起 check，得到 `updatable`；更新后 `commit` 与 `content_hash` 变化。
- AC-05 本地修改验证：修改已记录 skill 文件后 check 报告 `locally_modified=true`；未带确认标志的 update 返回 `local-changes-confirmation-required` 且不写文件，UI 显示完整遮罩确认，确认后更新才可执行。
- AC-06 同步验证：在当前 DSH 工作区制造缺失、指向错误、多余、孤儿四类问题后 health 全部命中，sync 后全部为零；移除一个被引用的 DSH 工作区时，仅出现 `workspace-unmatched` 迁移问题，不自动删除该项目目录。
- AC-07 出库验证：删除 skill 后 `$DSH_HOME/skill-manager/backups/` 下备份目录与 `_backup_meta.json` 存在，源目录与 DSH 根链接消失；restore 后来源记录恢复，组归属按 settings 残留意图回落。
- AC-08 禁用验证：禁用后 `~/.dsh/skills/` 无该 skill 而库目录保留，启用后链接恢复，且禁用期间 check 不把该条目报告为缺失。
- AC-10 卸载验证：移除插件行后重启 DSH，HTTP 路由不存在，已物化链接仍存在，DSH 启动无报错。
- AC-11 基线保护：所有验收不得通过放松断言、跳过检查、篡改阈值或伪造通过证据达成；基线类指标只允许改进，不允许回退。
- AC-12 既有条目验证：创建一个临时 DSH 工作区，分别构造正确链接、指向错误链接、空目录、含 SKILL.md 的真实 skill 目录、无 SKILL.md 的非空目录五种现场；对账后正确链接被记录为 `ok`，错误链接待用户显式对账后修复，其余三类均不被修改；仅对空目录执行 `清理并接管` 后，空目录被替换为正确 junction；含 SKILL.md 的真实目录始终原样保留并显示遮蔽提示。
- AC-13 配置验证：未配置状态下 `overview/health/sync/search/repo-skills` 等各方法均返回 `skilldir-unconfigured`，技能页显示引导且不提供管理操作；配置一个临时空目录后库为空、分组与同步可用；将配置改为另一目录后立即按新目录工作，旧目录的挂载链接保留为孤儿且不被清理。

## missing evidence 与延期项

- `missing evidence`：skills.sh 匿名接口本机可用性；真实 GUI 中本地修改遮罩确认交互；工作区镜像迁移与项目级链接的 test-profile 集成冒烟；DSH 对 bundle 内 `dsh.client` 产物更新的客户端增量重建行为。
- 已实测：DSH skill 根 watcher 对 junction 写入与摘除即时反映（test profile 冒烟，2026-08-16：挂载后会话 skill 目录实时出现、摘除后实时消失）；AC-03 的当前会话发现时机即此结论。
- 延期：代理配置 UI、GitHub token、npm 发布、多用户支持；重访条件在对应决策记录中定义。
- 假设：本机部署后配置目录指向本机既有库（如 `E:\Project\Skills\skills`，由用户在设置中配置，默认未配置）；DSH 升级后重新核对 `settings.section`、`settings.plugin.item`、`dsh.client`、settings 域与 storage 域契约。
