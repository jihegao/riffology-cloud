# G5-A B2 生产尝试与关闭态诊断（2026-09-16）

状态：**未通过，fail closed；G5-A 未完成，G5-B/G6 未启动。** 本次仅使用合成输入。普通用户链实际接纳了一个Project、一个Session和一个建模Turn；产品事件随后记录`provider.status:error:503`，Turn以`pi-turn-failed`结束。该事件不能证明上游HTTP响应码。没有工具调用，没有Simulation Run或Service Run。

## 冻结范围与实际消耗

本次沿用已批准的G5-A边界：总额US$20、每Turn US$5、147次上游dispatch、39个Simulation Run、0个Service Run、66个task，首次实际admission起2小时停止新任务。第一次失败后立即停止新admission，没有重放原始intent。

实际计数为2个task（Project与Turn）、1个Project、1个Turn、1次dispatch、0个Simulation Run、0个Service Run。三账本保留9,910,450 nanodollars，即US$0.009910450的最坏预留；没有provider usage终态，因此这不是invoice，真实上游收费仍未知。OpenAI账户usage/cost只读接口对现有key返回403，不能据此宣称费用为零。

## 可核验失败链

普通用户事件按序为`turn.queued`、`turn.started`、`provider.status:requesting`、`provider.status:error:503`、`assistant.message`、`turn.checkpointing`、`turn.failed:pi-turn-failed`。关闭态authority随后回读到同一调用：Guard=`unknown`，token=`unknown/pending`，money=`unknown`，terminal不存在，tool active/pending/unknown均为0。

历史记录只剩`errorCategory=outcome-unknown`。旧路径会先记录可能存在的具体上游分类，随后在usage未验证和结算失败时以通用分类覆盖它，因此无法从现有持久记录区分上游明确非2xx与2xx流终态/usage校验失败。Gateway关闭payload日志，当前发布也未保留足以恢复该历史根因的模型遥测。原请求不得重放来补证据。

## 修复、审查与关闭态发布

集成提交`6ca2797`使money ledger保留第一个具体错误类别；通用`outcome-unknown`只能填空，不能覆盖已有具体分类。独立复核GO，P1/P2均为0。

提交`26b84a8`新增operator-only的脱敏provider failure读取；首次独立审查发现客户端会接受附加字段和伪造收据，并且多调用排序无法证明账本关联，结论NO-GO。追加提交`5a33bc0`改为同一authority Context聚合Guard/token/money，用连续ordinal关联，客户端递归校验exact shape、scope和类型并重算收据；复核转为GO。关闭态真实回读又暴露`terminal=null`空值路径，`d98ee38`增加显式空值保护和真实Workerd回归，独立复核GO且P1/P2均为0。

主控最终复跑TypeScript typecheck和48项聚焦测试全部通过；空值修复后再跑14项聚焦测试全部通过。生产仅发布关闭态诊断版本：commit `d98ee38669077c24834265ffe2c1b215600c7cef`，Worker version `3e290ab4-88b4-4ddc-b9f8-083f786a419a`，deployment `0a601bad-6b5f-44ba-804b-73e6e7af3fc7`，100%流量，线上source SHA256 `2ba578e96c7d7fbabebcec013c64d132afd8c44b014b87f066f69e99fb9a039d`，闭门config SHA256 `b762ff4f317b4cab94fcbac0283200c2a99a53ad1040eb6b84453fd137ce5909`。`G5_ADMISSION_ENABLED`、Turn、provider、production model、Simulation和Service六个门禁均为false。

临时operator在读取签名诊断后已删除，独立`deployments status`返回不存在。一次短时调试版本只向Cloudflare实时日志写入受控异常名，没有记录请求内容、身份、凭据或provider标识；随后已恢复严格脱敏operator再完成读取并删除。

## 结论与下一窗口门槛

本次不是G5-A验收证据，不能关闭#46，也不能启动G5-B。当前窗口有1个dispatch和一笔未结算unknown，保持永久fail closed；切换版本、关闭门禁或创建新ID都不能清除此事实。

仅批准新window和新实体ID仍不足以继续：全局Guard会让旧unknown Call及其open Turn阻断任何新窗口，现有compiler和driver也不接受残余64 tasks、146 dispatch和US$19.990089550 policy。取得原调用的权威provider usage终态并按既有协议结算，或另行批准并实现一次性rollover安全语义之前，不得重新开启G5-A。后者属于改变既有“任何unknown全局阻断”约束，不能由原窗口授权推定。详见[后续窗口阻断审计](g5-a-rollover-blocker-20260916.md)。G5-B和G6仍需另行确定范围和预算。

本次失败产生的全部平台白名单脱敏诊断和本地诊断副本按7天清理；没有生成可按30天保留的成功验收包。本文件仅长期记录开发状态、汇总计数、预算边界和发布元数据，不包含精确诊断时间、签名收据、身份、请求标识、会话或payload，因此不作为诊断副本或验收证据。
