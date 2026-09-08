# M0 staging 资源台账

更新：2026-09-06。**G0 10/10 及共同候选已签收**，见[主控记录](evidence/runs/m0-g0-accepted-20260906/progress.json)，产品 M1–M5 尚未完成。

T10 原 Worker `riffology-m0-release-staging` 保持回退版本 `e6a57b3f-a5fb-47e6-abbd-cedbc568c822`，application `a03a6e91-25cb-4a8d-89a8-be522368dde4` version=5/I1、Sandbox namespace `b3b02828c43a4578bc512cf4235903db`。补验 Worker `riffology-m0-release-completion-staging` version `c3eeddf2-8945-4e0f-9af4-2948b22c5655`，native fault application `a03693b8-f5be-4247-9280-f0c38435d911` version=1/I1，max_instances=1；恢复通过原 Sandbox namespace 执行。两应用共七实例记录全部 inactive，见[实例回读](evidence/runs/m0-release-completion-1788689659147/instances-after.json)。没有模型绑定；固定运行 closed/completed，不能重用。原 R2 前缀保存 counter=2，独立 completion 前缀保存 counter=3，均保留审计。

## 已建资源

2026-09-06 新增真实 Go 代理与 Pi 云监督器，详见[部署核验](evidence/runs/m0-pi-live-v2-deploy-20260906/deployment-verified.json)：

| 资源 | 已核验标识 / 当前状态 |
|---|---|
| `riffology-m0-model-proxy-go-live-staging` | Worker `8ff337aa-a548-4779-b1f7-d1053fc3939c`；SQLite namespace `e891f553964442c78b7561d71e7b8004`；两次调用后已撤权，active=0 |
| `riffology-m0-pi-live-staging` | Worker `7bb43caa-bc64-4d91-801f-b9d2758cff3a`；HOST namespace `37226bd110984c47a5d318ba43f3a27e`；运行 closed/completed |
| Trusted application | `a03ddc7e-1c6e-4cea-93ec-ac03d7b0073a`，basic/max_instances=1；两条实例记录 inactive |
| Project application | `a039ed42-159d-43db-be13-69315bce5189`，basic/max_instances=1；成功及此前失败实例均 inactive |
| R2 | 复用私有 checkpoint bucket，前缀 `m0-pi-live/go-live-g0-20260906`；Session 1416B、manifest 160B 独立下载摘要一致；审计保留 |

没有新镜像发布；模型密钥仅保存于代理 Worker Secret，项目与可信 VM 只接收各自所需的固定资源/短期能力。现金扣款仍未知。[本次记录](m0-pi-live-cloud-validation.md)不代表产品计费链路已实现。

PiHost Worker `b30e9f9d-dc60-4ea3-985c-6c6291f20513` 已部署至 100%，HOST namespace `6990a51e4a4d441caf6681d8e982e0c2`，Sandbox namespace `3f54614572894e1394797b699602343d`。app `a0321718-f17e-4ccf-974a-fd447dde5920` basic/max 1，沿用已批准可信镜像；T03 运行 8 请求、5,208 bytes、13.892 秒，唯一实例 inactive，DO 报告保留、无 R2 绑定。[T03 验证](m0-resource-loading-cloud-validation.md)已签收。本机独立 pi-host secret 为 0600，未进入镜像。Go live 专用 Worker 目前仅有本地代码和配置，未部署、无真实模型调用。

Recovery Worker 当前版本 `5fef2b3a-a064-4162-b1c3-6b0ce25c098d`，100% 流量。app `a036b418-dcce-4d2f-bd3d-6debf982ea6f` ready/basic/max 2，协调者 namespace `a682f665b7004214bc5a27ef24b231b7`、Sandbox namespace `e17c13abe5474cd0bbb673c6ce58a2a0`。最终三场景为 76 次请求、130.153 秒、五次运行时生命周期；含前轮的七条历史实例均 inactive，checkpoint 与 DO 审计保留。三轮驱动合计 188 次请求，另有两次浏览器诊断；部署/API 查询另计，无真实模型调用，实际费用待对账。独立 Recovery secret 已注入，值未进入镜像或文档。[T08 云验证](m0-recovery-cloud-validation.md)包含完整证据。

Tenancy Worker 已部署到 `00f869d8-8229-42d8-83e1-cb661f5cadfb`，SQLite namespace `72efcc4896bc4a1396eaf76e3bdc3a32`。四轮矩阵共 150 个请求，另有 7 个清理回归/核对请求，合成资源均已清理，关闭标记保留。独立 secret 位于本机 `.local/cloud-staging/tenancy.secrets.json`（0600），不写入文档。[T04 验证](m0-tenancy-cloud-validation.md)包含部署和失败恢复证据。Boundary 当前版本 `f43bcfe0-03c3-4d76-9662-9deeacc750d6`，两个应用的历史 15 条实例均 inactive，见 [T02](m0-isolation-cloud-validation.md)。

| 资源 | 当前状态 | 依据 |
|---|---|---|
| Cloudflare account | `8b0d70250211aa10d89e20605a1c7e5e`；`wrangler whoami` 已成功 | 当前账号配置与环境 preflight |
| workers.dev account subdomain | `jihe-gao`，主控 API 查询于 2026-09-05T09:54:50.207Z | 主控实测结果 |
| R2 bucket | `riffology-m0-checkpoints-staging` 已创建；APAC / Standard；private；public development domain disabled；custom domains 为空 | [environment evidence](evidence/runs/m0-environment-20260905094527503/bucket-verification.json) |
| Cloud/本地前置 | 2026-09-05T09:46:34.008Z preflight 为 `pass`，4 项本地检查与 3 项 CLI 云检查均 passed | [preflight](evidence/runs/m0-environment-20260905094527503/preflight.json) |
| Storage Worker / DO | `riffology-m0-storage-staging` bodyfix 版本 `e0d311aa-ab18-4b55-9fd8-0c188376041b` 已部署；T06 云 fault 原语已单项签收 `status=passed` | [T06 gate summary](evidence/runs/m0-g0-t06-cloud-20260905/G0-T06-gate-summary.json) |
| Files Worker / DO / Container | Worker `98cc1d73-0efe-4d6f-9e43-7616f841b8c3`；app `a03c0d4b-d529-4d81-a2b6-bfb901222a18`；basic/max 2；唯一实例记录 inactive；保留 10 个 checkpoint 对象共 3,041 bytes | [T05 云验证与部署证据](m0-files-cloud-validation.md) |
| PiHost Worker / DO / Container | 恶意文件首次加载和恢复云门禁已签收，唯一实例 inactive | [T03 云验证](m0-resource-loading-cloud-validation.md) |
| Recovery Worker / DO / Container | 云三组中断与恢复已签收；实例最终 inactive，私有 checkpoint 保留 | [T08 云验证](m0-recovery-cloud-validation.md) |
| Model Proxy Worker / DO | `riffology-m0-model-proxy-staging` 版本 `06e097f1-cb6d-4349-8cf5-af4472ba0079`，SQLite namespace `95df6344c3f64b0f82ae9431c3ff36fb`；fixture-only | [部署核验](evidence/runs/m0-model-proxy-staging-1788612744246/deployment-verified.json)、[运行后 API](evidence/runs/m0-model-proxy-staging-1788612744246/cloud-after.json) |

该 R2 bucket 与 `infra/wrangler.m0-storage.jsonc`、`wrangler.m0-files.jsonc`、`wrangler.m0-recovery.jsonc` 中的 `CHECKPOINTS` 绑定一致。Storage Worker/DO 已完成 T06 云 fault 原语单项签收，其余 Storage/项目验收与其它 Worker、DO 和 Containers 仍待完成。Boundary 首次 push 及单并发认证兼容重试均因 proxy broken pipe 失败，最终 reconciliation 仍显示 Worker/DO bindings 已存在但 Container apps 为空，不应写成部署成功或资源未创建。随后 [regctl 分块上传](evidence/runs/m0-registry-chunked-trusted-20260905111316067/result.json)在首个 30,649,033-byte layer 的 120 秒预算内失败并收到 HEAD 404，manifest 未发布、Container 未部署；`payloadBytesSubmitted` 不是网络实际字节，费用未知，不把该记录写成 PATCH 已获支持。

两份 [Docker Hub 镜像](m0-dockerhub-publication.md)已于 2026-09-06 公开发布、匿名核验，四套 staging 配置固定远端运行 manifest digest 并通过类型生成/dry-run。随后已完成[Boundary 云部署和 VM 观测](m0-boundary-cloud-validation.md)与[Preview 新入口部署](m0-preview-cloud-entry.md)；前述 Container apps 为空仅属历史观测。

## 计划资源与输入

| 项目 | 计划状态 |
|---|---|
| Storage Worker | bodyfix 版本云 fault 原语已单项签收：21 requests、74848 bytes；实际上传中断、提交前/后崩溃、SSE 游标重放去重、GC 3 删 5 留均有证据；不能关闭整个 G0 |
| 其它 M0 Worker | Boundary、Preview、Files、Tenancy、Recovery、PiHost 已部署；其它云门禁按计划继续 |
| DO / Containers | Storage、fixture Model Proxy、Boundary、Preview DO 已部署；Trusted / Project / Preview 三个 Container 应用已创建。Boundary 测试九条实例最终均 inactive；Preview 状态见云入口记录 |
| Cloud secrets | Model Proxy 使用独立 `.local/cloud-staging/model-proxy.secrets.json`（0600），已在首次公开路由前注入；Storage secret 文件为 `.local/cloud-staging/storage.secrets.json`，权限 `0600`，只含强随机 `M0_PROBE_TOKEN`；文档不读取或写入其值。Boundary 已有独立 `.local/cloud-staging/boundary.secrets.json` 并注入其 Worker，不能互换两文件；Preview 已使用独立 `.local/cloud-staging/preview.secrets.json`（0600），含两个不同的强随机 probe / signing secret，已注入；其它 Worker secrets 待准备 |
| 域名与 TLS | 用户指定 `riff-demo.gaojihe.cn`；旧 Worker、路由和 DNS 已退役，新控制域与 Preview base 已绑定，通配 DNS 已创建；证书申请含 `*.preview.riff-demo.gaojihe.cn`，就绪与 T07 状态见[云入口](m0-preview-cloud-entry.md) |
| LLM 供应商 | 已有 Go 授权、订阅有效且余额兜底关闭；固定两次 live profile 已实现及测试，仍需部署和真实云 Pi/出口接线；详见[预算决定](m0-model-proxy-budget.md) |
| 测试身份/租户 | 云 G0 验证所需的合成身份、租户和故障注入安排待准备 |

## M0 用量预算

本轮新增用量预算为 **US$5**，其中模型请求最多 **US$1**；Workers 月租不包含在这两个数字内。这是执行预算与审批依据，不是云账单已经设置的硬美元上限，且实际云账单可能延迟出现。运行时仍必须执行请求数、实例数和运行时长硬限制，并保留请求/实例/时长记录后再对账。

资源配置完成不等于 M0 完成。首次公开路由前必须注入 required secrets，完成当前候选的 dry-run/复验，并按对应 G0 矩阵验证；Preview 另需专用域名与 TLS，不阻断独立模型代理 fixture Worker。任何部署结果都需单独记录 Worker、DO、Container、版本和公网行为。

本轮 Storage 外部探针累计 35 次请求（baseline 6、空 POST 修正前 8、修正后 21）；模型调用 0、云容器实例启动 0。部署/API 核验和镜像层上传另有用量，美元实际账单未核对，不能记为零费用。Boundary 推送结束后已[清除专用配置中的短效 registry 登录](evidence/runs/m0-boundary-staging-20260905100830706/registry-credential-cleanup.json)，既有 Wrangler OAuth 保持加密存储。

本轮 regctl 恢复尝试后的[清理核验](evidence/runs/m0-registry-chunked-trusted-20260905111316067/cleanup-verification.json)确认：上传进程已终止、专用配置无持久 Registry 凭据、Docker daemon 配置未变；2026-09-05T11:19:14Z 云 API 仍显示 Container apps 为空。这些历史镜像不代表当前源码；[新 trusted / project 镜像](m0-registry-alternative.md)当时已本地构建、尚未发布；2026-09-06 已发布并部署，当前结果见上文。模型代理是独立 Worker，其部署另见下文。

模型代理第六套独立 Worker 已[部署核验](evidence/runs/m0-model-proxy-staging-1788612744246/deployment-verified.json)，运行后 API 仍为相同版本 100%、SQLite DO 一致。[本次云 fixture](evidence/runs/m0-model-proxy-cloud-1788613210899-49e0a3db/model-proxy-cloud.json)使用 50 次业务请求、50,210 响应字节、34.347 秒，4 run 均撤权且 active=0；新增真实供应商调用 0、云容器启动 0。该用量与上文 Storage 探针分开记录；部署/API 请求另计，现金费用未知。G0 仍只有 T06 单项通过。
