# dsh-skill-manager 设计

## 主题目标

在 DSH Web 设置页提供技能管理页，本地 skills 目录由设置中插件配置选项「本地 skill 目录」提供（默认为空即未配置，见 DSR-005）：管理库、分组与 DSH 挂载，支持 skills.sh 搜索下载、GitHub zipball 入库、检查更新、备份恢复与禁用。目录为纯 skill 平铺目录（DSR-010）；用户意图（目录、分组、挂载、禁用）存于 settings 命名空间 `skill-manager`，运行时投影（入库元数据、检查缓存）存于 DSH storage 域 `skill_manager` 两表（DSR-011/017）。

## 当前状态

- 需求基线 v2（2026-09 重构）已确认：范围收敛为「集中目录 + 分组挂载分发 + 外部 skill 生命周期」；本地导入、同步矩阵与健康视图、工作区既有条目接管废止为非目标；新增修复提示词需求（R-17）与只读红线（C-03）、自动执行边界（C-04）。
- 新基线重设计已确认（2026-09-01，design-spec-workshop）：DSR-017（junction-only 物化 + 状态面五表→两表 + 出库限外部 skill + 原子换装，显式回退 DSR-004、部分取代 DSR-006、修订 DSR-015 模块清单）、DSR-018（修复提示词机制：Host 供 facts + Client 统一模板）。一次实施批次（DSR-014~018 + 包卫生）已于 2026-09-05 落地完成并通过 test 实例（0.1.2-rc.1）实测门禁。
- 文档-代码一致性：技术文档描述的就是源码现行形态（`src/core`+`src/adapter`+`src/client` 三层、`connection.rpc` 通道、esbuild 产物 client bundle、两表 + junction-only）；旧形态表述（扁平 `lib/`、自建路由、五表 copy 兜底、`/skill-manager/api` 信封）已随实施退役，如见残留属文档欠账，按「先修文档再修代码」处理。
- 单测基线：79 项（2026-09-05，`pnpm run check` = 产物新鲜度哨兵 + 语法 + 分层门禁 + node --test）；实测门禁捕获并修复两处真实缺陷（settings 校验器误拒「默认」组键致启动崩溃；zipball 主站 URL 直连不可达改 API 形态），详见 `TODO.md` 与提交历史。
- 部署（DSR-012）：test profile 经 `link:` 源码直挂（P9 实测完成，2026-09-05）；web profile 经 `github:FengZhiHen1/dsh-skill-manager` git 依赖挂载——本次实施批次推送后的 web 重挂为用户操作，待执行。
- 待验证项（GUI 浏览器走查）：设置页两视图/⋯ 菜单/挂载失败徽章展开/修复提示词一键复制/遮罩确认对话框渲染/产物改动免重启增量——Host 侧对应语义均已实测（见 `需求.md` missing evidence 节），余下为纯渲染面确认。
- 本插件不再维护独立设计稿（OpenPencil `.op` 已弃用删除，2026-09-04）：界面视觉与交互细节以设置页实际实现为准；`technical-details/插件运行时.md` 的视图节只承载交互语义与信息架构，不作为视觉规格。

## 阅读顺序

1. `需求.md`：先确认范围、约束与验收。
2. `technical-details/README.md`：按机制阅读顺序展开技术细节。
3. `decisions/`：需要了解决策理由时阅读。

## 文档地图

| 文档 | 唯一权威范围 |
|---|---|
| `需求.md` | 目标、范围、功能需求、约束、非目标与验收条件 |
| `项目结构设计.md` | 目标目录结构、模块边界、依赖方向与命名约定（DSR-015/017 目标形态） |
| `技术栈设计.md` | 本插件语言、运行时、依赖、构建与部署技术选型 |
| `TODO.md` | 本插件待办与未决事项（仅未完成项） |
| `technical-details/目录配置与状态存储.md` | 目录读取语义、settings 命名空间意图形状与校验、storage 域两表形状、备份目录布局、并发策略与校验规则 |
| `technical-details/入站操作.md` | 扫描、搜索、入库、检查、更新、出库（限外部 skill）、备份恢复、禁用启用语义 |
| `technical-details/挂载与同步.md` | dsh App 语义、DSH 工作区投影、挂载推导、junction 物化与摘除、归属判据、对账、行状态走查 |
| `technical-details/插件运行时.md` | 插件包形态、组合挂载与部署、Host 服务、RPC 传输（DSR-014）、请求调度与缓存、修复提示词（DSR-018）、Client 设置页与生命周期 |
| `decisions/` | 真实重大取舍的备选、评价、后果与重访条件 |
