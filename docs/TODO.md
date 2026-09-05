# TODO

待办与未决事项（仅未完成项；完成即写入拥有该事实的设计文档并从此处移除）。

## 待办

- **web profile 重挂**（P10 用户操作，2026-09-05 更新）：web profile lockfile 仍钉 `ed7e124`（旧扁平 `lib/` 形态）。submodule 已推送后执行 `dsh plugin --profile web add github:FengZhiHen1/dsh-skill-manager` 重挂（命令与实例版本二进制路径按 `tools/dsh-launcher-cli` env 现查；红线：由用户执行，不重启 stable-dev 宿主进程）；完成后 `--dump-config` 复查 + 启动无 `N entries did not activate` + 刷页冒烟。
- **GUI 浏览器走查**（test 实例现场已备好，2026-09-05）：设置页「技能」两视图渲染与 ⋯ 菜单/徽章/挂载失败展开、修复提示词一键复制出口、本地修改遮罩确认对话框（Host 边界已实测不可绕过，剩渲染面）、改 `dist/client.js` 一句文案后仅刷页的产物增量通道、Console 无 `slot entry crashed`。结果回填 `需求.md` missing evidence 节。
- **boot 级组合测试补齐**（2026-09-01 design-spec-workshop D5 登记延期）：knowledge/21 §6 要求产品可见插件有真实组合测试（boot 测试 cordis.yml 过 Loader，非手拼 `ctx.plugin`）；现状只有单元测试 + 手工冒烟清单（`technical-details/插件运行时.md` 验证计划）。**重访条件：首次 npm 发布或对外分发前必须补齐**；一次实施批次以单测 + 分层门禁 + test 实测为语义保全证据链，不混入此项基建。
