# DSR-006：DSH 工作区作为项目配置唯一来源

> 状态：部分被取代（2026-09-01，DSR-017）。「DSH 工作区注册表是活动项目唯一事实源、插件不提供项目写操作」保留有效；`state.projects` 兼容镜像与旧键归一因 CLI 互通成为非目标而撤销，工作区信息改为现算。保留为历史记录。

## 上下文

原方案把项目名称与路径手工写入车间 `distributor/state.json`。这与 DSH 已持久化的工作区注册表重复：DSH 工作区已有稳定 `workspaceId`、规范化目录路径和可改显示名称。两套登记会产生路径漂移、重名和手工维护成本，也使“项目级 Skill 配置”与实际 DSH 项目脱节。

已核实的 DSH 事实：Host 的 `workspaceRegistry` 可按持久顺序列出工作区；每项暴露稳定 `id`、规范化 `path` 和可改 `title`。浏览器端 `ctx.workspaces.list` 只是该 Host 注册表的观察投影，不能成为挂载安全判断的唯一来源。

## 真实方向与评价

- 方向 A：自动镜像 DSH 工作区。以 `workspaceId` 为稳定项目键，Host 在项目级读写前从 `workspaceRegistry` 获取当前列表，并把键到规范化路径的映射同步进既有 `state.projects` 形状。取消手工注册界面，同时保持 distributor CLI 可解析项目路径。用户已确认采用。
- 方向 B：完全运行时派生。不写 `state.projects`，挂载直接引用工作区 id。来源最纯粹，但 distributor CLI 独立运行时无法解析项目级目标。
- 方向 C：保留手工项目登记。工作区自动出现，但手工项目仍是并列来源。迁移风险较低，却不能满足项目唯一来源的目标。

## 最终决定

采用方向 A。

1. DSH `workspaceRegistry` 是活动项目的唯一事实源；项目键为不可变的 `workspaceId`，显示名称只取当前 `title`，绝不以名称作为持久键。
2. `state.projects` 保留为 CLI 兼容镜像：活动项的键为 `workspaceId`、值为规范化绝对路径。`mounts[].project` 与 `synced[].project` 同样保存 `workspaceId`。
3. 插件不再提供项目注册、改名、改路径或删除的写操作；这些生命周期由 DSH 工作区界面负责。技能页只配置“某个分组是否挂载到某个工作区”。
4. 首次迁移时，旧项目键若其路径匹配当前工作区，则原子地把 `projects`、`mounts` 和 `synced` 的引用改为对应 `workspaceId`。不匹配任何工作区的旧记录保留为只读遗留项：不参与新挂载或新物化，也不自动摘除既有链接。它们必须在界面明确标注，并只可经显式迁移清理动作解除。

## 直接后果

- Host 需要 `workspaceRegistry` 依赖，并由 Host 而不是浏览器完成工作区解析、路径校验和镜像刷新。
- API 中移除可写 `skill-manager/projects`，替换为只读的工作区项目投影；`mounts`、`project-skills` 与 `claim-empty` 以 `workspaceId` 为项目参数。
- 同步视图不再有“项目注册表”或新增、改名、改路径、删除按钮；它列出来自 DSH 工作区的项目与只读遗留项。
- 共享 JSON 未新增 CLI 无法解析的必填字段，项目值仍是绝对路径；CLI 可继续读取自动镜像的活动项目。

## 重访条件

- DSH 不再向 Host 暴露稳定 `workspaceId`、规范化路径或工作区注册表。
- distributor CLI 支持直接读取 DSH 工作区注册表，从而无需 `state.projects` 兼容镜像。
- 用户明确要求把不匹配工作区的遗留项目自动创建为 DSH 工作区，或自动解除其挂载。
