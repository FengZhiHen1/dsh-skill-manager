# TODO

待办与未决事项（仅未完成项；完成即写入拥有该事实的设计文档并从此处移除）。

## 待办

- **2026-09-09 三项修复的 web 生效**（用户操作）：子仓库已 commit + push（远端 master 现为 `00cdb6d`，含 `d2164e0` fix / `a9c49d5` docs / `6c39088` 红线 / `f9b56d2` 默认种子翻转 / `00cdb6d` 回归闸与实测记录）。生效两步：① `dsh plugin --profile web add github:FengZhiHen1/dsh-skill-manager` 重挂 → 刷页即生效（client 半区：页边距、新建组可见性与成功话术、写后自动收敛刷新）；② Host 半区（`src/adapter/index.js` 写队列注入）须重启 stable-dev 才生效（`dshl instances restart`，需用户明确指令）。缺 ② 时上述三项仍工作，只是后台防抖对账与写操作可并发（旧行为，可能出现 EEXIST 型误报挂载失败）。
- **GUI 浏览器走查**（test 实例实测场，2026-09-09 起为**合成库** `E:\Project\Skills-test\skills`，5 个 `demo-*` 夹具 + 12 个命名组，专供复现组列表裁切）：设置页「技能」两视图渲染与 ⋯ 菜单/徽章/挂载失败展开、修复提示词一键复制出口、本地修改遮罩确认对话框（Host 边界已实测不可绕过，剩渲染面）、改 `dist/client.js` 一句文案后仅刷页的产物增量通道、Console 无 `slot entry crashed`；**本批次专项**：AC-16 写后自动收敛（改配置不点 `↻ 刷新`）、第 13 个组新建后可见（选中滚入视野）、页边距与「插件/通用」页对齐（判据：外壳 `.options` 的 24px 独供，页内零自加内缩）。结果回填 `需求.md` missing evidence 节。
- **DSR-022 B 案（挂载归属登记）落点已定型、实现未开工**：2026-09-09 用户确认 **丙-c = storage 域新表 `managed_links`**（每 HOME 一份，不新增文件；就地清单与独立中心文件两案否决理由见 DSR-022「丙 的落点三选」）。原列**硬前置（DSH skill 根能否容忍非目录条目）随该落点整体消解**，无需再核对 `agent/23-skill.md`。摘除权改由登记授予、realpath 前缀降级为「不夺取」下界、自检重建同受约束、adopt 一次性认领——语义全文见 DSR-022 第 10–12 条与本文档两份 technical-details。开工次序：表声明 → 三处写入点 → 判据切换（含自检重建与「宁可残留」三分支）+ adopt → 回归闸（验证计划第 6、7、9 条，均可 unit 层复现，不起进程）。
- ~~DSR-022 待决一条~~ **已闭合（2026-09-09 用户定「宁可残留」）**：语义与三条分支（域不可用＝零变更且同关 adopt／表空＝adopt／表非空未登记＝永不摘）已写入 DSR-022 第 10 条末与**新增第 13 条**，验收落为验证计划**第 9 条**；B 案设计层面无待决，可直接开工。
- ~~A/B 案落点复评带出的收口项~~ **五项已全部落地（2026-09-09，`npm run check` 131/131）**：事实与理由写进 DSR-022 **R8**、`入站操作.md`（残骸出口、update 直进 stage）、`挂载与同步.md`（exclude 原子写、非行级警告）、`项目结构设计.md`（四模块职责行）。新增未决：`detachLink` 删除后，「显式摘除单个 (skill,target)」这一动作在代码里已无入口——若 B 案之后的修复流程需要它，按 `managed_links` 判据重建而不是复活旧函数。
- **A 案提交未推送**（2026-09-09）：`0fef5e6`（审计台账，15 文件 +896/−50）只在本地，`git push` 卡在 `github.com:443`（连接重置/超时），`origin/master` 仍为 `00cdb6d`；顶层 gitlink 因此**故意未提**（次序：先 push 子仓库再提顶层）。网络就绪后：`git push origin master` → 顶层 `git add plugins/dsh-skill-manager && git commit`；本次文档修订（DSR-022 + 两份 technical-details + TODO）另起一个 docs 提交，不与 `0fef5e6` 混提。
- **boot 级组合测试补齐**（2026-09-01 design-spec-workshop D5 登记延期）：knowledge/21 §6 要求产品可见插件有真实组合测试（boot 测试 cordis.yml 过 Loader，非手拼 `ctx.plugin`）；现状只有单元测试 + 手工冒烟清单（`technical-details/插件运行时.md` 验证计划）。**重访条件：首次 npm 发布或对外分发前必须补齐**；一次实施批次以单测 + 分层门禁 + test 实测为语义保全证据链，不混入此项基建。
