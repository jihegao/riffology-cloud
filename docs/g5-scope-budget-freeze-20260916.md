# G5 新窗口范围与预算冻结（2026-09-16）

独立 Worker / Gateway 探针已返回models 200并识别Luna，随后完成云端清理；三个只增加Worker公网出口flag且固定原bundle的A/B/B-cold候选overlay已生成。A已以关闭门禁方式发布，精确bundle、deployment、vars、bindings、生产Gateway、零对象状态及259个inactive容器均已回读，closed-gate release proof齐备；B/B-cold未发布。详情见[隔离出口准备证明](g5-isolated-probe-readiness-20260916.md)。主Worker门禁、预算和首次admission时钟未变。

最新 staging 出口只读诊断与恢复版本见[Worker 诊断记录](g5-worker-origin-probe-20260916.md)：Gateway models 返回200且包含 `gpt-5.6-luna`，地区403未在 Worker 出口复现；这不是 Responses 推理验收。恢复冻结代码、全部关闭门禁及原预算后，G5 付费验收继续暂停，正式运行前须冻结 Worker 出口兼容配置的新 release proof。

授权依据：用户要求“完成生产接线及新窗口范围、预算冻结”。冻结既有 G5-A/B 具体提案，生产接线以关闭门禁发布；本轮不接纳付费模型任务、Project 或 Simulation/Service Run。G6、G4 剩余补测、推送/合并和 issue 关闭不在此范围。

| 窗口 | 固定范围 | 总额 / 每 Turn | 上游 dispatch | Simulation / Service Run | task 硬限 |
|---|---|---|---:|---:|---:|
| G5-A | 第一授权主体；3 Project、18依赖任务、39研究 Run；最多3终端故障 probe | US$20 / US$5 | 147 | 39 / 0 | 66 |
| G5-B | 两个不同授权 user/tenant；2 Project、22 Turn；暖复用/冷对照/换 Session/取消/恢复/FIFO/回退矩阵 | US$20 / US$5 | 168 | 0 / 0 | 24 |

A 再 B，线上执行严格串行；各自从服务端首次真实 admission 开始 7200000 ms 后停止新任务，关闭门禁的配置冻结不启动计时。两窗口共享唯一 money period/global actor 和 US$40 总额，不复用 G4 剩余额度。每个 Task、实际实体、Call、grant 独立持久去重，queued cancellation 不返还 task 名额；Simulation child Run 按实际 Run 计数。A 的 66 是包含 probe/group intent 余量的硬限，不代表一定执行66个实体；正常3+18+39=60，最多3 probe Turn，剩余3仅留安全余量，不增加正常任务或研究 Run。

两个主体已由现有目录只读核对 active user/tenant/owner membership，互异身份；第二用户为已授权的 `jihe.gao@theidsa.org`。真实 UUID 和私有政策仅存最小权限本地文件，公共 manifest 只含摘要。普通登录与跨 tenant 权限仍须真实执行签收。

两窗口均使用 OpenAI API `gpt-5.6-luna`、Cloudflare Gateway、原生 Responses、platform BYOK；不将 G4 的 OpenCode Go 推理计入此验收。token 固定8 reserve/8 dispatch、输入262144、输出4096、Turn reservedTokens2129920。独立 `G5_TOKEN_BUDGET_POLICY_JSON` 不改写旧 `MODEL_BUDGET_*`、G4 policy、namespace 或不可重置 fence。Money 每窗口20、每Turn5，shared global/user/tenant40，按向上取整 nanodollars 保守预留。

B另有闭门cold variant `wrangler-B-cold.json`：只将lazy/reuse两个runtime gate设false，window/profile/token/money/source完全相同，无新增预算或window ID。用于已冻结的冷对照及冷回退，暖pair实际退休/双域释放后才切阶段；不能靠切variant重新执行未知任务。[Cold variant摘要](g5-b-cold-variant-proof-20260916.json)绑定原B overlay及source proof字节；本轮不发布或执行该variant。

固定任务 fixture SHA256 为 `3e410718f9143da69f3bc63407f4452ae7802afb299f250657be51a40a756fb4`。A 目标沿用16/18、每类别至少2、安全/伪造0；主控冻结筛查目标 p95 Turn≤120秒、模型费用/合格任务≤US$1。它们是小样本验收筛查值，不是长期 SLO、实际性能或额外准入授权。任务细节见[具体提案](g4-closeout-g5-execution-proposal-20260916.md)。B 暖配置保持闲置60秒、最大30分钟、16 binding、guard360秒、quiet30秒、容量2及共享 FIFO；版本摘要绑定当前实际镜像和本次代码，不能冒称原生物理身份已验收。

仅合成数据，平台脱敏诊断7天、验收证据30天，已实际写入并独立读取专属 R2 生命周期；上游默认保留与本地副本清理另有边界，见[数据评审](g5-privacy-freeze-20260916.md)。[费率冻结](g5-ratecard-freeze-20260916.md)的模型最坏预留分别US$10.3563264/11.8358016，不是invoice结果。

任何未确认创建、start grant ACK 丢失、费用/usage unknown、未关闭三账本、身份或 release 冲突均阻断全局后续新任务及下一窗口；关闭或切换 window 不清零 fence。先按原实体只读核对并安全收尾，不能重新创建或重放未知请求。A 终端 unknown probe 可能阻断 B；不以跑完矩阵为由清除未知。

当前真实通道阻断：Gateway 原生 `/models` 返回 OpenAI HTTP403 `unsupported_country_region_territory`，0推理。生产配置接线与预算冻结可交付，但通道尚不可标记可用。提供符合上游支持地区要求的通道并重新核验后，才可另行安排首次付费准入；不得单凭密钥/token存在或本地fixture解锁。五个模型/Turn/Simulation/G5 gate 与 money.enabled 保持关闭。

生产接线已关闭门禁发布：Worker version `1afa24e5-f327-412a-b22b-1a921130a7ae`，deployment `579ac95f-a403-4d91-b003-cc659ff723d1`，100%，2026-09-16 UTC00:46:16。源码提交 `5d468296da3b68c20362fe5a6a7b4e5e0f1d9a9b`；源码清单 SHA256 `680259b32bef0f6680266ebc562a01556f850e76da1ddd773b30f7e636d6ffc8`，线上下载的 `index.js` 与本地两phase dry-run逐字节摘要一致：`ba7f989e7cf0de7ae16e67314e0875c79650b7235ebbc9887d4d617b190a1b03`，4120280字节。实际发布A闭门overlay；B暖/冷配置范围已冻结为后续阶段，不在本轮开启。

所有冻结vars独立GET逐项一致，五个新任务/模型/Simulation gate与Service=false，money.enabled=false；3新DO与2生产secret名字已读回，旧15 namespace ID、G4 policy、MODEL_BUDGET政策、5 container app ID及实际image均保持。发布后UTC00:49:25分页完备读取259实例，nonInactive=0；3新预算namespace对象均0，因此本窗口未接纳任何任务/推理/新Run、两小时未启动。公共root HTTP200，未认证providers HTTP401，仅为健康/认证边界检查，不是普通用户建模验收。

完整check2053项：2042通过、11环境/opt-in跳过、0失败；额外G5驱动23/23，非作者实际Workerd复核3/3。SDK两phase dry-run完成，CLI在部分命令输出完成后未退出，主控以构建字节/独立云readback确认完成后仅终止对应CLI进程，没有重复部署或推理重试。上游403地区阻断仍保留；未进行G5付费benchmark、实际暖复用物理身份验收或关闭#46/#37。

冻结private bundle位于隔离工作树`.local/issues-20260915/g5/frozen-v1/`，directory0700、policies/overlay0600，wx+fsync、不同字节不覆盖；临时上传用secret JSON已精确删除，原项目`.dev.vars`保留。后续改变源/通道/profile须生成新的具体评审版本；已有server window/deadline/money unknown不可清零或创建新ID绕过。

公共摘要：[窗口manifest](g5-frozen-window-manifest-20260916.json)、[实际源/镜像pin](g5-production-source-proof-20260916.json)、[生产readback](g5-closed-production-readback-20260916.json)、[发布前独立检查](g5-production-wiring-verification-20260916.md)。脱敏白名单冻结证据已PUT至MODEL_CONTENT `g5-acceptance/g5-20260916-wiring-v1/evidence/closed-wiring-evidence.zip`，8541字节，SHA256 `74683f9244cba8b16c1560b3050f3edeef10e3bc3ab9b50f33f794deba612137`；独立GET字节一致，6/6内部SHA256SUMS通过。30天规则已独立核对；不上传scope中的真实邮箱、principal UUID、账户ID、privatepolicy、凭据或原始session。
