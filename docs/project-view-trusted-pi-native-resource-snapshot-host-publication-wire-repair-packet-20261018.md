# c263 原身份单行授权修复：待恢复授权

原c263已实际尝试且停止：正常六scope token/身份读取已完成，SSH exit1、stdout0、stderr771B、无remote safe events；credential POST/stdin均false。原根任务只读回证12:21:53Z确认remoteROOT/records/archive/auth不存在、7897已关闭及原CLI/SSH均不在。未导出/未推送/未合并；不作全局零费用或零活动结论。

纯本地实际grant诊断锁定传输问题：4632B pretty JSON本身有效，旧发送端保留换行，冻结接收端只读到 `{`+LF；其pure parser在创建ROOT前失败。原stderr正文未保存，不声称观察到具体traceback。修复仅local inputs在Auth/STATE前拒绝非“单行JSON+恰一末尾LF/无CR/producer原字节不变”的授权，remote/OCI/scope/reader完全不改，3项新增producer/consumer回归通过。

沿原requestc263、source0bb/index856/49layers、原尚未创建的AMD目录与新tag；保持所有旧once锁和失败原件，在本机新repair-once副本进行一次明确批准的控制续接。新授权必须明确允许已消费的一次token/route之后再一次正常同权限token读取和SSH路由，grant用compact JSON+末尾LF并固定新manifest。它不是原授权自动retry，也不通过新请求/项目/镜像绕行。

原唯一export/full原blob+49diffID/新tag一次platformpush/完整rawreadback/临时凭据和route清理/独立reader，以及完成后root条件普通合并PR253的合同保留。runnable/config仍未知，须在固定0bb原始链验证后实际派生。不build/pull、无rollout/Gateway/gate/新Turn/模型/项目、不延长旧runtime。当前只准备，恢复尚未执行。[完整候选](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-wire-repair-preparation-20261018/README.md)。

[已公开的原c263停止结果](https://github.com/jihegao/riffology-cloud/blob/cb6a48ae29078e7d44859dd36916a740fdf3cf52/docs/project-view-trusted-pi-native-resource-snapshot-host-publication-stop-result-20261018.md) 保持原字节。新[操作件manifest](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-wire-repair-preparation-20261018/operations-manifest.json) 固定 `76dfb4606c75424c01a00220805f6efb5b32afbf474fd003fe540641bb97c309`（8核心+3额外源）；完整[source binding](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-wire-repair-preparation-20261018/candidate-source-binding.json) 固定 `2e47be8e7478dd1cdf176792e4c76e836a2b2fad73e091f4b06b9d8c85f434f8`（19源/安全证据）。

[独立窄审](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-wire-repair-preparation-20261018/reviews/wire-repair-independent-review.json) 无 must-fix，未重测或执行；[3项新增pure检查](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-wire-repair-preparation-20261018/offline-checks.safe.json) 与旧17/11历史分开。[公开文件清单](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-wire-repair-preparation-20261018/inventory.json) 固定完整公开字节，不含grant/答复、OAuth或原rawstderr。当前无恢复授权，不启动本机repair-once或远端动作。
