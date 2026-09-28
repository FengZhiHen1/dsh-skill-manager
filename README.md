# dsh-skill-manager

> ⚠️ **基线要求（硬性）**：本插件（`0.2.x` 起）适配 **DSH `0.1.7-rc.2` 及以后**。适配内容见 DSR-025：配置模型换成「profile 条目 `Config` + `.volatile()`」（旧 `ctx.settings.register`/`SettingsScope`/`settings.yaml` 在新树零命中），配置页随 `settings.plugin.item` 槽废除迁往**侧栏 Plugins 页**，图标 API 与 client 注入边同步换代。
> ⇒ **升级顺序：先把实例升到 `0.1.7-rc.2`，再挂载/更新本插件**。在 `0.1.2-rc.1` 等旧运行时上，peer 版本门禁会把**整行自动置 `disabled: true`**（实例照常启动，只在 stderr 留一行），插件直接消失；反向操作（先更新插件）等于把稳定实例上的技能管理静默关掉。

DSH 技能管理插件：**配置即意图**——用户意图（分组、挂载目标、禁用/归属）存于本插件 loader 行的 Cordis `Config`（持久化在该 profile 的 `cordis.patch.yml` 里 `id: skill-manager` 行的 `config`），UI 经标准配置表单（`ctx.configForms`）直读直写（渲染即时、保存即生效），Host 对账器监听配置变更后台物化链接。技能页提供管理/搜索两视图：库列表（本地文件 + GitHub 入库元数据）、skills.sh 搜索下载、GitHub zipball 入库、检查更新、备份恢复；本地 skill 无版本管理（即本地文件）。物化状态存于 DSH storage 域（`$DSH_HOME/storages/skill_manager.json`，运行时投影）。

权威设计与语义：`docs/`（本仓库）。

## 功能

- **配置即意图**（配置命名空间 = 本插件 loader 行 id `skill-manager`）：`skillsDir`（空串 = 未配置，保存立即生效）+ `groups`（组集合与每组挂载目标，默认种子 = 空挂载：默认组不自动挂 DSH 全局，全局需显式勾选，2026-09-09 修订）+ `skills`（每目录的 disabled/group 意图）+ `intentMigrated`（迁移标记）。跨字段形式校验（组名/形状/绝对路径）在挂载期与写入路径拒绝；引用完整性由对账层容忍回落。旧版 storage 意图一次性迁移进配置行。
- **对账器**：`loader/volatile-update` 监听本行配置变更 → 200ms 防抖 → 对账（意图展平 → 投影 storage → 物化 junction/copy、孤儿清扫、项目 git exclude → 预热缓存）；物化失败进健康列表（「应用并修复」可重试）。
- **库管理**：扫描配置目录直接子目录（frontmatter、来源 self/github/local、上游 commit、缺失状态），管理视图 origin/group/q 本地过滤，建组/改名/删组/换组/禁用全部经配置直写即时生效。
- **获取**：skills.sh 搜索、GitHub 仓库探测（Trees API → zipball 回退）、入库（分支 branch → main → master 回退）、检查三态（同 repo 去重）、更新（本地修改需显式确认）。
- **挂载**：分组挂载到 dsh 全局根 `$DSH_HOME/skills` 与当前 DSH 工作区 `.dsh/skills`，junction 优先/copy 回退；对账、健康检查、孤儿清扫、项目级既有条目五类分类与遮蔽语义。
- **维护**：出库（备份到 `$DSH_HOME/skill-manager/backups/`）、恢复、GitHub 缺失恢复（本地目录删除即消失）。

## 模块布局

三层单向依赖 `adapter → core`（DSR-015；门禁 `tools/plugin-layering-check.mjs`，core 不得 import `@deepseek-ai/*`）：

```
src/adapter/          DSH 接缝（唯一允许 import @deepseek-ai/*）
  index.js            入口装配（name/inject/Config/apply）：service、对账器、预热、页面策略、effect 清理
  settings.js         配置边界：Config schema（DI 注入 schemastery）+ volatile 现读 + 两处校验挂点
  storage.js          storage 域 spec 包裹（core 纯 schema → defineDomain/domainTable）
  migrate.js          旧七表意图 → 配置行的一次性迁移编排
src/core/             纯领域逻辑（裸 node 可单测）
  service.js          三路队列、RPC dispatch、只读视图、写方法编排
  model/              intent（配置 schema/校验）、store（域 spec）、library（库扫描）、contract（入站契约）、verdict（写后裁定）
  mount/              derive（挂载推导）、materialize（junction 物化）、reconcile（对账）、inspect（行状态走查）、registry（归属登记）
  inbound/            acquire、upstream、zipball、backups（搜索/探测/入库/检查/更新/出库/恢复）
  base/               fsys（原子写）、net、zip、cache、audit（台账）、errors
src/client/           浏览器半区（JSX，esbuild 产单文件 dist/client.js）
  index.jsx           槽位装配（settings.section + plugins.row.config）、配置变更总线
  section.jsx         技能页（管理/搜索两视图）
  card.jsx            配置页（Plugins 页本行入口）
  manage.jsx          管理视图（库列表、分组、行菜单）
  search.jsx          搜索视图（skills.sh / GitHub 探测）
  api.js              RPC 传输门面（超时、错误归一、入站契约校验）
  repair.jsx          修复提示词模板与一键复制
  ui.jsx / theme.js   通用 UI 基元与主题 token
  nav-icon.js         设置导航图标补丁
```

低延迟路径：配置渲染永不等待网络（配置表单镜像页面启动即加载）；读请求走进程内 bundle 缓存快照（缓存热时零扫描）；写操作串行并在收尾预热缓存；网络慢操作独立队列不阻塞读写；技能页单请求 `overview` 出只读视图。详见 `docs/technical-details/插件运行时.md`。

## 开发

```bash
npm test          # node --test 全部单测
npm run check     # 产物新鲜度哨兵 + 语法检查 + 分层门禁 + 单测
npm run build     # 重建 dist/client.js（改 src/client 后必跑并提交产物）
```

- 运行期依赖（DSR-025 重排）：`zod`（storage 域表记录校验）；两个 peer `@deepseek-ai/schemastery ^3.18.4`（配置 schema，`.volatile()` 只有 `@deepseek-ai/` 这一支有）与 `@deepseek-ai/dsh-storage-domain ^0.1.7-rc.2`（域设施）。
  - `@deepseek-ai/schemastery` 另列同版本 `devDependencies`：裸 node 单测要能解析它（profile 侧 `autoInstallPeers: false` 不会装回副本）。
  - ⚠ 解析顺序是「**物理候选优先，未命中才进运行时拦截**」——别把 `schemastery`（裸名）或旧版 `@deepseek-ai/schemastery` 放进 `dependencies`，那会把配置钉在缺 `.volatile()` 的旧版上，`Config` 在 import 期直接抛错。
- 重建 `node_modules` 后重新运行 `npm test` 验证解析。

## 部署

- **test（试验）profile**：`link:` 依赖 + bundle patch 行（见 `homes/<HOME>/profiles/test/` 的 package.json 与 cordis.patch.yml），源码改动重启即生效（改 `src/client` 另需先 `npm run build` 并提交产物）；新增依赖需在 profile 执行 `pnpm install`（自定义 store 见仓库 AGENTS.md）。
- **web（稳定）profile**：`dsh plugin --profile web add github:FengZhiHen1/dsh-skill-manager#<commit>`（钉 commit）。仓库红线禁止 `file:`/`link:` 直挂 web；发布/换钉前必须先过 test 实测门禁（仓库 AGENTS.md §插件加载规则）。⚠ 换钉前先确认该实例运行时 ≥ `0.1.7-rc.2`，否则 peer 门禁会让整行 `disabled`（见文首基线要求）。
- 首次使用：侧栏 Plugins 页 → `dsh-skill-manager` → 本行的「配置」入口，配置本地 skills 目录（如 `E:\Project\Skills\skills`），配置后技能页自动可用。
