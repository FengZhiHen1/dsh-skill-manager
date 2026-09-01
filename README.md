# dsh-skill-manager

DSH 设置页技能管理插件：**配置即意图**——用户意图（分组、挂载目标、禁用/归属）存于 DSH settings 命名空间（`$DSH_HOME/settings.yaml` 的 `skill-manager` 段），UI 经标准 settings 域直读直写（与原生设置卡片同构，渲染即时、保存即生效），Host 对账器监听配置变更后台物化链接。技能页提供管理/搜索/同步三视图：库列表（本地文件 + GitHub 入库元数据）、skills.sh 搜索下载、GitHub zipball 入库、检查更新、本地导入、备份恢复；本地 skill 无版本管理（即本地文件）。物化状态存于 DSH storage 域（`$DSH_HOME/storages/skill_manager.json`，运行时投影）。

权威设计与语义：`docs/`（本仓库）。

## 功能

- **配置即意图**（settings 命名空间 `skill-manager`）：`skillsDir`（空串 = 未配置，保存立即生效）+ `groups`（组集合与每组挂载目标，默认种子 = 默认组挂全局）+ `skills`（每目录的 disabled/group 意图）+ `intentMigrated`（迁移标记）。形式校验（组名/形状）在写路径拒绝；引用完整性由对账层容忍回落。旧版 storage 意图一次性迁移进配置。
- **对账器**：`scope.watch` 监听配置变更 → 200ms 防抖 → 对账（意图展平 → 投影 storage → 物化 junction/copy、孤儿清扫、项目 git exclude → 预热缓存）；物化失败进健康列表（「应用并修复」可重试）。
- **库管理**：扫描配置目录直接子目录（frontmatter、来源 self/github/local、上游 commit、缺失状态），管理视图 origin/group/q 本地过滤，建组/改名/删组/换组/禁用全部经配置直写即时生效。
- **获取**：skills.sh 搜索、GitHub 仓库探测（Trees API → zipball 回退）、入库（分支 branch → main → master 回退）、检查三态（同 repo 去重）、更新（本地修改需显式确认）。
- **挂载**：分组挂载到 dsh 全局根 `$DSH_HOME/skills` 与当前 DSH 工作区 `.dsh/skills`，junction 优先/copy 回退；对账、健康检查、孤儿清扫、项目级既有条目五类分类与遮蔽语义。
- **维护**：出库（备份到 `$DSH_HOME/skill-manager/backups/`）、恢复、GitHub 缺失恢复（本地目录删除即消失）。

## 模块布局

```
index.js        Host 入口（settings 命名空间、迁移、对账器、/skill-manager/api 路由、三路队列）
client.js       Client（技能设置页 + 插件配置卡片；配置经 settingsScope 直读直写，overview 只读视图）
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

低延迟路径：配置渲染永不等待网络（settings mirror 页面启动即加载）；读请求走进程内 bundle 缓存快照（缓存热时零扫描）；写操作串行并在收尾预热缓存；网络慢操作独立队列不阻塞读写；技能页单请求 `overview` 出只读视图。详见 `docs/technical-details/plugin-runtime.md`。

## 开发

```bash
npm test          # node --test 全部单测
npm run check     # 语法检查 + 单测
```

- 运行期/测试依赖：`schemastery`、`@deepseek-ai/dsh-settings`、`zod`、`@deepseek-ai/dsh-storage-domain`。前两者不在公共 npm registry 的可用版本上，本机开发通过插件目录下的 node_modules 联结解析（gitignored）：
  - `node_modules/schemastery` → web profile 的 `node_modules/schemastery`（或任意 schemastery 3.18.x 安装）
  - `node_modules/@deepseek-ai/dsh-settings` → 本机共享解析层 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings`
  - `node_modules/zod` 与 `node_modules/@deepseek-ai/dsh-storage-domain` → 本机共享解析层对应包
- 重建联结后重新运行 `npm test` 验证解析。

## 部署

- **test（试验）profile**：`link:` 依赖 + 用户层 insert 行（见 `~/.dsh/profiles/test/` 的 package.json 与 cordis.patch.yml），源码改动重启即生效；新增依赖需在 profile 执行 `pnpm install`（自定义 store 见仓库 AGENTS.md）。
- **web（稳定）profile**：`dsh plugin --profile web add github:FengZhiHen1/dsh-skill-manager#<commit>`（钉 commit；当前挂载见 `~/.dsh/profiles/web/package.json`）。仓库红线禁止 `file:`/`link:` 直挂 web，也禁止 bundle 层与 insert 行同时挂载（duplicate loader entry id）；发布/换钉前必须先过 test 实测门禁（仓库 AGENTS.md §插件加载规则）。
- 首次使用：设置 → 插件 → skill-manager 卡片 配置本地 skills 目录（如 `E:\Project\Skills\skills`），配置后技能页自动可用。
