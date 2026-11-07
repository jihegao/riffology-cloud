# c263 authorized publication attempt stopped — 2026-10-18

用户明确批准d948/6fd/08466固定批次后，本机driver真实启动一次。正常token CLI退出0并reaped，返回同六scope/固定身份与账号；随后原SSH退出1，local终态 **12:20:18.483962Z** 为 `original-publication-ssh-nonzero`。原SSH stdout0B，stderr仅保771B及SHA；没有Ready，Registry POST未尝试、凭据stdin未发送、final ACK=false。本机once已消费，不能自动重放。

[实际结果](result.json) · [独审](sources/actual-stop-independent-review.json) · [原终态](sources/local-terminal.json) · [原身份停止后对账](sources/stop-readback-observation.json) · [纯本地wire诊断](sources/wire-diagnosis.safe.json) · [文件清单](inventory.json) · [一页结果](../../../docs/project-view-trusted-pi-native-resource-snapshot-host-publication-stop-result-20261018.md)

停止后按原身份的独立只读观察在 **12:21:53.621814Z** 确认远端ROOT/records/archive/temporary-auth均不存在、7897监听0/连接errno111；随后本机ps确认原SSH96233和tokenCLI95869均不存在。原观察的observedAt是远端读取时刻，本机PID检查稍后加入，不能称所有观察完全同时。它是另行停止对账，没有调用Docker/Registry，也不是成功路径冻结reader通过。

实际grant是有效的完整JSON（4,632B/119个LF），本批执行者以pretty多行保存。冻结sender使用 `g.rstrip(LF)+LF`，receiver只读第一行，因此只得到2B `7b0a`（左花括号和LF）；纯本地JSON解析可复现JSONDecodeError，且固定源码中该解析先于ROOT.mkdir/export。执行者已明确说明这次输入格式失误。**实际remote stderr正文未被固定driver保存**，这里不声称恢复了远端traceback；源顺序诊断与实际无Ready/原目录不存在分别保留。未重新运行driver、完整CLI、fixture或远端reader。

公开目录包含13份安全原件逐字节copy及2份投影：授权仅保安全事实/hash，token CLI intent只替换本机可执行路径；没有原grant/人类回复、OAuth/token/stdout内容、stderr正文或Env/Config。`preflight-local-only.json` 中false字段为执行前快照，不能盖过后续真实OAuth/SSH活动。driver原stdout与pretty终态JSON语义一致，分别746B/826B，字节哈希不同。

本请求未到达原远端目录创建和export/push阶段，新archive/runnable/config仍未知，Registry发布未成立。不能把OAuth正常成功写成Registry凭据已生成，也不能把Registry POST未尝试写成零auth/云端活动；正常token命令及两项显式身份GET已发生，CLI内部网络请求总数未取证。持久OAuth同scope刷新状态不因进程/路由清理而撤销。

条件PR253合并依赖实际发布与独立清理，当前未满足；没有merge、rollout、Gateway/gate、新Turn/项目或旧12:42:46Z截止延长。695e镜像mock成功、失败T1/释放和此前历史/锁/费用预留保持原样。费用usage未核，不记0；JHG-46未完成。后续恢复准备/新授权/执行须另列，本目录不写尚未发生的成功结果。
