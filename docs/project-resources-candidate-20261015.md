# #85 项目文本资源本地候选

2026-10-15；基线 origin/main `fbc0e46bde2c8781b71609fa4524d2e75bffaf99`。独立工作树 `/tmp/riffoid-m1-resources-20261015`，分支 `codex/m1-project-resources-20261015`。本记录是实现及本地验证快照，不替代 Issue/Linear 排期。

本页保留原作者工作树的实现说明与历史测试报告。历史数字和“完整检查退出 0”未绑定本轮最终冻结源码，尚未独立复核，不能作为当前候选通过证明。本轮冻结 SHA、文件清单、检查命令、实际退出码和 skip 由集成负责人记录后另行引用。

## 已实现

- 从既有 canonical immutable Revision archive 发现根 AGENTS.md、`.pi/skills/<slug>/SKILL.md` 和 `.pi/prompts/<slug>.md`。沿用 RevisionStore 的授权和摘要验证；不挂载项目目录、不扫描可信 host 的本地资源。
- Turn 读取绑定 claim baseline 的 Revision ID/文件摘要，资源读取前后核对 active Turn、scope、Session、dispatch、generation、取消、时限和当前 Catalog 授权。
- `project.resources/v1` 记录 project scope、Revision ID、archive SHA256、各文本 path/kind/content SHA256 和整个资源包 SHA256。最多 16 份、每份 8 KiB、总正文 24 KiB；research transport 的 64 KiB 总响应边界继续保留。
- 根 AGENTS 进入真实 Pi SDK 上下文；skills/prompts 有真实 loader metadata。坏正文/编码返回有界 path/code/digest diagnostics，拒绝加载该资源并保留下一回合修复入口。模型可用 `project_load_resource` 从冻结内存包加载选定文本；`/skill:name` 和 `/prompt-name` 展开对应正文。未选 skill 正文不注入；manual-only skill 拒绝模型侧加载，用户显式命令可用。prompt 支持一次性 `$ARGUMENTS`/`$@` 替换，不执行 Shell 或递归命令。
- 保存与原生恢复兼容有界 inert provenance；仅同来源恢复已加载标记，并标记 loadedFromHistory。无资源会话保留旧快照形状。新的安全任务边界加载新 Revision；SDK reload 不重新发现宿主文件。旧文本和工具结果仅作为会话历史恢复，不派发旧工具/模型请求。
- 新的无 ModelSpec 项目不再全局注入五文件/固定画布/禁止 HTML 的 simulation profile；已有保存的 ModelSpec 继续使用对应仿真规则。
- 项目扩展、模型/凭据发现、本地 Shell 和任意插件继续关闭；冻结文本不能改变 bridge、预算、执行账本、supervisor 或保存权威。

## 原作者报告的测试覆盖与限制（本轮未复核）

原作者报告：真实 Pi SDK + 本机 HTTP protocol fixture 验证 AGENTS、显式命令、模型主动加载、未选正文、跨项目拒绝、冷恢复零重放、原凭据/扩展/取消边界；canonical archive 测试验证摘要篡改、路径、体积、坏 frontmatter 与别名/循环 YAML 拒绝；native adapter 验证 provenance 的保存及跨项目拒绝。这些覆盖描述尚未按本轮最终冻结源码复核。

原作者历史报告称，M2 全套回归在修正纯 JavaScript SHA256 共享依赖后为 **967 pass / 0 fail**；本轮未复核该数字。此后又增加 manual-only 及安全错误透传，并加强异步授权与 Revision ID 核对，因此该切片不能代表最终冻结验收。原作者报告保留了第一次 M2 的 node:crypto 浏览器打包失败日志，沙箱内初次 Node 原生断言崩溃不计通过；本轮检查结果待集成负责人记录。

frontmatter 当前只支持有界单行 name/description/disable-model-invocation 标量，不支持通用 YAML、include、自动递归引用或 Node 插件。链接作为 inert 文本；额外参考文件仍经原项目工具读取，不自动进入此冻结资源包。没有对 #85 完整云端/用户验收签收。

原作者在该历史阶段报告：没有启动付费线上模型、修改凭据权限、恢复或删除项目、合并或部署；#208/#210/#217 原分支和主目录既有改动未修改；没有推送代码或创建新 PR。这是原阶段边界，不替代本轮发布记录。

## 与 #214 的整合状态

#214 的本地候选已新增 `project.views/v1`、HTML/modules/CSS/media 包、固定 frame、只读 MessagePort broker 与 UI 接入。原作者报告新的合成端到端用例覆盖 skill→工具写文件→canonical archive/Session 保存→冷恢复→真实浏览器导航与刷新，恢复没有重放；本轮同版执行结果待记录。

独立审阅复现任意 DOM JS 可用 iframe 自身导航外发数据，CSP connect-src none 无法阻止该请求。通用页面的生产 Gateway 与 execution frame 因此明确禁用，仅允许双 loopback 本地合成验收；没有部署或放宽权限。详见 [页面契约与阻碍](project-views-local-contract-20261015.md)。不能宣称 #214 或 M1 完整交付。

最小整体验收仍须在全新项目完成：写 skill → 下一任务真实加载 → 生成多页 DOM/modules/CSS/media → 保存冻结 Revision → 刷新/离开恢复相同页面及来源；冷恢复不重放、旧 generation/撤权/跨项目拒绝。Observer/WebGL/WASM 不作前置。部署、真实双身份和付费验收分开记录。


## 原作者历史整合报告（2026-10-15，本轮未复核）

原作者历史报告称各检查组件通过：check:ui 21；typecheck；M0 353 pass / 1 skip；M1 549 pass；M2 970 pass；M3 的四个子套件合计 1096 pass / 12 skip；issue73 30 pass；research-quality 8 pass；git diff --check。这些数字没有绑定本轮最终冻结源码，尚未复核；跳过项不计通过。

原作者报告完整 npm check 首轮在 M3 停止：仿真 profile fixture 仍使用 model:null 却要求 simulation 注入，后改为带 spec 的上下文；另一 TLS fixture 因系统 LibreSSL 不支持 pkey -check，改用已有 OpenSSL 3 的测试进程 PATH。其随后声称完整 M3、issue73 和 research-quality 重跑通过，并保留失败与后续日志。本轮未复核该重跑结论，不将失败的单次 npm check 进程记为退出 0。

原作者历史报告称 14 项页面针对性用例通过，包含真实 Pi SDK 的合成新项目保存/冷恢复及真实 Chromium 导航/刷新；本轮尚未复核该数字。P1 导航外发阻碍保持，生产入口继续禁用。

原作者 R2 续作报告另见 [页面契约](project-views-local-contract-20261015.md)，其中声称“单次完整 npm check 退出 0”及“#85 独立复核未发现新增回归”，列出 UI 21，M0 353/1 skip，M1 549，M2 970，M3 1101/12 skip，issue73 30，research-quality 8。上述均为未按本轮最终冻结源码复核的历史报告，不是本轮通过或独立复核结论。当前冻结检查待集成负责人记录。

## 旧 Browser Preview 退役的代码依赖

当前 `services/project-resources/text.mjs` 仍导入 `services/browser-preview/runtime/sha256.mjs`，两份 trusted-pi Dockerfile 也复制该共享摘要实现。旧 Browser Preview 退役前必须先把这项通用依赖迁出旧目录，并同步导入与镜像复制路径，避免连带损坏 #85。此处记录现有耦合，不表示保留旧 Browser Preview、恢复旧案例或新增交付范围；页面侧依赖见[页面契约](project-views-local-contract-20261015.md)。

## 本轮集成复核边界

当前资源接线仅覆盖 Trusted Pi；ManagedProductRuntime 尚未接入 skills，不能宣称所有新个人项目可用。真实 Worker 授权到镜像 Pi、保存和冷恢复链路仍待认证验收。另发现资源数量/体积超限会阻断启动、模板参数展开缺少展开后大小预算，需在后续最小修复中处理。
