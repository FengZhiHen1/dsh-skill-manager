# DSR-024：写后裁定以 Host 权威值为准——弃用镜像快照比对，两字段写串行

> 状态：**已落地，过静态闸与 test 实例实测**（2026-09-14：`npm run check` 退出 0、`node --test` 144/144、分层门禁通过；页面走查见文末「实测」）。**web（stable-dev）尚未更新**，待用户指令。

## 上下文

2026-09-14 用户在 web 稳定实例删掉一个分组后，技能页立刻弹错误条与修复提示词：

> 错误码：settings-validation-rejected｜错误消息：字段 groups 写入被 Host validate 拒绝｜问题概述：配置「groups」被 settings 校验拒绝，已回滚为当前值。

只读排查结论：**删除其实成功了，报错是误报**。

现场证据（排查全程只读）：

| # | 证据 | 来源 |
|---|---|---|
| 1 | `settings.yaml` 的 `skill-manager.groups` 已无该组，且键序与"尝试写入的值"逐字一致 | `homes/stable-dev/settings.yaml` |
| 2 | 操作时刻恰有一条 `settings-debounced` 对账（摘除 `E:\Project\Study\.dsh\skills\course-forge`，`changed:1`、`configGen 0→1`），此后无任何"resolved 值变化"类记录 | `skill-manager/audit.jsonl`，`2026-09-14T13:57:50Z` |
| 3 | 用插件自身 `configSchema()` + `validateConfigIntent()` 复核"被拒值"：组名全合法、schema 解析通过、resolved 值与尝试值 `JSON.stringify` 逐字相等 | 只读复算 |
| 4 | 线上跑的就是本地 HEAD 那份代码（lockfile resolution `a2830f6` = submodule HEAD、工作区干净） | `profiles/web/pnpm-lock.yaml` |

根因（DSH 客户端语义，非本插件独有）：settings-scope 只把**最新一笔写**的回执折进镜像，被后续写超越的那一笔只记 `pendingRevision`、不回折视图；被拒时静默 `recover()`，不抛错也不把原因透出（平台侧映射为 `settings/conflict` | `settings/rejected`，客户端拿不到）。而 `deleteGroup`/`renameGroup` 在同一 tick 连发 `groups`+`skills` 两笔写，第一笔的比较**必然**读到落后快照 → 必然误报「被拒绝，已恢复原值」。同一机制还有一处静默风险：真被拒时第二笔照发，会留下半套用（成员指向不存在的组名，按失效组回落「默认」，挂载静默丢失）。

## 真实方向与评价

- **A（两字段写串行）**：消掉必然误报与半套用。但"被拒"与"镜像落后"仍不可分——用户快速连点两处开关造成写重叠时，靠前那笔仍会误报。
- **B（权威值裁定）**：写后另读一次 `settings.describe`，与尝试值比对，三态裁定。判据从"某份可能落后的缓存"换成 Host 事实源；代价是每次配置写多一次本地环回请求。
- **C（等平台回执）**：DSR-021 的重访条件之一，平台未提供，不可选。

## 最终决定（A + B 同批落地）

1. 新增 `core/model/verdict.js`（**纯函数、零 import、浏览器安全**——裁定要进 client bundle，故与读文件系统的 `model/intent.js` 分开）：`writeVerdict(attempted, authoritative)` → `accepted` / `not-applied` / `unknown`；等值比较走规范化字符串化（对象键排序、数组保序），消掉"键序不同即判未生效"的失败模式。
2. `client/index.jsx` 新增 `readConfigField(field)`（`ctx.remote.settings.describe()` → 本命名空间 → `value[field]`；失败返回原因字符串），注入技能页与配置卡片两个槽位；**client `inject` 补 `remote.settings`**——客户端 remote 命名空间按 traced service 暴露，取属性前必须在 `inject` 声明，否则运行时抛 `cannot get property "remote.settings" without inject`（与一方 Client 插件 `ui-settings-general` / `ui-permission-presets` 同一约定）。
3. `editConfig` 与卡片保存改挂三态裁定；错误码改 `settings-write-not-applied` / `settings-write-unconfirmed` / `settings-write-failed`（原 `settings-validation-rejected` 是自造码、平台里不存在，且把原因断言成"组名非法"）。
4. `deleteGroup` / `renameGroup` 两字段写串行：`if (!await editConfig('groups', nextGroups)) return false` 之后才写 `skills`；`renameGroup` 返回契约改为 `Promise<boolean>`。
5. 视图切换只跟写落定：改名/删除**成功**才切分组筛选（`manage.jsx` 的 `groupOp` / `confirmDeleteGroup`）——否则筛选会跳到并不存在的组名。

## 直接后果

- 删组/改名不再误报；真被拒时第二笔不发，不再有半套用。
- 修复提示词只陈述裁定事实（含"权威读失败原因"），不再指使人去改一个合法组名。
- 每次配置写多一次 `settings.describe`；失败路径不再依赖浏览器镜像的时序。
- 新增回归闸 `test/verdict.test.mjs`（6 项：三态决定表 + 键序/数组序语义）。

## 重访条件

- 平台为 settings 写入提供回执（含 validate 结果）→ `readConfigField` 退役，直接消费回执（与 DSR-021 同款条件）。
- `readConfigField` 出现可感知开销 → 改为"快路径（本地快照）+ 复核路径（权威读）"两级。

## 实测（2026-09-14，test 实例 `127.0.0.1:64777`，合成库 `E:\Project\Skills-test\skills`）

开工前置闸 `skill-manager-baseline.mjs gate --prod stable-dev --test test` 五条全绿；冒烟前后各采一次基线，`diff` 报**无差异**（生产零外溢、fixture 复原）。

| 步骤 | 修复前 | 修复后 |
|---|---|---|
| 建组（单笔写） | 无误报 | 无误报（toast 正常） |
| 删组（两笔写） | ❌ 弹「配置「groups」被拒绝，已恢复原值（组名保留字/非法字符或格式不合法）」，但分组实际已消失 | ✅ 无横幅，分组确实消失 |
| 非法改名 `写作`→`a/b`（真被拒） | （未在修复前测） | ✅ 如实报「写入未生效：Host 权威值仍是原值」；`skills` 第二笔未发出（成员未动）；视图不跳到不存在的组名 |
| 合法改名 `写作` ⇄ `wr-tmp` | （未在修复前测） | ✅ 无横幅；成员随组迁移（nav 计数 `wr-tmp1`） |
| 清理残留组 | — | ✅ 无横幅，fixture 复原 |

修复前误报截图留档：`tmp/repro-banner-before-fix.jpg`（会话临时产物，gitignore）。

中期踩坑（当场修掉）：首次实测裁定落 `unknown`，横幅如实回显原因 `cannot get property "remote.settings" without inject`——这条也证明"把权威读失败原因上屏"的设计当场就起了作用。
