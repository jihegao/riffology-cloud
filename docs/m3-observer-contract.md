# M3 Observer 实施契约

日期：2026-09-08。状态：执行器、浏览器适配、内容存储及 Workspace 私有执行入口已有本地候选；生产执行宿主及验收未完成，不代表 Observer 已交付。依据 [系统设计](mvp-system-design.md#83-共同观察的准确含义) 和 [M3 执行计划](m3-execution-plan.md)。

`WorkspaceAgent.observePreview` 通过独立 `OBSERVER_EXECUTOR` 接口进入持久认领和执行；未配置宿主或门禁关闭时，在 accept 前拒绝。目标 origin 由 D1 登记路由推导；调用专属 `ObserverExecutorCapability` 只提供重新授权、固定内部路径转发及取消查询，不接受另一个 command。执行器地址绑定 scope、Turn、dispatch 与 commandId，参数冲突不能换一个执行器规避原调用身份。capability 不可持久保存，host 结束后回调失效。

新增 `ObserverExecutor` DO 与 `SqlObserverExecutorSupervisor`：完整命令和目标/路由策略持久绑定，派发前保存 attempted，不确定调用不得重复执行；保存结果仍需重新授权后公开。stop 先保存不可逆 fence，再请求独立浏览器 Runtime 的持久 fence 和退出证明，收到并持久确认后才返回 true。过期或关闭执行门禁不阻止 stop；后端不存在句柄、超时或 Promise 取消均不构成退出证明。浏览器 Runtime 只获得受执行生命周期限制的 `ObserverBrowserResources`，累计资源预算仍归 Executor。当前仅有本地 DO/R2 加原生端口夹具证据，实际浏览器进程封禁与退出仍须验收。

Workerd RPC 返回聚合对象附带 Symbol.dispose。仅在返回数据边界通过 `observerRpcData` 分离普通字段并释放 RPC 包装，再进入闭合协议校验；不允许其他符号或访问器，也不对活能力对象和 Response 使用该处理。授权目标变化在内部采样前拒绝，不得将新目标结果保存为旧目标的历史结果。

浏览器侧 `executeObserverCapability` 将该接口接入真实执行器；取消查询串行执行，断连按取消处理，挂起查询另受绝对截止控制。Request 跨 RPC 不携带显式 AbortSignal；Workspace 将本地 host 信号接入已有资源转发。该适配器本身不提供持久停止证明。维护 reconcile 已接入 Workspace 共享 alarm；实际浏览器 Runtime、网络隔离与 Artifact 生产绑定仍未配置，不能打开生产门禁。

新增 `observerCoordinator` 将持久 `ObserverCallHost` 与真实执行器组合；每次执行授权同时受 host 当前生命周期和新鲜目标约束。真实 SQLite + Chrome 夹具验证完成重放不再次执行、unknown 重启后占槽和独立 stop 对账。accepted 提交后 start 到期也需维护 reconcile，不能仅凭过期释放槽位；Workspace 维护调度已完成本地接线；实际原生执行器停止栅栏仍待验收。

`WorkspaceObserverHost` 在同一存储事务中提交调用状态与 Observer 闹钟投影；每个活动调用保留不晚于 5 秒或命令截止的下一次检查。unknown、过期或授权失败进入停止对账，停止未确认则继续占槽并延后重试。初始化、Turn、Service 和 Observer 四域共享物理 alarm，任一域更新不得删除其他域。维护使用持久 Workspace scope，不要求当前用户仍有访问权限，也不启动新观察。

新增本地 `executeObserver` 将浏览器导航、reload、子资源与后续状态读取接入同一个 `createObserverFetchSession`。执行期限取命令和历次授权的最小值，不因后续授权延长。授权在请求和结果存储前后复核；浏览器必须确认临时 context 已关闭，才能接受结果。页面与 state 各自记录 startedAt/completedAt 窗口，并明确 atomicSample=false、domainSideEffects=unverified；窗口不保证页面和 state 来自同一仿真瞬间。

`observeWithPlaywright` 使用平台传入的浏览器创建独立临时 context，固定四种操作与截图尺寸，拒绝额外 frame、下载和 WebSocket。它不启动生产浏览器，也不复用用户 context。请求路由不是 OS/容器出口隔离证据；生产启动、网络栅栏和停止对账仍须接线验收。

`R2ObserverArtifacts` 为 state、view 与 PNG 建立私有不可变内容对象，完整 command、内容摘要与种类共同绑定收据；条件写后读回验证，丢失确认只按同内容恢复。PNG 仅验证基本头部，不声称完整像素解码。截图不内嵌在调用结果中；较小 view 可内嵌，state 保留 ID、sequence 和 Artifact 引用。该层没有公开 HTTP 入口，不授予读取权限；生产读取 ACL、引用生命周期与 GC 仍待完成。


当前本地基础模块：`observer-protocol.ts` 实现闭合命令、15 秒截止及有界状态 JSON 解析；`observer-http.ts` 实现两个明确路径的请求与响应策略；`observer-fetch.ts` 实现单次观察的累计请求、字节和分块预算，以及响应读取前后授权、取消及迟到响应回收。Workspace 私有权限与资源转发已接线，并要求持久调用为 running；观察准入、浏览器执行器、结果落盘、Artifact、Pi 工具或 UI 尚未连成完整链路。协议规范化与路径策略都不授予权限。截图、console、文本上限目前仅定义常量，仍待执行器落实。

新增本地调用基础：`TurnJournal.observerCaller` 同步校验当前 running Turn、Session 所有者、dispatch、generation 和取消状态；`observer-authority.ts` 组合此锚点、Catalog、实时执行租约与 Preview 目标，并要求异步检查后在 Workspace 内同步复核当前绑定。Workspace 的私有授权方法已接 Catalog 与 Runtime，只在显式 Observer 开关下可用；不能由客户端提供权限或以固定成功替身部署。`observer-calls.ts` 提供真实 SQLite 持久认领和结果重放；资源入口已检查该账本，Workspace 执行入口已接该账本和独立执行器接口；实际生产浏览器宿主仍未配置，因此不是已工作的线上 Observer 后端。

账本固定完整命令与目标摘要，同一身份改参数即冲突；只有持久确认的首次 start 返回执行许可，确认丢失不再执行。accepted、running 和 unknown 占用单一工作区槽，过期或重启不自动释放；只有对账确认后才能写终态。成功必须在调用截止前完成，旧终态只能精确重放。结果限制 64 KiB，存储记录读取时复核闭合字段、状态与时间关系，损坏记录拒绝服务。当前保留最多 256 条调用且不自动删除，达到上限拒绝新调用；面向长期使用的保留/归档与幂等墓碑策略仍待实现，不能以直接删除旧记录解决容量。

内部转发使用独立 `forwardObserverHttp`：Workspace 要求调用账本已处于 running、目标摘要匹配、当前 Turn/Preview 有效，并从 D1 登记路由推导 origin；Runtime 校验描述符中的 observation 路径与不可变运行计划一致，独立检查租约和停止栅栏；ServiceSandbox 只访问正在运行容器的固定 8080 端口，重新生成只读标记。普通 `forwardHttp` 的清洗仍会移除 `x-riff-observer`，没有将该头加入公共白名单。当前端口替身与 Workerd 集成验证了标记、拒绝及取消，真实项目容器仍待验收。

这些入口只承接已经开始的观察资源请求，不创建观察、不执行浏览器、不写观察结果。每个请求有限额；新增执行器已在本地持有同一个 `createObserverFetchSession`，跨全部页面资源累计请求数/字节/分块；Workspace 接线仍须保持这一所有权，不能用“每个请求重新创建会话”替代单次观察的总预算。账本开始/完成已由 Workspace 私有执行入口调用编排基础；这些资源入口本身仍不开始或完成观察。

取消不能直接把 AbortSignal 塞入 RPC Request：真实 Workerd 在当前稳定配置下返回 DataCloneError；上游的 [enable_abortsignal_rpc](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/compatibility-date.capnp) 仍标为 experimental，未启用。现使用临时、不可持久化的 `ObserverCancellation` RpcTarget，只能报告取消，不能授予访问。最终端口在请求前及等待期间串行查询；每次查询间隔 100 ms，查询耗时另计，失败或调用者消失按取消处理。Runtime 同时复核租约/停止状态，Workspace 同时复核调用、成员、Turn、目标与路由。每层仍有绝对期限，不能依赖取消查询始终可达。

## Runtime 截止与只读查询

只读必须落实到 SDK 以下：锁定的 Sandbox 0.12.9 普通 readFile 会进入 resolveExecution/ensureDefaultSession，创建默认 Session 并持久化相关状态；普通 readFile/getProcess/getStatus 的 HTTP transport 会进入 containerFetch，在容器未运行或未健康时执行 startAndWaitForPorts。不能在调用前检查 running 后仍调用这些 API。Observer 必须使用独立身份绑定入口，经容器运行状态检查后直接向固定管理端口发送限于控制文件、结果文件和指定进程状态的读取，不接受调用方 URL，不经过 Session 初始化或自动启动；等待期间容器停止或期限到达即拒绝。实际 Sandbox 镜像端点兼容性仍需原生验收。 Sandbox/Container 基类冷初始化还可能创建自身调度表、维护 alarm；daemon 的 MIME 检测也可能使用辅助命令。专用传输不启动容器、不创建 Session 的证据，不能提升为整个 SDK 零写入或零辅助进程；严格零副作用要求尚未获得原生证据。

专用传输已接入 `TrustedPiSandbox.queryObserverExecution`：派生 actor 与调用身份匹配后，只读固定 3000 端口的控制/结果文件和指定进程。`observer-native-read.ts` 使用 sessionless 读取，不接受自选 URL、其他文件或编码；控制内容最多 64 KiB、结果内容最多 2 MiB，JSON 传输另设膨胀上限，每次读取最多 4096 块，读取阶段共用 5 秒期限。缺少专用 RPC 时拒绝，不能回退普通 SDK。发布协议依据：[文件读取](https://github.com/cloudflare/sandbox-sdk/blob/133939602f28a23ae6bab1d00878d95b3f308394/packages/sandbox-container/src/handlers/file-handler.ts#L69)、[进程详情](https://github.com/cloudflare/sandbox-sdk/blob/133939602f28a23ae6bab1d00878d95b3f308394/packages/sandbox-container/src/handlers/process-handler.ts#L126)、[sessionless 选择](https://github.com/cloudflare/sandbox-sdk/blob/133939602f28a23ae6bab1d00878d95b3f308394/packages/sandbox-container/src/services/execution-service.ts#L130)；上述链接固定到 Sandbox 0.12.9 对应源码提交。源码协议核对不替代真实镜像运行证据。

此前调查发现 ProductTurnRuntime 的持久 State 和 Trusted Pi 控制文件没有绝对执行截止。`pi-native.ts` 原有 `startProcess(..., {timeout:600_000})` 只是相对进程参数，不能直接投影为跨重启不变的授权截止。`ProductTurnRuntime.observe()` 会消费运行状态并可能进入 checkpoint prepare/commit/reconcile，不能复用为只读授权查询；TrustedPiExecutionAdapter 还会把 starting 映射为 running，不能据此认定执行已可观察。

按以下顺序实现和验收，不能以当前时间加 15 秒或固定成功夹具替代实际运行权威：

1. Runtime 首次接受 Turn 时持久化绝对 executionDeadlineAt；同一调用重放、重启不延长。期限应来自平台固定运行策略，而非模型输入。旧记录缺失期限时拒绝 Observer，不猜测补发授权。
2. 把同一期限传入 Trusted Pi 控制文件，执行端拒绝过期启动、到期取消并确认退出；工具与模型桥接调用不得越过总期限。明确持久化到期后的停止对账，不能只依赖浏览器或请求计时器。
3. 增加独立只读 currentObserverExecution(identity)，校验持久身份、running、未取消和期限；读取真实 host 运行状态后再次核对状态及时钟，不启动进程、不写状态、不保存 checkpoint。unknown、starting、terminal、无期限记录均拒绝。
4. 贯通 core、host 与私有 Durable RPC；测试查询期间取消、重启不续期、到期拒绝、错误身份和查询零副作用。之后才将 Workspace 授权组合接入该入口。

本地候选已落实核心接线：新 Runtime schema 3 将 executionDeadlineAt 固定为首次 startedAt + 600000；原生控制文件 schema 2 携带同一期限，启动参数缩短为剩余时间。Trusted Pi 主机拒绝过期启动、在到期时取消，并保留取消宽限期内的退出兜底；模型和工具请求也受总期限约束。旧记录仅保留原协调能力，不能建立 Observer 授权。专用 currentObserverExecution 不经过 observe/consume/checkpoint，ProductTurnRuntime 冷查询不创建其状态表；Workspace.authorizeObserverCommand 已在默认关闭的 M3_OBSERVER_ENABLED 下连接 Catalog、TurnJournal、Runtime 与当前 Preview。真实 Sandbox SDK 的进程退出、重启后到期停止对账及云端全链路仍需单独验收，代码接线不能替代这些证据。

`observer-host.ts` 已提供调用认领、执行、结果复核及停止对账的本地组合。执行端必须确认浏览器资源退出才可成功；无法确认停止则写 unknown 并保留并发槽，迟到结果不能补写成功。该组合的 executor 和 authorize 仍是必需端口，不代表真实浏览器已接通。

## 1. 接入位置与职责

当前 `services/trusted-pi/product-tool-bridge.mjs` 与 `services/tools/protocol.ts` 仅承载项目文件和 Shell 工具。Browser 能力由平台内置插件提供，不把浏览器、平台密钥或任意网络请求能力加入项目 Shell。接入时需同时更新工具注册、服务端闭合协议、调用身份验证、结果投影和发布清单；只增加工具名称不构成交付。

首版实现 snapshot、screenshot、console 和 reload。参数只选择本 Workspace 的 Preview 与平台规定的观察选项，不接受任意 URL、Cookie、请求头、JavaScript 或浏览器调试协议命令。reload 只重载 Observer 自身视图，不刷新用户 iframe，也不重启服务。

项目 Pi Agent 可以编写观察页面和状态接口，并在 `app/preview.json` 声明其位置。平台决定是否开放观察、允许访问哪些路径、如何验证调用者，以及结果是否仍属于当前实例。项目声明不能授予权限。

## 2. 独立授权与撤销

调用链为：可信 Pi 工具调用 → 平台 Browser 后端 → Workspace 当前调用与目标校验 → Observer 执行器 → 私有 ServiceRuntime 转发。Browser 后端从已验证的调用上下文确定 Tenant、Project、Workspace、Session、Turn 和 dispatch；不能从模型参数选择这些身份。

Observer 使用 purpose 为 observer 的内部授权，与 browser 票据和访问 Cookie 分离。授权固定调用 ID、操作、Preview ID、完整 source、Run/runtime 引用、允许路径及截止时间。截止取调用、Turn、Preview 和 Run 截止的最小值。授权不送入项目页面、URL、日志或模型结果，也不通过主应用登录 Cookie 取得能力。

Workspace 在开始、每次资源转发及结果返回前复核调用仍有效、插件仍启用、租户及工作区仍可用、当前 Preview 未撤销且绑定未改变。Runtime 继续独立检查自己的租约、截止和停止栅栏。不能只验证初始授权或仅依赖浏览器请求拦截。

取消 Turn、禁用插件、撤销访问、替换实例或停止服务时，终止相关观察和网络请求。已经返回的历史收据可以保留，但不能被再次标为当前观察。关闭用户 Panel 不取消独立 Run；观察失败不改变文件、保存点或 Run 成果。

禁用 Browser 插件还必须持久记录其 PreviewInstance 的撤销与所管理 service Run 的停止请求，立即撤销用户和 Observer 访问；只有得到进程退出证明才报告停止完成并释放配额。该操作不停止不属于 Browser 的独立任务，不撤销核心文件能力。停止结果未知时继续持久对账，不能将“禁止新观察”当成插件禁用已完成。

## 3. 导航、资源与只读边界

执行器使用独立、临时浏览器上下文，不复用用户页面、持久 Cookie、缓存或 Service Worker。所有网络出口经平台受控代理；浏览器自身没有任意外网或内网出口。请求拦截是附加防线，不替代网络隔离。

固定 Starter 的初始导航只允许已验证声明中的 pagePath，状态读取只允许 statePath。首版观察页面使用内联或同一受限端点提供的必要内容；不因页面引用一个资源就自动扩大路径权限。需要额外资源时，应先增加平台验证的显式资源契约与测试，再开放该路径。

平台仅转发允许路径上的 GET/HEAD，拒绝上传、领域写方法、WebSocket、任意 IP、其他实例、管理路径和越界重定向。重定向逐跳重新验证，不能依赖自动跟随；URL 在规范化前后均须检查编码、路径穿越、凭据、查询与来源。项目获得平台生成的最小观察身份标记，不能获得内部授权；用户代理转发必须剥离同名外部头，防止伪造身份。

GET/HEAD 不等于领域只读。机场 Starter 的专用观察路由不推进仿真、不随机采样、不写入状态，并拒绝观察身份的领域写请求。普通项目未经此验收时，结果只能标为“独立页面观察，领域副作用未验证”。不能自动继承官方模板的可信状态：文件修改后的版本需重新验证。

## 4. 观察收据与有界结果

收据包含 observationId、operation、Preview ID、Run ID、sourceKind、不可变文件包摘要 filesSha256、runtime generation、开始和结束时间、服务路径、结果类型与内容摘要。filesSha256 从平台确认的 saved-turn receipt 或 initial-workspace source 取得，不能采用页面自报值；返回前逐项核对当前绑定。项目状态额外包含 simulation_state_id 和非负安全整数 sequence；这些是项目报告的领域信息，与平台确认的实例身份分开存放，不能据此授予权限。

截图和状态读取可能发生在不同时间，分别记录采样时间和序号，不宣称原子一致或用户屏幕一致。要证明二者对应同一状态，Starter 需暂停或提供明确的状态版本锁定契约，并在结果中给出验证证据。

页面文字、console 和状态 JSON 均视为不可信项目数据，不作为平台或 Agent 指令。输出有字节、条目、时间和并发限制；先定义并校验限制，再允许浏览器执行。截图通过平台 Artifact 服务按 scope 保存，只向工具返回经过授权的引用及摘要，不把大型图片塞入工具账本。错误只输出固定错误码，不能回传包含秘密的浏览器调试日志。

首版固定限制如下，实施时写入闭合协议与边界测试；项目声明不能提高这些上限：

| 对象 | 上限与超限行为 |
| --- | --- |
| 单次观察 | 15 秒，且不晚于所有关联授权截止；超时取消，返回 observer-timeout |
| 并发 | 每 Workspace 1 个进行中观察，包含导航和 Artifact 保存；超额返回 observer-busy，不暗中排队 |
| 页面资源 | 最多 32 请求、累计 8 MiB 响应、4096 个响应数据块（含空块），逐段计数；超过则取消并返回 observer-resource-limit，避免空块无限流饿死计时器 |
| 状态 JSON | UTF-8 最多 64 KiB，顶层闭合 envelope 为 simulation_state_id、sequence、state；ID 非空且最多 128 字节，sequence 为非负安全整数，state 为领域 JSON 对象；超限或格式错误拒绝，不截断成貌似完整状态 |
| snapshot 文本 | 最多 32 KiB UTF-8，按有效字符边界截断，显式记录 truncated |
| console | 最多 100 条，单条最多 2 KiB、总计最多 64 KiB；截断时记录 truncated 与丢弃条目数，不保存无限日志 |
| screenshot | 固定 1280×720 viewport，不启用 full-page；PNG 最多 2 MiB，超限返回 observer-result-limit，不发布部分 Artifact |

工具结果包含 schemaVersion、平台收据和对应操作的固定结果结构，不混入私有 source 存储引用。传输限制在读取过程中执行，不能先完整缓冲再检查长度。浏览器上下文、连接和并发槽在成功、失败、取消及超时后均须回收。

相同调用 ID 重试返回同一已记录结果；若首次执行结果未知，先对账而非自动 reload。旧结果返回前再次验证目标，目标已变化则报告 stale，并保留原收据作为历史证据。

## 5. 实施顺序与验收矩阵

| 顺序 | 交付内容 | 必须通过的验证 |
| --- | --- | --- |
| 1 | 独立调用协议、授权和持久调用收据 | browser 授权不能调用 Observer；跨租户、错误 Turn/dispatch、停止和插件禁用均拒绝；相同 ID 不重复执行 |
| 2 | 私有代理及执行器 | 无 Cookie/密钥进入项目；允许路径可读；其他来源、IP、编码绕行、越界重定向、写方法和 WS 均拒绝；真实网络出口不能绕过代理 |
| 3 | Starter 观察页面及状态接口 | 用户领域操作后读到相同服务实例的状态 ID/序号；暂停下连续观察、截图、console、reload 不推进状态；写入计数保持不变 |
| 4 | Pi 工具和用户/管理端投影 | Agent 收到可追溯收据；用户看到观察时间与失效原因；管理禁用后旧工具调用与用户访问被拒绝，Browser 所管理服务完成持久停止对账，核心文件能力可继续；页面内容不能扩大工具权限；reload 不刷新用户 iframe、不重启服务、不改变 Preview ID |
| 5 | 竞态、故障与云验证 | 等待导航、读响应、截图、保存 Artifact 时取消/替换/撤权，旧结果不能成为当前结果；浏览器崩溃不回滚已保存文件或完成的 Run；真实容器、Workerd、D1/DO/R2 与 Chrome 联合完成修改/保存→启动→交互→观察→替换→旧授权失效→停止；再分别记录真实云隔离和公网访问证据 |

本地替身可以验证授权协议和失败传播；真实浏览器证明页面执行与网络行为；实际容器及云部署证明运行边界。三类证据分别记录，不以其中一类替代另外两类。
