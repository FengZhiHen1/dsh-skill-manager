# TODO

待办与未决事项（仅未完成项；完成即写入拥有该事实的设计文档并从此处移除）。

## 待办

- **2026-09-09 三项修复的 web 生效**（用户操作）：子仓库已 commit + push（远端 master 现为 `00cdb6d`，含 `d2164e0` fix / `a9c49d5` docs / `6c39088` 红线 / `f9b56d2` 默认种子翻转 / `00cdb6d` 回归闸与实测记录）。生效两步：① `dsh plugin --profile web add github:FengZhiHen1/dsh-skill-manager` 重挂 → 刷页即生效（client 半区：页边距、新建组可见性与成功话术、写后自动收敛刷新）；② Host 半区（`src/adapter/index.js` 写队列注入）须重启 stable-dev 才生效（`dshl instances restart`，需用户明确指令）。缺 ② 时上述三项仍工作，只是后台防抖对账与写操作可并发（旧行为，可能出现 EEXIST 型误报挂载失败）。
- **GUI 浏览器走查**（test 实例实测场，2026-09-09 起为**合成库** `E:\Project\Skills-test\skills`，5 个 `demo-*` 夹具 + 12 个命名组，专供复现组列表裁切）：设置页「技能」两视图渲染与 ⋯ 菜单/徽章/挂载失败展开、修复提示词一键复制出口、本地修改遮罩确认对话框（Host 边界已实测不可绕过，剩渲染面）、改 `dist/client.js` 一句文案后仅刷页的产物增量通道、Console 无 `slot entry crashed`；**本批次专项**：AC-16 写后自动收敛（改配置不点 `↻ 刷新`）、第 13 个组新建后可见（选中滚入视野）、页边距与「插件/通用」页对齐（判据：外壳 `.options` 的 24px 独供，页内零自加内缩）。结果回填 `需求.md` missing evidence 节。
- **DSR-022 B 案（挂载归属标记）未开工**：A 案（操作级审计台账）已于 2026-09-09 落地并过闸（130/130 + 分层 + 产物新鲜；实现期修订 R1–R7 见 DSR-022「实现状态」）。B 案 = 每挂载根一份本 HOME 的 manifest，`findOrphanLinks` 改为「只摘自己清单里的」+ 一次性 adopt 认领，封死跨实例互摘链（A 案只追责、不防空）。**硬前置**：按 `knowledge/v0.1.2-rc.1/agent/23-skill.md` 核对并在实测场验证「DSH skill 根扫描能否容忍非目录条目」，不通过则换清单位置（候选 `writeJson`，该函数现为零调用方的孤儿导出）。验收对照余两条：DSR-022「验证计划」第 6、7 条 + 第 8 条（test 实例现场冒烟，须用户执行）。
- **boot 级组合测试补齐**（2026-09-01 design-spec-workshop D5 登记延期）：knowledge/21 §6 要求产品可见插件有真实组合测试（boot 测试 cordis.yml 过 Loader，非手拼 `ctx.plugin`）；现状只有单元测试 + 手工冒烟清单（`technical-details/插件运行时.md` 验证计划）。**重访条件：首次 npm 发布或对外分发前必须补齐**；一次实施批次以单测 + 分层门禁 + test 实测为语义保全证据链，不混入此项基建。
