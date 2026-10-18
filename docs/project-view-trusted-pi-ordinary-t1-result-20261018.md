# 普通受邀 T1 实际失败，原释放随后完成 — 2026-10-18

**本次付费执行验收失败，剩余 T2/T3 与 browser gate 已停止。** 已部署 Gateway 9c8e / version `5a840cbc-49c5-45cd-badc-b75553c78566`，原应用 v12/f18，以及[明确接受差异后的原 maintenance end](project-view-trusted-pi-rollout-result-20261018.md) 均已另行确认；它们不替代普通用户验收。[安全结果与完整边界](../evidence/releases/project-view-trusted-pi-ordinary-t1-20261018/README.md) · [机器结果](../evidence/releases/project-view-trusted-pi-ordinary-t1-20261018/result.json)。

普通受邀身份的 authVersion=2、accepted invitation、active personal owner、非平台角色通过 fresh 只读 bracket。普通 UI 只创建一个 blank 项目 `e7044b0b-839a-4e44-9636-ab0c3b77b7ae` / workspace `3e1e0106-503e-42e1-89ce-35a26612935e` / generation 1；初始化 ready 和同 scope snapshot200 是源码验证过的初始化/stop/quota-release 产品投影，未取得独立 raw bootstrap stop 回执。随后只创建 Session 1 `bc034608-8a61-47c4-b323-9f6143bca607`，10:12:17.477Z 单次提交固定 OpenAI/gpt-5.6-luna T1，原 ACK 202，body 3,473 B / SHA256 `36ee35cbd1a879f0b2ac8771f7bc1410ec6d82415f1b9f80f4d1d56ecb51f16c`。

同 Turn `bd291436-baeb-43bb-9cc2-b92f62c06c78` 的精选事件有两次 provider HTTP200、一次 `project_write` 完成且 isError=true。原终态为 `failed / turn-native-exit-failed`，保存为 `failed / turn-checkpoint-unknown`；checkpoint、Session head、canonical revision 均为 null，无 R1，故未进入 T2/T3、R2/R3、第二 Session 或 gate open/close。provider 200 不等于整个工具/原生流程成功，也不等于费用已核。

10:14:03.337Z 的原 `releaseHold` 为 assignment guard；10:23:07.527Z 完整快照仅该 hold 清空，其余 data 不变；10:23:09.641Z 原用户 Beta GET 为 available。原产品释放投影与执行失败分开记录，释放完成不能补造 R1。未宣称 raw stop/ticket proof、idle VM 已释放、全局零容器或零费用。

原工具副作用及原始错误原因仍 unknown。10:18 receipt GET 的 400 来自缺少 name/revision 查询，不能用作 pipe 故障根因；无 R1 时也没有对应 canonical receipt authority，不猜 revisionId。独立本地 host-resources 缺陷由 [#252](https://github.com/jihegao/riffology-cloud/issues/252) In progress 处理，不表示已修复或重验本次 project_write。当前只做最小缺陷诊断；不自动重放 T1、换项目/Session/key、fallback 或补第四 Turn。

原窗口仍为 2026-10-18T12:42:46Z；未延长。usage/费用未对账，金额 unknown，不记零；项目、Session、历史模型/Revision、usage/预留及失败证据保留。JHG-46 保持未完成，浏览器页面、刷新/冷恢复及 full JHG-56 矩阵未覆盖。本次证据整理没有额外云操作、付费调用、测试/构建、生产源码或原 end 证据修改。
