# DSR-028：`connection.rpc.handle` 必须在注入 `webServer` 的 ctx 上注册

> 状态：**已修复，静态闸全绿**（2026-09-28）。`npm run check` 退出 0：产物新鲜度 + 语法 + 分层门禁 + `node --test` **162/162**（新增 1 项 DSR-028 回归闸，经消融确认有判别力）。
> ⚠ **实例级复验未做**——修复后尚未在真实 test 实例启动观察（红线：实例启停由用户执行）。见文末「尚未验证」。

## 症状（实测，2026-09-28）

test 实例（0.1.7-rc.2）**启动成功**（这是 DSR-027 生效的证据），但 Plugins 页上两个插件行
都标「异常」，启动日志给出：

```
dsh: warning: 2 entries did not activate
skill-manager (dsh-skill-manager): Error: cannot get property "webServer" without inject
    at Object.handle (…dsh-client-connection/lib/index.js:576:39)
    at Object.apply [as callback] (…plugins/dsh-skill-manager/src/adapter/index.js:215:24)

unity-search (dsh-unity-search): Error: cannot get property "webServer" without inject
    at Proxy.register (…dsh-client-connection/lib/index.js:656:16)
    at registerRpc (…plugins/dsh-unity-search/src/adapter/rpc.js:60:22)
```

「异常」在界面上是 `rowPhaseFailed`（`ui-plugin-manager`），即**Host 侧行 fiber 处于 failed 相位**——
不是 Client 半区问题，也不是实例崩溃（插件行不在 `requiredStartupEntryIds` 里，故只告警不致命）。

## 根因

注册路径末端要触达 `owner.webServer`，而 owner 是**读该服务的 ctx**，它没有 `webServer` 的 inject 声明：

```
插件 apply → ctx.connection.rpc.handle(channel, handler)
  → connection/lib/index.js:573   get rpc() { const owner = this.ctx; … }
                                  （owner = 读 connection 的那个 ctx，即本插件 fiber 的 ctx）
  → 同文件 :656                    owner.effect(() => owner.webServer.register(route))
  → cordis 守卫                     vendor/cordis/src/reflect.ts:140 `Reflect.has(target, prop)` 未命中
  → 抛                              cannot get property "webServer" without inject
```

两个插件的 `inject` 都含 `connection`，但**都不含 `webServer`**：

| 插件 | inject |
| --- | --- |
| dsh-skill-manager | `connection, workspaceRegistry, storage, dshHomePath, settings` |
| dsh-unity-search | `web, tools, skills, connection, dshHomePath` |

平台自身的写法就是动态注入：

```ts
// packages/client/connection/src/index.ts:139
ctx.inject(['webServer'], (webCtx) => { … })
```

**为什么只有这两个插件失败**：`dsh-guardrails` / `dsh-method-principles` 不使用 `connection`，
从不进入这条注册路径。

### ⚠ 这不是 0.1.7 的新要求（更正一处早期判断）

初判曾把这归为"0.1.7 新增的前置条件"，**证据不支持**：0.1.2-rc.1 的运行时里同样成立——
其 `connection` 也把 owner 绑成 `this.ctx`（`lib/index.js:517-518`）、也执行
`owner.webServer.register`（`:588`），其 cordis 也有同一守卫（`:675`）。

准确的说法是：**这个前置条件在两代都存在，我们只是在本次才开始真正跑到这条路径**
（此前从未在 test 实例成功启动过这两个插件：先是 DSR-027 的启动卡死拦在前面，
更早则从未实测）。⇒ 归类与 DSR-025/026 同源：**"不变 ≠ 已适配"**——API 名字没变，
但代码从一开始就漏了声明，只是没有闸门发现。

## 最终决定：动态注入，且必须用回调给的 ctx

```js
// skill-manager：直接包住注册
ctx.inject(['webServer'], (webCtx) => {
  webCtx.connection.rpc.handle('/skill-manager', createDispatch(api, { writeQueue }))
})

// unity-search：把注入后的 ctx 传给 registerRpc（注册在该函数内完成）
ctx.inject(['webServer'], (webCtx) => {
  registerRpc(webCtx, { registry: diagRegistry, … })
})
```

**两个易错点**（都会复现生产报错，已由回归闸钉死）：

1. 不能在 `apply` 里直接调 `ctx.connection.rpc.handle(...)` —— 本 fiber 的 ctx 没声明 `webServer`；
2. 回调里必须用 **`webCtx`** 读 `connection`，**不能**用外层 `ctx` —— 外层 ctx 同样没声明。
   （只包一层 `inject` 而仍读外层 ctx 是无效修复。）

**为什么用动态注入而非静态 `inject: [..., 'webServer']`**：`webServer` 由 profile 的 web bundle
提供（`@deepseek-ai/dsh-web-app` 的 `webserver` 行 = `@deepseek-ai/dsh-host-webserver`），
**不是本插件的依赖**。静态声明会让本插件在不含该行的 profile 上永远 PENDING——
正是 DSR-027 那类启动挂死。动态注入的降级形态是「不注册 RPC，插件仍可挂载」，面小得多。

## 直接后果

- 新增回归闸：skill-manager `test/adapter.test.mjs` 的 DSR-028 用例、unity-search
  `test/dsr028-rpc-inject.test.mjs`（后者是**该插件首次覆盖 `apply` 的 RPC 接线**——
  此前 `test/` 无任何 `registerRpc` 覆盖，正是本缺陷漏到实测的原因）。
- 两个假 ctx 都**复刻了守卫语义**（外层 ctx 的 `handle` 必抛），使「绕过注入」和「误用外层 ctx」
  两个易错点都会变红。
- 消融双向验证：改回直接调用 ⇒ 复现 `cannot get property "webServer" without inject`；
  复原 ⇒ 转绿。

## 尚未验证（如实登记）

- **实例级复验未做**：修复后未起实例。要验：test 实例重新启动后 Plugins 页两行不再标「异常」、
  启动日志无 `2 entries did not activate`，且两插件的 RPC 通道真实可用
  （设置页/技能页能读到 Host 数据即证）。
- **`webServer` 缺失时降级形态未实测**：按设计此时只是不注册 RPC；本仓库无「不含 webserver 行」
  的 profile 可验，属读源码推断。
- **⚠ 探针未能体外复现该守卫，这是本轮最值得记下的方法教训**：我写了 5 版探针
  （v1 自造 Service、v2 加 effect、v3 用真包 apply、v4 用真 `HostConnectionService`、
  v5 简化 Service），**全部三个场景都"通过"**——包括本该失败的基线。
  原因：cordis 守卫入口是 `reflect.ts:140` 的 `Reflect.has(target, prop)`，它与
  **服务提供者所在的 fiber store、traceable ctx 的重绑链**耦合，自造件与真包的属性可见性不同；
  而真包链路又需要 `credentials`/`attachments`/`BrowserAuth` 等一长串桩，越补越远。
  ⇒ 本轮结论**不依赖体外复现**，而是三方一致：① 生产日志的完整栈（含插件源码行号）；
  ② 平台源码链路逐行可读；③ 假 ctx 复刻守卫后的消融双向验证。
  **教训：当体外复现成本高于取证价值时，应转向"假件复刻守卫 + 生产栈对齐"，
  并明确标注哪些是推断。** 探针脚本留档于 `tmp/probe-*.mjs`（未提交）。

## 重访条件

- 若上游把 `webServer` 依赖从注册路径上摘掉（例如 connection 自己持有 webServer 引用），
  本决定可撤——RPC 注册可回到 apply 内直调。
- 若上游为「需要 webServer 的插件」提供官方声明位（如 `dsh.client.requires`），
  应改用它而不是手写动态注入。
