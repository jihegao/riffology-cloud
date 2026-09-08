# M0 云端执行域验证

更新：2026-09-06（Asia/Shanghai）。旧入口已按用户要求[退役](m0-legacy-retirement.md)。[T02 可信与项目隔离](m0-isolation-cloud-validation.md)已在真实云 VM 中签收；云内慢流诊断通过，公网慢上传预期差异保留。当前 G0 为 [9/10](evidence/runs/m0-g0-progress-live-20260906/progress.json)。下文按时间保留此前局部结果与失败记录。

## 部署与镜像

- Worker：`riffology-m0-probe-staging`；version `de139207-4562-4545-a0ea-32de625710d2`，deployment `d9661158-d40d-46a3-a609-2c41af0c7b7e`，流量 100%。
- Trusted 应用：`a03ea65b-b039-4f56-8422-36c719b87b72`；Project 应用：`a03313e4-fa9d-4de2-ac2c-d2cc69efd875`。两个独立 DO namespace，均为 basic、每类最多两个实例、默认禁用互联网。
- 两份镜像来自已核验的 Docker Hub 运行 manifest：Trusted `sha256:4be14ca3e2191e2a2941d4eb0ff7ac904c5a694b60ee839f75ac429eac7f3e67`；Project `sha256:c010768e37d6ad06da137308d30faf32b9ec7fcc21916f29f146c281c7a6946e`。
- 实际 deploy 于 01:38:23–01:38:45 UTC 完成，exit 0；未重新构建镜像。API 配置与 VM 实例记录共同证明已拉取、启动，不能只凭 Worker deploy 成功作此判断。

[部署收据](evidence/runs/m0-boundary-dockerhub-deploy-20260906/deployment-verified.json)记录 config、bundle SHA、镜像与云版本；[日志](evidence/runs/m0-boundary-dockerhub-deploy-20260906/deploy.log)保留完整命令结果。首次 dry-run 本身成功，但后续摘要脚本误按工作目录寻找 Wrangler 相对 outdir，包装器退出 1；[复核记录](evidence/runs/m0-boundary-dockerhub-deploy-20260906/dry-run-review.json)保留该差异。后续部署使用绝对 outdir。

## 失败保留与诊断修正

完整 Boundary 驱动的三次运行都没有进入 VM 业务探针：

1. [首次运行](evidence/runs/m0-boundary-cloud-20260906014000676/boundary-cloud.json)未启用 Node 的环境代理，传输失败，0 case。
2. [第二次运行](evidence/runs/m0-boundary-cloud-20260906014219041/boundary-cloud.json)使用 `node --use-env-proxy`，前七项负向检查通过，但慢上传预期 400、实际 200。
3. [第三次运行](evidence/runs/m0-boundary-cloud-20260906014627731/boundary-cloud.json)把 2.1 秒上传间隔移至首块实际 flush 之后，仍为 200。首块 flush 后至完成约 2101 ms。中间链路缓冲是待验证假设，尚未定位原因。

驱动现只保存慢上传响应中的固定错误枚举、fixture 标志及 capability 是否签发，避免异常成功响应携带临时 capability 进入证据。第二次运行的原始临时 capability 已脱敏，保留原始与脱敏摘要的[记录](evidence/runs/m0-boundary-cloud-20260906014219041/redaction-record.json)，失败状态未改变。增加脱敏回归检查；未降低慢上传应返回 400 的断言。

## 独立 VM 观测

在上述失败继续保留的前提下，另用[有界驱动](evidence/runs/m0-boundary-cloud-vm-20260906015033319/driver.mjs)对隔离、租户文件和出口各执行一次，单操作上限 180 秒，finally 清理上限 30 秒。该运行不代替完整负向检查。

| 检查 | 云上观察 | 结论边界 |
|---|---|---|
| 隔离 | 可信 canary、Session、进程及信号正控制计数保持正确；项目侧未读到可信路径、凭据名或进程 marker；伪造与跨 scope 写入仅改变项目侧文件 | 真实 VM 隔离的局部证据；POSIX 信号能力不可用，不等同于实测跨 VM 发信号被拒绝；控制 RPC / capability 矩阵仍须补齐 |
| 租户文件 | alpha、bravo 各自内容符合预期且互不相同 | 不替代正式登录、任意对象 ID 越权和全部租户 API 验收 |
| 出口 | 可信测试 health 返回 200，非允许测试路径 403；项目外网 / 测试地址未成功；DNS-over-TCP 无连接、无响应、0 字节 | 项目部分请求为 520 或传输错误，不能改写为应用显式 403；真实模型代理及依赖白名单尚未接通 |

[VM 原始观测](evidence/runs/m0-boundary-cloud-vm-20260906015033319/vm-observations.json)绑定部署、源码前后摘要（稳定），三个响应均为 `observations_collected`。清理接口均确认销毁；[最终实例复核](evidence/runs/m0-boundary-cloud-vm-20260906015033319/instances-final.json)于 01:56:39 UTC 确认九条实例记录全部 inactive。应用配额中的 instances=2 不代表当时运行两个实例。

本轮无真实模型调用。预算沿用总计 US$5、模型 US$1 上限；VM、请求与运行时长有记录，实际账单尚未结算，不填写虚构零费用。最新[完整本地检查](evidence/runs/m0-local-20260906021336511/local-checks.json)通过，源码摘要稳定。

## 后续行动

完成新 Preview 域名和 TLS 验证；定位云慢上传检查与边缘请求交付的差异；随后补齐 T02/T04 控制入口矩阵，并接入限定模型代理出口和云监督器。各项门禁须独立复核，不以这三组 VM 观测自动签收。

## 02:42 UTC 读体诊断补充

Worker 新增 operator 鉴权后的固定 capability 路由诊断头，只含相对时间、chunk/byte 数和结果枚举；没有请求正文、capability 或客户端字段反射。原 1000 ms 读取竞争与拒绝语义保持不变。新增测试覆盖访问范围、timer 清理、晚到 JSON、连续滴流和错误分类；[完整检查](evidence/runs/m0-local-20260906023949819/local-checks.json)通过。

第一次诊断版本部署返回 Cloudflare `10000 Authentication error`，CLI 同时仍可读取已登录账号和写权限。[只读对账](evidence/runs/m0-boundary-body-diagnostics-20260906/deployments-after-failure.json)确认旧版本仍为活跃部署，未声称新版本成功。一次有界重试成功，当前 Boundary 版本为 `a74ded2f-40dd-4cba-b33e-62bfb1b3d855`；[部署复核](evidence/runs/m0-boundary-body-diagnostics-20260906/deployment-verified.json)绑定 bundle、config、deployment，镜像和 Container 应用均未变化。

[两次无 VM 请求](evidence/runs/m0-boundary-body-diagnostics-20260906/body-observations.json)分别为完整正文正控制与 2.1 秒分块发送。两者 Worker 均观察到 77 bytes、1 chunk、读取至 EOF 时间偏移 0，timer 未触发。延迟组客户端首块 flush 为 1 ms，末块发送为 2103 ms，最终 HTTP 200。

这证明本次 Worker 读取阶段收到的是已完成的正文；客户端的发送间隔没有成为 Worker 的读取等待。不能据此认定服务端超过 1 秒仍接受慢流，也不能据此将公网慢流门禁改成通过；具体缓冲发生在客户端代理、边缘前置链路还是交付阶段尚未定位。Workers 时钟依赖 I/O 推进，0 ms 也不代表精确的零 CPU 耗时。[Workers 时间说明](https://developers.cloudflare.com/workers/runtime-apis/performance/)

下一步增加受控云内慢流验证 handler 的 timer 行为，并将其与公网入口交付观测分别记账；保留公网预期 400 / 实际 200 的失败事实。诊断轮模型调用和 VM 请求均为 0，未保存签发的短期 capability 值。

## 后续云内诊断与 T02 独立验证

03:48 UTC [云内诊断](evidence/runs/m0-boundary-internal-20260906/internal-observations.json)通过：完整体正常解析，滴流四块和停滞一块均在 1000 ms 超时，定时器与读取锁全部清理。入口空流检查另有 1000 ms 上限，内部三流套件上限 2500 ms；两者不是同一个整请求上限。该轮 1 次请求、1,163 响应字节，无 VM/模型调用。Worker 为 `9455664b-d069-4b4e-9b8f-bfaaa4786a78`。

03:56 UTC [公网重测](evidence/runs/m0-boundary-internal-20260906/public-ingress-observations.json)仍观察到延迟正文在 Worker 读取时已合并，未关闭公网慢上传检查。随后部署内核身份补充版本 `f43bcfe0-03c3-4d76-9662-9deeacc750d6` 并完成[T02 云隔离验证](m0-isolation-cloud-validation.md)，两种 Container 镜像未改变。T04 资源授权矩阵与 T09 出口策略继续独立推进。
