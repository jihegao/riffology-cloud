# JHG-46 fb07：已发布 SDK，T1 已保存；已知 idle placement 替换提案

本页记录截至 2026-10-18T22:24:30Z 的实际检查点，并提出一个最小范围差异决定。**提案尚未获接受，不授权 T2 或新资源操作**。原 [8f7b 固定包](https://github.com/jihegao/riffology-cloud/blob/8f7b8c00ec4e01f7ab694fd6bf26dbd55960a2b1/docs/project-view-native-sdk-publication-acceptance-packet-20261019.md)及 c65b 总输入保持原字节；本页不改写其已批准范围。

PR #257 已正常合并为 `004e5cd5940c6e283b1b58501c3f409a569f6e20`，双 parent 为原 main240378 与固定 headfca66。唯一 Gateway 发布完成，原 ACK 为2026-10-18T22:04:19.812Z，实际 Worker `d2660428-5ccb-4fb9-b1bd-d6b8ba26959f` / deployment `f32cef50-1c49-42ac-9514-b26837c68d24`，bundle304373a5…/5,774,988B。原前后各39 GET保全及独审通过；96资产无Cookie完整GET共53,784,755B全部匹配。页面准入保持关闭。frame原闭门503的顺序校正已保留：其同一只读GET安排在未来R2释放及唯一有限PUT后、V1前，当前仍pending，不记为静态全通过。

新普通项目仅一个Session和T1。T1 completed/saved，R1=`768fc2ff2c44a5005cbaeae9b433f47f19c71bb0fb88cdaf70a1c11992d259fb`；两工具ledger completed，bash exit0，skill6056B/8ef3375d…，Diff added4/modified0/deleted0。原公开receipt不提供精确bash script/timeout参数，不能把prompt、exit0或目录结果提升为实际参数逐字验证。T1后guard快照四个hold/active字段已clear，但22:24:17容量仍release-pending，**原T1联合释放尚未确认**；不因saved、经过时间、available单项或空Dash放行。

## 唯一待决定差异

最新22:24:27–30四个完整物理GET显示：目标仍为原 `d03b8c4d-8cc2-475e-ba96-6e46d062983c`、v13/ec8、default/basic、max_instances=1；当前唯一placement变为 `9f18c9ab-e7ea-47bc-8238-efce81feea0e`，VM health=running、container=stopped。10个logical均inactive、Dash instances=[]。当前身份已通过list/exact关联，但不据此证明T1导致该替换、原8ef5已处置或全部历史VM释放。该idle VM仍可能计费，费用unknown不记零。

原包只允许已知 `8ef5d3a1-a30c-47c6-8608-b557b6bbc23a`，明确不扩大到新/unknown placement。因此本提案**仅在原fb07窗口内，将单个已知idle例外从8ef5替换为上述精确9f18**；不同时保留两份例外，不接受任意后续替换，不新增、删除、重启、rollout或maintenance hold。其余原次数、字节、provider/model、时限、并发、计量与停止边界全部不变。

原窗口为2026-10-18T21:59:00Z至2026-10-19T01:59:00Z（上海05:59–09:59），不延长。即使差异获接受，也必须先按原T1身份确认canonical/工具/runtime/capacity及完整物理scope的联合释放，再继续原计划T2/R2；R2释放后有限gate，V1通过才唯一Session2/T3。未知继续原身份只读对账，不重放T1、换项目/key/window/provider或增加修复Turn。

#214保持Acceptance/blocked；#255已部署实现处Acceptance、Issue OPEN，未Done。新T2、gate、V1实际包/frame/artifact完整chunks、Session2/T3/V2及整体验收均未覆盖，不称JHG-46完成。旧a25f失败、已释放两Turn及已关闭gate历史保留。

[本提案安全证据](../evidence/releases/project-view-native-sdk-idle-placement-difference-20261019/difference-proposal.safe.json)与[inventory](../evidence/releases/project-view-native-sdk-idle-placement-difference-20261019/inventory.json)绑定原公开安全独审及private原件尺寸/SHA。没有公开raw userId、邮箱、tenant、host、位置、凭据、原账单或prompt/配置正文。
