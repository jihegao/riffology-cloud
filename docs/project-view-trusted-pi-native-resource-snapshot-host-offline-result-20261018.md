# TrustedPi native host 离线验证结果 — 2026-10-18

[原固定包](project-view-trusted-pi-native-resource-snapshot-host-offline-packet-20261018.md) 获明确授权后，695e请求完成**一次构建、一次断网镜像mock及原CID清理**。runner终态11:47:11.166794Z通过；冻结独立reader随后核原记录/17原CLI和两个新Docker GET，确认CID `6bc8aab1…` NotFound、同operation label全状态列表为空。整理结果未重跑测试或远端检查。[完整结果](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-execution-20261018/result.json) · [安全原件与边界](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-execution-20261018/README.md) · [独审](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-execution-20261018/sources/actual-result-independent-review.json)。

base原a946/index、f18 platform、07c1 config的固定三份raw哈希、48diffID及闭合Config合同匹配。派生镜像保留原48层前缀成为49层；Engine Id、build IID和descriptor均为 `sha256:0bb9af7a5909c41187cf56402a21420100c72a8de0025b0a7152f8804e85d191`，**角色为OCI index、856B**。新config digest仍null，可运行平台manifest/config未单独取证；本批没有export/push或Registry发布。

真正的image模式探针为Node22.23.2、UID/GID10002，`env -i`后严格仅PATH，12文件/1host overlay/14检查全通过；包含实际native host与ControlledPi facade、合法resources终态/digest、冷恢复元数据无模型重放、legacy五字段，以及三种不合法输入在创建Session/模型调用前拒绝。合成model3/research3、Session创建3/销毁3，projectTool/ambientFetch/报告内realProvider均0。它们是同一断网容器内的fixture，**不证明原supervisor/常态容量释放或真实project_write已修复**。

[原T1失败与释放](project-view-trusted-pi-ordinary-t1-result-20261018.md) 仍成立：没有R1，没有继续T2/T3/第二Session/gate。PR253未因本批合并，应用/Gateway未因本批更新，新0bb9仅本地。原9c8e/f18部署及maintenance end、历史请求/费用预留和锁全部保留；原12:42:46Z真实验收期限未延长。费用usage仍待核对，不记0。本结果只满足本批离线mock范围，JHG-46及完整JHG-56仍未完成。
