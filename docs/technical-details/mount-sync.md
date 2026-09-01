# 挂载与同步

## 权威范围

本文唯一拥有 dsh App 语义、DSH 工作区项目投影、挂载规则推导、junction/copy 物化、对账、健康检查、项目级既有条目与 Git exclude 维护。意图形状（settings 的 `groups`/`skills` 段）与状态域形状归 `storage-model.md`，出库摘除与恢复语义归 `inbound-operations.md`，对账器的触发装配归 `plugin-runtime.md`。

## DSH skill 根与工作区事实

- 全局根：`$DSH_HOME/skills`，由 Host `dshHomePath` 服务解析（`ctx.dshHomePath('skills')`，与 dsh-skill-filesystem 的 `resolveDshHome` 同源；默认即 `~/.dsh/skills`），不得由 `homedir()` 硬编码推导；首次同步时由插件创建。对账/物化/健康检查一律经注入接收该根；`src/core/mount/derive.js` 的 `globalRoot()` 无参 `~/.dsh/skills` 回退仅为纯函数测试保留，不用于真实物化路径（DSR-015）。测试注入临时根，真实用户根不被测试触碰。
- 项目根：当前 DSH 工作区的 `<workspace.path>/.dsh/skills`。工作区路径由 Host `workspaceRegistry` 给出，已经过 Host 侧规范化。
- 一个工作区项目由稳定 `workspaceId`、当前显示 `title` 与规范化 `path` 组成。挂载与 synced 记录只持久化 `workspaceId`；`title` 仅供界面显示，重命名不会改变任何挂载键。
- Host 注册表是活动项目唯一来源。Client 的 `ctx.workspaces.list` 只能作为显示状态，不能用来决定文件系统目标或越过 Host 校验。
- DSH 发现逻辑会忽略没有 `SKILL.md` 的目录；配置目录是纯 skill 平铺目录，不含需要隐藏的状态文件（DSR-010）。

## dsh App 语义

- 本插件只管理 `app: "dsh"` 的挂载与物化；`synced` 记录的 `app` 字段固定取 `dsh`（字段保留仅为形状稳定）。distributor 时代的多 App 注册（`apps.json`）已随 CLI 兼容一并移除（DSR-010）。

## 工作区镜像

每次构建库视图（bundle）前，Host 按以下顺序刷新镜像：

1. 从 `workspaceRegistry.list()` 取得当前活动工作区，投影为 `{ workspaceId, title, path }`；注册表不可用或返回无效数据（缺 id/路径、重复 id）时以 `workspace-unavailable` 失败，不读写项目镜像或项目目录。
2. 以 `workspaceId` 为键、规范化绝对 `path` 为值刷新 `projects` 表：活动键写入/更新；不删除消失键。
3. 旧键归一：未匹配旧键若其路径与某个活动工作区的规范化路径一致（Windows 不区分大小写），则把该旧键在 `projects` 与 `synced` 中的引用原子改写为对应活动 `workspaceId`。归一并入时同目标既有 `synced` 记录若 method 或目录冲突，以 `workspace-migration-conflict` 失败，不写半成品。
4. 镜像同时产出界面快照：每个活动工作区的 `mountCount`（「N 个组使用」，按配置意图统计）与 `syncedCount`（既有物化条数）；未匹配旧键列入 `legacyProjects`（状态 `workspace-unmatched`）。

镜像刷新只在内容变化时写盘（持久化先行）；读路径的冷扫也会触发该刷新。

工作区新建、删除与改名由 DSH 工作区界面完成。技能页不提供注册、改名、改路径或删除项目的写操作；它只允许把分组的挂载目标切换为 DSH 全局或某个当前工作区。

工作区从注册表消失后，其 `projects` 键、配置中的挂载规则与 `synced` 记录保留为只读遗留项：不参与新挂载或新物化，不自动删除项目目录或既有插件链接；界面以「未匹配工作区」提示，只允许经显式清理动作解除。

## 挂载推导

输入为配置意图展平（settings 的 `groups` 段展开为 `{group, app: "dsh", scope, project}` 挂载规则，`skills` 段给出组归属与禁用标记）、当前工作区投影与 `projects` 镜像。形状非法的挂载项跳过（对账容忍）。

输出为 `{ skill -> [target] }`，其中活动 target 为 `{ app, scope, project }`；项目级 `project` 是 `workspaceId`。参与推导的 skill 集 = 库视图中未禁用且未缺失的条目。

- 一个 skill 的期望位置等于其所属组的全部活动挂载规则；`disabled` 或 `missing` 的 skill 不进入期望集。
- 同名 skill 对同一 target 只保留一条规则。
- 引用不在当前工作区投影中的 `workspaceId` 不产生新期望目标，并产生警告（区分「未匹配工作区」与「不存在的工作区」）。
- 对未匹配工作区的遗留规则与 `synced` 记录，推导额外返回保留集；它只保护已有 synced 链接不被普通对账静默摘除，不会创建或修复新的项目级物化。
- dsh 的 target 目录为 `~/.dsh/skills` 或当前工作区 `<path>/.dsh/skills`。

## 物化

- 源目录必须含 `SKILL.md`，否则拒绝该 target，防止把无效目录挂进 DSH 根。
- Windows 使用 `fs.symlink(src, dst, 'junction')` 创建 junction；失败且方法为 `auto` 时回退 `fs.cp` 全量复制；显式要求 junction 时失败上报。
- 目标已是链接：realpath 与源一致为 `ok`。指向错误时，仅当能证明归属才删除重建——synced 记录显示本插件此前在此物化（自检修复，含悬挂链接经 `readlink` 原始目标兜底判定），或链接目标落在配置目录内（与孤儿清扫同一判据）；指向他处且无记录的链接是他人现场，按 `target-exists` 拒绝，不夺取。
- 目标已是真实目录：仅当 synced 记录显示该位置是本插件旧 copy **且当前内容哈希与记录一致（未被改动）** 时替换；无哈希的旧记录或已被改动的目录同样拒绝。其余真实目录按下方既有条目分类处理，不自动覆盖。
- 每次物化成功或跳过，都写回 `synced` 记录 `{method, dir, at, hash?}`；`hash` 仅 copy 物化时写入（副本内容哈希），junction 记录无此字段。
- copy 物化在源更新后必须由对账替换刷新；junction 自动跟随源目录。

## 项目级既有条目

项目 `.dsh/skills` 中的条目在物化前先分类。判定顺序为：是否链接 → realpath 是否指向配置目录对应源 → 是否含 `SKILL.md` → 是否为空目录；最后对「库中存在而该项目无同名条目」的 skill 补记 `external-skill`。

| 现场 | 分类 | 对账与界面行为 |
|---|---|---|
| 链接且 realpath 指向 `<配置目录>/<name>` | `managed-ok` | 不重建，写 synced 记录并标记 `ok`，正式接管 |
| 链接但 realpath 指向别处 | `wrong-target` | health 报错；用户执行对账时删除并重建正确链接 |
| 空真实目录且无 `SKILL.md` | `local-empty` | 不自动删；提供显式 `清理并接管`，确认后删除空目录并建立正确链接 |
| 真实目录且含 `SKILL.md` | `local-skill` | 永不覆盖；该目标记 error，界面只读展示并提示项目本地版优先 |
| 真实目录、无 `SKILL.md` 且非空 | `local-foreign` | 永不触碰；DSH 本身会忽略该目录 |
| 库中存在而该项目无同名条目 | `external-skill` | 矩阵补格用只读标记：表示该工作区当前没有此条目的任何现场（不表示项目本地有库外 skill） |

项目中存在而配置目录中不存在的 skill 按上表落入 `local-skill`/`local-foreign`/`wrong-target` 等分类：只读展示、永不纳管，也不进入同步矩阵行。

遮蔽语义：项目级 `.dsh/skills` 的合并 rank 高于用户级 `~/.dsh/skills`。当当前工作区存在同名 `local-skill` 时，即使库 skill 通过全局挂载生效，该工作区内仍以本地版为准；矩阵中该工作区同名单元格显示 `shadowed`，并提供原因提示。

### 空目录接管

- 入口：`skill-manager/claim-empty`，参数 `{workspaceId, name}`。
- 前置校验：`workspaceId` 在本次 Host 工作区投影中存在（否则 `workspace-not-found`）；目标经条目分类确为 `local-empty`（真实空目录，否则 `bad-claim`）；目标未被 synced 记录为本插件 copy。
- 执行：删除空目录，立即对账，在该位置建立正确 junction。
- 任何校验失败都返回错误，不删除任何文件。

### 项目本地条目读取

- 入口：`skill-manager/project-skills`，参数可按 `workspaceId` 过滤；`workspaceId` 不在当前投影时返回 `workspace-not-found`。返回当前工作区投影及各项目 `.dsh/skills` 下的条目分类。
- 数据只用于同步矩阵单元格状态判定；`external-skill` 不产生健康问题。
- 未匹配工作区的遗留项可返回摘要和保留状态，但不得扫描、写入或把其路径当作活动项目目标。

## 对账流程

对账是全量幂等操作，任意活动子项失败不影响其他子项，最终返回 `results/warnings/errors` 三部分。未配置目录时对账与健康检查不执行，统一返回 `skilldir-unconfigured`。

```text
读取 settings 意图、storage 域各表与当前 DSH 工作区投影，刷新 projects 镜像
推导活动期望与遗留保留集
1. 对 synced 中每条记录：
     若仍属于活动期望集或遗留保留集 -> 保留
     否则 -> 摘除该链接或本插件 copy，记录 action
2. 孤儿清扫：
     遍历 dsh 全局根与当前工作区根下的链接
     只处理 realpath 落在配置目录内且不在活动期望中的链接
3. 物化活动期望：
     对每个 (skill, target) 执行物化，记录 action 或 error
4. 更新当前工作区 .git/info/exclude 托管块
5. synced/projects 变更经域写链持久化（持久化先行）
```

- 摘除规则：链接直接删；synced 记录为 copy 的真实目录仅当当前内容哈希与记录一致（未被改动）时删除，无哈希的旧记录或已改动目录保留；其他真实目录保留。
- 遗留保留集禁止普通对账摘除既有链接；用户显式清理后才允许摘除其 synced 记录。
- 孤儿清扫安全边界：realpath（悬挂链接以 `readlink` 原始目标兜底）必须落在当前配置目录内——按路径分隔符边界判断，`skills-sibling` 这类共享字符串前缀的兄弟路径不算在内——且不在期望路径中；其他链接一律不动。更换配置目录后，指向旧目录的链接不在新前缀内，自动保留为孤儿，不清理。
- Git exclude 托管块用固定起止标记（`# >>> dsh-skill-manager` / `# <<< dsh-skill-manager`）包裹，内容为项目级 `.dsh/skills/`，防止项目 Git 误提交挂载物；只更新活动工作区，非 Git 项目跳过。
- 触发路径：Client 显式 `sync`；配置变更经对账器 200ms 防抖触发；`add/update/import/restore/claim-empty` 等写操作收尾触发（装配归 `plugin-runtime.md`）。

## 健康检查

健康检查只读，不修改任何文件；每个问题包含 skill、target 与 `issue`：

| issue | 判定 |
|---|---|
| `missing-link` | 活动期望位置不存在 |
| `wrong-target` | 活动期望位置是链接但 realpath 不指向对应源；也来自项目条目分类 |
| `target-exists` | 期望位置是真实目录且非本插件 copy（全局根等非项目既有条目场景） |
| `project-missing` | 活动期望目标的工作区在投影中已无可用路径 |
| `workspace-unmatched` | 遗留项目键不在当前 DSH 工作区投影中 |
| `extra-link` | synced 记录已不在活动期望且不属于遗留保留集 |
| `orphan-link` | dsh 根下的链接指向配置目录但不在期望路径 |
| `local-empty` | 项目目标为空真实目录，等待显式清理 |
| `local-skill` | 项目目标含 `SKILL.md` 的真实目录，未被接管 |
| `local-foreign` | 项目目标为无 `SKILL.md` 的非空目录 |
| `dsh-invisible-name` | 安装名不满足 DSH skill 名文法 |

- `local-empty/local-skill/local-foreign` 与项目级 `wrong-target` 来自当前工作区的项目级既有条目分类，只读展示，永不自动修改；已按项目分类报告的占位不再重复报告 `target-exists`。
- `workspace-unmatched` 不在普通 `sync` 后收敛为零；它只能经工作区恢复匹配或显式清理解决。

## 挂载与工作区操作

- 挂载规则的新增与移除不是 RPC 端点（DSR-011）：Client 把该组的 `mounts` 数组整体写回 settings 的 `groups` 字段（字段级原子写），Host 对账器监听变更后防抖对账，使物化与期望收敛。
- 项目级挂载规则的 `project` 必须是当前 Host 工作区投影中的 `workspaceId`；settings 写路径不做此校验（形式校验边界归 `storage-model.md`），失效引用由推导跳过并警告。
- 不提供 `project.add`、`project.rename`、`project.edit-path` 或 `project.remove`。DSH 工作区的创建、改名和删除由宿主工作区界面负责。
- 工作区改名不触发文件路径变动或挂载键变动；工作区删除后，其活动目标退出期望集、对应遗留项保留并报告 `workspace-unmatched`。
- 新建组由 Client 复制「默认」组现有挂载规则作为起步（DSR-009）；组改名/删除同为 settings 直写（成员组归属同步改写或回落 `默认`）。

## 失败语义

| 失败 | 结果 |
|---|---|
| 源缺 `SKILL.md` | 该 target 记 error，其他 target 继续 |
| 目标存在非托管真实目录 | 按既有条目分类记 issue 或 error，不自动修改 |
| 工作区注册表不可用 | 返回 `workspace-unavailable`，不读写项目镜像或项目目录 |
| workspaceId 不在当前投影 | 项目条目读取/空目录接管返回 `workspace-not-found`；配置中的失效引用由推导跳过并警告 |
| 旧记录无法匹配工作区 | 保留为只读遗留项，报告 `workspace-unmatched` |
| 旧键归一并入冲突 | 返回 `workspace-migration-conflict`，不写入 |
| junction 创建失败且显式 junction | 记 error |
| junction 创建失败且 auto | 回退 copy |
| copy 回退失败 | 记 error |

## 同步矩阵单元格

同步视图矩阵的单元格状态（Client 推导，供阅读健康与期望差异）：

| 单元格 | 含义 |
|---|---|
| `生效` | 该目标在期望集且项目条目分类为 `managed-ok`（全局列：在期望集即生效） |
| `错误` | 该目标在期望集但条目分类非 `managed-ok`（缺失、指向错误、本地占位等） |
| `shadowed` | 该目标不在期望集，但工作区本地含同名 `local-skill`（项目级合并优先） |
| `不适用` | 该目标不在期望集且无本地现场 |

## 验证边界

- 验证用项目通过 DSH 工作区创建或选取；其 `.dsh/skills` 可证明项目级 DSH 根约定成立。
- 覆盖工作区创建、改名、删除、路径镜像归一与未匹配遗留保留五类场景。
- 全局首次同步必须自动创建 `~/.dsh/skills`，不要求用户手工建目录。
- 新建会话可见性、当前会话 watcher 即时性与 junction 是否被 watcher 识别为目录变化，按需求验收实测并记录结果。
- 既有条目策略按验收条件构造五类现场验证，不把当前空目录直接作为唯一用例。
