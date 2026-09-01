# DSR-011：配置即意图——用户意图迁入 settings 命名空间

## 上下文

DSR-010 把全部管理状态迁入 DSH storage 域（七表：skills 含 disabled/group、groups、mounts、synced、projects、check_cache、backups）。落地后发现两层割裂：用户意图（分组、挂载规则、禁用/组归属）是**配置**，却被存进面向运行时状态的 storage 域；浏览器端读写意图需要插件自建一套 HTTP 配置协议（spec/status 声明式配置层与 apply-spec 后台收敛，中间态见 commit `5e8df3e`），而 DSH rc.7 起 settings 域已对所有注册命名空间开放浏览器直读直写（白名单与 `settings-not-exposed` 移除），官方机制自带热加载、跨进程写锁、保注释与 `applies: live`。

## 真实方向与评价

- 方向 A：意图留在 storage 域，保留插件自建配置写协议。状态面统一在域内，但配置读写、冲突检测、回滚提示全部自研，与平台 settings 机制重复造轮子；配置不再是用户可读的 `settings.yaml` 段。
- 方向 B：意图迁入 settings 命名空间（`skill-manager` 段：`skillsDir` + `groups` + `skills` + `intentMigrated`），storage 域降级为运行时投影（五表：skills/synced/projects/check_cache/backups）；浏览器端经标准 settings 域（`settingsScope`）直读直写，Host 以 `scope.watch` 监听变更并防抖对账。删掉整个自定义配置协议层；代价是组/挂载不再是域表，引用完整性不能在 settings 写路径上校验（字段级原子写必须放行跨字段中间态），改为对账层容忍回落。
- 方向 C：混合——skillsDir 走 settings，组/挂载留 storage。两套通道并存，意图割裂，比 A、B 都差。

## 最终决定

采用方向 B（2026-08 下旬落地，commit `6715948`「refactor: skill-manager 配置即意图」、`e4925a1`「settings 改硬依赖」；本记录为追溯补记）：

1. 用户意图唯一事实源 = settings 命名空间 `skill-manager`；`groups` 默认种子为「默认」组挂载全局。
2. storage 域 `skill_manager` 保留五表运行时投影；`groups`/`mounts` 表删除，`skills` 表去除 `disabled`/`group` 意图字段；`version` 保持 1 兼容存量文件。
3. 旧七表意图由 `lib/migrate.js` 一次性投影进 settings（`intentMigrated` 标记防重；`origin: "self"` 记录不迁移）。
4. `disable`/`enable`/`mount.add`/`mount.remove` 等配置端点与 apply-spec/spec-conflict 自定义协议全部删除；配置操作 = settings 直写，对账器 200ms 防抖收敛。
5. settings `validate` 只做形式校验；引用完整性由对账层容忍回落并警告。
6. `settings` 服务进入 Host 硬依赖（inject）。

## 直接后果

- `lib/dir.js` 的 `configSchema` 扩展为四字段；`lib/store.js` 拆为新五表 spec 与仅供迁移的 legacy 七表 spec；新增 `lib/migrate.js`。
- `inbound-operations.md` 的 disable/enable 端点语义、`storage-model.md` 的七表形状、`mount-sync.md` 的 mount.add/remove 与 `mounts` 表被本决定改写，正文已按新状态重写。
- 禁用语义收窄：`disabled` 只是挂载意图（退出期望集），不再把条目排除出 `check`/`update` 的默认目标集。
- 出库不再清除 settings 意图；恢复后组归属以配置中残留的意图为准。
- 波及文档：`requirements.md`（R-02/R-06/R-12/R-13/R-17/C-08/AC-13）、`storage-model.md`、`inbound-operations.md`、`mount-sync.md`、`plugin-runtime.md`。

## 重访条件

- settings 命名空间在意图规模增长后出现性能或容量问题（settings.yaml 单文件承载）。
- 出现跨机器同步配置或意图版本管理需求（settings 域不提供历史）。
- DSH settings 域对第三方命名空间的契约收紧（如恢复暴露白名单）。
