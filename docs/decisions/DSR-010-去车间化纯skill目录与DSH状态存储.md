# DSR-010：去车间化——纯 skill 目录 + DSH 惯例状态存储

## 上下文

插件脱胎于 distributor CLI 的车间布局契约：配置目录（车间根）内含 `skills/` 子层、`skills.lock.json`、`distributor/{groups,apps,state,check-cache}.json`、`.disabled/`、git 提交历史与 `backups/`。这套结构让用户的 skill 目录背负了插件的存储实现，且状态文件与用户内容混居一处。2026-08-19 用户裁定：彻底修正，不再依赖原车间；「本地 skills 目录」语义改为单纯的 skill 保存目录，读取时直接读此目录下的 skill；状态按 DSH 插件惯例另放。

## 真实方向与评价

- 方向 A（保留 CLI 兼容层）：继续写 `skills.lock.json` 等 distributor 形状。维持与 Python CLI 互通，但目录永远掺着插件私物，语义浑浊。
- 方向 B（纯目录 + 平台惯例状态）：目录只放 skill 平铺目录；全部状态（来源基线、分组、挂载、物化记录、工作区镜像、检查缓存、备份登记）迁入 `ctx.storage.domain` 域，落盘 `$DSH_HOME/storages/skill_manager.json`；备份文件树放 `$DSH_HOME/skill-manager/backups/`（`dshHomePath` 服务定位）。目录即库，状态归平台惯例位置；代价是放弃 CLI 互通与既有车间数据。

## 最终决定

采用方向 B（2026-08-19 用户逐项确认）：

1. **目录语义**：配置目录 = 纯 skill 平铺目录；直接子目录含 `SKILL.md` 即库成员。不再维护 `skills/` 子层、`skills.lock.json`、`apps.json`、`state.json` 的 CLI 形状，不做 git 提交（溯源由状态域的来源基线承担）。
2. **状态载体**：`ctx.storage.domain` 开 `skill_manager` 域（json 后端落盘 `$DSH_HOME/storages/skill_manager.json`）；表：`skills`（来源/commit/content_hash 基线/installed_at/disabled/group）、`groups`、`mounts`、`synced`、`projects`（工作区镜像）、`check_cache`、`backups`。插件新增依赖 `@deepseek-ai/dsh-storage-domain` 与 `zod`。
3. **禁用**：`skills.disabled` 标记位，目录原地不动；禁用即退出挂载期望集。
4. **出库**：保留备份能力；备份树放 `$DSH_HOME/skill-manager/backups/<id>/`，登记入 `backups` 表；恢复保留。
5. **迁移**：零迁移设计——不读取、不搬移旧车间任何文件；既有 `E:\Project\Skills` 的用法是配置改指 `E:\Project\Skills\skills`。
6. **基线抢救**：旧 `skills.lock.json` 的上游基线（repo/branch/commit/content_hash）由维护者手工一次性整理为域初始数据（本仓库运维动作），插件不内建任何旧格式知识。
7. **本地修改检测保留**：`check` 时以 `content_hash` 基线对比现算哈希，产出 `locally_modified` 徽章与更新确认门槛，语义不变。

## 直接后果

- `technical-details/workshop-files.md` 就地重写为「目录与状态存储」；`../需求.md`、`../technical-details/入站操作.md`、`../technical-details/挂载与同步.md`、`../technical-details/插件运行时.md` 同步重写受影响条目。
- Host：`lib/git.js` 删除；`lib/workshop.js` 瘦身为目录门禁；新增 storage 层；`state.js`/`groups.js`/`inbound.js`/`sync.js`/`library.js` 改读写域。
- 部署：test profile 需 `pnpm add @deepseek-ai/dsh-storage-domain zod` 后生效。

## 重访条件

- distributor CLI 需要重新互通时，重访方向 A（届时以导出器而非同居布局实现）。
- storage domain 对第三方插件的注入契约若在后续 rc 中收紧，重访状态载体。
