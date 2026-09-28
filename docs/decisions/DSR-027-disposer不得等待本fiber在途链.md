# DSR-027：disposer 不得 await 本 fiber 发起的在途链（启动卡死与闭环拆除）

> 状态：**已修复，静态闸全绿**（2026-09-28）。`npm run check` 退出 0：产物新鲜度 + `src` 全量语法 + 分层门禁（23 个 core 文件）+ `node --test` **160/160**（新增 3 项 DSR-027 回归闸，且三项均经消融确认有判别力）。
> ⚠ **实例级复验未做**——修复后尚未在真实 test 实例启动观察（红线：实例启停只能由用户执行）。见文末「尚未验证」。

## 症状（实测，2026-09-28）

test 实例（0.1.7-rc.2）挂上本插件后启动**永久卡死**，指纹：

| 观测 | 值 |
| --- | --- |
| 进程 | 存活，`running=true`，`url=null` |
| CPU | Δ=0（6s / 10s 两次采样），非自旋 |
| 网络 | 已监听 `127.0.0.1:55554`，但 `/` 返回 401（webserver 已起，未出 URL） |
| 诊断 | HOME 下**无 `logs/` 目录**（未到 `auditStartupEntries`） |
| 启动器 | 本次启动**零日志**（从未收到 ready） |
| 现场 | 挂死期间 HOME 内**零业务写入**；`profile/cordis.patch.yml` 哈希与挂载前**完全相同** |

「webserver 已 bind、boot 永不结算、无任何报错、CPU 静置」是这条死锁的特征签名。

## 根因：一条自我等待的闭环

不是配置错误、不是缺服务、不是 peer 门禁（**这三条都已用探针逐一排除**，见「已排除项」）。闭环如下，每一环都由源码取证：

```
apply 发起 migratePromise（index.js:55-60）
  └─ 等本 fiber 结算 → migrateLegacyIntent() → ctx.settings.update()（migrate.js:58）
       └─ settings.write() → configEditor.edit()（settings/lib/index.js:508）
            └─ withFileLock(profile/package.json) → reconcileProfilePatches()（config-editor/src/index.ts:81-84）
                 └─ 对 root Include 行 entry.update()（app-boot/src/index.ts:289）
                      ⇒ 重组整棵树 ⇒ **dispose 本插件 fiber**
                 └─ await Promise.allSettled(previousFibers.map(f => f.await()))（app-boot/src/index.ts:290）
  └─ 本插件异步 disposer：await storeReady（旧 index.js:82-83）
       └─ storeReady ← migratePromise ← ↑那笔写 ⇒ **闭环**
```

闭环的致命处在于 cordis 的卸载语义：`Fiber._unload()` 会 `await Promise.all(disposables…)`（`vendor/cordis/src/fiber.ts:676-686`）——**卸载必须等异步 disposer 结算**。于是：

1. disposer 等那笔写 → 写等重组 → 重组等本 fiber 卸载 → 卸载等 disposer（闭环）
2. `_unload()` 永不结算 ⇒ `fiber.inertia` 永不清空（`fiber.ts:669`）
3. `Loader.await()` 的 `while` 永不出循环（`vendor/loader/src/config/tree.ts:43-49`：只要有 entry 的 `_initTask`/`fiber.inertia` 非空就继续 `Promise.allSettled`）
4. `app-boot/src/index.ts:1010` 的 `await ctx.get('loader')?.await()` 永不返回 ⇒ `appReady.commit()`（`profile-boot.ts:317`）不执行（web 面同源：`bundle/web-app/src/index.ts:284` 的 `announceReady` 也挂在同一个 `loader.await()` 上）
5. ⇒ 不打印 URL、不落诊断、CPU 静置——**与实测指纹逐条吻合**

## 已排除项（均为探针实证，非推断）

| 假设 | 结论 | 证据 |
| --- | --- | --- |
| `inject: ['dshHomePath']` 无法满足（PENDING） | ❌ 排除 | 真 cordis 4.0.4：provide 普通函数后 apply 正常执行 |
| 缺服务的插件停在 PENDING 会挂死 `tree.await()` | ❌ 排除 | 真 cordis：`getTasks()` 长度 0、`await()` 正常返回 |
| 异步 disposer await **自己**的 `fiber.await()` 链会自锁 | ❌ 排除（第 1 版探针） | 该形状单独存在时 dispose 正常结算 |
| peer 版本门禁误伤 | ❌ 排除 | 全部 peer 通过（带 `includePrerelease`），行未被 `disabled` |
| 组合解析（`--dump-config`）出错 | ❌ 排除 | 退出 0、0.26s、stderr 空、重复 id 0 |
| `--dump-config-schema` 的 4 个 error | ❌ 无关 | plugin-free 控制组产出**逐字节相同**的 stderr |

⚠ 环复现探针**第 1 版**的**设计缺陷**值得记下：它在 dispose 之前就让 `fiber.await()` 链结算了，测到的是「已结算」分支，因此证伪不成立。修正为「dispose 发生在写在途时」后**才复现**（`fiber.dispose()` 超时、`fiber.inertia` 仍在），且**对照组**放行那笔写后立刻解锁——因果由此闭合。

## 最终决定

**disposer 只能等「不依赖本 fiber 结算」的在途工作。**

这条判据把「等」分成了两类，是本修复的关键区分：

| 在途工作 | 是否依赖本 fiber 结算 | disposer 可否等 |
| --- | --- | --- |
| 那笔 `settings.update` 配置写 | **是**（写要等重组，重组要等本 fiber 卸载） | ❌ **绝不可等**——等它 = 卸载等自己 |
| 在途的 `storage.domain.open` | 否（只依赖 storage 后端 I/O） | ✅ **应当等**——不等则句柄泄漏、新 apply 撞 already-open |

1. **不等那笔写**（`src/adapter/index.js`）：disposer 不再 `await storeReady`（那条链的根即配置写）。
2. **但要等在途的 open**：在途 open 的收场链（`openSettled`）被 disposer 等待，确保句柄在**卸载结算之前**已释放。storage 域同名单句柄（`storage-domain/src/index.ts:104-105` `already-open`），平台重组是「卸载旧 fiber 完成 → 才 apply 新 fiber」，故句柄晚关一步，新 apply 的 `open` 就会撞 already-open 并把管理 API 永久降级成 internal。
3. **open 之前先查 `disposed`**：被销毁就不再发起 open（否则开出无人持有的句柄，或与下一次 apply 抢同名域）；open 之后再查一次，被销毁则自持关闭。

旧实现是「用 `await storeReady` 顺带保证第 2 条」——保证本身正确，代价是把第 1 条的闭环也一起等进来了。修复把两者拆开：**等有界的那一段，不等会闭环的那一段**。

⚠ 测试判别力的教训（值得记下）：第 2 条的回归闸**初版是假绿**。它用同步 `close()`，于是「等待收场链」与「不等待」在微任务顺序上恰好都得绿——**消融掉 `await pending` 后测试仍全绿**，即该断言没有判别力。改为**跨 macrotask 的慢关闭**（`await setTimeout(25)`，更贴近真实后端 I/O）后，消融立刻变红、复原转绿，判别力才真正建立。⇒ 写「顺序/时序」类断言时，必须用消融确认它真的会红。

这条判据对**所有**插件成立，不限于本插件：disposer 一旦依赖本 fiber 发起的在途异步链，就等于让卸载依赖自己完成。

## 直接后果

- 新增回归闸 3 项（`test/adapter.test.mjs`）：**③ 在途写不结算时 dispose 仍须结算**（红→绿：修复前 1578ms 挂死、修复后 66ms 通过）；① 已开域在销毁时同步关闭；② open 在途期间销毁不泄漏句柄。
- ① 与 ② 是**为了守住修复可能丢掉的两个保证**而写的，不是装饰：① 对应「重挂不撞 already-open」，② 对应新引入的竞态分支。
- 全仓库 `effect(() => async …)` 形状**清零**（四个插件扫查 0 命中）。

### 真框架消融（决定性证据）

在**真 `@deepseek-ai/cordis@4.0.4`** 上构造同一闭环，只改 disposer 形状、其余全同：

| disposer 形状 | 迁移链结果 | 事件序列 |
| --- | --- | --- |
| 修复前：`await storeReady` | **HANG**（2.5s 超时） | `apply#1 → write-start` |
| 修复后：有界语义 | **SETTLED** | `apply#1 → write-start → write-done` |

「写」同样复刻平台语义（先 `fiber.dispose()` 再返回，对应 `app-boot:290` 对旧 fiber 的 `await`），故这是**单变量消融**：唯一的差异就是 disposer 是否等待在途链。修复后 `store` 在卸载时尚未开（写在途），disposer 无事可关、置位返回；随后写完成、链看到 `disposed` 直接返回 null，不泄漏句柄。

⚠ 探针第 1 版**设计有缺陷，值得记下**：它在挂载后立刻扫描 `inertia` 判 boot 完成，而 `plugin()` 返回时 apply 已同步跑完、`inertia` 尚为 `undefined` ⇒ 立即判 SETTLED，迁移链根本没开始（现场：只有 `apply#1`、无 `write-start`）⇒ **两个变体都"通过"，什么都没测到**。改为直接 race 那条链本身后才复现。这条与「第 1 版环探针提前结算」是同一类错误：**探针必须确认自己真的进入了被测路径**。

### 残留在途重挂是收敛的（已验）

断环之后，那笔迁移写仍会让平台**重组本插件**（卸载 → 重新 `apply`）。这不是死锁，但若第二次 `apply` 读到的 `intentMigrated` 仍为 `false`，就会再写一次 ⇒ **启动循环**（同样是启动不成功，但指纹不同）。真 cordis 上以「共享可变配置 + 真 `fiber.restart()`」建模，实测：

```
apply#1 → write#1 → apply#2 → apply#2:skip-migration → write#1-done
apply 次数 = 2，迁移写次数 = 1  ⇒ ✅ 收敛
```

收敛的两个前提，都由现有实现满足：① 写路径**持久化先落盘**（`config-editor` 先 `writeFileAtomic` 再 `reconcileProfilePatches`，`:130`/`:132`），故第二次 `apply` 读到的是 `intentMigrated: true`；② `migrateLegacyIntent` 首行即 `if (current.intentMigrated === true) return false`（`migrate.js:26`），不重复写。⇒ 最坏情形是**多一次 apply**，不会循环。

## 重访条件

- 平台若为「apply 期写配置」提供**不触发重组的**通道（或让 `reconcileProfilePatches` 不再等待被重组 fiber），则第 1 条的时序顾虑消失，迁移可直接在 apply 内完成、无需 `fiber.await()` 前置。
- 若上游让 `Fiber._unload()` 对 disposer 施加超时，则本条不变量降级为「性能建议」而非「正确性要求」——但**仍不应**依赖它。

## 尚未验证（如实登记）

- **实例级复验未做**：修复后未起实例。已在**真 cordis 4.0.4** 上完成单变量消融（修复前 HANG / 修复后 SETTLED，见上），但以下仍属**推断**：真实 boot 下 `settings.update` 确实走到 `reconcileProfilePatches` 并因此重组本插件 fiber（探针用 `fiber.dispose()` 复刻该效果，**未**接真实 `config-editor`）；真实重组后新 apply 的 `openStore` 不撞 `already-open`（单测/探针只用假域，未在真 storage 后端上验证「旧句柄已释放」）。
- **`withFileLock` 的 2s 等待上限**（`DEFAULT_LOCK_WAIT_MS`）意味着锁竞争本身不会永久挂——故环的成因确实是**自我等待**而非锁饥饿；这一点由「对照组放行后才解锁」和锁超时存在共同支持，但未单独探针验证锁超时路径。
- **卡死时的真实堆积点未取栈**：进程全程 CPU 静置，未抓到 JS 栈样本（未用调试器附加），环的判定来自源码链路 + 在 vitro 复现 + 现场指纹三方一致，而非运行时栈。
