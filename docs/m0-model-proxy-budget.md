# M0 模型代理协议与预算前置条件

核验日期：**2026-09-05**。本记录针对 `opencode-go/deepseek-v4-flash` 的官方公开协议、现有本地证据与已安装 Pi SDK 0.85.0 源码；未读取凭据值、查询账户权益、调用模型或修改账户设置。用户授权的新增用量预算为 **US$5，其中模型最多 US$1**，不允许新增订阅购买。

**2026-09-06 当前执行结果：两次真实 Go 云调用已完成，T01/T09 已签收。** [云记录](m0-pi-live-cloud-validation.md)包括完整 Session/R2 恢复与取消；代理独立回读为两次派发、completed/cancelled、已撤权且 active=0。整窗预留 923,424 μUSD 保留，首轮终态 usage 为 81 输入 + 24 输出，取消轮用量、Go 额度变化和现金金额保持未知。不补发第三次，不充值或切换到 Zen 余额入口。下文保留协议推导及历次实施状态，不能把历史未部署表述当作当前状态。

## 已知事实与证据边界

[历史本地记录](evidence/runs/m0-initial/artifacts/pi-live.json) 包含三次 HTTP 200、流式事件、上下文恢复和一次取消，环境为 `local-trusted-pi-host`；三个响应头 `requestId` 均为 `null`。这只能证明当时的本地请求成功，**不能证明当前账户仍有有效订阅、剩余额度、模型权限或可用路由**，也不能证明可信云执行域及项目出口已通过 T01/T09。

历史记录的三次 input/output 分别为 163/16、181/42、207/1；第三次已取消，这些数字不能作为三次请求的最终结算总量。旧记录里的 SDK cost 为零，是自定义模型价格字段的占位结果，不是免费或零扣款证明。当前[证据适配器](../services/runtime/pi-probe-evidence.mjs) 将金额保留为 `null`、用量结算标为 `unreconciled`，取消/失败标为 `not-final`；未知费用必须继续保持未知。

## 对应供应商协议

[Go 官方文档](https://opencode.ai/docs/go/) 当前列出以下接口；它与不含 `/go` 的 Zen 接口是不同计费入口。

| 字段 | 本轮固定目标与含义 |
| --- | --- |
| 方法、地址 | `POST https://opencode.ai/zen/go/v1/chat/completions` |
| 鉴权 | `Authorization: Bearer <平台注入凭据>`；凭据值不得进入项目、日志或证据 |
| 请求 model | `deepseek-v4-flash`；`opencode-go/` 是客户端 provider 前缀 |
| 协议 | OpenAI-compatible Chat Completions；JSON 请求，`stream: true` 时返回 SSE |
| 生成上限 | 显式 `max_tokens: 256`，并验证最终序列化请求；不能只验证 SDK 内部 `maxTokens` 字段 |
| 用量 | 请求 `stream_options: { include_usage: true }`，接收完整结束事件后仍需供应商账目核对 |
| 思考模式 | 固定诊断应显式发送 `thinking: { type: "disabled" }`，不能把本地 `reasoning: false` 当作已发出该指令 |

[DeepSeek 官方 Chat Completions 协议](https://api-docs.deepseek.com/api/create-chat-completion/) 公开的是 `max_tokens`；生成与输入共同受上下文限制，思考模式默认开启。`prompt_tokens` 包含输入缓存命中与未命中部分，`completion_tokens` 表示生成 token，reasoning 明细属于 completion 的组成部分，不能再重复相加；`total_tokens` 为输入与生成之和。完整流中的最终 usage 与取消时已收到的片段不同，取消可能使客户端拿不到最终用量。

上述 DeepSeek 文档是上游公开协议，不构成 Go 当前部署对所有字段兼容的实测证明。[Go 官方路由源码](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/go/v1/chat/completions.ts) 使用 `oa-compat` 和 Bearer；[请求处理源码](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/util/requestBody.ts) 替换模型并添加 streaming usage 请求，没有将 `max_completion_tokens` 改为 `max_tokens`。这些链接是核验当日的公开 `dev` 分支，不是线上部署版本证明。

## 现有 256 token 限制的两个缺口

[本地调用脚本](../scripts/m0/pi-live-probe.mjs) 根据是否提供 `RIFFOLOGY_PI_BASE_URL` 选择两条路径；[受控 Pi 适配器](../services/runtime/controlled-pi.mjs) 注册平台提供的模型定义，并关闭自动重试及网络发现。

| 路径 | 当前实现 | 预算缺口 |
| --- | --- | --- |
| 提供 BASE_URL | 自定义模型设置 `maxTokens: 256`、`contextWindow: 16384`、`reasoning: false`，未显式设置兼容参数 | 已安装 Pi 的默认兼容检测对该 Go URL 选择 `max_completion_tokens`；不能证明公开协议的 `max_tokens` 上限已生效，也不会因此自动发送关闭 thinking 的字段 |
| 不提供 BASE_URL | 使用 Pi 内置 `opencode-go` 模型定义 | 内置 Flash 兼容参数正确选择 `max_tokens`，但模型默认 `maxTokens` 是 384,000；脚本没有另行强制 256 |

本地可复核的锁定依赖文件为 `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`（`buildParams`、`detectCompat`）、`dist/api/simple-options.js`（`buildBaseOptions`、`clampMaxTokensToContext`）及 `dist/providers/data/opencode-go.json`。版本来源见[锁文件](../package-lock.json)。这些是安装产物，不要求把 `node_modules` 纳入仓库。

`contextWindow: 16384` 只是 SDK 估算可用输出空间的元数据；现有函数会缩小输出空间，却不把超限输入当作预算拒绝。因此它不是输入 token 的硬上界。30 秒取消计时器也不限制已经发生的供应商用量。

## 条件性额度计算，不是现金扣款结论

核验日期 2026-09-05、对应上述 **Go** 端点的公开 Flash 价格如下。它用于计算 token 标价对应的用量价值，不能与 [Zen 按量价格](https://opencode.ai/docs/zen/#pricing) 混用，也不能直接解释为 Go 共享额度下降或信用卡新增扣款。

| Go 时段 | 输入 / 1M token | 输出 / 1M token | 缓存读取 / 1M token |
| --- | ---: | ---: | ---: |
| Peak | US$0.44 | US$1.32 | US$0.014 |
| Off-Peak | US$0.22 | US$0.66 | US$0.007 |

来源：[Go 官方额度与价格说明](https://opencode.ai/docs/go/#usage-limits)。

官方规则还列出 Go 的基础共享额度为 **US$12/5 小时、US$30/周、US$60/月**；Flash 模型表中的 **Usage US$30** 是该模型的用量价值口径，不是请求次数上限，也不是新增现金扣款。按该口径给出的典型请求估算约为 **7,600、18,900、37,800 次**，取决于请求的 token 组成；这些是价值换算示例，不能当作保证的可用次数或硬限。

按较高 Peak 价格、全部输入视为非缓存计算，**仅当每次完整输入不超过 16,384 token、生成不超过 256 token、总供应商尝试不超过三次时**：

```text
单次预留 = (16,384 × 0.44 + 256 × 1.32) / 1,000,000
         = US$0.00754688
三次预留 = US$0.02264064 < US$1
```

这只是明确前提下的额度价值上界。仅限制三次输出 256 token 不足以限制输入；未经证实的 tokenizer 估算、SDK 默认参数和收到的文本长度都不能满足此条件。账单金额、当前权益与实际剩余额度仍是 `unknown`/`null`，不得据上述计算填成零。

Go 当前为 US$10/月订阅；2026-09-06 用户确认已有订阅有效，5h / weekly / monthly 剩余额度均接近 100%（用户报告，非 API 核验）。[Go 超额说明](https://opencode.ai/docs/go/#usage-beyond-limits) 表明，超出 Go 共享额度时，关闭 `Use balance` 应按拒绝处理；只有启用 `Use balance` 才会转用 Zen 余额。[Zen 自动充值与月限额说明](https://opencode.ai/docs/zen/#auto-reload) 中的自动充值只适用于余额路径，因而不是 Go-only 测试的额外前置条件。执行前必须确认既有权益、模型许可、剩余额度以及 `Use balance` 状态；不足时停止，不购买订阅、不充值、不切换付费入口。账户状态已由用户确认，尚无自动读取的精确额度快照；本文没有更改这些设置。

账户核验进展（2026-09-06）：用户已提供订阅有效及三个额度窗口接近 100% 的状态文字，详见[环境确认](m0-setup-confirmation.md)。页面内容读取仍未成功，不将用户报告写成自动核验。用户已确认 `Use balance` 关闭；未更改扣费开关，也没有新增供应商调用。不要求关闭全账户自动充值，费用字段继续保留 unknown。

## 两轮调用与完整上下文预留的候选方案

**原 G0-T01 没有三次请求的下限，也没有要求精确 tokenizer。** [原验收](development-deployment-plan.md#31-g0-云端技术验证)要求最小真实调用、流式事件、取消、Session 保存恢复，以及供应商 ID、事件和恢复后上下文证据。[现有脚本](../scripts/m0/pi-live-probe.mjs)分开执行记忆、恢复、取消，才形成三个请求；上面的三次价格示例不是验收次数要求。经过验证的 tokenizer 与已证明保守的完整输入上界均可作为预算依据，不能因为模板计数未知而排除整窗预留。

[DeepSeek 官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)公布 Flash 的上下文为 1M；[Chat Completions 协议](https://api-docs.deepseek.com/api/create-chat-completion/)规定输入与生成合计受上下文限制；[官方 Flash-0731 配置](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731/blob/main/config.json)明确 `max_position_embeddings: 1048576`。若实际 Go 调用的完整计费输入受这一上界约束，则同一次推理中的角色分隔、模板、恢复历史和附加提示都包含在整窗内，无需精确知道各项 token 数量。此处预留更大的费用上界，实际请求仍使用短诊断，并保留正文总字节数、消息数、时限与输出限制。

按 Peak 价、输入全部视为非缓存，并在完整上下文之外再加 256 输出作保守预留：

```text
单次 rawTokenValue 上界 = (1,048,576 × 0.44 + 256 × 1.32) / 1,000,000
                       = US$0.46171136
单次向上取整预留       = 461,712 μUSD
两次合计预留           = 923,424 μUSD = US$0.923424 < US$1
三次合计预留           = 1,385,136 μUSD > US$1
```

这是按公开合约作出的保守 token 价值预留，2026-09-06 已完成执行评审；它不是 Go 绝对现金扣费封顶。Go 官方文档确认模型名及端点，但核验时的[公开模型列表](https://opencode.ai/zen/go/v1/models)没有上下文限制字段；DeepSeek 的模型配置不单独证明 Go 当前线上路由和完整计费范围。[Go 公开 handler 固定 revision `e2894562f8ba943d72172d10b727c24d5f650c16`](https://github.com/anomalyco/opencode/blob/e2894562f8ba943d72172d10b727c24d5f650c16/packages/console/app/src/routes/zen/util/handler.ts#L180-L287)在本层只有一次 `providerRequest()` / fetch，fallback 在派发前选择，没有失败后重试循环；这不是线上版本或下游 `console-go` / `inf-go` 的部署证明。未找到透明重试不额外计费、取消或上游拒绝免费的公开保证，也没有证据表明本次实际发生重复扣费。平台的两次派发限制不能自动写成所有下游尝试合计两次；精确 tokenizer 同样不能解决这个计费范围问题。

后续证据应分开记录以下三个口径，不能相互替代；这些是记录要求，不代表现有代码已经实现同名字段：

| 口径 | 含义与当前边界 |
| --- | --- |
| `rawTokenValue` | 按固定模型公开 token 单价计算的用量价值；上述 923,424 μUSD 是两次保守预留，不是已发生费用 |
| `GoQuotaDelta` | Go 控制台共享额度的实际下降，需核对账户及模型归一化倍率；当前未知 |
| `cashCharge` | 新增现金扣款，需账户交易或账单证据；当前未知，不能填零 |

[Go 文档](https://opencode.ai/docs/go/#usage-limits)列出的基础月额度为 US$60，Flash 对应 Usage 为 US$30；[固定 revision 的额度累计](https://github.com/anomalyco/opencode/blob/e2894562f8ba943d72172d10b727c24d5f650c16/packages/console/app/src/routes/zen/util/handler.ts#L1121-L1160)使用 `cost × costMultiplier`。因此不能将 token 标价价值直接当作共享额度下降。US$1 模型预算不变；这些单位的差异应明确记录；当前两次微量诊断依据既有执行授权及关闭余额兜底安排，不再等待未公开计费内部实现的证明。取消、断流、未知结果均保留完整预留，不以已接收片段推定最终扣费。

两轮方案的验收步骤如下；实现状态以文末为准，真实执行仍待云监督器接线完成：

1. **正常完成第一轮。** 在可信云 Pi 中发送随机 marker，正常完成真实流式调用，保存事件、真实返回 ID 的来源、最终 usage 或未知状态，以及 Session 保存包和摘要；随后销毁该 Pi 实例。
2. **恢复并取消第二轮。** 从保存包重建 Pi，重新注入平台策略；当前问题不重新提供 marker，要求先返回此前 marker，再继续一个输出受限的诊断。记录实际 wire 历史及摘要，从真实流中确认 marker 后，在调用仍运行时发起显式取消，记录宿主、代理事件和持久终态。供应商实际停止时间或最终费用未确认时维持 unknown 和完整预留。
3. **有界结束。** 如果第二轮已完成才取消、没有恢复出 marker、供应商 ID 证据不足或出现未知失败，则对应验收保持未通过。该候选方案最多两次平台派发，**不自动补第三次，不重放未知结果**；也不把客户端取消成功表述为供应商停止生成或零费用。

历史 [policy](../spikes/m0-model-proxy/policy.ts)当时将可配置输入硬限设为 **8,192**、输出硬限设为 **256**，尚未改成整窗预留，也没有接入上述两轮 live 流程。不得把 1,048,576 偷填为较小的已验证输入值；后续变更须分别验证费用上界、请求大小和派发次数约束。此为当时实现状态；当前具名 live profile 已实现整窗预留，见文末。G0-T01/T09 尚无真实云验收。

## 待完整接入与实证的派发约束

以下是执行前必须完整实现并验证的要求。独立代理已实现部分纯策略与 fixture-only Worker 适配，状态见文末；不代表当前 live 脚本或真实供应商链路已具备这些能力。

1. **锁定实际 wire 请求。** 平台固定 provider、HTTPS origin、路径、方法、模型和生成上限，拒绝项目提交任意 URL、模型或计费参数；禁止重定向改变目的地。离线捕获最终 HTTP 请求体，两个配置分支均须断言 `max_tokens <= 256`、thinking 显式关闭、usage 已请求，且无冲突上限字段。固定客户端标识和合成 session 标识，不发送项目身份声明作为平台授权依据。
2. **证明完整输入上界。** 包含系统提示、恢复后的消息历史、所有序列化内容及协议开销；使用经过验证的供应商 tokenizer 或已证明保守的上界。若只能获得未校准估计，必须拒绝派发。使用固定短诊断，不开放工具循环、自动摘要、额外模型选择或隐式辅助调用；原验收没有三个诊断请求的下限。
3. **派发前预留，并限制次数。** 现有代理原语允许每个 run 最多三次；上述完整上下文候选方案只能允许两次，不自动补第三次，当前新增 live profile 已切换为两次，fixture 保留三次。每次真正发往供应商前原子登记平台 attempt ID、价格快照和保守费用预留；总额不能超过本次 US$1 模型子预算。错误、取消、超时、未知响应同样消耗一次尝试；禁止自动重试或换入口重放。已有 `maxRetries: 0` 是其中一项措施，不能替代整个派发预算与次数围栏。
4. **取消后保留未知预留。** 取消只证明客户端发出中断或观察到 aborted；供应商停止时间及最终费用可能仍未知。未取得可核对的最终用量前，不释放该次完整预留，不将已收到 token 当作最终结算，不重放未知结果。总体 deadline 必须为证据落盘和清理留出独立时间。
5. **分开记录三种 ID。** 平台 attempt/request ID 是平台生成的授权、预算与审计关联键；供应商响应头 request ID 是供应商返回且可能不存在的字段；SSE/JSON `id` 是 completion ID，Pi 保存为 `responseId`。客户端传入的 `x-opencode-request` 属于平台关联信息，不能写成供应商签发的 ID。保留来源和空值，不能相互伪造替代。
6. **单独核对用量与现金。** 保存经过脱敏的状态、事件、最终 usage 或 `unknown`、请求摘要、价格核验日期、预算预留、ID 来源，以及账户用量前后证据。供应商响应、SDK token 统计、Go 额度消耗和现金结算是不同证据层；没有供应商账目核对时，`billingAmount` 保持 `null`。

[公开网关源码](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/util/handler.ts) 的响应头过滤与历史 `requestId=null` 相符；它也把客户端 `x-opencode-request` 用于关联，并在非余额计费路径返回零 occurred cost。这既不能证明线上部署相同，也不能把返回零解释为没有额度消耗。当前 [Pi 证据适配器](../services/runtime/pi-probe-evidence.mjs) 已区分 header request ID 与 response ID；即使成功取得 completion ID，也尚未证明可以与供应商后台账目或上游日志对账。

T09 还要求可信执行域实际限制项目出口、保护供应商密钥、拒绝改目的地址，并阻止项目访问充值、改价和结算接口。本文只确定协议与预算前置条件，不用本地调用成功替代这些真实边界验证。

## 输入计数的可用资产与剩余未知

官方 DeepSeek-V4-Flash [发布 commit](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash/commit/a7aaed80dd2df27620eb534454253ea25eb11c7a) 包含 tokenizer.json、tokenizer_config.json、Python 消息编码器与测试，无需模型权重。后续可锁定该 commit，再计算各资产 SHA256，用官方 encode_messages 处理完整消息历史、BOS、角色分隔与生成前缀，然后执行 tokenizer。此次仅核查公开资产，未下载或计算其内容摘要；PR 分支中的 Jinja 模板不能冒充正式发布资产。

这只能建立锁定开源版本的 local_reference_count。[官方 token 说明](https://api-docs.deepseek.com/quick_start/token_usage/) 给出的字符比例是近似值，没有承诺 UTF-8 字节的硬上界。Go 线上路由的 tokenizer/模板版本、附加提示和计费归一化仍未知，公开 dev 源码也不是部署证明。在这些附加输入得到供应商保证前，不把本地计数填成 verifiedInputUpperBound。前述完整上下文方案是另一条保守预留路径：若其 Go 服务与计量前提成立，就不需要通过精确模板计数解决 framing 未知；2026-09-06 已选用该公开合约下的保守规划；它不是供应商内部实现或实际现金费用的证明。

[代理原语](../spikes/m0-model-proxy/README.md) 的核心策略缺少可信上界时拒绝派发；其普通配置的最大值为输入 8,192、输出 256；新增具名 live profile 另允许整窗预留，与前述 16,384 的条件性价格示例及整窗候选方案不同。新增 fixture-only Worker、能力校验和 DO 存储适配已完成下述本地 Workerd 与 staging fixture 矩阵，但真实可信 Pi 身份接入、真实供应商云链路与仅断开连接的及时取消仍未完成。既有 pi-live 脚本尚未配置宿主检查入口，不能根据这些测试放行真实调用。

## 已验证与仍待接入（2026-09-05）

已完成 **7 项 wire 测试与 4 项新增宿主 hook 测试**，均为本地真实 Pi SDK 配合 loopback HTTP fixture 的离线验证，没有调用供应商。其中，[wire 测试](../tests/m0/pi/model-wire.test.mjs) 保留 Go 逻辑 URL 以验证 SDK 兼容推断，但唯一 socket 目的地固定为本地 fixture，默认 fetch 被阻断；内置模型 384,000 上限仅检查安装的 registry 配置，没有派发内置分支请求。

- 显式 compat 能使最终请求使用 `max_tokens: 256`，但默认不含 thinking；未配置 compat 的默认字段问题仍然存在。测试还证明调用选项可以上调模型的 `maxTokens` 元数据，因此模型元数据本身不是预算围栏。
- [受控宿主实现](../services/runtime/controlled-pi.mjs) 及其[类型声明](../services/runtime/controlled-pi.d.mts) 现提供可选的 `onProviderPayload` 平台入口。适配器在 `...options` 之后覆盖最终 hook，先处理原 SDK payload 回调，再执行平台检查；检查接收来自 canonical 模型的冻结元数据，不采用请求正文自报身份。
- [新增宿主测试](../tests/m0/pi/controlled-pi.test.mjs) 验证了最终请求改写及 Session 恢复后重新注入策略、策略拒绝时零 HTTP 请求，以及取消后策略晚 resolve 或晚 reject 仍零派发。取消等待保留晚结果的处理器，并在返回请求正文前再次检查中断信号。

**这些结果只验证可接入策略的入口，不代表自动具备 token 计数、预算预留、次数账本、供应商扣费核对或实际云出口控制。** SDK 默认问题本身没有被修改；现有 [pi-live 脚本](../scripts/m0/pi-live-probe.mjs) 尚未配置此 hook，该历史脚本继续不用于新 live 测试；当前调用应使用文末已实现的固定代理模式和待接线云监督器。T01/T09 继续保持未通过。

## 新增代理存储与 Worker 适配状态（2026-09-05）

独立代理此前已有 **42 项纯代理相关测试通过**：核心 21 项、[durable store 8 项](../tests/m0/model-proxy-durable.test.ts)、[opaque capability 7 项](../tests/m0/model-proxy-capability.test.ts)、[gateway HMAC 6 项](../tests/m0/model-proxy-gateway.test.ts)。这些测试使用真实 crypto 和内存 transport/存储接口 fixture，不包含 Workerd、云部署或供应商请求；不与上面的 7 项 wire / 4 项新增宿主测试混为云验收。新增取消入口与有界上传完成后的[全仓检查](evidence/runs/m0-local-20260905122955797/local-checks.json)为 173 项通过、1 项 opt-in 跳过、2 个自检通过。

- [DurableRunStore](../spikes/m0-model-proxy/durable-store.ts) 在 SQLite DO `transactionSync` 内更新固定 ledger，clone 状态及返回值，并等待 `storage.sync()` 才确认。sync 失败仍为未知，不能重放可能已提交的 intent；跨实例共享账本、回滚与重建约束已由接口 fixture 测试，下述本地 Workerd 集成另验证了 `ctx.abort()` 后 intent 与完成账本保留。
- [内部 capability](../spikes/m0-model-proxy/capability.ts) 由 Worker 生成 32 随机字节 opaque token，绑定固定 trusted-pi principal、tenant/workspace/run/callId、签发时间及最长 10 分钟 expiry；只持久存摘要和 binding。token 中的 runId 仅寻址，DO 必须核验保存记录和撤权状态，不能从请求正文或任意身份 header 认定主体。
- [外层 gateway HMAC](../spikes/m0-model-proxy/gateway-auth.ts) 使用 Worker 注入的 `M0_PROBE_TOKEN` 和独立 domain，在 DO lookup 前拒绝伪造 runId/nonce/tag；管理 Bearer 与模型 capability 不可互换。MAC 只作网关准入，DO 内部摘要、scope、expiry、撤权和单 call 不重放仍是独立检查。能力仍是可转移 Bearer，尚未证明真实 Pi 执行域能安全持有它。
- [cloud.ts](../spikes/m0-model-proxy/cloud.ts) 已把固定 run DO、三次 callId、持久批准/预留/intent、撤权、`waitUntil` 收据以及受控 restart / intent 后中断接成 **fixture-only** 入口。初始化是 operator 授权的合成 alpha/bravo scope，不是生产用户登录。transport 只在内存返回固定 SSE，provider/model 为 `m0-fixture / m0-text-fixture`，没有真实供应商 fetch、live 模式或 live 凭据；fixture 的 ID 和 usage 不是供应商证据。
- 显式 `POST /v1/cancel` 只接受同一次调用的 capability 和空 body。网关及 DO 双重校验后，DO 事务持久写入固定 callId 的取消标记，等待 sync，再 abort 对应活动请求；模型入口、reserve 与 dispatch 均检查该标记。它不释放已有预留，也不允许改 callId 重放未知结果。
- 当前网关在 DO 转发前以 8 KiB / 1.5 秒上限读取、校验完整 JSON 上传，避免 DO 提前 403 后原上传流仍存活；这项有限缓冲不等于已解决客户端断开后的取消传播。

该 Worker 的输入上界 128、输出上限 32 和 `synthetic-fixture-not-money-v1` 价格只适用于固定合成 transport，**不能证明 Go 的完整输入 token、额度或现金计费上界**，也不能用它覆盖本文的未知项。合成 usage 正常结束仍不改变 `billingAmount: null`；没有真实账户权益、扣费设置和 token 上界的核验，不授权新的模型调用。

[本地 driver](../scripts/m0/model-proxy-local.mjs) 固定连接 `http://127.0.0.1:8794`，使用仅含探针 `M0_PROBE_TOKEN` 的仓库 `.local` 下 0600 JSON；它不启动服务，也不需要供应商凭据。当前[1788611379474 的 Workerd 收据](evidence/runs/m0-model-proxy-local-1788611379474-ec85ee9b/model-proxy-local.json) 实际记录 **22 个 case 通过**、44 次业务请求和 2 次 cleanup 请求、源码在运行期间稳定、四个 run 撤权确认，环境仍为 `local-worker-fixture-only`，`gate_decision: not_evaluated`、`cloudGatePassed: false`。此前[1788611261155 的通过收据](evidence/runs/m0-model-proxy-local-1788611261155-b05d8c22/model-proxy-local.json) 保留为增加网关有界上传前的历史证据。

这轮实证包含同 capability 并发仅一次接受、tenant scope 替换拒绝，以及以下持久状态边界：显式取消使原流结束并保存 cancelled / unknown，活动请求归零；取消后的模型重放返回 403，ledger 与次数不变。预取消产生持久 call 标记，随后模型调用 403、零 reserve、零 fixture 派发。intent 后 `ctx.abort()` 返回中断，新 DO 实例 nonce 改变，但仍保留 `dispatchCount=1 / fixtureDispatches=0`、dispatched / facts null 和完整预留；重放 409 后再次读取，ledger 与次数不变。已完成后重启同样保留 completed / known 和一次派发，重放 409 后状态不变。活动 run 撤权也实际结束流并保存未知用量；以上金额均仍为 null。

**断开连接不等于已确认取消。** 前三次 [1788610853412](evidence/runs/m0-model-proxy-local-1788610853412-0d9153eb/model-proxy-local.json)、[1788610945539](evidence/runs/m0-model-proxy-local-1788610945539-086c58fb/model-proxy-local.json)、[1788611138874](evidence/runs/m0-model-proxy-local-1788611138874-d62e1d8d/model-proxy-local.json) 的 disconnect-only 路径均失败于 `terminal-status-timeout`。最长约 6 秒观察后仍为 `activeRequests=1`、call-3 dispatched；`enable_request_signal` 与 `request_signal_passthrough` 未能在该本地链路提供即时取消保证。显式取消通过没有关闭这个缺口，更不能证明真实供应商已停止生成或可释放预留。

[正式 staging 云配置](../infra/wrangler.m0-model-proxy.jsonc) 已部署至 `https://riffology-m0-model-proxy-staging.jihe-gao.workers.dev`；[1788613210899 的云 fixture 收据](evidence/runs/m0-model-proxy-cloud-1788613210899-49e0a3db/model-proxy-cloud.json)记录版本 `06e097f1-cb6d-4349-8cf5-af4472ba0079`、**23 个 case 通过**，四个 run 均已撤权且活动请求归零，真实供应商调用为零，环境为 `staging-cloud-do-fixture-only`、`gate_decision: not_evaluated`、`cloudGatePassed: false`。这只补充云 DO 与合成 transport 证据，没有改变完整输入上界、Go 计费或账户设置的未知项；G0-T01 / G0-T09 均继续未通过，当时 live 未放行；当前授权与实现进展以本文开头及下一节为准。

后续接线进展：新增[单次 capability 的受控 Pi 客户端](m0-proxy-pi-bridge.md)，本地已验证完整 Session 首次/恢复 wire、显式同 call 取消和有界错误处理。原 `pi-live-probe.mjs` 未改用此客户端，真实云诊断与付费 transport 仍未放行；原有云 fixture 和镜像不自动包含新客户端。

## 2026-09-06 部署前实施记录（历史时点）

主控和独立复核确认：原 G0-T01/T09 没有“三次请求”、精确 tokenizer 或供应商内部重试/线上 revision 证明的前置。使用用户已有 Go 订阅和 US$1 模型预算，两次短诊断可按公开价格与已确认关闭的余额兜底安排执行；这不等于取得账单绝对封顶证明。

[固定 policy](../spikes/m0-model-proxy/policy.ts)新增具名 `go-flash-context-20260906`，保留 fixture 原限制。新环境 `go_live` 使用独立 Worker `riffology-m0-model-proxy-go-live-staging`，唯一 run `go-live-g0-20260906`，只签发 call-1、call-2；拒绝其他 run、bravo 初始化、第三次调用和重复初始化。模式必须显式匹配固定 origin，Secret 存在本身不会开启 live。

[云代理](../spikes/m0-model-proxy/cloud.ts)固定 Go Flash 端点、POST、无重定向或自动重试，最终正文不超过 8 KiB、8 条消息，明确 `max_tokens: 256`、thinking disabled 与 usage 请求。每次按 1,048,576 输入 token 加 256 输出预留 461,712 μUSD，共 923,424 μUSD；整窗为公开模型合约下的保守规划，不冒称实际精确 token 计数。所有取消、失败与未知结果保留预留；预算不因 DO 重启、换 run 或重新初始化而重置。

Go API key 只由专用 Worker Secret `M0_GO_API_KEY` 注入，不能进入 Pi 容器、项目或证据。第二轮之前必须读到 call-1 终态 completed 且 activeRequests=0，再恢复 Pi；这是单活跃请求约束与恢复证据核对。预算审核有效期固定至 2026-09-07T00:00Z，初始化后的 capability 最长 10 分钟，须在监督器就绪后才初始化一次。

[新增 live 测试](../tests/m0/model-proxy-live.test.ts)与既有代理测试共 52 项通过；[全仓检查](evidence/runs/m0-local-20260906063733403/local-checks.json)为 248 pass、1 skip、0 fail。全部测试使用注入 transport，未读取凭据、未部署 live Worker、未调用真实供应商；这些结果不关闭 T01/T09。状态分别保留 rawTokenValueReserved、GoQuotaDelta=null、cashCharge=null、absoluteCashCapProven=false，不把预留当成已发生费用。
