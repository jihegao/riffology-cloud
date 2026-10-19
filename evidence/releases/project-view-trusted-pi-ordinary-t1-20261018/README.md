# 普通受邀用户 T1 实际失败与原释放结果

2026-10-18，普通受邀本人身份通过 authVersion=2、accepted invitation、active personal owner、无平台角色的只读核对，在已确认的原 maintenance end 后，通过普通 UI 唯一创建一个 blank 项目和 Session 1，并单次发送 T1。Gateway 已发布 9c8e / version 5a840，原 Pi 应用已 rollout 到 v12/f18；这些已部署事实与本次验收结果分开。

原 Turn `bd291436-baeb-43bb-9cc2-b92f62c06c78` 于 10:12:17.477Z 发送，原 ACK 202。精选同 Turn 事件观察到两次 provider HTTP 200，以及 `project_write` 的 `tool.completed.isError=true`。最终为 `failed / turn-native-exit-failed`、`persistenceOutcome=failed / turn-checkpoint-unknown`，checkpoint 与 Session head 均为 null，未形成 R1。没有发送 T2/T3、创建第二 Session 或发送 browser gate PUT/DELETE。结果见 [result.json](result.json)、[事件安全投影](selected-failure-events.safe.json)。

10:14:03.337Z 原快照仍有 `trusted-pi-release-assignment-guard`；10:23:07.527Z 同 scope 完整快照仅 releaseHold 变为 null，其余 data 逐项未变；10:23:09.641Z 原普通身份 Beta GET 为 `available`。这是产品原释放/容量投影已清，不能称 raw native stop/ticket 回执、全局零 VM 或零费用；先前经明确接受的 idle VM 未被宣称释放。[pending](failure-release-pending.safe.json) · [cleared](failure-release-cleared.safe.json) · [Beta](beta-available.safe.json)。

10:18 的工具 receipt GET 缺少必需 name/revision 查询而返回 400，属于无效读取，不是原 pipe/tool 故障原因。当前 canonical revision=null，无 R1 可供 canonical tool-receipt authority 读取，不伪造 revisionId。原 `project_write` 的原始效果/根因仍 unknown；canonical 无 Revision 也不能证明没有局部、未提交的原生文件影响。独立本地 host-resources 复现另由 [#252](https://github.com/jihegao/riffology-cloud/issues/252) 处理，不提升为已修复本次 project_write。[canonical](canonical-head.safe.json) · [无效读取](invalid-tool-receipt-read.safe.json)。

仅公开 whitelist 状态、计数、原 body SHA、scope hash 和允许的随机项目/workspace/Session/Turn ID。原身份、ACK、完整快照和完整提示词不复制；原件字节/hash 保留在 [source-observation-bindings.json](source-observation-bindings.json)。8 条精选事件来自原 45 条事件响应，不是完整公开对话或账户级请求计数。usage/费用未核，amount=null，不记零，历史预留保持。[inventory](inventory.json) 逐项绑定本目录安全文件。

T1 失败后原 2 Sessions / 3 Turns 的后续验收停止；不重试、换 key/项目/Session 或补第四 Turn。原项目、原历史与锁保留，JHG-46 及 full JHG-56 未完成。详情见 [结果文档](../../../docs/project-view-trusted-pi-ordinary-t1-result-20261018.md)；此前 [原 maintenance end](../project-view-trusted-pi-maintenance-end-20261018/result.json) 证据不改写。
