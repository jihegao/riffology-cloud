# PI WEB / Riffoid 验收记录

## 0.3.1 独立接入与新一轮验收

2026-10-18 开始、跨 10 月 19 日继续的 M3/M4 工作在独立 worktree 实施。Riffoid 固定包工具、受控 CLI、普通项目页面与独立 SQLite/R2 运行投影已进入代码审查；原 0.3.0 源工作区及仓库外历史模型保留。范围和基线见 [Riffoid 接入说明](riffoid-integration.md)与 [宿主 #254](https://github.com/jihegao/riffology-cloud/issues/254)。

本轮把实际本地浏览器、真实本地 Workerd 存储、PI WEB 自然语言验收、线上部署与线上普通用户验收分别保留。最新双端 ACC、包/部署身份和运行证据以仓库的 `acceptance/results/m3-m4/` 及宿主发布索引为入口；未有对应实际证据的阶段保持未完成。下面的 0.2.0、0.2.1、0.3.0 记录均为当时版本的历史，不作为新版本线上通过证明。

## 0.2.0 初次本地验收（历史）

日期：2026-10-18，Asia/Shanghai。插件版本：0.2.0。

本次完成用户要求的 **pi-web 插件开发、安装与 riff-pi 测试**。本地 ACC-01 至 ACC-05 通过；Riffoid 适配入口和接入说明已提供，线上宿主尚未接入、部署或验收，因此不宣称 v0.2 合同的“双端完成定义”已达成。

## 测试工作区迁移与隔离

2026-10-18，测试工作区从插件源码仓库迁到 `/Users/jihegao/.local/share/riffoid-ir-plugin/workspaces/pi-web-acceptance`。迁移 `model/` 和 `.riffoid-ir/` 共 36 个文件，迁移前后逐文件 SHA-256 一致；重启后连接描述文件正常轮换，其余 35 个原文件在浏览器回归后再次核对一致。15 个原 runId、旧版运行时快照和当时已有的 0.3.0 三日故障模型均保留。

通过 Pi 公开 SessionManager 接口复制原会话完整历史，保留 258 条消息；PI WEB 的项目入口改为外部目录，原会话文件仍保留，其他项目不受影响。新会话 ID 为 `01a14f36-e783-74ba-9383-b0c5d5e422db`，已验证 `/sim show`、IR Model 连接和旧运行读取。

测试入口 `npm run start:test` 与 `npm run test:riff-pi` 默认使用外部工作区；工作区和原始输出路径都会检查真实路径，拒绝仓库自身、子目录及指向仓库的符号链接。测试临时使用 B1，结束或失败时恢复原有五个模型文件的原始字节，不再把当前三日模型留成验收样例。

17 项自动检查通过，覆盖目录隔离、原模型恢复和证据白名单。迁移后的 riff-pi Direct 回归通过，实际基准 `run-89efa612-9a62-4b68-a45d-068a620bd5c8`、修改版 `run-4b21070f-4bd8-4f7e-a223-fef9dce0f83b`、复跑 `run-8a0563a6-f305-48ec-9c46-7b195bb47e4f`，继续匹配固定预期和独立参考；当前三日模型和编译产物已恢复。

原始输出、模型备份、调试日志和安装包留在仓库外。使用 `acceptance:export` 复制了 30 个选定证据文件回仓库，并附 SHA-256 清单；模型备份和原始日志未导出。见[迁移核对](../acceptance/results/pi-web/workspace-migration-20261018/workspace-migration.json)、[浏览器汇总](../acceptance/results/pi-web/workspace-migration-20261018/summary.json)、[检查输出](../acceptance/results/pi-web/workspace-migration-20261018/check.txt)及[文件清单](../acceptance/results/pi-web/workspace-migration-20261018/evidence-manifest.json)。历史验收证据中的原工作区路径按当时事实保留。

## 0.2.1 领域包开发流程回归

同日用户反馈 Pi 拒绝 MTBF/MTTR、多日任务和领域包扩展。检查真实对话后确认：skill 把当前 B1 执行范围写成了开发限制，且缺少从能力诊断进入源码开发的工作流。此前模型验收消息还反复限定“不改插件源码”，后续显式开发请求需要按新的任务范围处理。

0.2.1 更新了 skill、共享开发指南和 Pi 上下文；`/sim show` 提供开发入口，编译器通过但浏览器未支持的 Plan 返回实际缺口层及源码路径。浏览器显示可交给 Pi 开发的提示，并保持不支持模型不可运行。新增连接适配支持本工作区 broker 重启后，在发送操作前采用新连接信息，不重试结果不确定的操作。

- 14 项自动测试通过，包括真实 SDK 编译三日/故障模型后的浏览器能力诊断、源码入口可读、替换 broker 后连接更新及工作区校验；skill 校验通过。
- 在原 PI WEB 会话 `/reload` 后验证 `/sim show`。保留用户当前的 `xai/grok-4.7`、high 设置，以只读任务回归：Pi 实际调用 28 次 read/bash，核对 lowering 和参考运行时，纠正先前拒绝，列出所需实现和待定业务参数。未调用写模型、编译或运行工具。这证明开发入口和诊断行为，未声称新故障语义已经开发完成。见[对话证据](../acceptance/results/pi-web/domain-development/conversation.json)及[截图](../acceptance/results/pi-web/domain-development/pi-diagnosis.jpg)。
- riff-pi Direct Bridge 对 0.2.1 重跑语法恢复、B1、修改版、重开与旧产物复跑，并验证多日 Plan 显示开发提示、运行按钮禁用、未新增运行；随后恢复合法修改版和当前编译产物。见[本次浏览器汇总](../acceptance/results/pi-web/domain-development/browser-regression/summary.json)和[能力缺口页面](../acceptance/results/pi-web/domain-development/browser-regression/domain-extension-diagnostic.json)。

本次实际 runId：基准 `run-29e4f101-8e49-4e4d-b3b3-f1c44d20529a`，修改版 `run-af618561-3061-49c5-ba04-d51cb2e5899b`，复跑 `run-d8cdf0fd-6712-4e13-b882-5a8f132ec950`。七项指标及关键事件继续匹配固定预期与独立参考。初次新增 UI 断言未考虑 riff-pi 的 `[ref=...]` 标记，已修正并完整重跑通过。

**0.2.1 记录的浏览器能力当时仍为 B1。** 后续 `aircraft-support-browser/0.3.0` 已实现七日以内的跨日保障，以及飞行暴露指数故障和固定维修时长，并与独立参考运行时对照。逐机架次绑定、日历时钟、非指数分布、多机波次、预防性维修、备件和运输仍被诊断拒绝。后文保留 0.2.0 初次验收记录与原始证据。

## 环境与身份

| 项目 | 实际身份 |
| --- | --- |
| 需求与固定输入 | 本仓库主分支 `f1f6762e774b5eba63b788a2baacde56d491c0fe`；需求及 fixtures 保留原始字节 |
| 插件 | `riffoid-ir-plugin@0.2.0`；安装包身份见 [package-build.json](../acceptance/results/pi-web/package-build.json) |
| PI WEB | `@jmfederico/pi-web@1.202610.3`，浏览器 API v4 |
| Pi | `@earendil-works/pi-coding-agent@1.3.0` |
| riff-pi | `riff-pi-browser@0.1.0`，broker health version 2；源码 `46312973496bb85135878be432e5b3ad3b20e4b6`，测试时工作区干净 |
| Agent | 同一真实 PI WEB 会话，`openai/gpt-6.1-sol`，medium |
| 编译器 | `sim-engine-compiler==0.1.0`，公开 seal/validate/compile/inspect SDK |
| 编译器制品 | wheel SHA-256 `e7bcd9271dd42106b78e87176e3485b290536f5291c0440872b814fc549858f7` |
| 编译环境 | macOS arm64，Node 26.10.0，Python 3.12.14，SimPy 4.1.1；从固定 wheel 提取可移植编译模块，未在 macOS 执行 Linux native runtime |
| 实际计算位置 | 用户浏览器中的 Worker；运行时 `aircraft-b1-browser/0.2.0`，SHA-256 `33e14373b8d409c91c1834154a3ee814ee27ff8e80302117ea56e2e67c5b9b83` |
| 结果性质 | local/unverified，不是 Verified Experiment |

真实会话 ID：`01a14e7a-3ce5-713e-bb05-e17fda2b897b`。已导出的会话、工具调用、模型解释与版本记录见 [agent-session.json](../acceptance/results/pi-web/agent-session.json)。会话最初配置的 gpt-5.5、gpt-5.4 被账号渠道拒绝；改用同一渠道的 gpt-6.1-sol 后完成验收。原失败记录保留。开发中发现并修复了全局 extension symlink 的相对导入，以及长驻 Pi 进程的共享模块缓存问题；最终版本的 `/reload` 和三个 `/sim` 命令已重新验证。

## 验收结果

| 编号 | 本地 pi-web | 实际证据 | Riffoid 线上 |
| --- | --- | --- | --- |
| ACC-01 完整闭环 | 通过 | Agent 创建 B1 草稿并遵守“暂不检查、编译或运行”；随后实际调用四工具，页面与 Agent 读取同一已保存 runId；三个 `/sim` 命令有宿主回执 | 未执行 |
| ACC-02 确定性正确 | 通过 | [baseline-record.json](../acceptance/results/pi-web/baseline-record.json)、[独立参考](../acceptance/results/pi-web/baseline-independent-reference.json)，七项指标、选定事件及第 30 分钟顺序精确匹配 | 未执行 |
| ACC-03 修改有效 | 通过 | [单字段修改](../acceptance/results/pi-web/business-edit.json)、[variant-record.json](../acceptance/results/pi-web/variant-record.json)、[独立参考](../acceptance/results/pi-web/variant-independent-reference.json)；Business/Plan 身份改变，第一任务不变，第二任务事件后移 5 分钟；Agent 在真实会话中对比两个 runId | 未执行 |
| ACC-04 重开与复跑 | 通过 | [replay-record.json](../acceptance/results/pi-web/replay-record.json) 记录 sourceRunId；重新加载实际浏览器后执行旧产物和输入，指标与事件完全一致；PI WEB 项目重新打开后旧记录仍可读 | 未执行 |
| ACC-05 诊断后继续 | 通过 | [syntax-diagnostic.json](../acceptance/results/pi-web/syntax-diagnostic.json) 含文件、行、列；riff-pi 修复后完成编译和浏览器执行。Agent 亦完成另一次冒号错误→诊断→修复→修改重跑，见会话工具记录 | 未执行 |

## 实际运行

| 来源 | 基准 | 修改版 | 原条件复跑 |
| --- | --- | --- | --- |
| 自然语言 Agent | `run-77f9d3b5-6399-472e-82ba-0e8936931ce9` | `run-1633d5d6-20e4-4955-8660-0bb3fcd05971` | `run-f042bce7-d11d-4323-a634-f8d1d4344f0d`，source 为同排基准 |
| riff-pi Direct Bridge | `run-eb6f2962-8d81-4c3d-94df-2bed005f4249` | `run-96b3fe4a-bf92-47f8-8cc5-7672fc86f98e` | `run-5eeab62d-158b-48fe-bf32-c053dd991869`，source 为同排基准 |

三种 riff-pi 运行的指标均为 planned/launched/completed/successful = 2，cancelled/delayed = 0，elapsed = 60。基准与复跑第二任务事件为起飞 40、成功点 48、返回 50、航后完成 52；修改版分别为 45、53、55、57。对应模型、Plan、simpack、运行时和独立参考结果保存在同一证据目录。

[机器可读汇总](../acceptance/results/pi-web/summary.json) 与 [Direct 同页观察](../acceptance/results/pi-web/riff-pi-observation.json) 记录实际浏览器连接和执行。截图由 riff-pi Shared 模式额外加载同一已保存结果获取；仿真验收在 Direct iframe 的同一文档中完成，截图不是执行证明的替代品。

![riff-pi 读取已保存的模型与结果](../acceptance/results/pi-web/riff-pi-preview.png)

## 复现

按 README 配置固定编译器、安装插件，执行 `npm run start:test`，在 PI WEB 打开外部验收工作区的 Browser 面板，再运行 `npm run test:riff-pi`。脚本拒绝在源码仓库内测试；原始输出和备份留在仓库外，结束或失败时恢复原模型文件，新增验收运行保留。成功后用 `npm run acceptance:export -- --from /absolute/external/results-directory`，按白名单复制证据回仓库并生成 SHA-256 清单。历史证据中的仓库工作区路径保留为当时实际来源，不改写旧运行记录。

`npm run check` 的 12 项检查通过，覆盖独立参考对照、不同保障时长/取消/交叠准备、能力拒绝、语法恢复、模式、快照复跑、断线、结果保存失败、引用完整性、工作区隔离、同源/token 检查和会话连接清理。建模 skill 的 quick_validate 通过。检查输出见 [check.txt](../acceptance/results/pi-web/check.txt)。

Riffoid 后续须按 [接入说明](riffoid-integration.md) 装配四个工具、fixedSkills、项目页面与具体 `ir.request` 提交保存动作，并在实际部署上完成全部 ACC。包内适配合同测试不替代线上验收。
