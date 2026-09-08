# M0 受限模型代理原语

本目录为 G0-T01 / G0-T09 提供请求边界、流式观察和原子预留策略，包含 SQLite Durable Object、opaque capability、网关 HMAC 和 [cloud.ts](cloud.ts) Worker 入口。**staging 已部署，但仅支持固定 SSE fixture，没有真实供应商 transport 或 live 凭据。** [本地 22 项检查](../../docs/evidence/runs/m0-model-proxy-local-1788611379474-ec85ee9b/model-proxy-local.json)与[云端 23 项检查](../../docs/evidence/runs/m0-model-proxy-cloud-1788613210899-49e0a3db/model-proxy-cloud.json)均有记录；[最新全检](../../docs/evidence/runs/m0-local-20260905125007655/local-checks.json)为 176 项通过、1 项 opt-in 跳过及 2 个自检。仅断开连接的及时取消仍有缺口；T01/T09 未通过，fixture 不能证明真实 Pi/供应商或 Container 网络与 Secret 隔离。

## 固定请求协议

`createModelProxy(policy, dependencies).handle(request)` 返回 `{ response, completion }`。`response` 是原始 SSE 字节流或有限 JSON 错误；`completion` 提供持久化状态和预留收据。固定路由为 `POST /v1/chat/completions`，请求 origin 必须等于服务端配置，不接受查询参数。不存在模型选择、充值、改价、结算或任意 URL 转发端点。

历史后端配置常量仅记录 `opencode-go / deepseek-v4-flash` 与 `https://opencode.ai/zen/go/v1/chat/completions`，不是供应商认证或可用性证据。上游配置只能从 Worker 可信配置注入；生产适配器必须额外固定允许的完整 origin/path/provider/model/mapper 组合，不能从项目文件、请求 body、请求头或任意管理参数构造它。通用核心检查 HTTPS 和路径结构，不负责证明某个 HTTPS 主机属于该供应商。

只接受 1–32 条纯文本字符串 `system/user/assistant` 消息，assistant 可携带字符串 `reasoning_content`。拒绝 tools、图像、content parts 数组、其他协议字段及客户端模型/地址/预算覆盖。当前 mapper 明确构造 `thinking: { type: 'disabled' }`；`reasoning: false` 不能替代它。上游请求使用 `max_tokens`，默认服务端上限且最多 256；`max_completion_tokens`、`max_output_tokens` 和混用字段均拒绝。

| 限制 | 核心允许的最大配置值 |
| --- | --- |
| 原始输入及规范化后 body | 65,536 字节，各自检查 |
| 可信模型输入 token 上界 | 8,192，必须由额外可信适配器提供 |
| 输出 `max_tokens` | 256 |
| 单个 SSE frame | 65,536 字节 |
| SSE 累计字节 | 1,048,576 字节 |
| 请求绝对期限 | 30 秒，包含身份/输入/预留/派发/流式消费 |
| 终态持久化额外等待 | 最多 5 秒，或更小的请求期限 |
| 单 run 派发意图 | 最多 3 次，包含失败、取消和不确定结果 |
| 单 run 授权金额 | 最多 1,000,000 微美元，即 US$1，仅为上限 |

测试配置采用更小的字节/token 限制。其他文档中的 16,384 token 价格示例不代表本代理允许该输入量。上限不是费率，也不是可直接执行真实调用的预算换算。

输入使用实际流字节累计限制，不相信 `Content-Length`。`inputTokenBound` 必须给出与固定模型一致、含 message framing 和 mapper 开销的已验证保守上界；未配置、无法建立上界、版本缺失或超过上限时不会派发。这里没有把字符数、UTF-8 字节或 SDK 的默认值伪装成 tokenizer 结果。

新建上游请求头只包含服务端 `Authorization`、`Content-Type` 和 `Accept`。客户端凭据/cookie/任意头不会转发；影响路由、模型、scope、预算和预留的覆盖头会直接拒绝。Fetch 明确 `redirect: 'manual'`，3xx 不跟随。任何一次已派发或不确定请求都不自动重试。

## 预留与真实用量的边界

`RunReservationAuthority` 绑定一个预批准的 principal/tenant/workspace/run、到期时间、费率版本和总预算。`AtomicRunStore.transact` 是必需注入接口，没有进程内存 fallback。实现方必须让同一 run 的所有实例使用同一持久存储，并保证事务互斥、异常回滚以及**持久提交完成后才返回**。

[DurableRunStore](durable-store.ts) 已实现该接口：在 SQLite DO 的 `transactionSync` 内读写同一个固定 ledger key，并在返回前等待 `storage.sync()`。状态和返回值均进行 clone，拒绝异步事务回调；sync 失败保持提交结果未知，不撤销或重放可能已提交的 intent。[纯测试](../../tests/m0/model-proxy-durable.test.ts) 使用存储接口 fixture 验证顺序、回滚、别名隔离、并发重复请求与重建后的账本约束；下述 Workerd 集成另验证了 `ctx.abort()` 后新实例保留 intent 和已完成账本，该本地结果与下述独立 staging DO 证据分别记录。

原子步骤先按可信 `callId + payloadHash` 保存预留，再在派发前保存不可重放的 intent。通过鉴权后，相同 callId、相同规范化 payload 的任何重试均返回保存的收据和 HTTP 409，包括 reserved/dispatched/terminal；不同 payload 返回冲突。Worker 的 call 取消标记或 run 撤权会更早返回 403。取消与期限校验不会清除 intent。核心在 intent 提交返回后、调用 fetch 前再次校验身份到期，过期可产生一次 intent、零发送的保守记录。存储配置发生漂移时返回冲突，不重置旧 run 额度。

费率必须明确注入 provider/model/version、HTTPS 来源、核验时间/到期时间和覆盖全部可计费用量的 input/output 价格。核心不抓取或验证该网页，因此接入者必须核验当前官方价格以及该固定 mapper 的计费语义。测试中的价格和 token 上界是刻意标注的合成 fixture，不能用于真实调用。历史 `pi-live.json` 的 `cost: 0` 占位值不是免费证据，也不授权调用。

预留按全部输入的非缓存价格上界与全部输出上界计算，整数微美元向上取整。每个 run 最多保存 3 个预留，从而避免未完成 reserved 状态无限占用状态。该原语没有生产扣费、充值、改价、结算、退款或释放接口；即使终态 usage 已知，也始终 `billingAmount: null / held-for-review`。费用授权不足、费率缺失/过期或未知语义都应拒绝执行。

SSE 使用增量 UTF-8 解码和逐帧解析，同时逐 chunk 转发原字节；跨 chunk 只保留一个尚未完成的 frame，单个传输 chunk 还受总字节上限限制，没有为了读取 usage 缓冲整段回答。以 `[DONE]` 作为协议结束，不无限等待上游关闭。已知用量必须满足 finish、其同帧或之后的 usage、`[DONE]` 和 token 算术一致。早期 content 帧携带 usage 不算最终用量；usage 错误、前后冲突或倒退不会被后续正常帧洗成已知。finish 后继续输出 content、finish 冲突、模型/协议/响应 ID 漂移、超限会中止并保存 unknown。未知 cache/reasoning 分类保留 `null`，不假设 0；cache 与 reasoning 作为输入/输出子集观察，不重复相加。

收据分别保留平台生成的 `platformRequestId`、实际响应头的 `upstreamRequestId`（并注明头名）与 SSE JSON 的 `upstreamResponseId`。供应商没返回头 ID 时保留 null，不用平台 ID 或 JSON ID 伪造。历史 header requestId=null 不阻止另行观察真实 JSON ID，但不能宣称供应商请求头关联已建立。

`completion.persistence` 为 `saved / unconfirmed / not-reserved`。预留或 dispatch 结果未知不允许自动重放；后续相同 callId 必须向同一持久账本查询。终态保存失败/超时为 unconfirmed，不能因 SSE 正常结束而称持久收据成功。

## 已实现的能力与固定 Worker 适配

[capability.ts](capability.ts) 由 Worker 为批准的调用生成 `m0p.<runId>.<32 随机字节 hex>`，最长有效期为 10 分钟。可信记录绑定固定 `m0-trusted-pi` principal、tenant、workspace、run、callId 和 expiry；只持久保存覆盖 token、binding 与签发时间的 SHA-256 摘要及 binding，不保存明文 token。解析出的 runId 仅用于寻址，最终身份必须来自 DO 保存记录的摘要、scope 与过期校验。记录和返回身份是独立冻结快照。它仍是可转移的 Bearer 能力，不证明真实 Pi 进程或生产登录主体已接入。

[gateway-auth.ts](gateway-auth.ts) 在内部 token 外追加 HMAC-SHA256，签名输入为 `riffology-m0-model-gateway-v1\0` 加内部 token，密钥仅由 Worker 的 `M0_PROBE_TOKEN` 注入。公网入口在 DO lookup **之前**严格校验单 Bearer、四段格式和 MAC，阻止伪造任意 runId 创建 DO；随后把内部 token 交给 DO 二次鉴权。摘要及 MAC 使用固定时间比较。外层 MAC 只授予网关准入，不能替代内部身份、过期或撤权检查。管理路由只接受原始 operator secret，模型 capability 不具备管理权限，operator Bearer 也不能直接调用模型。

[cloud.ts](cloud.ts) 将每个 run 固定路由至 `M0ModelProxyRun`，以管理授权的合成 alpha/bravo scope 初始化三个固定 callId，并持久保存批准、capability 记录、ledger 和撤权状态。模型入口复核对象归属和记录；预留/派发复核 run 状态与 call 取消标记，run 撤权写入并确认后中断已登记请求。完成收据交给 DO `ctx.waitUntil`；管理接口另有 status、受控 restart 和“intent 持久化后、fixture 派发前中断”的故障注入。初始化声明为 `operator-authorized-synthetic-probe`，本地集成通过不代表生产用户登录或可信 Pi 拓扑已验收。

显式取消使用 **`POST /v1/cancel`、空 body、与该次模型调用相同的 capability**，不能从 body 另选 callId，也不接受 operator secret 代替模型能力。网关先验外层 MAC，DO 再核验内部记录，在事务内写入固定 callId 的持久取消标记、等待 `storage.sync()`，然后 abort 该 call 的活动请求。预取消在 reserve 前拒绝模型调用；已取消能力重放返回 403，保留原 intent 和预留。取消请求结果未知时仍需读取可信状态核对，不能以新 callId 重放。

模型网关在转发 DO 前，以 8 KiB / 1.5 秒上限完整读取并校验 JSON 上传，移除旧的 content-length / transfer-encoding 后转发有限正文，避免 DO 提前拒绝已取消或撤权调用时，原请求上传流仍晚于响应存活。此处理不改变下述 disconnect-only 取消缺口。

该入口固定 `M0_MODEL_MODE=fixture-only` 和 `PROTOCOL_VERSION=m0-model-proxy-v1`，精确校验 `M0_CONTROL_ORIGIN`，没有 live 模式切换。provider/model 固定为 `m0-fixture / m0-text-fixture`；注入的 transport 只在内存构造 SSE，`.invalid` 目的地址不会发生网络请求。call-1 / call-2 返回固定结束与 usage，call-3 用未结束的流验证取消和未知用量。`realProviderCalls: 0`、`liveEnabled: false` 是该实现的模式说明，fixture 的 header ID / response ID 也不是供应商 ID。

Worker fixture 使用输入上界 128、输出最多 32 token，以及 `synthetic-fixture-not-money-v1` 费率。它们仅对固定合成 transport 有意义，**不能证明 Go 输入 token 或计费上界**；金额仍保持 `billingAmount: null`。本入口仅需探针 operator secret，不读取、配置或转发真实供应商凭据。

## 真实接入仍必须完成和验证

1. 将已实现的能力签发与校验接到真实可信 Pi 执行域，验证能力不可由项目取得或扩权，且一次逻辑调用保持同一服务端 run/callId、租户和 workspace。合成 operator 初始化不是生产身份验证；项目传入的 Authorization 或身份 header 不能直接成为可信返回值。
2. 将已通过的本地 DO 并发、显式取消、撤权和重启矩阵扩展到实际云部署，并补足仅断开连接的及时取消证据；检查 persistence 与云端重启后的账本。持久写入结果不确定须人工/可信流程核对，不能重新调用供应商来猜结果。
3. 把 provider secret 只保留在可信 Worker，结合 Container 的实际出口策略和可信 Pi 拓扑，验证项目读不到该 secret，也不能走另一个代理/任意 URL 绕过限制。
4. 提供经过验证的输入 token 上界实现与当前官方费率批准记录，审阅合计预算，再允许单次有界真实调用。供应商忽略输出约束的风险需真实调用证据检验，旁路 usage 检查不能撤销已发生的供应商消耗。
5. 保持 Pi SDK 自动重试为 0，并令一次逻辑调用的重连保持同一可信 callId。纯模块无法阻止另一个云入口为相同动作错误签发新能力。
6. 冻结实际部署 bundle/version，记录真实请求/响应 ID、事件、取消和 Session 保存恢复；另验云端网络出口、依赖源和业务接口拒绝。全部原门禁完成并经主控审阅后才能宣称 G0-T01/T09 通过。

## 本地验证

```sh
node --test tests/m0/model-proxy.test.ts tests/m0/model-proxy-durable.test.ts tests/m0/model-proxy-capability.test.ts tests/m0/model-proxy-gateway.test.ts
npm run typecheck
```

此前已通过的 42 项由核心 21 项、durable store 8 项、capability 7 项和 gateway 6 项组成，均不建立网络连接；该计数不是新增取消入口的全仓检查结果。身份摘要、随机数和 HMAC 使用真实 crypto；存储仍为接口 fixture。核心还用锁定的 Pi AI SDK 0.85.0 真实生成 payload，通过内存 transport 进入代理并消费模拟 SSE；显式指定 `max_tokens / 256 / DeepSeek compat` 时完成两轮文本消息及 assistant 历史上下文；`max_completion_tokens` 会被拒绝且不派发上游。它没有证明完整 Pi Session 的 content parts、远程工具协议或云端链路可接入，本阶段严格的纯文本子集仍需与实际 Session payload 核对。

[本地 Workerd driver](../../scripts/m0/model-proxy-local.mjs) 固定 origin 为 **`http://127.0.0.1:8794`**，只连接操作员已启动且将 `M0_CONTROL_ORIGIN` 覆盖为该地址的 Worker，不启动 Wrangler、Docker 或模型。其入口为：

```sh
node scripts/m0/model-proxy-local.mjs --secrets-file .local/<owned-probe-secrets>.json
```

secret 文件须为仓库 `.local` 内无符号链接的 0600 JSON，且只有 `M0_PROBE_TOKEN` 字段，与本地 Worker 的探针 secret 一致；不需要供应商凭据。driver 记录源码摘要、有限请求/时间/字节预算及独立 cleanup 结果。

2026-09-05 当前的[本地 Workerd 通过收据](../../docs/evidence/runs/m0-model-proxy-local-1788611379474-ec85ee9b/model-proxy-local.json) 包含 22 个通过 case、44 次业务请求和 2 次 cleanup 请求，运行期间源码稳定、四个 run 均确认撤权；环境为 `local-worker-fixture-only`，`gate_decision: not_evaluated`、`cloudGatePassed: false`。此前[1788611261155 的通过收据](../../docs/evidence/runs/m0-model-proxy-local-1788611261155-b05d8c22/model-proxy-local.json) 保留为增加网关有界上传前的历史证据。除管理/模型权限隔离、并发仅一次接受和 scope 替换拒绝外，当前版本已验证：

| 场景 | 实际观察与断言 |
| --- | --- |
| 活动流显式取消 | 相同 capability 调用 `/v1/cancel` 返回 200，原流得到 server EOF；call-3 保存为 `terminal/cancelled`、usage unknown、活动请求归零。再次调用返回 403，ledger 与 fixture 次数不变 |
| 预取消 | call-2 的取消标记先持久保存；模型调用返回 403，ledger 为 null、零 reserve、零 fixture 派发 |
| 活动 run 撤权 | 管理撤权关闭活动流，保存 cancelled / unknown，活动请求归零；已撤权能力返回 403 |
| intent 后中断 | `ctx.abort()` 令请求返回 500，新实例 nonce 改变；`dispatchCount=1`、`fixtureDispatches=0`，call 保持 dispatched、facts null、完整预留仍在。重放返回 409，随后复查 ledger 与次数均不变 |
| 已完成后重启 | 新实例 nonce 改变，completed / known 账本及一次 fixture 派发保留；重放返回 409，随后复查 ledger 与次数不变 |

**仅断开连接的及时取消仍未通过。** 前三次 [1788610853412](../../docs/evidence/runs/m0-model-proxy-local-1788610853412-0d9153eb/model-proxy-local.json)、[1788610945539](../../docs/evidence/runs/m0-model-proxy-local-1788610945539-086c58fb/model-proxy-local.json)、[1788611138874](../../docs/evidence/runs/m0-model-proxy-local-1788611138874-d62e1d8d/model-proxy-local.json) 均在客户端断开后得到 `terminal-status-timeout`，保留为失败记录。最长约 6 秒的状态观察仍显示 call-3 为 dispatched、`activeRequests=1`；配置 `enable_request_signal` / `request_signal_passthrough` 并不足以在这条本地链路实现即时取消。新增显式取消通过没有关闭这一缺口，也未证明供应商停止时间或最终费用。最新全仓检查已通过，未因此关闭断线传播缺口。

[正式云配置](../../infra/wrangler.m0-model-proxy.jsonc)已部署，版本 `06e097f1-cb6d-4349-8cf5-af4472ba0079`，模式为 fixture-only。[云收据](../../docs/evidence/runs/m0-model-proxy-cloud-1788613210899-49e0a3db/model-proxy-cloud.json)包含 23 个通过 case、50 次业务请求、50,210 响应字节、34.347 秒；4 run 最终 revoked/active=0。正常清理计入业务，emergency cleanup=0。增加的第 23 项为最终全 run 状态与账本核验。部署/API/SQLite 证据及命令见[运行手册](../../docs/m0-local-runbook.md#模型代理的云端-fixture-验证)。云入口和原语通过均不关闭 T01/T09；真实调用仍须满足[协议与预算前置条件](../../docs/m0-model-proxy-budget.md)。
