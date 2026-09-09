# TODO

待办与未决事项（仅未完成项；完成即写入拥有该事实的设计文档并从此处移除）。

## 待办

- **2026-09-09 三项修复的 web 生效**（用户操作）：源码已改（页边距对齐标准节 / 新建组可见性与成功话术 / 写后自动收敛刷新，DSR-021），`dist/client.js` 已重建、`npm run check` 全绿、test 实例已 `link:` 直挂实测启动。**生效两步缺一不可**：① 子仓库 push + 顶层 gitlink 提交 + `dsh plugin --profile web add github:FengZhiHen1/dsh-skill-manager` 重挂 → 刷页即生效（client 半区）；② Host 半区（`src/adapter/index.js` 写队列注入）必须重启 web 实例才生效（`dshl instances restart`，需用户明确指令）。缺 ② 时页边距/组可见/自动刷新仍工作，只是后台对账与写操作可并发（旧行为）。
- **GUI 浏览器走查**（test 实例现场：`link:` 直挂 + 已配置 `E:\Project\Skills\skills`）：设置页「技能」两视图渲染与 ⋯ 菜单/徽章/挂载失败展开、修复提示词一键复制出口、本地修改遮罩确认对话框（Host 边界已实测不可绕过，剩渲染面）、改 `dist/client.js` 一句文案后仅刷页的产物增量通道、Console 无 `slot entry crashed`；**新增走查项**：AC-16 写后自动收敛（改配置不点刷新）与新建组滚入视野、5.2 页边距与「插件/通用」页对齐（对齐判据：外壳 `.options` 的 24px 独供，页内零自加内缩）。结果回填 `需求.md` missing evidence 节。
- **boot 级组合测试补齐**（2026-09-01 design-spec-workshop D5 登记延期）：knowledge/21 §6 要求产品可见插件有真实组合测试（boot 测试 cordis.yml 过 Loader，非手拼 `ctx.plugin`）；现状只有单元测试 + 手工冒烟清单（`technical-details/插件运行时.md` 验证计划）。**重访条件：首次 npm 发布或对外分发前必须补齐**；一次实施批次以单测 + 分层门禁 + test 实测为语义保全证据链，不混入此项基建。
