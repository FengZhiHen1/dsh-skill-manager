# dsh-skill-manager 设计

## 主题目标

在 DSH Web 设置页提供技能管理页，本地 skills 目录由设置中插件配置选项「本地 skill 目录」提供（默认为空即未配置，见 DSR-005）：管理库、分组与 DSH 挂载，支持 skills.sh 搜索下载、GitHub zipball 入库、本地导入、检查更新、备份恢复与禁用。目录为纯 skill 平铺目录（DSR-010）；用户意图（目录、分组、挂载、禁用）存于 settings 命名空间 `skill-manager`，运行时投影（入库元数据、物化记录、工作区镜像、检查缓存、备份登记）存于 DSH storage 域 `skill_manager`（DSR-011）。

## 当前状态

- 设计基线已经用户确认；DSR-001~DSR-013 全部落地到 `plugins/dsh-skill-manager/` 源码。
- 单元测试 88 项全绿（`node --test test/*.test.mjs`，2026-09-01 实测）。
- 部署（DSR-012）：test profile 经 `link:` 源码直挂；web profile 经 `github:FengZhiHen1/dsh-skill-manager` git 依赖挂载。
- 2026-09-01 新增已确认决策（design-spec-workshop）：DSR-014（传输层迁到官方 `connection.rpc` 通道）、DSR-015（core/adapter 分层与模块领域重划）、DSR-016（Client 引入 esbuild 构建）。**代码实施待执行**；实施完成前 `项目结构设计.md`、`technical-details/插件运行时.md`、`技术栈设计.md` 描述目标形态，与源码现状（扁平 `lib/`、自建 `/skill-manager/api` 路由、单文件 `client.js`）存在有意的文档-代码窗口，实施项登记于 `TODO.md`。
- 待验证项（未实测）：真实 DSH GUI 的客户端模块重建/遮罩交互、工作区镜像迁移与项目级链接的 test-profile 集成冒烟、skills.sh 匿名搜索——清单见 `需求.md` 的 missing evidence。
- 待办与未决事项（DSR-014/015/016 实施、web 重挂等）登记于 `TODO.md`。

## 阅读顺序

1. `需求.md`：先确认范围、约束与验收。
2. `technical-details/README.md`：按机制阅读顺序展开技术细节。
3. `decisions/`：需要了解决策理由时阅读。

## 文档地图

| 文档 | 唯一权威范围 |
|---|---|
| `需求.md` | 目标、范围、功能需求、约束、非目标与验收条件 |
| `项目结构设计.md` | 目标目录结构、模块边界、依赖方向与命名约定（DSR-015 目标形态） |
| `技术栈设计.md` | 本插件语言、运行时、依赖、构建与部署技术选型 |
| `TODO.md` | 本插件待办与未决事项（仅未完成项） |
| `technical-details/目录配置与状态存储.md` | 目录读取语义、settings 命名空间意图形状与校验、storage 域表形状、备份目录、并发策略与校验规则 |
| `technical-details/入站操作.md` | 扫描、搜索、入库、检查、更新、导入、出库、备份恢复、禁用启用语义 |
| `technical-details/挂载与同步.md` | dsh App 语义、DSH 工作区项目镜像、挂载推导、物化、对账、健康与既有条目 |
| `technical-details/插件运行时.md` | 插件包形态、组合挂载与部署、Host 服务、RPC 传输（DSR-014）、请求调度与缓存、Client 设置页与生命周期 |
| `decisions/` | 真实重大取舍的备选、评价、后果与重访条件 |
