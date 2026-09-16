# G5 新窗口范围与预算冻结（2026-09-16）

授权依据：用户要求“完成生产接线及新窗口范围、预算冻结”。冻结既有 G5-A/B 具体提案，生产接线以关闭门禁发布；本轮不接纳付费模型任务、Project 或 Simulation/Service Run。G6、G4 剩余补测、推送/合并和 issue 关闭不在此范围。

| 窗口 | 固定范围 | 总额 / 每 Turn | 上游 dispatch | Simulation / Service Run | task 硬限 |
|---|---|---|---:|---:|---:|
| G5-A | 第一授权主体；3 Project、18依赖任务、39研究 Run；最多3终端故障 probe | US$20 / US$5 | 147 | 39 / 0 | 66 |
| G5-B | 两个不同授权 user/tenant；2 Project、22 Turn；暖复用/冷对照/换 Session/取消/恢复/FIFO/回退矩阵 | US$20 / US$5 | 168 | 0 / 0 | 24 |

A 再 B，线上执行严格串行；各自从服务端首次真实 admission 开始 7200000 ms 后停止新任务，关闭门禁的配置冻结不启动计时。两窗口共享唯一 money period/global actor 和 US$40 总额，不复用 G4 剩余额度。每个 Task、实际实体、Call、grant 独立持久去重，queued cancellation 不返还 task 名额；Simulation child Run 按实际 Run 计数。A 的 66 是包含 probe/group intent 余量的硬限，不代表一定执行66个实体；正常3+18+39=60，最多3 probe Turn，剩余3仅留安全余量，不增加正常任务或研究 Run。

两个主体已由现有目录只读核对 active user/tenant/owner membership，互异身份；第二用户为已授权的 `jihe.gao@theidsa.org`。真实 UUID 和私有政策仅存最小权限本地文件，公共 manifest 只含摘要。普通登录与跨 tenant 权限仍须真实执行签收。

两窗口均使用 OpenAI API `gpt-5.6-luna`、Cloudflare Gateway、原生 Responses、platform BYOK；不将 G4 的 OpenCode Go 推理计入此验收。token 固定8 reserve/8 dispatch、输入262144、输出4096、Turn reservedTokens2129920。独立 `G5_TOKEN_BUDGET_POLICY_JSON` 不改写旧 `MODEL_BUDGET_*`、G4 policy、namespace 或不可重置 fence。Money 每窗口20、每Turn5，shared global/user/tenant40，按向上取整 nanodollars 保守预留。

固定任务 fixture SHA256 为 `3e410718f9143da69f3bc63407f4452ae7802afb299f250657be51a40a756fb4`。A 目标沿用16/18、每类别至少2、安全/伪造0；主控冻结筛查目标 p95 Turn≤120秒、模型费用/合格任务≤US$1。它们是小样本验收筛查值，不是长期 SLO、实际性能或额外准入授权。任务细节见[具体提案](g4-closeout-g5-execution-proposal-20260916.md)。B 暖配置保持闲置60秒、最大30分钟、16 binding、guard360秒、quiet30秒、容量2及共享 FIFO；版本摘要绑定当前实际镜像和本次代码，不能冒称原生物理身份已验收。

仅合成数据，平台脱敏诊断7天、验收证据30天，已实际写入并独立读取专属 R2 生命周期；上游默认保留与本地副本清理另有边界，见[数据评审](g5-privacy-freeze-20260916.md)。[费率冻结](g5-ratecard-freeze-20260916.md)的模型最坏预留分别US$10.3563264/11.8358016，不是invoice结果。

任何未确认创建、start grant ACK 丢失、费用/usage unknown、未关闭三账本、身份或 release 冲突均阻断全局后续新任务及下一窗口；关闭或切换 window 不清零 fence。先按原实体只读核对并安全收尾，不能重新创建或重放未知请求。A 终端 unknown probe 可能阻断 B；不以跑完矩阵为由清除未知。

当前真实通道阻断：Gateway 原生 `/models` 返回 OpenAI HTTP403 `unsupported_country_region_territory`，0推理。生产配置接线与预算冻结可交付，但通道尚不可标记可用。提供符合上游支持地区要求的通道并重新核验后，才可另行安排首次付费准入；不得单凭密钥/token存在或本地fixture解锁。五个模型/Turn/Simulation/G5 gate 与 money.enabled 保持关闭。

生产版本、源码/镜像/overlay 摘要与最终验证回执将在本轮收口追加；冻结 private bundle 使用 wx+fsync，不同字节不覆盖。
