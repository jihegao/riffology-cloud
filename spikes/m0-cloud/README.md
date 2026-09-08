# M0 Cloudflare 信任边界探针

本目录是可部署的最小验证程序，**不是产品后端，当前云端验证为 `not_run`**。它为 G0-T02 / G0-T04 / G0-T09 收集观测，不替代整个 G0，也不会自动输出安全门槛 `passed`。

本地核验时间：2026-09-05。依赖读取实际安装的 `@cloudflare/sandbox@0.12.9`、`@cloudflare/containers@0.3.7` 声明及源码；容器镜像和绑定由 `infra/wrangler.m0.jsonc` 与两个 Dockerfile 管理。执行时必须核对镜像版本与 SDK 兼容性。

## 信任边界

`TrustedSandbox` 与 `ProjectSandbox` 必须绑定两个不同的 Container 应用与 DO 类。可信 canary、模拟 Session 和控制服务进入 Trusted VM；固定项目脚本进入 Project VM。所有 canary 是随机生成的合成标记，真实平台凭据只停留在 Worker。

两个类均设置 `enableInternet=false`，不继承 Worker Secret 为容器环境变量，并导出 `ContainerProxy`。Project 的 `allowedHosts=[]` 拒绝默认外连；Trusted 仅允许 `m0-control.invalid` 进入 Worker 出站处理器，其中只有 `GET /health` 返回合成响应，其他路径拒绝。没有模型代理、依赖下载、计费或 Tool Bridge 的特权接口。既有 VM 的策略/镜像版本变化需要重新创建后再跑证据。

同一 Sandbox 内的文件、进程、环境与 localhost 共享，SDK 的 Session 不能作为可信 / 不可信边界。项目可能能访问**自己的** SDK HTTP 端口；本探针记录这一事实，不把该端口称为可信平台 API。必须继续验证本地 SDK 能力无法扩大到 Worker 凭据、跨租户资源、结算或不受配额约束的运行。

依据：Cloudflare [安全模型](https://developers.cloudflare.com/sandbox/concepts/security/) 与 [出站策略](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)，2026-09-05 读取。安装包中 `containers/dist/lib/container.js` 对存在但为空的 `allowedHosts` 数组执行拒绝匹配。

## 配置与操作

必须提供以下配置，正式生产环境故意拒绝运行探针：

| 配置 | 约束 |
|---|---|
| `ENVIRONMENT` | 仅 `staging` |
| `PROTOCOL_VERSION` | 仅 `m0-v1` |
| `M0_PROBE_TOKEN` | Secret，32–1024 字符，使用随机值，禁止写入仓库或证据 |
| `M0_EXECUTION_ENVIRONMENT` | 可选运维标签：`local-docker-workerd` 或 `cloudflare-vm`；未设置记录 `unrecorded`，必须结合执行器证据确认 |
| `TrustedSandbox` | 对应可信 DO binding，建议 M0 上限 1 个实例 |
| `ProjectSandbox` | 对应项目 DO binding，双租户探针需要上限至少 2 个实例 |

除静态 `/health` 外，所有路由首先要求 `Authorization: Bearer <M0_PROBE_TOKEN>`，再检查环境、方法、输入和固定操作。未认证请求不会触碰 DO 或启动 VM。无公网 preview、任意命令、用户代码、任意 URL、Sandbox ID 或任意路径入口。POST 只接受最大 1024 字节的 JSON，整个 body 读取最多 1 秒；超时请求会取消读取，取消本身不响应也不会拖住请求。拒绝额外字段和查询参数。

| 请求 | 输入 | 结果范围 |
|---|---|---|
| `GET /health` | 无 | 静态版本和 `product_backend:false` |
| `POST /probes/isolation` | `{"run_id":"m0-example-0001"}` | G0-T02 v2：固定信号与 SDK 控制 RPC 攻击，加跨 VM 文件 / 环境 / HTTP / IPC 观测；可信 VM 独立回读文件、信号计数和服务状态 |
| `POST /probes/tenancy` | 同上 | G0-T04 原语：两个项目并发写同一路径，Worker 分别读回对应内容 |
| `POST /probes/egress` | 同上 | G0-T09：固定正控制、外部 HTTP / HTTPS、IP 直连与有界 DNS-over-TCP 应用响应尝试 |
| `POST /probes/cleanup` | 同上 | 销毁该 `run_id` 固定前缀下的三个 VM，记录确认状态 |
| `POST /probes/capabilities` | `run_id`、`tenant`、`kind` | 签发有效期 5 分钟的单对象 fixture capability |
| `GET /fixtures/{run_id}/{tenant}/{kind}/{object_id}` | Bearer 加 `X-M0-Capability` | 校验租户、资源类型、对象、run、签名、过期时间后返回合成内容 |

`run_id` 必须是 8–48 位小写字母、数字或连字符，以字母或数字开头。每次操作分配新 ID，**同一个 ID 不能并发运行或并发清理**；此最小探针没有 durable turn、业务幂等或跨请求租约。调用者持有运维 Bearer，可以签发两个测试 Tenant 的 capability，这是测试鉴权原语的入口，不是 M1 登录体系。

Sandbox 名称使用 `m0-t-{完整run_id}-s`、`m0-a-{完整run_id}-s`、`m0-b-{完整run_id}-s`。最大长度 55，保留完整 run ID，角色和 run 组合不会因截断或散列而碰撞；末尾固定 `-s` 也覆盖合法 run ID 以连字符结尾的情况。SDK 0.12.9 的 `sanitizeSandboxId` 同时拒绝超过 63 位和首尾连字符。新命名不再使用旧 `riff-m0-...` 前缀；旧 run 的资源按其原始记录清理，不能假定新前缀 cleanup 已销毁旧实例。

Fixture Tenant 只有 `alpha` / `bravo`，资源类型只有 `workspace` / `file` / `log` / `artifact` / `preview` / `run`，对象 ID 是 `fixture-{tenant}-{kind}`。capability 同时绑定这些字段与 run，不使用客户端提供的 Sandbox ID。Fixture 不会访问真实文件、日志、Artifact、Preview 或 Run。

## 证据解读与清理

每次运行返回 `gate_decision:not_evaluated`，并分开记录 `worker_verified`、可信 VM 观测和 `untrusted_project_observations`。Project 自报的“没有找到”不能证明隔离通过；独立回读只能证明本次 canary / 模拟 Session 未变化，还需要部署拓扑、镜像、配置、攻击覆盖和实际云执行证据。

### T02 固定攻击与独立验证

版本 2 在可信 VM 内创建合成 Node 服务、随机 canary 和模拟 Session。服务记录本次实例 nonce、PID、进程启动时间、`SIGUSR1` 收到次数及控制操作次数。Worker 首先经可信 capability 执行固定 Node 脚本，读取可信状态中的 nonce，向 loopback 的固定 `POST /m0-t02/signal-positive` 提交仅包含该 nonce 的正文；服务核对后仅执行 `process.kill(process.pid, 'SIGUSR1')`，不接受 PID 或 signal 参数。Worker 随后独立回读确认信号计数为 1、nonce 保持一致；这验证服务确实收到信号，而不是只相信发送脚本返回成功。可信镜像不需要 Python 或 pidfd；项目侧 raw signal 仍严格使用 pidfd，缺少能力时拒绝发送。

项目脚本仅获得公开的本次目标 ID 和随机攻击标记，不获得 canary 内容、Session、运维 token 或供应商凭据。它执行下列固定操作：

1. 读取固定可信路径和 `/proc` 合成标记，尝试固定 Unix socket 和 HTTP 控制路径。
2. 先用 Linux `pidfd_open` 固定目标进程，再核对 PID namespace、启动时间、完整命令路径和实例 nonce；全部匹配时通过 `pidfd_send_signal` 发送一次 `SIGUSR1`，最后关闭 handle，避免数字 PID 复用导致信号发给其他进程。任何身份不匹配或不可见均返回 `target_not_addressable`；缺少 pidfd 能力则明确返回 `capability_unavailable`，不回退裸 `os.kill` 或进程组信号。分离 VM 无法以同一数字 PID 寻址，因此这一限制被明确保留。
3. 经项目自己的 `127.0.0.1:3000` SDK API 写入随机正控制文件；Worker 随后通过 alpha capability 回读比较。项目 SDK 内容仍属于项目域，这个正控制只证明固定请求在本次运行产生了项目内效果，不作为可信隔离证明。
4. 使用可信 Session ID 读取固定合成文件、写入 `/workspace/m0-t02-foreign-session.txt`；另一次请求伪造 `sandboxId` / `X-Sandbox-Id` / `Host` 写入 `/workspace/m0-t02-cross-scope.txt`。两个路径独立，可信 VM 均预置 canary，Worker 分别回读可信和 alpha 两侧，避免把同一文件的结果归给两种攻击。还对本次可信服务的唯一 process ID 发送真实 `GET` / `DELETE /api/process/{id}` 请求。这里的 DELETE 是真实的 SDK 信号控制 RPC 尝试；它不接受任意 PID 或 `kill-all`。
5. 向固定 `http://m0-control.invalid/m0-t02/tamper` 发送控制请求。它是合成出站控制路由，不是生产 Tool Bridge。

锁定 SDK 的协议来源为 `node_modules/@cloudflare/sandbox/dist/sandbox-D0rNqxlr.js` 的 FileClient、ProcessClient 和 SessionClient：`POST /api/read`、`POST /api/write`、`GET/DELETE /api/process/{id}`。SDK Session ID 不能承担安全隔离；进程管理属于整个 Sandbox，容器寻址在 Worker 已选择的 DO capability 中完成。npm 包不包含镜像端 handler，因此未知字段、伪造头和不存在 Session 的具体 HTTP 状态必须由真实镜像观测，不能从客户端源码推断。写请求即使返回 HTTP 200 / `success:true`，也可能只作用于发起请求的项目 VM；仅当该请求独有 alpha 路径的本次随机 marker 匹配、对应 trusted canary 未变时，才记录写入局限于项目。读取和外部 process 信号请求仍要求真实拒绝，不能套用写入局限规则。

Worker 经独立 trusted capability 检查原 canary、Session、跨域写目标、服务 PID / nonce、服务健康响应、信号计数仍为 1、控制操作计数仍为 0，并确认攻击 marker 不存在。HTTP/IPC 若实际到达合成服务，会修改模拟 Session 和控制计数，使这些核验失败。所有项目诊断均有大小上限，不返回 SDK 错误正文、请求 Authorization 或原始环境内容。

`worker_verified` 中的关键字段：

| 字段 | 类型与本地预期 |
|---|---|
| `trusted_service_status` / `trusted_service_running` | SDK 字符串 `running` / `true` |
| `signal_positive_control_delivered` | `true`，可信回读已证明正控制收到信号 |
| `trusted_signal_count_before` / `trusted_signal_count_after` | 均为数字 `1` |
| `trusted_signal_count_unchanged` / `trusted_control_mutation_count_unchanged` | 均为 `true` |
| `trusted_service_instance_unchanged` / `trusted_service_health_matches` | 均为 `true` |
| `trusted_canary_unchanged` / `synthetic_session_unchanged` | 均为 `true` |
| `trusted_cross_scope_file_unchanged` / `trusted_attack_marker_absent` | 均为 `true`；前者要求两种写入尝试的 trusted 路径均保持 canary |
| `project_sdk_positive_control_observed` | Worker 回读的项目正控制匹配，应为 `true` |
| `project_forged_scope_write_confined` | 项目内观察到伪造写 marker 且可信目标未变时为 `true`；若 SDK 直接拒绝伪造请求，可为 `false`，需结合该次拒绝响应判断 |
| `project_foreign_session_write_confined` | 独立回读 Session 写入专用 alpha 路径匹配 marker，且其 trusted 路径未变时为 `true`；可接受明确拒绝或此独立限定结果，不能把 HTTP 200 声称为拒绝 |
| `observed_foreign_session_marker_sha256` | Session 写入专用 alpha 文件内容摘要，读取失败为 `null`；限定写入成立时须等于 `expected_attack_marker_sha256` |
| `expected_canary_sha256` / `expected_positive_marker_sha256` / `expected_attack_marker_sha256` | 本次随机预期内容的 64 位十六进制摘要 |

`untrusted_project_observations` 保留原读取诊断，新增 `raw_signal`、六行 `sdk_control_attempts` 和两行 `control_http_attempts`。SDK 行只记录固定名称、方法、路径、HTTP 状态、响应字节数、截断标记、`success` 布尔值与是否出现合成可信 marker 前缀。HTTP 200 不自动代表跨域成功；TCP/HTTP 可达也不自动代表取得 Worker capability。主控必须结合 trusted 独立核验与部署拓扑判读。即使这些本地条件全部满足，云 gate 仍为 `not_evaluated`。

出站观测版本 2 将 TCP 连接与 DNS 应用响应分开：`transport_connected` 只表示 socket connect 成功，本地透明代理可能先接受连接再拒绝转发；`application_response_received` 只在完整接收有界 DNS-over-TCP 帧、验证事务 ID、响应标记、`example.com A IN` 问题及报文结构后为真。探针仅向固定 `1.1.1.1:53` 发送合法、无秘密的 `example.com` 查询；无重试，连接最多等待 3 秒，总调用期限 5 秒，接收帧最多 4096 字节。长度、头部与消息定义依据 [RFC 1035 §4](https://www.rfc-editor.org/rfc/rfc1035.html#section-4.2.2)。超时、提前关闭、代理 HTTP 错误、错误事务 ID 和不完整帧都不会被记录为 DNS 响应。

匹配的 DNS `REFUSED` 响应同样是应用层响应，另外记录 `response_code` 和 `answer_count`，不能写成“所有出站均已拒绝”。DNS 通道能否传递任意查询、响应是否由本地代理生成，以及云端 VM 的实际策略仍需独立验证；本探针不认证 DNS 响应来源，也不进行数据外传试验。

原本地记录 [boundary-egress-local.json](../../docs/evidence/runs/m0-initial/artifacts/boundary-egress-local.json) 保留不变。其中 `public_raw_tcp_connected:true` 是版本 1 的 connect 观测，**不能证明端到端 TCP 外网成功**。Docker/Workerd 的本地出站模拟与 Cloudflare VM 是两种执行环境，后续版本 2 响应应保存为新文件，不能用本地结果替代云端证据。Worker 的环境标签来自运维配置，不是对云运行的自动证明；执行器必须记录实际运行方式。

所有固定运行结束或抛错后都会请求 `destroy()`。每个清理等待最多 15 秒，若未确认则返回 `cleanup_not_confirmed`，不可写为资源已经释放。Operator 必须用原 run ID 再执行清理并核对 Containers 实例状态；`sleepAfter=60s` 只是兜底休眠，不等于确认销毁。运行错误或清理未确认的 HTTP 状态为 502；成功收集观测的 200 也不代表 G0 通过。

明确未覆盖：真实 Pi Session、跨 VM 原生 PID 信号寻址、被入侵的 SDK daemon、完整 DNS/协议出口绕过、真实模型/依赖代理、R2 持久化、认证后的真实 Preview 子资源与 WebSocket、全套嵌套对象 API、租户配额、幂等、断线恢复及升级回滚。后续实现必须扩展这些验证。

## 本地验证记录

2026-09-05 执行：

- `node --test spikes/m0-cloud/worker.test.ts`：11 个测试通过；在原有鉴权、作用域与错误边界测试上，增加 48 字符/尾连字符 run ID 的无碰撞命名，以及 1 秒 body 读取期限和非合作 cancel。
- `node --test spikes/m0-cloud/runtime.test.ts`：真实独立 Node 子进程验证固定 nonce 入口让服务向自身发送 `SIGUSR1` 后的磁盘计数，错误 nonce 或附加 PID / signal 正文不会发送信号；同时验证 HTTP/IPC 控制操作对合成 Session 和 marker 的实际影响。26 个离线 pidfd 身份/能力/异常案例验证只给已固定且匹配的目标发信号，并关闭句柄；离线 SDK 测试核对六个固定请求及响应字段，无 Authorization；保留原有 12 种 DNS fake socket 场景。真实网络仅连接测试自己创建的 loopback 服务，没有发供应商或云请求。
- `npx tsc --noEmit`：通过。
- 固定脚本分别用 `node --check --input-type=module` 和 Python `ast.parse` 做语法校验；可信侧信号正控制已改为 Node，项目侧 pidfd 逻辑保持 Python。

原版本 1 的 Docker/Workerd 观测保留不变。[m0-boundary-20260905082511433](../../docs/evidence/runs/m0-boundary-20260905082511433/boundary-local.json) 也保留为失败证据：实际 T02 收集观测返回 200、可信独立核验均为真，但旧 driver 将 foreign Session 写入必须返回 4xx 作为前提，遇到 SDK 写入成功响应而失败；该版本两种写请求共用一个目标文件，不能分别证明各自效果。当前改为独立文件和独立回读，等待主控串行集成的新证据，不能将旧失败记录改标为通过。云端仍为 `not_run`；云执行前由主控完成账号开通、镜像构建、部署配置、Secret 与成本上限核验，并保存真实响应及释放资源的证据。
