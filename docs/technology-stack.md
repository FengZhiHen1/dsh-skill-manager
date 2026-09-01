# 技术栈设计

## 权威范围

本文是 `dsh-skill-manager` 的技术栈定调文档，唯一拥有语言与运行时、依赖与构建方式、部署目标、兼容与安全约束及选型理由。项目结构边界与分层规则归 `project-structure.md`；各机制如何使用这些技术归 `technical-details/`。实质变更属于重大决策，须写入决策记录并核对依赖文档。

## 已核实事实

- 本机 Node 为 `v24.12.0`，pnpm 为 `11.9.0`，Git 为 `2.52.0`。
- 部署 Profile 位于 `$DSH_HOME/profiles/{web,test}`，使用 pnpm workspace，`nodeLinker: hoisted`。
- 自有插件 `dsh-guardrails` 是零依赖纯 ESM 包，按官方 Bundle 范式交付（`dsh.bundle.patch` + 包内 `cordis.patch.yml` 的 `insert` 行），test profile 源码直挂、web profile 经 `github:` git 依赖挂载；`dsh-better-sidebar` 与 `dsh-auteur` 是带 `dsh.client` 与 `dsh.bundle` 的 npm 包。
- 浏览器 Client 由 `window.__ModuleLoader__` 加载 CommonJS 工厂，`react`、`react-dom` 及 `@deepseek-ai/dsh-client-*` 属于平台外部模块，由运行时 `require` 回答。
- DSH 主题变量使用 `--dsw-alias-*` 前缀（ui-theme 定义），随亮暗主题切换。
- DSH rc.7 起 settings 域对所有注册命名空间开放浏览器直读直写（`settings-not-exposed` 白名单移除）；`settings.plugin.item` 槽位为 keyed（key = 卡片编辑的命名空间）。

## 技术栈决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| Host 语言 | JavaScript（ESM，`"type": "module"`），不使用 TypeScript | 与 `dsh-guardrails` 一致；本项目插件没有需要类型系统压制的复杂度；避免 Host 构建链 |
| Host 运行基线 | Node 24 LTS 系；`engines: ^22.19.0 || >=24` | 本机实测版本；知识库 `must-read/04` §7 发布基线（D4，2026-09-01） |
| Client 形态 | `src/client/` 多文件源码，esbuild 产单文件 `dist/client.js`（惰性 CJS 工厂），产物提交进 git | 单文件已越过 1200 行重访阈值（DSR-016）；模块加载器只服务单文件产物，多文件必须构建；产物提交使 git 依赖安装链路不变（无 `prepare`/`allowBuilds` 摩擦） |
| Client 写法 | JSX（esbuild 编译） | 设置页三视图/表单/菜单密集，`createElement` 冗余是主要可读性税（DSR-016） |
| Client 构建产物新鲜度 | `check` 脚本重建产物并与已提交 `dist/client.js` 字节比对，不一致即失败 | 「改源码忘构建 → 部署旧 UI」是静默漂移失败模式，必须有哨兵（DSR-016） |
| 第三方依赖 | dependencies：`schemastery`、`zod`；peerDependencies（+ devDependencies）：`@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-storage-domain` | settings 命名空间 schema 与 storage 域声明（DSR-010/011）；`@deepseek-ai/*` 列 peer 与宿主共享同一实例（profile `autoInstallPeers: false`，运行时解析落到安装树/共享 fallback）；cordis 无 import 不声明；ZIP 解包用自研零依赖读取器（`src/core/base/zip.js`，node:zlib），不引入 fflate |
| 网络 | Node 全局 `fetch` 直连 GitHub 与 skills.sh；`git ls-remote` 作分支探测回退 | 真实插件包具备完整 Node 能力；匿名 REST 与 zipball 与 distributor 通道一致 |
| 文件与进程 | `node:fs/path/child_process/os/crypto/zlib`，Git 走子进程 | 全部能力由 Node 内置模块覆盖；Git 仅用于 `ls-remote` 回退 |
| Python | 运行时不依赖 Python 与 distributor CLI | 双面孔共存但互不调用，避免跨语言序列化与启动成本 |
| UI 样式 | ui-primitives 原子组件（`Button`/`Input`/`Pill`）+ `--dsw-alias-*` 主题 token，不注入全局样式表 | 视觉对齐 DSH 原生（DSR-008/009 既定方向）；token 随主题切换 |
| RPC | 官方 `connection.rpc` 通道（channel `/skill-manager`，方法名即 endpoint）；配置读写走官方 settings 域 | 平台对每个请求应用围栏（回环/trustedHosts + `sec-fetch-site` + origin，部署运行时 0.1.1-rc.2 实证等价于旧自携带 fence），alpha.3 起追加 browser-auth；注册 fiber-scoped 随卸载自动摘除；删除自维护围栏与信封代码（DSR-014） |

## 部署与兼容约束

- 部署目标为 `$DSH_HOME/profiles/web`（稳定）与 `$DSH_HOME/profiles/test`（试验/发布前实测门禁）。
- 插件包必须声明 `dsh.bundle.patch` 并可被 reconcile 纳入 `dsh.profile.bundles`；test 经 `link:` 源码直挂，web 经 `github:FengZhiHen1/dsh-skill-manager` git 依赖挂载（DSR-012）。
- 插件包不得依赖 DSH 内部包的私有 API 版本；Host 侧只通过 `connection`、`workspaceRegistry`、`storage`、`dshHomePath`、`settings` 服务对接宿主（DSR-014 起 `webServer`/`loader` 移除），Client 侧只通过 `slots`、`workspaces`、`settingsScope`、`remote`、`connection` 与 `dsh.client` 元数据对接。
- Client 外部模块清单以 `react`、`react-dom` 与 `dsh.client.inject` 声明的 `@deepseek-ai/dsh-client-*` 包为边界（esbuild 外化集合与之保持一致），不引入其他组件库。
- 所有长时网络请求必须带超时；所有文件写入必须经过临时文件加原子重命名（域写由平台持久化先行保证）。
- Host 半区不启用构建产物，`src/` 下 `.js` 即交付文件；Client 半区是唯一例外：`dist/client.js` 由 esbuild 构建并提交入库，新鲜度哨兵见决策表（DSR-016）。

## 重访条件

- 官方发布 client bundle 预设（tsdown 或继任者）→ 迁移到官方预设，废弃自维护 esbuild 配置（DSR-016）。
- 官方 `connection.rpc` 通道对自定义 channel 的围栏/信封语义收紧或废弃 → 重评传输层（DSR-014）。
- 需要把 RPC 暴露给模型工具或其他 Host 插件时，重访官方 RPC 通道方案。
- 需要公开发布或分发到其他机器时，重访 npm 发布（registry 安装）。
- 若 GitHub 匿名限流显著影响使用，重访 API token 配置与代理抽象。
