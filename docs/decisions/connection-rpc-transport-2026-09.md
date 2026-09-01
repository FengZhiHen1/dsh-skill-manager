# DSR-014：传输层迁移到官方 connection.rpc 通道

> 状态：已确认（2026-09-01，design-spec-workshop D1），代码实施待执行；实施前 `plugin-runtime.md` 等文档按目标形态描述。

## 上下文

插件自建 `POST /skill-manager/api` 路由（`ctx.webServer.register`）+ 自携带受信围栏（`lib/fence.js`，判定逻辑复制自 dsh-better-sidebar），并因此把 `loader` 列入 inject 只为读 connection 行的 `trustedHosts`。2026-09-01 对照知识库 `client/17-remote-rpc.md` 并双重验证源码与部署运行时后确认：

- 官方通用 RPC 通道 `ctx.connection.rpc.handle(channel, handler)` 对**自定义 channel** 同样逐请求应用平台围栏 `isTrustedApiRequest`（回环/trustedHosts Host 头 + 拒绝 `sec-fetch-site: cross-site` + origin host 匹配）——与 fence.js 同一算法（部署运行时 `0.1.1-rc.2` 的 `@deepseek-ai/dsh-client-connection` bundle 实证）；
- alpha.3 源码 `packages/client/connection/src/rpc-host.ts`：围栏之后追加 `browserAuth`（process token/cookie，401）——升级运行时即白得一层认证；
- 注册 fiber-scoped（`owner.effect`），插件卸载时 channel 自动摘除；信封校验、端点匹配、415/400 均由平台承载。

自建围栏与信封因此是与平台重复的自维护代码，且永久少一层 browser-auth。

## 真实方向与评价

- 方向 A：迁移到 `ctx.connection.rpc.handle('/skill-manager', handler)`。删除 fence.js 与 `loader`/`webServer` inject，围栏与信封由平台维护，卸载清理自动；client 侧 `createCall` 换成 `ctx.connection.rpc.call`（inject 加 `connection`）。代价：信封形状 `{ok,data}` → `{ok,value}`，`retryable` 迁入 `error.details.retryable`；本插件私有协议（唯一消费者是本插件 Client），无外部破坏面。
- 方向 B：维持自建路由 + fence。零改动、已实测可用；代价是继续承担与 dsh-better-sidebar 复制逻辑的漂移风险，且永远少 browser-auth 一层。

## 最终决定

采用方向 A：

1. Host：`ctx.connection.rpc.handle('/skill-manager', handler)`；方法名即 endpoint（如 `POST /skill-manager/overview`）；inject 改为 `['connection', 'workspaceRegistry', 'storage', 'dshHomePath', 'settings']`（移除 `webServer`、`loader`）。
2. core 的 `service.js` 提供 `dispatch(method, payload)`，返回**传输中立** Result：`{ ok: true, value } | { ok: false, error: { code, message, details: { retryable } } }`；`SkillManagerError` 与 `GhError` 的映射在 service 内完成，未知异常归类 `internal`（R-19 语义不变）。adapter 的 `rpc.js` 只做薄接线。
3. Client：`inject` 加 `connection`，`createCall` 改为 `ctx.connection.rpc.call('/skill-manager', method, payload)`；`dsh.client.inject` 元数据加 `@deepseek-ai/dsh-client-connection`。
4. 删除 `lib/fence.js` 与 `lib/api.js` 的 HTTP plumbing（`readJsonBody`/`writeJson`/`writeOk`/`writeError`）；自建 1MB 请求体上限随之消失（平台通道无显式上限；本插件 payload 均为小 JSON，风险记录在案、可接受）。
5. 三路队列与读屏障策略不变，从 index.js 收进 core `service.js`（R-17 语义不变）。

## 直接后果

- `technology-stack.md` RPC 行重写；`plugin-runtime.md` 传输节、Host 入口节、生命周期表、验证计划同步重写。
- `lib/fence.js` 与其测试 `test/fence.test.mjs` 删除；信封相关测试改写为 Result 形状断言。
- 部署运行时 `0.1.1-rc.2` 下围栏语义与现状等价（同一算法、平台维护）；升级到 alpha.3+ 后自动获得 browser-auth。
- 错误协议消费面只有本插件 Client（遮罩确认按 `code` 匹配，`retryable` 改读 `details`），无第三方破坏面。

## 重访条件

- 官方通道对自定义 channel 的围栏/信封语义收紧或废弃。
- 需要向非浏览器客户端（CLI、第三方脚本）暴露管理 API——届时按官方通道的 HTTP 可达性重新评估。
- 需要请求体尺寸硬上限等平台未提供的传输策略时，评估在 handler 内补充或回到自控路由。
