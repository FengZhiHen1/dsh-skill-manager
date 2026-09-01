# TODO

待办与未决事项（仅未完成项；完成即写入拥有该事实的设计文档并从此处移除）。

## 待办

- **DSR-014/015/016 实施**（2026-09-01 确认，设计见 `decisions/`）：core/adapter 重划（`src/core/{base,model,mount,inbound}/` + `service.js` + `src/adapter/` + `src/client/`）+ 传输迁 `connection.rpc` + Client esbuild 构建 + 包卫生（`@deepseek-ai/*` 转 peer、`engines`、`check` 哨兵、版本 0.2.0）。验收链：单测重分布全绿 → 分层门禁生效 → test profile 实测门禁（含 rpc 冒烟与围栏等价验证）→ push GitHub 并提示用户重挂 web。
- **web profile 重挂新 commit**（2026-09 登记）：`plugins/dsh-skill-manager/` 转 submodule 时已把本地源码权威同步推送至 `FengZhiHen1/dsh-skill-manager`（`6e67f92`），但 web profile lockfile 仍钉 `ed7e124`（旧版，缺 `lib/cache.js`/`lib/migrate.js`）。需经 `dsh plugin --profile web add github:FengZhiHen1/dsh-skill-manager` 重挂更新（发布前置：test 实测门禁，见仓库 AGENTS.md）。
- **boot 级组合测试补齐**（2026-09-01 design-spec-workshop D5 登记延期）：knowledge/21 §6 要求产品可见插件有真实组合测试（boot 测试 cordis.yml 过 Loader，非手拼 `ctx.plugin`）；现状只有单元测试 + 手工冒烟清单（`technical-details/plugin-runtime.md` 验证计划）。**重访条件：首次 npm 发布或对外分发前必须补齐**；本轮重构以单测重分布 + 分层门禁 + test 实测为语义保全证据链，不混入此项基建。
- **missing evidence 实测**：skills.sh 匿名搜索本机可用性、真实 GUI 遮罩确认交互、工作区镜像迁移与项目级链接的 test-profile 集成冒烟、bundle 内 `dsh.client` 产物更新的客户端增量重建。实测后结果写入 `requirements.md` 的 missing evidence 节。
