# TrustedPi Registry 参数顺序修复：固定镜像已发布并独立清理

2026-10-18，同一 JHG-46 Goal。用户已明确授权 `abd265e503c77a5fb2a9256dd8365f5849d2df05` / manifest `89f2f285` 的新 `fb99c7e4-21a7-4215-8261-c17dd7c148aa` 单次批次。实际正常同用户 OAuth consent/token 均 exit0，目标用户哈希/账户与精确六scope匹配；唯一 Registry 凭据 POST HTTP201，SSH stdin发送成功。一次固定平台push及51次发布后raw回读完成，唯一完整ACK通过。

Registry目的地为 `registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi:jhg46-pi-resource-compat-20261017-a946b164`；发布平台manifest为 `sha256:f18a826d40b2fd60e2cf8c49d7f7b8f595fa609fe2be4c28593479ae846960ea`（9396 B）、config `sha256:07c199e17490cc4fdf3e8027770f8a7413090d4e7c3a1f44aa9064e115641059`（18775 B）。原a946/856仅为本地Engine/index，未上传index/attestation或宣称签名。只读复用原407955456 B/SHA83b81e55…归档，52 blob/48运行层diffID匹配；0export、1archive verify、1 Docker push CLI。51次回读为tag/digest各1 manifest、1 config、48 layer槽位（含重复digest），不称48唯一layer或全部API请求数。

远端终态原时间02:03:05Z、本机终态02:03:09Z；不证明跨主机时钟同步。冻结独立reader核对27份固定记录和5原CLI/startTicks、原supervisor、临时认证目录/7897均释放；独立本机检查和root交叉检查确认原30182/30207/30219均回收且不存在。没有重新push、生成凭据或以新请求替代未知收尾。

[完整实际结果、精确身份和安全来源](../evidence/releases/project-view-trusted-pi-registry-argv-repair-execution-20261018/README.md) · [结构化结果](../evidence/releases/project-view-trusted-pi-registry-argv-repair-execution-20261018/result.json) · [清单](../evidence/releases/project-view-trusted-pi-registry-argv-repair-execution-20261018/inventory.json)。[冻结修复包](project-view-trusted-pi-registry-argv-repair-packet-20261018.md)与[原9ec实际失败](project-view-trusted-pi-registry-recovery-result-20261018.md)保持原字节和各自历史边界，不覆盖c3e旧403或其原因未知。

本次持续OAuth containers:write保留，没有账户/仓库资源过滤，不因临时Docker配置清除而撤销或恢复五scope；15分钟为账户Registry凭据请求TTL，未证明服务端撤销或自然过期。HTTP201不解释旧403。未取得应用/Gateway/model/费用作用域权威计数，不宣称全账户零活动或零费用。

**本批仅完成Registry发布及原身份独立释放。** a036尚未随此镜像rollout，native DOM v3 Gateway的既有发布保留；不能把Registry image已发布写成应用已部署。 未合并#239/#246，未rollout应用/Gateway/门禁，未启动容器验收或真实项目/模型/Turn/Run；普通受邀skill→双页/保存/刷新/离开/冷恢复、整体JHG-46及完整JHG-56仍未完成。下一合并/rollout/用户验收各按具体范围和最新门禁推进，不能由本次发布自动扩大。

前提交abd265e…的原自动CI39088048795/attempt1于02:04:05Z成功（14返回步；条件skip保留、未读测试计数/完整日志），仅作为前提交CI；不套用新增实际结果的后续head，也不替代真实验收。
