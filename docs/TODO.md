# TODO

待办与未决事项（仅未完成项；完成即写入拥有该事实的设计文档并从此处移除）。

## 待办

- **一次实施批次**（2026-09-01 确认，设计见 `decisions/`）：新基线重设计（DSR-017/018）与 DSR-014/015/016 合并为一次实施，避免两轮迁移与两轮实测。范围：core/adapter 重划（`src/core/{base,model,mount,inbound}/` + `service.js` + `src/adapter/` + `src/client/`）+ 传输迁 `connection.rpc` + Client esbuild 构建 + junction-only 物化与两表状态面（删 synced/projects/backups 表、copy 路径与物化方法参数、`model/workspaces.js`）+ 删除本地导入/同步视图/claim-empty/project-skills/health 端点 + 修复提示词机制（Host repair facts + Client 统一模板）+ remove 限外部 skill 且一律自动备份 + 原子换装 + 包卫生（`@deepseek-ai/*` 转 peer、`engines`、`check` 哨兵、版本 0.2.0）。验收链：单测重分布全绿 → 分层门禁生效 → test profile 实测门禁（含 rpc 冒烟、围栏等价、junction-only 行为、AC-10 孤儿保留、AC-13 只读红线、AC-15 修复提示词）→ push GitHub 并提示用户重挂 web。
- **设计稿同步**（2026-09-01 登记）：`design/skill-manager-management.op` 需按新基线调整——删除 04 帧（导入）与 05 帧（同步矩阵）；管理视图行徽章新增「挂载失败」态与点击展开（修复提示词复制入口）；行 ⋯ 菜单按来源分化（自有 skill 无更新/删除）；警告条（未匹配工作区）。
- **web profile 重挂新 commit**（2026-09 登记）：web profile lockfile 仍钉 `ed7e124`（旧版，缺 `lib/cache.js`/`lib/migrate.js`）。实施批次完成并过 test 实测门禁后，经 `dsh plugin --profile web add github:FengZhiHen1/dsh-skill-manager` 重挂更新（见仓库 AGENTS.md）。
- **boot 级组合测试补齐**（2026-09-01 design-spec-workshop D5 登记延期）：knowledge/21 §6 要求产品可见插件有真实组合测试（boot 测试 cordis.yml 过 Loader，非手拼 `ctx.plugin`）；现状只有单元测试 + 手工冒烟清单（`technical-details/插件运行时.md` 验证计划）。**重访条件：首次 npm 发布或对外分发前必须补齐**；本轮重构以单测重分布 + 分层门禁 + test 实测为语义保全证据链，不混入此项基建。
- **missing evidence 实测**：skills.sh 匿名搜索本机可用性、真实 GUI 遮罩确认交互、junction-only 物化与行状态走查的 test-profile 集成冒烟、bundle 内 `dsh.client` 产物更新的客户端增量重建。实测后结果写入 `需求.md` 的 missing evidence 节。
