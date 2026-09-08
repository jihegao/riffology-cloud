# M0 验收与后续回归清单

更新：2026-09-06。**G0-T01–T10 均已签收，10/10；共同候选复核通过**，见[主控签收](evidence/runs/m0-g0-accepted-20260906/progress.json)。M0 技术门禁无剩余项；进入 [M1](m1-execution-plan.md)。下表区分已验原语和产品阶段需要重新接线验证的范围。

## 共同前置

Workers、R2、Docker Hub 镜像、Preview 域名/TLS 和 Go 订阅前置已确认，详情见[环境确认](m0-setup-confirmation.md)及[资源台账](m0-staging-resources.md)。Boundary、Preview、Files、Recovery、Tenancy、Storage、fixture 模型代理已部署；镜像和网络失败的历史记录保留。预算仍为 US$5、模型最多 US$1；账户实际账单待对账，不能以请求字节或 SDK 零估价替代核算。旧 riffology-demo 已退役，不恢复兼容路由。每项签收绑定源码、配置、镜像、云版本和脱敏证据，十项全部通过后才进入 M1。

## 按 G0 门禁的最小清单

| 门禁 | 已验证原语或现有证据 | 缺失实测与最小交付 | 云/账号资源 | 验收依据 |
|---|---|---|---|---|
| G0-T01 真实 Pi | **云已签收**：两次 Go 请求、真实流式事件、完整 Session/R2 恢复、随机标记语义恢复与代理取消终态 | 后续生产 Turn 接线回归；HTTP 请求头 ID 缺失，使用供应商 SSE 响应标识和平台 ID/hash 关联；不重跑已消耗的两次调用 | 已部署可信 VM / Go-only 代理 / DO / R2 | [T01 签收](evidence/runs/m0-g0-t01-cloud-20260906/G0-T01-gate-summary.json)、[云验证](m0-pi-live-cloud-validation.md) |
| G0-T02 信号与控制 RPC | **云已签收：** 两个独立 VM / namespace，固定 Shell 对可信文件、环境、Session、进程与控制接口的攻击未产生越权作用，可信通道独立回读一致 | 保留对应版本回归；真实 Pi Session 与生产 Tool Bridge 按 T01 / M2 验收 | 既有可信与项目 Container 应用，实例均 inactive | [T02 云验证](m0-isolation-cloud-validation.md)及正式签收；原缺少 pidfd 能力的失败保留，当前以不同 kernel identity 证明目标不可寻址 |
| G0-T03 恶意资源加载 | **云已签收：** 真实 VM 中首次创建和恢复 Pi 拒绝恶意扩展、Skill、settings/models 和工具，固定 Skill 进入实际请求；同组文件普通发现正控制全部成立 | 保留当前版本回归，后续正式项目与 Skill 接线不改变此边界 | 独立 PiHost Worker / DO / 一个 Container，已停止，DO 审计保留 | [T03 云验证](m0-resource-loading-cloud-validation.md)及[正式签收](evidence/runs/m0-g0-t03-cloud-20260906/G0-T03-gate-summary.json)，无真实供应商调用 |
| G0-T04 两 Workspace / Artifact | **云已签收：** 两路并发、两轮读写、跨归属与失效 capability 拒绝，owner 摘要不变；清理和关闭后拒绝均有云证据 | 保留最后清理响应超时及独立清理核对；M1 接入生产身份和 Workspace 生命周期 | 既有 Tenancy Worker / SQLite DO / 私有 R2，合成资源已清理，关闭标记保留 | [T04 云验证](m0-tenancy-cloud-validation.md)及正式签收；临时原语不替代完整产品链路 |
| G0-T05 文件与恢复 | **云已签收**：20 次真实 CRUD、文件清单/摘要/权限/删除一致、VM 启动标识变化、R2 恢复后可写及重命名、两次保存、10 个 R2 对象独立核验，实例 inactive | 保留回归；真实 Pi Session 在 T01 / M2 接入，不作为重复关闭文件原语的前置 | 已部署的 Files Worker / DO / Container / R2 | [云验证](m0-files-cloud-validation.md)、[T05 签收](evidence/runs/m0-g0-t05-cloud-20260906/G0-T05-gate-summary.json) |
| G0-T06 R2/事件故障 | 本地 R2/DO adapter 与 [Storage 云 fault artifact](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/storage-cloud.json) 已验证上传中断、提交前/后崩溃、SSE 游标重放应用一次并去重、GC 删除 3 个 orphan 并保留 5 个对象；artifact `checksPassed=true`、`sourceStableDuringProbe=true`、21 requests/74848 bytes | **已完成 T06 单项签收**；该临时探针覆盖计划 §3 所需原语，不扩写为整个 G0 或生产链路验收 | 当前 staging Storage Worker/DO/R2；无需把 M2 生产 Turn 作为 T06 前置 | [deployment-verified](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/deployment-verified.json)、[primary review](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/primary-review.json) 与 [T06 gate summary](evidence/runs/m0-g0-t06-cloud-20260905/G0-T06-gate-summary.json)；共同候选已另行签收，不扩大 T06 原范围 |
| G0-T07 Browser 身份与 Origin | **云已签收**：15 case、46 条入口及 29 条凭据检查；真实 Cookie wire、HTTP/WS、撤权、过期和 generation 更换；实例 inactive | M1 正式身份和 M3 产品接线后重验；跨站 Cookie 支持按产品范围另行验证 | 已部署的 Preview Worker / Containers、域名/TLS、平台控制的测试主体 | [T07 签收](evidence/runs/m0-g0-t07-cloud-20260906/G0-T07-gate-summary.json)；不将后续生产身份循环设为 M0 前置 |
| G0-T08 中断与恢复 | **云已签收：** 三场景、五次运行时生命周期；浏览器关闭后继续，SDK kill Pi 与销毁容器均命中实际流式窗口，新 g2 从同一 seed Session 恢复；四次旧代事件和写入精确拒绝 | 保留失败记录与回归；真实供应商和生产 Turn 在 T01 / M2 / M5 联调，具体 OS 信号未独立验证 | 已部署 Recovery Worker / DO / Container / 私有 R2；七条历史实例记录 inactive，审计保留 | [T08 云验证](m0-recovery-cloud-validation.md)、[正式签收](evidence/runs/m0-g0-t08-cloud-20260906/G0-T08-gate-summary.json)；真实 Pi 与本地 SSE fixture |
| G0-T09 出口与代理 | **云已签收**：两执行域 HTTP 白名单及管理接口拒绝、固定 SimPy wheel 摘要/安装、密钥键未注入、真实模型代理可用 | DNS解析为平台例外，指定解析器的答案不认证实际目的地；TCP超时仍unknown，不宣称全协议封锁 | 已部署分离 VM / 固定 outbound handler / 受限代理 | [T09 签收](evidence/runs/m0-g0-t09-cloud-20260906/G0-T09-gate-summary.json)、[云验证](m0-pi-live-cloud-validation.md) |
| G0-T10 版本与回退 | **云已签收：** W1/I1 基线、W2/I1 兼容、I2 rollout与恢复、原生退出42、Worker和镜像回退、新实例恢复2→3及独立R2回读 | 生产发布协调器和运行中的产品任务在M2/M5重验；原SDK失败与精确hold信号未知保留 | 两应用七实例inactive；不重置关闭运行，无新增模型派发 | [T10签收](evidence/runs/m0-g0-t10-cloud-20260906/G0-T10-gate-summary.json)、[共同候选](evidence/runs/m0-candidate-review-20260906/final-review.json) |

## 后续条件

G0 的十项技术证据与共同候选已核对。后续按 M1→M2→M3/M4→M5 推进，原语的后续产品接线须有阶段证据。旧模型探针不重放；预算不变。新增源码仅对实际受影响范围重验，不把历史失败覆盖为成功。

## 历史推进记录（当前状态以上文为准）

[模型代理 DO/调用权限适配](../spikes/m0-model-proxy/README.md)已部署到 staging：[23 项云端 fixture 检查](evidence/runs/m0-model-proxy-cloud-1788613210899-49e0a3db/model-proxy-cloud.json)通过，四个 run 均撤权且 active=0，50 次请求、50,210 响应字节、34.347 秒；[176 项本地全检](evidence/runs/m0-local-20260905125007655/local-checks.json)通过。真实云 Pi 身份/供应商、可信输入上界和账户核验仍缺失，pi-live 尚未接入，不放行新 live 请求。当前使用持久化的显式同 call 取消，连接断开及时取消仍未确认。[两份替代镜像](m0-registry-alternative.md)已本地构建，当前镜像已于 2026-09-06 [公开发布并核验](m0-dockerhub-publication.md)，四套 staging 配置固定 digest 并通过预检；Preview 已指定 `riff-demo.gaojihe.cn`，仍缺 generation 子域名 DNS/TLS，见[环境确认](m0-setup-confirmation.md)。G0 仍为 1/10 staging passed。

受控 Pi 已完成[本地代理协议接线](m0-proxy-pi-bridge.md)，原 13 项客户端集成测试保留，当前全检 192 项通过。新固定 staging-fixture 入口已进入[本地 Linux 镜像](m0-pi-proxy-image.md)并完成断网 SDK 检查；下一步需接通云监督器和固定出口，核验镜像发布/拉取，再补云端实际 Worker/DO 与 Pi 链路；这一结果不替代云 VM、真实模型或 Session 语义恢复证据。

真实 Pi 子进程与本地 Workerd/SQLite DO 的[10 项联调](evidence/runs/m0-proxy-pi-local-1788622591199-4e3a43ff/proxy-pi-local.json)已通过，覆盖落盘后新进程恢复、DO 实例重启、请求/账本摘要关联及显式取消后未知预留。当前无新模型付费调用，仍需云执行域和真实供应商证据。
