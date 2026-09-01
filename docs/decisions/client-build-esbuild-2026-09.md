# DSR-016：Client 引入 esbuild 构建（JSX + 多文件，产物提交）

> 状态：已确认（2026-09-01，design-spec-workshop D3），代码实施待执行。

## 上下文

`technology-stack.md` 既定「单文件 `client.js` + `React.createElement` + 不做 client 构建」，重访条件为单文件超过约 1200 行。现已 ~1600 行 / 82.5KB（三视图 + 配置卡片 + 遮罩 + 菜单 + 图标补丁），阈值触发，重访项登记于设计根目录 TODO.md。

结构性事实：DSH 模块加载器只服务**单文件产物**（惰性 CJS 工厂 + `window.__ModuleLoader__.load({ id, factory })` banner，`react` 与 `dsh.client.inject` 声明包由运行时 `require` 回答，知识库 `client/14` §3）——「多文件」与「无构建」不可兼得。官方 `tsdown.client.ts` 预设未发布，仓库外包须自行复刻输出格式。

部署约束：web 经 `github:` git 依赖挂载，git 安装拉源码——若构建交给安装期 `prepare`，pnpm ≥10 需 profile `allowBuilds` 授权（知识库 `must-read/05` §5），引入安装摩擦；**构建产物提交进 git** 则安装链路完全不变。

## 真实方向与评价

- 方向 A：维持无构建，上调阈值，文件内分节重排。部署与开发链路零变化；代价是 `createElement` 冗余写法与单文件导航成本永久保留，而设置页体量单调增长（阈值已被触发一次，上调只是推迟）。
- 方向 B：esbuild + JSX + `src/client/` 多文件，产物 `dist/client.js` 提交进 git。可读性与可维护性质变，且对齐官方 client 结构（`src/client/` → 构建产物），约定的 `src/client/core/` 纯逻辑分层也只有此形态下可执行。唯一真性风险是「改源码忘构建 → 部署旧 UI」的静默漂移——配反向验证哨兵（见下）。

## 最终决定

采用方向 B：

1. `src/client/` 多文件 JSX 源码（按视图与组件拆分，纯算法可抽 `src/client/core/`）；esbuild 产单文件 `dist/client.js`：`format=cjs`、`platform=browser`、bundle、外化 `react`/`react-dom`/`@deepseek-ai/*`（外化集合与 `dsh.client.inject` 声明保持一致）、banner/footer 复刻 `__ModuleLoader__.load({ id: 'dsh-skill-manager', factory: (require) => { ... } })`。
2. **产物提交进 git**（不引入 `prepare`，web/test 安装链路不变）；`exports["./client"]` 指向 `dist/client.js`，`files` 含 `dist/`。
3. **新鲜度哨兵**（反向验证，防静默漂移）：`check` 脚本把源码重建到临时文件并与已提交产物字节比对，不一致即失败；该检查随 test 实测门禁执行。
4. `package.json`：`scripts.build`（esbuild 单次）与 `scripts.dev`（watch）；`esbuild` 进 devDependencies。改 client 后刷新页面即生效（知识库 `must-read/05` §3：产物更新无需重启）。
5. Host 半区维持无构建（`.js` 即交付）——两半区各自取最优，不对称是有意的。

## 直接后果

- `technology-stack.md` 的 Client 形态/写法两行、「不启用任何构建产物」约束（改为 Host 无构建 + client 唯一例外 + 哨兵）、重访条件同步重写；TODO.md 勾销本重访项。
- `plugin-runtime.md` Client 入口节按新形态重写；DSH_Plugins 仓库 AGENTS.md 的目录树与全局约定同步。
- 卸载与 HMR 语义不变：`dist/client.js` 内容变化触发 client-modules 增量重建，刷新生效。

## 重访条件

- 官方发布 client bundle 预设（tsdown 或继任者）→ 迁移到官方预设，废弃自维护 esbuild 配置。
- esbuild 停维或出现阻断性缺陷 → 换等价 bundler（产物格式契约不变）。
- client 体量意外缩回单文件可控范围 → 可回退无构建（此时删除哨兵）。
