# dsh-skill-manager

DSH 设置页技能管理插件：在设置「插件」区配置「本地 skills 目录」（纯 skill 平铺目录，默认为空即未配置）后，提供技能管理页（管理/搜索/同步三视图），管理库、分组与 DSH 挂载，支持 skills.sh 搜索下载、GitHub zipball 入库、本地导入、检查更新、备份恢复与禁用启用。管理状态存于 DSH storage 域（`$DSH_HOME/storages/skill_manager.json`），配置目录内不出现任何插件状态文件（DSR-010）。

权威设计与语义：`docs/design/dsh-skill-manager/`（本仓库）。

## 功能

- **目录配置**（R-22）：设置 → 插件 → skill-manager 卡片，单字段「本地 skills 目录」，默认空串 = 未配置；保存立即生效，无需重启。未配置时所有管理操作返回 `skilldir-unconfigured`；配置的目录缺失时返回 `skilldir-missing`（插件保持存活）。
- **库管理**：扫描配置目录直接子目录（frontmatter、来源 self/github/local、上游 commit、所属组、缺失/禁用状态），分组创建/重命名/删除/换组，本地导入目录或 .zip。
- **获取**：skills.sh 搜索、GitHub 仓库探测（Trees API → zipball 回退）、入库（分支 branch → main → master 回退）、检查三态、更新（上游路径失效报候选，不静默回退；本地修改需显式确认）。
- **挂载**：分组挂载到 dsh 全局根 `$DSH_HOME/skills`（Host `dshHomePath` 解析，默认 `~/.dsh/skills`）与当前 DSH 工作区 `.dsh/skills`，junction 优先/copy 回退；对账、健康检查、孤儿清扫（只清理指向本配置目录的链接）、项目级既有条目五类分类与遮蔽语义。
- **维护**：出库（备份到 `$DSH_HOME/skill-manager/backups/`）、恢复、禁用/启用（标记位，目录原地不动）。

## 模块布局

```
index.js        Host 入口（settings 命名空间、storage 域、/skill-manager/api 路由、受信围栏）
client.js       Client（技能设置页 + 插件配置卡片）
lib/dir.js      配置命名空间、目录门禁、原子写
lib/store.js    storage 域声明（skillManagerSpec）与存取门面
lib/fence.js    受信请求围栏（回环/受信权威 + 同源标记）
lib/zip.js      零依赖 ZIP 读取器（node:zlib，store/deflate）
lib/net.js      skills.sh / GitHub 网络通道
lib/library.js  库扫描、frontmatter、目录哈希
lib/groups.js   分组
lib/state.js    工作区镜像、遗留项、挂载规则校验
lib/sync.js     挂载推导、物化、对账、健康、项目既有条目分类
lib/inbound.js  搜索/探测/入库/检查/更新/导入/出库/恢复/禁用启用
lib/api.js      HTTP 信封、单飞队列、方法分发、未配置门禁
```

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
