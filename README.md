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

```
index.js        Host 入口（配置行 Config、迁移、对账器、/skill-manager RPC 通道、三路队列）
client.js       Client（技能设置页 + Plugins 页配置页；配置经 configForms 直读直写，overview 只读视图）
lib/dir.js      配置命名空间（意图 schema + 形式校验）、目录门禁、原子写
lib/store.js    storage 域 spec（五表投影 + 旧七表迁移 spec）与读写门面
lib/migrate.js  旧 storage 意图一次性迁移进 settings
lib/cache.js    进程内缓存层（bundle 快照、meta、dirHash、health 代际）
lib/fence.js    受信请求围栏（回环/受信权威 + 同源标记）
lib/zip.js      零依赖 ZIP 读取器（node:zlib，store/deflate）
lib/net.js      skills.sh / GitHub 网络通道
lib/library.js  库扫描（stat 签名复用解析）、frontmatter、目录哈希
lib/groups.js   组文档纯推导（意图来自配置）
lib/state.js    挂载状态投影、工作区镜像
lib/sync.js     挂载推导、物化、对账、健康、项目既有条目分类
lib/inbound.js  搜索/探测/入库/检查（repo 级去重）/更新/导入/出库/恢复
lib/api.js      HTTP 信封、三路队列、只读视图与文件/网络操作
```

> 上面的目录清单是**旧扁平布局**的留档，现行形态是 `src/core` + `src/adapter` + `src/client` 三层（DSR-015），权威描述见 `docs/项目结构设计.md`；与此同批的配置模型也已在 DSR-025 换代（配置行 `Config` + volatile，配置页在 Plugins 页）。旧清单待整批清理，不在本次改动范围内。

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
