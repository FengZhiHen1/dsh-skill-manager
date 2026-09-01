# 项目结构设计

## 权威范围

本文是 `dsh-skill-manager` 的项目结构定调文档，唯一拥有本插件的目标目录结构、模块边界、依赖方向与命名约定。技术选型归 `technology-stack.md`；各模块内部机制归 `technical-details/`。实质变更属于重大决策，须写入决策记录并核对依赖文档。

> **目标形态声明**：本文描述 DSR-014/015/016 实施后的目标结构（core/adapter 分层、`connection.rpc` 传输、Client esbuild 构建），**代码实施待执行**（登记于 `TODO.md`）；实施完成前与源码现状（扁平 `lib/`、自建 `/skill-manager/api` 路由、单文件 `client.js`）存在有意的文档-代码窗口。

## 目标结构

```text
plugins/dsh-skill-manager/                       # submodule（FengZhiHen1/dsh-skill-manager）
├─ package.json
├─ cordis.patch.yml                              # 即 bundle patch（dsh.bundle.patch 指向它）
├─ src/
│  ├─ core/                                      # 纯领域逻辑（禁 @deepseek-ai/*，裸 node 可测；DSR-015）
│  │  ├─ base/                                   # 原语层（只依赖 node:*）
│  │  ├─ model/                                  # 数据形状与纯推导
│  │  ├─ mount/                                  # 挂载域（推导/物化/走查/对账）
│  │  ├─ inbound/                                # 入站域（管线/上游/获取/备份）
│  │  └─ service.js                              # 应用服务层（方法表/调度/读模型/Result 映射）
│  ├─ adapter/                                   # DSH 适配层（唯一允许 import @deepseek-ai/*）
│  └─ client/                                    # 浏览器半区源码（JSX 多文件；DSR-016）
├─ dist/
│  └─ client.js                                  # esbuild 产物（提交入库，check 哨兵守护新鲜度）
├─ docs/                                         # 设计文档（本体系，README 是文档地图）
│  ├─ README.md  requirements.md  technology-stack.md  project-structure.md  TODO.md
│  ├─ decisions/
│  └─ technical-details/
├─ design/
│  └─ skill-manager-management.op                # 设置页设计稿（OpenPencil）
└─ test/                                         # node --test 单元测试（*.test.mjs + helpers.mjs）
```

## 插件包模块边界

分层与依赖方向（DSR-015；目录级规则，core 纯度由 DSH_Plugins 仓库 `tools/plugin-layering-check.mjs` 机检）：

```text
base ← model ← {mount, inbound} ← service ← adapter
```

- 跨域只许向下依赖，同域文件自由互引，依赖无环。
- `src/core/` 禁止 import `@deepseek-ai/*`（含 cordis）、禁止相对路径反引 adapter；`src/adapter/` 是全包唯一允许接触 DSH 运行时的层。
- `src/core/base/` 只依赖 `node:*` 与 base 内部。

`src/core/` 模块职责：

| 模块 | 职责（唯一承载） |
|---|---|
| `base/errors.js` | `SkillManagerError` 稳定业务错误类型（code/message/retryable） |
| `base/fsys.js` | 文件系统与路径原语收口：`safePath`、原子写、`copyTree`（统一跳过 `.git`/`__pycache__`）、链接读写、路径归属判定（`withinRoot`/`canonicalPath`/`pathsEqual`） |
| `base/zip.js` | 零依赖 ZIP 读取器（`node:zlib`，store/deflate 单卷） |
| `base/net.js` | GitHub REST / zipball 下载 / skills.sh 搜索 / `git ls-remote` 回退；`GhError` 网络错误分类 |
| `base/cache.js` | 进程内缓存句柄（bundle 快照、meta、hash TTL、health 代际） |
| `model/intent.js` | 配置即意图领域模型：`configSchema`、形式校验、`requireDir`、组推导、配置挂载展平、意图叠加、旧意图迁移纯投影 |
| `model/store.js` | 投影存储模型：zod 记录 schema、域形状纯数据、`createStore` 门面、`syncedKey`/`backupId`、state 与检查缓存读写 |
| `model/workspaces.js` | DSH 工作区注册表镜像与旧键归一 |
| `model/library.js` | 库扫描、SKILL.md frontmatter、目录内容哈希基线、skill 名文法（C-01 唯一收口） |
| `mount/derive.js` | 挂载推导（纯）：目标拓扑（`DSH_APP`/`globalRoot`/`projectRootOf`/`targetDirOf`）、`deriveDesired`、`targetKey`（全库唯一） |
| `mount/materialize.js` | 物化与摘除（仅有的 fs 写效果）：`materializeOne`、`detachOne`、`orphanSweep`、`.git/info/exclude` 托管块 |
| `mount/inspect.js` | 只读走查：`health`、`classifyProjectEntries`、`findOrphanLinks`（孤儿检测单源，health 与 orphanSweep 共用） |
| `mount/reconcile.js` | 对账编排：摘除 → 清扫 → 物化 → git exclude → 写回 |
| `inbound/zipball.js` | zipball → skill 目录管线（解包/定位/物化临时目录；add/update/import/probe 四消费方共用） |
| `inbound/upstream.js` | 上游检查（三态）与更新；检查缓存合并回填 |
| `inbound/acquire.js` | 搜索、仓库探测、入库、本地导入 |
| `inbound/backups.js` | 出库（备份先行）、备份列表、恢复 |
| `service.js` | 应用服务层：方法表与 payload 规约、`dispatch`（READ/NET/WRITE 队列策略，R-17）、每请求会话与 bundle 读模型组装、缓存策略、错误 → 传输中立 Result 映射 |

`src/adapter/` 模块职责（DSH 接缝，唯一允许 import `@deepseek-ai/*`）：

| 模块 | 职责 |
|---|---|
| `adapter/index.js` | 插件入口（`inject`/`apply`）：装配 service、对账器（watch + 防抖 → sync）、启动预热、全部 effect 清理 |
| `adapter/settings.js` | settings 命名空间注册（`settingsNamespace` + `ctx.settings.register`，schema 来自 core） |
| `adapter/storage.js` | `defineDomain`/`domainTable` 包裹 core 纯 schema → 新旧双 spec；`openStore(ctx)` |
| `adapter/migrate.js` | 旧域打开/读取/关闭编排，调用 core 的迁移纯投影后写 scope |
| `adapter/rpc.js` | `ctx.connection.rpc.handle('/skill-manager', service.dispatch)` 薄接线（DSR-014） |

`src/client/`：浏览器半区源码（JSX 多文件，DSR-016）；纯算法可抽 `src/client/core/`（同一门禁覆盖）；产物 `dist/client.js` 由 esbuild 构建并提交入库。

## 全局约定

- 文件名统一小写连字符；模块内导出稳定小写驼峰函数名。
- 路径安全统一由 `src/core/base/fsys.js` 承载；备份与 `$DSH_HOME` 定位统一经 `ctx.dshHomePath`。
- RPC 通道固定 `/skill-manager`，方法名即 endpoint；Result 信封语义归 `technical-details/plugin-runtime.md` 定义（DSR-014）。
- Host 半区无构建（`.js` 即交付）；Client 半区产物 `dist/client.js` 由 esbuild 构建并提交入库，`check` 脚本含分层门禁与产物新鲜度哨兵（DSR-015/016）。
- 插件包内不得保存任何用户数据、缓存或当前会话状态；运行时数据只在 settings 命名空间、storage 域、`$DSH_HOME/skill-manager/` 与 DSH skill 根。
- 部署经 bundle 通道（DSR-012）：test profile `link:` 源码直挂，web profile `github:` git 依赖；仓库内目录是源码权威。
