# DSR-015：core/adapter 分层与模块领域重划

> 状态：已确认（2026-09-01，design-spec-workshop D2′，含用户修订「按域分目录」），代码实施待执行；实施前 AGENTS.md 等文档按目标形态描述。

## 上下文

仓库约定（AGENTS.md「插件组织」，知识库 `checklists/21` §3）：新插件硬性采用 core/adapter 单包分层——`src/core/` 纯领域逻辑（禁 import `@deepseek-ai/*`、禁反引 adapter，裸 node 可单测）+ `src/adapter/` DSH 适配层，门禁 `tools/plugin-layering-check.mjs`。本插件先于约定存在，扁平 `lib/` 14 模块，门禁以「薄壳豁免」空转；全仓库尚无插件真实采用该约定。

2026-09-01 逐模块审查的一手证据：

- **god module ×2**：`lib/api.js`（439 行）混杂传输 plumbing、队列原语、缓存策略、读模型组装、意图展平（配置 → 挂载规则的领域逻辑藏于 `createSession`）、方法表；`lib/sync.js`（551 行）兼任 fs 原语库、纯推导、物化、孤儿清扫、git exclude、项目条目分类、对账编排、健康审计八个角色。
- **重复 ×6**：`targetKey` 两份定义且空值语义不一（`lib/sync.js` vs `lib/state.js`）；`pathExists`/`existsDir`/裸 `lstat` 三变体；`copyTree`（跳过 `.git`）与 `cp` 递归（不跳过）双实现；孤儿链接扫描在 `orphanSweep` 与 `health` 各写一遍；`SKILL_NAME` 正则两处；`fileExists`/`isEmptyDir` 与 dir.js 原语重叠。
- **孤儿导出 ×6**（无生产消费方）：`dir.js: writeJson/normalizeRel`、`library.js: skillDirExists`、`groups.js: groupSummary`、`errors.js: unconfigured`、`cache.js: clearHashes`。
- 命名按技术角色而非领域语言：`dir.js`（意图 schema + 路径安全 + 原子写）、`state.js`（storage 读写 + 工作区镜像 + dsh App 常量）。

## 真实方向与评价

- 方向 A：最小搬迁（`lib/` → `src/core/` 原名平移，仅抽离 settings/storage 两条 DSH 接缝）。成本低、语义保全验证最简单；但保留上述粗糙边界与重复，门禁通过而设计债不变。
- 方向 B：顺势领域重划——一个模块一个领域责任，拆分由真实复用边与重复消灭驱动，依赖目录级无环。一次性成本高（测试重分布、文档重写），语义保全靠 88 项单测逐一对应保障；换来边界清晰、重复与孤儿归零。

## 最终决定

采用方向 B（用户明确「从最优解角度出发」并要求按域分目录）：

```text
src/core/
├─ base/        # 只依赖 node:* 与 base 内部
│  ├─ errors.js  fsys.js  zip.js  net.js  cache.js
├─ model/       # → base/
│  ├─ intent.js  store.js  workspaces.js  library.js
├─ mount/       # → base/, model/
│  ├─ derive.js  materialize.js  inspect.js  reconcile.js
├─ inbound/     # → base/, model/, mount/materialize.js
│  ├─ zipball.js  upstream.js  acquire.js  backups.js
└─ service.js   # 应用服务层 → 全部下层
src/adapter/    # 唯一允许 import @deepseek-ai/*
├─ index.js  settings.js  storage.js  migrate.js  rpc.js
src/client/     # 浏览器半区源码（构建形态归 DSR-016）
```

- 目录级依赖规则：`base ← model ← {mount, inbound} ← service ← adapter`；跨域只许向下，同域文件自由互引。入站域到挂载域唯一一条边：`backups → materialize(detachOne)`；`add/update/import/restore` 的「变更后对账」维持回调注入，不产生 inbound → reconcile 的 import 边。
- 四条 DSH 接缝收进 adapter：`settings.js`（命名空间注册，schema 留 core/model/intent.js）、`storage.js`（`defineDomain` 包裹 core 纯 schema → 双 spec + `openStore`）、`migrate.js`（旧域编排，纯投影函数留 intent.js）、`rpc.js`（DSR-014 通道接线）。
- 关键归并：fs/路径原语统一进 `base/fsys.js`；存储 IO（loadState/saveState/check 缓存）归位 `model/store.js`；SKILL_NAME 文法（C-01）收口 `model/library.js`；孤儿检测单源化为 `mount/inspect.js: findOrphanLinks`，`materialize.orphanSweep` 与 `health` 共用；`targetKey` 全库唯一（`mount/derive.js`）；DSH App 目标拓扑（DSH_APP/globalRoot/projectRootOf/targetDirOf）归 `mount/derive.js`；六个孤儿导出删除。

## 行为变化清单（语义保全合同的显式例外）

1. **物化 copy 回退不再传播 `.git`/`__pycache__`**：统一后的 `fsys.copyTree` 跳过两者，与 `library.dirHash` 的内容基线语义对齐（现状 `cp` 递归会传播；用户确认接受此修正）。
2. `targetKey` 统一为 `` `${app}|${scope}|${project ?? ''}` ``（app/scope 实践中恒非空，无实际差异）。
3. DSR-014 的信封形状变化（另录）。
4. 其余全部行为以 88 项单测重分布全绿 + test profile 实测为保全证据。

## 直接后果

- DSH_Plugins 仓库 AGENTS.md 的插件组织约定（core/adapter 分层）整节重写；本插件 README 模块布局节实施时重写。
- 测试按新模块边界重分布（`test/fence.test.mjs` 随 DSR-014 删除，信封测试改写 Result 断言）；`package.json` exports/files/scripts 更新，版本 `0.1.0 → 0.2.0`。
- 门禁 `node tools/plugin-layering-check.mjs plugins/dsh-skill-manager` 首次真实生效；本插件成为全仓库首个 core/adapter 采用者。
- 部署侧无路径破坏面：bundle patch 行经包名解析 `exports["."]`，profile 无感知；web 重挂前必须过 test 实测门禁（含 DSR-014 的 rpc 冒烟与围栏等价验证）。

## 重访条件

- core 模块数持续增长（>25）或单域职责漂移时，重评子域再分或拆包。
- core 出现第二个消费平面（如 CLI 工具复用库管理逻辑）时，评估独立包发布。
- 门禁规则或仓库分层约定变化时，核对本划分。
