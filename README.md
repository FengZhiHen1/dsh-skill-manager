# dsh-skill-manager

DSH 设置页技能管理插件：在设置「插件」区配置「本地 skill 目录」（车间根，默认为空即未配置）后，提供技能管理页（管理/搜索/同步三视图），管理库、分组与 DSH 挂载，支持 skills.sh 搜索下载、GitHub zipball 入库、本地导入、检查更新、备份恢复与禁用启用。

权威设计与语义：`docs/design/dsh-skill-manager/`（本仓库）。

## 功能

- **车间根配置**（R-22）：设置 → 插件 → skill-manager 卡片，单字段「本地 skill 目录」，默认空串 = 未配置；保存立即生效，无需重启。未配置时所有管理操作返回 `workshop-unconfigured`；配置的目录缺失时返回 `workshop-missing`（插件保持存活）。
- **库管理**：扫描 `skills/`（frontmatter、来源 self/github/local、git 指纹、锁记录、所属组、缺失/禁用状态），分组创建/重命名/删除/换组，本地导入目录或 .zip。
- **获取**：skills.sh 搜索、GitHub 仓库探测（Trees API → zipball 回退）、入库（分支 branch → main → master 回退）、检查三态、更新（锁记录路径失效报候选，不静默回退）。
- **挂载**：分组挂载到 dsh 全局根 `~/.dsh/skills` 与注册项目 `.dsh/skills`，junction 优先/copy 回退；对账、健康检查、孤儿清扫（只清理指向本车间根的链接）、项目级既有条目五类分类与遮蔽语义。
- **维护**：出库（备份到 `distributor/backups/`）、恢复、禁用/启用；自动 Git 提交（约定路径，非 Git 车间降级跳过）。

## 模块布局

```
index.js        Host 入口（settings 命名空间、/skill-manager/api 路由、受信围栏）
client.js       Client（技能设置页 + 插件配置卡片）
lib/workshop.js 配置命名空间、车间根门禁、原子读写
lib/fence.js    受信请求围栏（回环/受信权威 + 同源标记）
lib/git.js      git 通道（约定路径提交、批量指纹、ls-remote）
lib/zip.js      零依赖 ZIP 读取器（node:zlib，store/deflate）
lib/net.js      skills.sh / GitHub 网络通道
lib/library.js  库扫描、frontmatter、锁文件、目录哈希
lib/groups.js   分组
lib/state.js    state/apps、项目注册表、挂载规则、旧格式迁移与默认种子
lib/sync.js     挂载推导、物化、对账、健康、项目既有条目分类
lib/inbound.js  搜索/探测/入库/检查/更新/导入/出库/恢复/禁用启用
lib/api.js      HTTP 信封、单飞队列、方法分发、未配置门禁
```

## 开发

```bash
npm test          # node --test 全部单测
npm run check     # 语法检查 + 单测
```

- 运行期/测试依赖：`schemastery` 与 `@deepseek-ai/dsh-settings`。二者不在公共 npm registry 的可用版本上（dsh-settings 仅 0.0.1-rc.1），本机开发通过插件目录下的 node_modules 联结解析（gitignored）：
  - `node_modules/schemastery` → web profile 的 `node_modules/schemastery`（或任意 schemastery 3.18.x 安装）
  - `node_modules/@deepseek-ai/dsh-settings` → 本机共享解析层 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings`
- 重建联结后重新运行 `npm test` 验证解析。

## 部署

- **test（试验）profile**：`link:` 依赖 + 用户层 insert 行（见 `~/.dsh/profiles/test/` 的 package.json 与 cordis.patch.yml），源码改动重启即生效。
- **web（稳定）profile**：按 `docs/design/dsh-skill-manager/technical-details/plugin-runtime.md` 部署步骤——复制包到 profile、`file:` 依赖、insert 行、`pnpm install`、重启。禁止 bundle 层与 insert 行同时挂载（duplicate loader entry id）。
- 首次使用：设置 → 插件 → skill-manager 卡片 配置车间根（如 `E:\Project\Skills`），配置后技能页自动可用。
