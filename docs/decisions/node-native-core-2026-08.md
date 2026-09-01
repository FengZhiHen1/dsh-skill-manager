# DSR-003：Node 原生重实现核心逻辑

## 上下文

车间已有 Python 标准库实现 `distributor/cli/distributor/core`。插件宿主是 Node 进程，存在复用与重写两条路线。

## 真实方向与评价

- 方向 A：Node 重写 library/net/fetch/sync/git 语义。部署零 Python 依赖，错误与 UI 同进程传递；代价是与 Python 实现存在语义漂移风险。
- 方向 B：Node 调用 distributor CLI 或本地 HTTP server。复用成熟实现；代价是运行依赖 Python 环境与 CLI 路径，结果要跨语言解析，且启动与错误处理复杂。
- 方向 C：把 Python 实现逐步废弃。超出 v1 范围。

## 最终决定

采用方向 A。以 `distributor/cli/distributor/core/` 为参考基线，Node 模块按既定的 `lib/` 模块边界重写（模块边界规范当时归 `project-structure.md`，该文档已随 DSH_Plugins 的 docs/design 体系拆除）；运行时不调用 Python。

## 直接后果

- 关键语义必须与参考实现逐项对齐：目录哈希、三态检查、zipball 定位、对账安全边界、备份元数据。
- 本仓库需要实现阶段补充对齐测试，覆盖 [inbound-operations.md](../technical-details/inbound-operations.md) 与 [mount-sync.md](../technical-details/mount-sync.md) 的失败表。
- Python 侧修复不会自动流入 Node 实现，需要人工同步。

## 重访条件

- 若对齐测试持续出现跨语言漂移，或 Python 实现新增 v1 必须支持的能力，重访方向 B。
- 若用户接受运行 Python server 作为常驻依赖，可将 Node 层降级为薄代理。
