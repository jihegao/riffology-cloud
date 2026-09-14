# 开发执行状态

## 2026-09-14 研究闭环后续执行计划（规划落盘）

第一阶段实际交付与限制见[普通用户发布验收](phase1-user-preview-acceptance.md)。后续按[研究闭环 Issues 执行顺序](research-loop-execution-plan.md)推进：#29 → #30/#33 → #31 → #32 → #45/#34 → #46 → #37 → #35；#28 跟踪全程。#46 的 ADR 和 #37 的度量可提前，完整实现默认不阻塞研究主线。

本条只记录排序计划落盘，不表示新增功能已经实现或验收，不变更 GitHub 状态和线上配置。下方为按原日期保留的历史阶段记录；其门禁和部署描述不应被当作当前线上状态。

## 2026-09-08 Observer Artifact 写入清单与原子引用（本地候选）

生产 Executor 存储路径接入每次观察独立的持久写入清单。完整 command/receipt 在 R2 put 前登记并同步；同一收据仅首次认领派发，重放和重启只读回。持久同步后、put 之前再次同步检查停止栅栏。写请求确认和内容验证分别存储，丢失写响应但读回成功时仍保留 uncertain 状态。Executor 完成结果与其 Artifact 引用在同一事务提交。

主控完成实现、R2 替身与真实 SQLite 的故障测试；子 agent 补真实 Workerd/SQLite/R2 的两项清单和引用断言，低成本子 agent 补清单协议测试。覆盖丢失 claim 确认时零写入、重启不再次派发、登记等待期间停止、未验证对象拒绝引用、结果提交故障回滚引用，以及实际执行重启重放后对象与浏览器次数不增加。[完整冻结检查](evidence/runs/m0-local-20260908135058232/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 409 pass、M3 365 pass，合计 **1307 pass / 1 skip**。云门禁仍为 false。

此增量只完成可恢复清单与引用保留，尚不提供引用释放或物理删除。pending/uncertain 写入、未被结果引用的对象及缺少清单的历史对象继续保守保留；不能以浏览器已停止推断 R2 写入不会迟到。未部署、迁移、修改远程资源、启动 Docker 或调用模型，云门禁继续关闭。

首次冻结检查[保留为失败证据](evidence/runs/m0-local-20260908134631947/local-checks.json)：历史 Artifact 测试的保存替身缺少新增 inventory，另有 Chrome 资源预算测试超时并导致总检查超时。已把替身接入真实 inventory，相关 Artifact/Chrome 定向测试 10/10 通过；Chrome 超时单独复现未出现，未放宽截止或跳过测试。

## 2026-09-08 历史 Observer Artifact 私有读取与用户 ACL（本地候选）

Gateway 新增历史 state/view 读取入口，Workspace 按当前 Catalog 项目权限、原 Turn/Session 用户归属及完整执行身份选择已完成记录中的收据。Executor 再核对自身持久完成记录，只允许读取其附带对象；不创建缺失执行记录，不启动浏览器。历史读取不依赖执行门禁或活跃 Preview，但项目及 Workspace 仍须 ready。

单次读取最长 5 秒，授权在异步访问前后复核；超时取消 R2 流，迟到的 RPC 授权在读取结束后失效。返回字节经过长度与 SHA-256 检查，HTTP 响应固定 JSON/PNG 类型、禁止缓存和嗅探，并明确标记为历史观察。认证版本轮换后，当前版本身份仍能读取自己旧会话的结果，旧版本身份不能继续访问。

主控完成 Workspace 授权编排与集成复核；子 agent 完成 Executor/R2 读取及真实 Workerd 验证，低成本子 agent 完成身份查询与 Gateway。主控另补身份损坏和 Gateway 桥接参数测试，并修复授权超时后迟到 RPC 返回值未显式释放的问题：先给原始 Promise 附加数据拆包与释放，再参与截止竞争。Gateway 使用真实 Catalog 和明确 Workspace 替身；Workspace 使用真实 journal/Catalog 和明确 Executor 字节替身；Executor 使用真实 Workerd/SQLite/R2 和明确授权替身。这些分层测试不替代云端完整产品验收。[最终冻结检查](evidence/runs/m0-local-20260908133911540/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 409 pass、M3 356 pass，合计 **1298 pass / 1 skip**。云门禁仍为 false。

Artifact 引用保留与回收、用户界面和 Pi 工具接入、原生 Browser 网络隔离与退出证明仍待完成。未部署、迁移、修改远程资源、启动 Docker 或调用模型，云门禁继续关闭。

检查异常保留：[迟到 RPC 清理修正后的首次冻结检查](evidence/runs/m0-local-20260908121826940/local-checks.json)超时，日志停在 M0 Pi SDK 测试，`passed=false`、源码稳定，不能作为成功证据。确认无残留检查进程后，相关离线测试单独运行 9/9 通过；其 transport 为固定替身，外部 fetch 被拒绝。超时原因未确定，未放宽测试截止或跳过测试。

## 2026-09-08 Observer 后台维护与四域共享 alarm（本地候选）

Workspace 新增 Observer 逻辑闹钟，和初始化、Turn、Service 共用一个物理 alarm。所有域的事务更新均保留其他域，Service 维护失败后仍会访问 Observer 并重新计算物理闹钟。维护依据已保存的 Workspace scope 执行，即使工作区不再 ready、访问撤销或插件门禁关闭，也可递送停止；不重新派发观察。

`WorkspaceObserverHost` 将调用账本变更和逻辑/物理闹钟更新置于同一存储事务，避免接受调用后没有唤醒，或 idle 清理擦除并发新调用的唤醒。活动观察最多 5 秒后再次检查，授权失效、期限到达或 unknown 会请求停止对账；未获得真实退出证明则保留槽位与未来重试，确认后才清理该域闹钟。

主控完成原子投影、Workspace 维护接线、Service 投影补充与真实 Workerd 验证；子 agent 完成第四闹钟域和路由器，低成本子 agent 补事务提交与活动记录测试。新测试覆盖投影失败回滚 accepted、并发 idle 清理不丢 wake、重启后 unknown 重试、取消后 accepted 收敛及关闭门禁后停止。自动唤醒测试不手动调用 alarm：重启 Workerd 后约 6 秒内由已保存闹钟完成维护，执行次数保持 1。

[完整冻结检查](evidence/runs/m0-local-20260908120155175/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 409 pass、M3 329 pass，合计 **1271 pass / 1 skip**。实际停止端为明确执行器夹具，自动本地 alarm 不替代原生进程退出或云验收。原生浏览器隔离与停止、Artifact 读取 ACL/生命周期及 Pi 工具仍待完成。未部署、迁移、修改远程资源、启动 Docker 或调用模型。

## 2026-09-08 Observer Executor DO、持久防重复与停止栅栏（本地候选）

新增 `ObserverExecutor` 并加入 Gateway 导出；生产尚未配置 namespace、浏览器 Runtime 或 Artifact 绑定。执行器按完整命令持久认领，首次派发前确认存储；不确定调用不能因重启重试。停止先持久封禁，再向独立浏览器 Runtime 请求持久封禁与资源退出证明；确认丢失不返回已停止。停止不依赖正在挂起的执行，也不受执行门禁关闭或命令过期限制。

执行器持久绑定目标摘要及路由策略；内部执行授权必须与初始目标一致，避免初始授权 A、内部切换 B 后把 B 的结果存到 A 下。整个 RPC 调用含前后授权、取消查询、执行和结果公开都受绝对截止限制。Artifact 使用实际 R2 内容层；浏览器只获得执行器持有的累计资源预算 RPC，迟到请求失效。执行器不以本机不存在句柄推断原生进程已退出。

主控完成 DO、浏览器资源 RPC、期限与目标绑定；子 agent 完成持久监督器和真实 Workerd 集成。Workerd 暴露返回聚合对象附带 Symbol.dispose，主控增加仅剥离该 RPC 元数据并释放包装的处理，其他符号和 getter 仍拒绝；测试没有在夹具端清洗数据掩盖问题。另修复调用账本数组校验中的越界数字属性，避免 sparse array 被序列化成不同内容。

[完整冻结检查](evidence/runs/m0-local-20260908115341908/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 403 pass、M3 321 pass，合计 **1257 pass / 1 skip**。15 项监督器 SQLite 测试覆盖并发、重建、停止先到、迟到结果、确认丢失及损坏；5 项 Workerd 测试使用真实 Executor/SQLite/R2 和明确浏览器、授权夹具，覆盖重启重放、停止、迟到资源能力、授权挂起及目标切换。原生浏览器 Runtime、实际网络隔离与进程退出、Workspace 维护调度、Artifact 读取 ACL/生命周期和 Pi 工具仍待完成。未部署、迁移、启动 Docker 或调用模型。

## 2026-09-08 Workspace 私有 Observer 执行入口与 RPC 能力（本地候选）

Workspace 新增 `observePreview`，通过真实权限、登记路由和目标校验后持久认领，再调用独立执行器。未配置 `OBSERVER_EXECUTOR` 或门禁关闭时，在接受调用前拒绝。每个调用获得独立、不可持久保存的 RPC capability，只提供重新授权、受控资源转发和取消查询；完成或未知终态后，迟到回调不能继续授权或转发。

主控实现执行器身份协议、RPC capability 和浏览器侧消费适配器；子 agent 完成 Workspace 接线及真实 Workerd 验证。Workerd 使用明确执行器夹具验证完成/unknown 在实例重启后重放，执行计数保持 1，未知停止继续占槽。主控另以真实 Chrome 验证 capability 消费、页面/state 采样和 Artifact，以及取消查询断连、挂起和串行轮询；该 Chrome capability 传输是本地夹具，不是远程浏览器部署。

[完整冻结检查](evidence/runs/m0-local-20260908114602092/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 403 pass、M3 298 pass，合计 **1234 pass / 1 skip**。实际执行器 DO/容器与持久停止栅栏、Workspace 维护对账、Artifact 生产绑定和读取 ACL、Pi 工具仍待完成；生产没有配置该 namespace，也未打开门禁。未部署、迁移、修改远程资源、启动 Docker 或调用模型。

## 2026-09-08 Observer 持久账本与浏览器执行组合（本地候选）

新增 `observerCoordinator`，将真实执行器接入 `ObserverCallHost`。每次执行授权同时受当前 host 生命周期与新鲜目标校验约束；传输方法显式转发以保留原型方法和 receiver。主控将真实 Chrome 测试升级为 SQLite 认领、截图和 state Artifact 提交、数据库重开后收据重放；重放未再次导航或写对象。浏览器失败且 stop 不确认时保持 unknown，重开后仍阻止新调用，只有独立停止对账成功才释放槽位。

低成本子 agent 只读复核取消和停止边界。主控另验证 accepted 已提交而 start 到期的恢复窗口：重启后 accepted 仍占槽，需维护入口调用 reconcile，并获得真实停止证明。首次测试把初始化 sync 误当成 accept 提交，已调整注入点并通过。不能以命令到期、取消信号或本机查不到任务替代停止证明。

[完整冻结检查](evidence/runs/m0-local-20260908114041342/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 403 pass、M3 290 pass，合计 **1226 pass / 1 skip**。组合目前是本地模块，尚未挂入生产 Workspace RPC 或启动真实隔离浏览器宿主；维护调度、执行器持久停止栅栏、Artifact 读取授权和 Pi 工具仍待连接。未部署、迁移、修改远程资源、运行 Docker 或调用模型。

## 2026-09-08 Observer 浏览器执行、累计预算与私有 Artifact（本地候选）

新增 `executeObserver`，将浏览器导航、reload、子资源和后续 state 请求接入同一次资源预算；总执行期限随授权缩短且不延长。浏览器确认临时 context 关闭后才接收结果。收据绑定 Preview、Run、文件摘要和运行代次；页面/state 分别记录采样窗口，明确非原子采样，业务副作用未验证。

浏览器适配器固定 snapshot/screenshot/console/reload，使用独立 context，资源经授权转发，拒绝额外 frame、下载与 WebSocket。私有 R2 内容层提供 state/view/PNG 收据、不可变条件写、读回核验与丢失确认恢复；截图不内嵌在回合 JSON 中。PNG 校验只涵盖基本头部，未宣称完整像素解码。

主控复核并修复较早授权期限的总取消、采样窗口和 state 媒体类型检查；子 agent 分别实现浏览器适配与 Artifact 层，低成本子 agent 补执行器测试。主控新增真实 Chrome → 执行器 → Artifact 保存/读回贯通测试，通过实际 PNG 尺寸、状态内容、窗口顺序及 context 回收验证。授权、Runtime HTTP 和 R2 传输仍为明确夹具，不能替代生产接线。

[完整本地检查](evidence/runs/m0-local-20260908113627208/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 403 pass、M3 289 pass，合计 **1225 pass / 1 skip**。本轮新增 21 项通过，包括真实 Chrome 的适配器测试及执行/Artifact 贯通测试。Workspace 持久编排与实际浏览器宿主、停止对账、Artifact 读取 ACL/引用生命周期/GC、Pi 工具和真实网络隔离尚待接通验收。没有云部署、迁移、远程修改、Docker 或模型调用；整体目标未完成，云门禁关闭。

## 2026-09-08 Observer 私有资源转发与跨 RPC 取消（本地候选）

Workspace 新增独立 Observer 资源入口，要求持久调用为 running、目标摘要一致，并复核当前 Turn、成员权限、Preview 及 D1 登记路由。请求 origin 由平台配置与已登记 host 推导，不采用调用方 URL 授权。Runtime 独立校验运行计划中的两条观察路径、租约和停止栅栏；ServiceSandbox 直接转发到已运行容器的固定 8080 端口，重新生成只读标记。普通用户 Preview 转发仍剥离同名头，未开放任意路径或公共 Observer API。

真实 Workerd 首次接线暴露 AbortSignal 不能按当前稳定配置跨 RPC 序列化。主控改为临时取消专用 RpcTarget；最终端口在发送前和等待期间串行查询取消，Runtime/Workspace 分别重验自己的权限来源。撤销租约或取消 Turn 时，即使响应体挂起，也能取消最终端口读取；项目服务不因一次观察取消而停止。实验性 enable_abortsignal_rpc 未启用。主控另修复初始化失败的控制器回收、补充 Runtime 等待期间的租约检查，并将过短真实定时测试改为 1 秒期限及相应等待，避免环境偶发失效。

主控负责协议、Workspace/Runtime/Sandbox 接线和 Workspace 集成；子 agent 实现最终端口及真实 Runtime/Quota 测试，低成本子 agent 补描述符和请求协议测试。Workerd 验证包括未认领/未运行/已结束调用、登记路由、目标摘要、默认关闭、错误路径/期限、取消 Turn、撤销租约和停止。挂起期间撤销租约的测试使用 14 秒请求期限，要求 5 秒内拒绝，排除仅靠期限到达通过；最终响应体被取消，服务仍 healthy。

[完整本地检查](evidence/runs/m0-local-20260908112450195/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 403 pass、M3 268 pass，合计 **1204 pass / 1 skip**。本轮真实 Workerd 覆盖平台绑定与取消传输，最终容器端口为显式替身；没有原生容器、真实浏览器 Observer 或云全链路验收。

下一步连接 Workspace 持久执行编排与浏览器执行器，落实跨全部资源的单次观察总预算、结果收据、Artifact 和 Pi 工具。当前资源入口不会自行开始观察或产出完整观察结果。未部署、迁移、修改远程资源、启动 Docker 或调用模型；M3 与整体开发目标未完成，云门禁保持关闭。

## 2026-09-08 Observer 查询绕过 SDK 自动启动（本地候选）

复核实际锁定的 Sandbox 0.12.9 后确认：普通 readFile 会创建默认 Session，普通文件与进程读取会通过 containerFetch 自动启动未运行的容器。因此上一轮 Native 夹具的“未显式调用 startProcess”不足以证明查询无启动副作用。

现改为派生 actor 校验后的私有 queryObserverExecution。专用 reader 直接检查 container.running 并访问固定 3000 端口，只能读当前控制/结果文件和进程状态，使用显式 sessionless 协议、读取上限与共用 5 秒期限；停止、过期、重定向或状态不符时拒绝并回收响应。没有专用 RPC 时不退回 SDK。主控完成 Native/发布组装/Sandbox 接线，子 agent 追踪发布源码并实现传输与 13 项测试，低成本子 agent 补 4 项发布组装测试；主控补缺失入口测试、同步异常回收与类型修正，并将真实定时测试留出 1 秒启动余量，避免过短期限引入环境偶发失败。

[完整本地检查](evidence/runs/m0-local-20260908111357766/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 403 pass、M3 245 pass，合计 **1181 pass / 1 skip**。当前证据是生产组装加显式端口夹具；发布源码协议已核对，真实镜像内 daemon、原生容器行为及严格零副作用要求仍未验收。Sandbox/Container 基类可能维护调度表/alarm，daemon 可能调用 MIME 辅助命令，不能宣称整个 SDK 零写入或零辅助进程。详见 [Observer 契约](m3-observer-contract.md)。

未部署、迁移、修改远程资源、启动 Docker 或调用模型。Observer 实际执行器、私有转发、Artifact/Pi 工具及完整纵向验证仍待完成；M3 与整体目标保持未完成，云门禁关闭。

## 2026-09-08 Runtime 绝对截止与 Workspace Observer 授权（本地候选）

Runtime 新记录持久保存首次 startedAt + 600000 的绝对执行截止；重放不延长。Trusted Pi 控制文件携带同一期限，进程启动使用剩余时间，Node 宿主在到期时取消并保留退出兜底，模型和工具请求均受总期限限制。Workspace 恢复前复制输入期限，防止异步恢复期间调用方修改期限。旧记录缺少期限时拒绝 Observer 授权。

新增专用 currentObserverExecution，不经过会消费状态和保存 checkpoint 的 observe。Workspace 私有授权入口已组合真实 TurnJournal、Catalog、Runtime 查询和当前 Preview 绑定；默认 Observer 开关仍关闭。真实 Workerd 测试覆盖错误 dispatch、取消、成员撤销和 Preview 替换，Runtime 返回值为显式夹具。Native、Node 宿主和模型/工具桥另有定向测试；这不证明真实 Sandbox 的退出、重启后停止对账或 SDK 查询无容器启动副作用，后者正在单独核对。

主控实现 Native 与 Node 截止、输入快照和 Workspace 接线并复核；子 agent 完成 Runtime 持久期限、桥接及 Workerd 测试，低成本子 agent 补 Native 拒绝与竞态测试。[完整本地检查](evidence/runs/m0-local-20260908110608094/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 385 pass、M3 245 pass，合计 **1163 pass / 1 skip**。

实际 Observer 执行器、私有转发、Artifact 和 Pi 工具仍待接入。未部署、迁移、修改远程资源、启动 Docker 或调用模型；M3 与整体开发目标未完成，云门禁保持关闭。

## 2026-09-08 Observer 执行编排与 Runtime 接线缺口（本地候选）

新增 ObserverCallHost，将真实持久账本与必需的授权/执行器端口组合：认领后再授权，结果必须确认资源退出，再次核对目标才能写成功，返回前继续复核权限。执行失败先请求停止，最多等待 2 秒；无法确认退出则写 unknown 并继续占槽，由维护入口显式对账。并发、重建、迟到结果及确认丢失均不触发重复执行。成功已持久化但最终授权失败时，保留历史记录并拒绝返回，不将其覆盖为新失败。

主控实现编排并修复执行结束后授权回调仍可能被使用的问题：上下文关闭后回调立即拒绝，不再查询权限。低成本子 agent 补测试，主控校正故障注入时机、异步等待和持久状态断言。新增 10 项定向测试通过。

首轮[完整检查](evidence/runs/m0-local-20260908105551567/local-checks.json)保留失败：已有 WS 固定端口测试用真实时钟构造超限 1 ms 的输入，构造 Request 的耗时使该输入可能回到有效区间。现仅固定测试 Date 时钟，验证等于当前时间拒绝、最大期限接受、超过 1 ms 拒绝；未改变生产期限。修复后[完整回归](evidence/runs/m0-local-20260908105746043/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 360 pass、M3 243 pass，合计 **1136 pass / 1 skip**。

子 agent 只读调查确认真实 Runtime 授权的前置缺口：ProductTurnRuntime State 与 Trusted Pi 控制文件尚无持久绝对执行截止，startProcess 的相对 timeout:600_000 不能作为跨重启租约；现有 observe 可能写状态及保存 checkpoint，不适合作为只读授权查询。修复顺序已写入 [Observer 契约](m3-observer-contract.md)：先持久化并在执行端落实绝对截止，再新增零副作用的 currentObserverExecution，之后连接 Workspace 与执行器。没有添加假定成功的授权或开放入口。

本轮编排测试使用真实本地 SQLite，授权与执行器为明确夹具，不能证明浏览器/原生 Runtime 已接通。未部署、迁移、修改远程资源、启动 Docker 或调用模型；M3 与整体开发目标未完成。下一步优先修复 Runtime 绝对截止及只读授权来源。

## 2026-09-08 Observer 当前 Turn 校验与持久调用（本地候选）

TurnJournal 新增同步 observerCaller，仅接受当前 running Turn、匹配 Session 所有者/dispatch/generation 且未取消的观察命令；返回独立副本，不采用模型传入的用户身份。授权组合要求插件、Catalog、实际 Runtime 租约和 Preview 目标均有效，截止取最小值；再次检查远程权限后同步确认当前 Turn 与绑定，替换或取消时拒绝。此组合仍通过明确端口取得权限，没有新增公开端点或真实运行端的默认授权。

SQLite 观察调用账本保存完整命令和目标摘要。只有首次持久认领获得执行许可，并发、重启和确认丢失均不产生第二次许可；未知状态保持工作区占槽，等待明确对账。完成结果精确重放但不能改写，过期禁止新成功；结果最多 64 KiB。读取时验证闭合记录、scope/key、摘要、状态及时间顺序，损坏记录导致拒绝。当前历史上限 256 条，不自动删除，长期保留/归档与幂等墓碑仍待落实。

主控实现 Turn 校验、授权组合与竞态验证；子 agent 实现账本及重启/故障测试，低成本子 agent 完成真实 TurnJournal 状态测试。主控复核发现持久记录校验不足，已补齐并加入 20 种损坏记录变体。新增定向 20 项通过。[完整本地回归](evidence/runs/m0-local-20260908104914766/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 360 pass、M3 233 pass，合计 **1126 pass / 1 skip**。

当前证据为真实本地 SQLite/TurnJournal 加权限、租约及 Preview 端口夹具；尚未将账本、授权组合、Workspace 调用入口和 Observer 执行器连成产品链路，不能宣称 Agent 已能观察。下一步接真实 Runtime 授权、Workspace 持久调度及私有观察转发，再接浏览器与 Artifact/Pi 工具。未部署、迁移、修改远程资源、启动 Docker 或调用模型，M3 与整体目标继续保持未完成。

## 2026-09-08 Observer 协议与受限传输基础（本地候选）

新增闭合 Observer 命令，固定 observer 用途、Workspace/Session/Turn/dispatch/call/Preview 和操作，拒绝附加 URL、未知字段、访问器及异常递归对象；只做规范化与最长 15 秒截止检查，不授予权限。状态解析器在 64 KiB 字节上限内使用严格 UTF-8、闭合 envelope、128 字节状态 ID、非负安全序号和最多 32 层 JSON，领域内容不作为平台身份。

请求策略只允许已给定 Preview origin 的 pagePath/statePath，固定内部 8080 端口及 GET/HEAD，拒绝写入、升级、其他来源、路径和 URL 编码绕行。用户头部全部丢弃，生成最小只读标记；响应剥离 Cookie/CORS/Refresh 等元数据，重定向限于同一策略路径并保留逐跳授权。传输会话逐请求、响应头后及每次分块读取前后授权，累计最多 32 请求、8 MiB、4096 数据块，状态接口另限 64 KiB；取消、超时、超限或撤权关闭会话并回收迟到响应。授权与实际转发目前仍是显式端口，尚未连接运行中的产品调用链。

主控实现 HTTP 策略、会话预算与撤权生命周期并复核；子 agent 实现命令/状态协议及故障测试，低成本子 agent 补请求策略测试。新增定向 20 项通过。[完整本地回归](evidence/runs/m0-local-20260908104405776/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 360 pass、M3 213 pass，合计 **1106 pass / 1 skip**。

实现边界已写入 [Observer 契约](m3-observer-contract.md)：Workspace 持久调用与权限、Runtime 独立 Observer 转发、浏览器执行器、Artifact、Pi 工具及 UI 均待接入。普通 forwardHttp 会剥离 Observer 标记，后续必须在独立受信入口重建身份，不能开放公共自报头。截图、console 和文本限制目前仅有常量，没有执行器验证。

本轮未部署、迁移、修改远程资源、启动 Docker 或调用模型。M3 与整体目标未完成；下一步接入持久观察调用和当前 Turn/Preview 授权，继续原生容器与云验收。

## 2026-09-08 真实 Chrome WSS 与 Observer 实施契约（本地）

新增 Chrome 真实 HTTPS/WSS 网络测试：浏览器域名通过测试进程的 resolver 映射至回环 TLS 适配器，再将 HTTP/Upgrade 交给真实 Gateway/Workspace Workerd。使用临时自签名证书，浏览器仅在该测试上下文忽略证书错误；没有改动系统 DNS 或信任库。身份和项目 Runtime 仍是显式夹具，不能作为公共 DNS/TLS、真实 Google 登录或原生 Sandbox 的验收。`ws` 8.21.0 从现有缓存离线声明为直接测试依赖，避免依赖传递安装偶然可用。

真实浏览器握手验证 Origin、HttpOnly Cookie、子协议、文本及二进制回显。现有生产 CSP 的 `connect-src 'self'` 在本次 Chrome 中允许同源 WSS；异源 WSS 产生真实 securitypolicyviolation，且适配器没有收到第二个升级请求，因此无需放宽策略。删除本地 D1 登录后，浏览器空闲连接以 1008 关闭；Runtime 未收到浏览器 Cookie。此结果不推断其他浏览器的行为。

[完整本地回归](evidence/runs/m0-local-20260908103912354/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 360 pass、M3 193 pass，合计 **1086 pass / 1 skip**。主控复核适配器和依赖变更并执行完整回归，子 agent 实现 Chrome WSS 测试。

新增 [Observer 实施契约](m3-observer-contract.md)，明确独立授权、真实 Pi 工具接入、受控网络、不可变版本收据、资源上限、插件禁用停止对账及完整纵向验收。低成本子 agent 复核文档，主控补齐版本、限额、生命周期与 reload 验收缺口。文档内的 Observer 能力和限额尚待实现，不能作为已开放能力的证明。

本轮未部署、迁移、修改远程资源、启动 Docker 或调用模型。下一步落实 Observer 接线，并继续原生容器与云链路门禁；WS 开关保持关闭，M3 和整体开发目标未完成。

## 2026-09-08 WebSocket 私有传输与主动撤权（本地候选）

新增默认关闭的 `M3_PREVIEW_WS_ENABLED`。Gateway 验证公开 Origin 和 Cookie 后，经私有 fetch 将升级交给 Workspace、ServiceRuntime 与 ServiceSandbox。真实 Workerd 探针发现普通 RPC 返回 WebSocket 或携带 WebSocket 的 Response 均不能序列化；DO.fetch 和 Service Binding.fetch 则完成 101/echo/close，因此没有强行复用 HTTP RPC。

Workspace 与 Runtime 主动持有连接，每消息发送前重新授权，空闲时每次检查完成约 1 秒后再查，权限查询最多等 1 秒。Workspace 检查具体登录、ACL、绑定与 Run，Runtime 检查停止栅栏及 dispatched 租约；运行停止中止现有连接，授权截止不续期。每 actor 最多 8 个连接；握手包含前置读取最多 10 秒，迟到升级也关闭。单消息 64 KiB、队列 32 条/1 MiB、累计 16 MiB，二进制显式采用 ArrayBuffer。固定端口 8080，不自动启动容器；子协议白名单与私有 Unicode 信封校验已接入。

[完整本地回归](evidence/runs/m0-local-20260908103244377/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 360 pass、M3 192 pass，合计 **1085 pass / 1 skip**。新增 17 项覆盖协议、消息桥、握手、固定端口、RPC/fetch 探针及真实 Workerd Gateway/Workspace 连接；扩展真实 ServiceRuntime/Quota/持久栅栏测试验证 8 个连接上限、echo、stop 关闭及停止后拒绝。Gateway 纵向验证文本/二进制、凭据剥离、错误来源拒绝以及 D1 删除登录后的空闲连接 1008 关闭。

主控实现连接生命周期及各层接线、总超时和运行停止验证；子 agent 完成 fetch 探针、协议及 Gateway/Workspace 测试，低成本子 agent 完成消息桥/固定端口测试。连接登记是非休眠的内存状态，权限依据持久化；实际部署重建断连仍待验证。运行端和端口测试仍有明确替身，不能宣称真实 Python/Chrome WebSocket 或完整原生链路已验收。

未部署、迁移、修改远程资源、启动 Docker 或调用模型。下一步验证真实浏览器 wss/CSP 与原生容器，并评估轮询鉴权负载；Observer 继续按独立用途与权限实现。WS 开关与云门禁保持关闭，M3 和整体开发目标未完成。

## 2026-09-08 浏览器至 Workspace 的 Preview 纵向验证（本地）

新增真实 Chrome → 用户 Preview 面板 → 生产 Gateway/Preview host → Workspace 的纵向测试。ServiceRun、Quota、RevisionStore、票据/访问会话及本地 D1/R2 使用真实实现；服务器身份返回值、控制页静态外壳和项目 Runtime HTML/JSON 是显式夹具。测试验证真实 nonce 引导、一次票据兑换、Host-only HttpOnly Cookie、项目 HTTP 访问及凭据剥离。

刷新恢复不增加 Preview 创建 POST 或 Runtime 启动次数。直接删除本地 D1 登录会话后，仍持有 Cookie 的浏览器请求得到 403，Runtime 转发计数不再增加；无 Cookie 访问已注册主机也被拒绝。新增独立 Chrome 测试在旧 iframe 的票据请求已发出且等待时关闭并重建窗口，验证旧回包不交给新 iframe。

定向纵向测试 1/1、面板测试 6/6 通过。[完整本地回归](evidence/runs/m0-local-20260908102331049/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 360 pass、M3 175 pass，合计 **1068 pass / 1 skip**。主控编写浏览器纵向测试并复核证据，子 agent 建立真实 Workerd/D1/R2 夹具，低成本子 agent 补旧 iframe 票据回包测试。两次初始定位超时来自测试与夹具的标题约定未同步，各阶段已返回 200；统一约定后完整流程通过。

本轮没有修改生产功能、部署、迁移、调用模型或启动 Docker。当前证明的是 Gateway/Workspace 平台链路，不证明真实 ServiceRuntime/Sandbox、Google OAuth、公共 DNS/TLS 或 WebSocket。原生容器隔离复验、WS 与 Observer 继续按计划推进；M3 和整体目标未完成，云门禁关闭。

## 2026-09-08 用户 Preview 面板与恢复 API（本地候选）

工作台已接选择运行中服务、打开/恢复/关闭 Preview 和刷新状态。打开请求保存原幂等键与 runId/expectedPreviewId，未知结果按原请求重试，确定 409 后重新读取。只读 GET 返回最小 current 与 available；过期或撤销的 current ID 保留供 CAS，只有当前有效目标及已注册主机才返回访问入口。GET 不创建绑定或注册路由，并在异步查询前后复核 Catalog 权限。

面板校验独立 HTTPS 引导地址与精确 iframe 窗口/origin，再签发并交接短期票据；票据不进入本地存储或 URL。稳定 DOM 避免普通状态渲染重载 iframe，关闭/过期/离开工作区卸载视图且不停止独立服务。非 ready 项目不发起 Preview 请求。静态资源白名单已加入 previews.js；控制页 frame-src 默认 none，仅在明确启用及校验独立基域后放行。

[完整本地回归](evidence/runs/m0-local-20260908101603078/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 183 pass、M2 360 pass、M3 173 pass，合计 **1066 pass / 1 skip**。新增 3 项恢复 API、1 项 CSP 域名策略、5 项真实 Chrome 面板测试和 1 项桌面/手机整页测试。Chrome 面板测试使用 HTTP/API 替身验证消息协议、伪造来源拒绝、原请求重试、409、上下文切换、iframe 状态保留及关闭/过期。

主控已查看[桌面截图](evidence/runs/m3-preview-ui-20260908181454/preview-desktop.png)和[手机截图](evidence/runs/m3-preview-ui-20260908181454/preview-mobile.png)，修复继承 flex 样式导致说明与按钮挤排；[视觉记录](evidence/runs/m3-preview-ui-20260908181454/visual-review.json)保存源文件和截图摘要。整页截图仅展示选择与打开入口，其 POST 是 503 替身，不证明真实容器页面加载。主控负责 API、最终面板实现、集成和质量复核，子 agent 负责测试与截图。

未进行云部署、迁移、远程资源变更或模型调用。下一步继续补实际浏览器至 Gateway/Workspace/Runtime 的纵向验证、原生容器、WebSocket 和 Observer；M3 与整体开发目标保持未完成，云门禁关闭。

## 2026-09-08 Gateway 授权 HTTP 接线与上传撤权（本地候选）

项目 HTTP 已接 access Cookie → Gateway 持续授权 → Workspace.forwardPreviewHttp → 私有 ServiceRuntime。Workspace 从当前权威 Run/Preview 目标构造固定 spec、reference 和 lease，拒绝客户端选择执行参数；无访问 Cookie 不查询运行目标。请求凭据在进入项目前剥离，响应应用固定隔离策略。

上传分段读取前后、发送前、响应头返回前及响应分段读取前后复核会话；取消或权限失效后不转发后续数据，迟到响应会取消并清理。请求总期限最多 15 秒且不超过访问期限，上传最多 1 MiB/5 秒、响应最多 8 MiB。子 agent 的定向测试发现原实现上传期间缺少复核，主控修复后新增等待期间撤权/取消验证；流夹具关闭预取，以区分源预取与实际读取。

[完整本地回归](evidence/runs/m0-local-20260908100527111/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 182 pass、M2 360 pass、M3 164 pass，合计 **1056 pass / 1 skip**。包含 8 项授权流测试、3 项目标到运行参数测试和新增主机 HTTP 测试；扩展真实 Workerd/D1 验证 Workspace 到 Runtime 替身转发、固定输入及会话删除/错误实例/关闭门禁/未 ready 时拒绝，转发不重复启动服务。

本轮只做本地代码、测试和文档工作，未部署、迁移、修改远程资源或调用模型。原生 Sandbox 端口纵向验证、云 bindings、WebSocket、Observer 和用户 Preview 面板仍待完成；M3 与整体目标未完成，云门禁关闭。主控负责接线、修复和完整录证，子 agent 完成参数转换、Workerd/授权流测试及契约同步。

## 2026-09-08 私有 HTTP 转发与停止边界（本地候选）

ServiceRuntime 已接私有 HTTP 转发，要求正确 actor/input、已尝试启动、未停止、未过期及当前 dispatched 租约；最后同步栅栏检查与发送之间不插入 await。ServiceSandbox 只使用已运行容器的固定 8080 端口，不调用自动启动方法。停止中止等待中的请求，响应流持续检查停止栅栏，单次最多 15 秒、响应 8 MiB。HTTP 策略限制 1 MiB 请求体并剥离 Cookie、Authorization 和平台控制头；响应策略限制重定向并覆盖 Cookie/CORS/CSP。

[完整本地回归](evidence/runs/m0-local-20260908095648576/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 182 pass、M2 360 pass、M3 152 pass，合计 1044 pass / 1 skip。新增 4 项只读栅栏、4 项 HTTP 策略、4 项固定端口测试；扩展真实 Workerd 验证 Runtime/配额/持久栅栏与 Sandbox RPC 替身的正常转发和 stop 中断响应头等待。原生端口仍使用替身，未启动 Docker。

真实 Workerd 最初拒绝跨 RPC AbortSignal 序列化；现改为传递明确截止，由 Runtime 与 Sandbox 各自处理中止，无新增兼容性旗标。主控实现转发接线与期限/资源清理，子 agent 实现持久栅栏及 Workerd 测试，低成本子 agent 完成请求策略和端口边界测试。

Gateway 项目路径尚未连接此转发，仍返回代理未就绪；公开访问的会话撤销传播、WebSocket、服务面板与原生 x86 容器验收仍待完成。本轮无云部署、远程资源变更或模型调用，整体目标和云门禁继续保持未完成。

## 2026-09-08 Preview 主机映射与控制端 API（本地候选）

Gateway 已接打开 Preview、签发票据及独立主机引导路由。控制端按当前登录和 Catalog owner/ready scope 授权，返回白名单元数据；新 `0008_preview_routes.sql` 固定 Preview → Workspace/generation/期限及摘要主机标签。非控制源只接受配置基域中的已注册完整 origin，复核当前目标后进入 bootstrap/exchange。兑换必须匹配主机对应的 previewId，错误实例不消费票据。项目应用路径仍返回代理未就绪。

[完整回归](evidence/runs/m0-local-20260908094751732/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 182 pass、M2 360 pass、M3 140 pass，合计 1032 pass / 1 skip。新增 4 项真实 SQLite 路由测试、3 项 Gateway API 测试、3 项主机路由测试和 1 项错误 Preview 兑换测试；Workspace/运行端为明确替身，原 Workerd 调用已同步验证。

两次失败记录保留：[迁移预检旧清单](evidence/runs/m0-local-20260908094445491/local-checks.json)拒绝新增 0008，现已显式加入并保留未知迁移拒绝；[既有 Workspace 成功路径](evidence/runs/m0-local-20260908094606321/local-checks.json)在并行全检中失败，单独运行通过。该夹具的真实异步摘要/SQLite RPC 预算仅 10 ms，现调整为 1000 ms，受控逻辑截止、故障注入及生产超时不变，16 项相关测试和完整检查通过。

主控实现 Gateway 接线、主机分支、实例绑定及全检修复；子 agent 实现路由注册和接口测试，低成本子 agent 审查并测试主机边界。只读 SDK 调查确认公共 containerFetch 会自动启动容器，后续代理不能直接使用它；固定端口、租约和停止栅栏方案已记入 M3 计划。

本轮无云迁移、部署、远程资源变更或模型调用。服务面板、控制页 iframe CSP、实际 HTTP/WS 代理、撤销传播及原生容器验收仍未完成，整体目标和云门禁保持未完成。

## 2026-09-08 Preview 访问会话与浏览器引导（本地候选）

Workspace 已接票据兑换为独立访问会话、逐次授权和维护撤销。访问最多 5 分钟且不超过原登录/Run 截止，只保存 access 摘要，读取不续期；异步授权后再次核对持久撤销状态。关闭 Preview 开关或 Workspace 未 ready 时仍可撤销。

新增独立 HTTPS 源的 bootstrap/exchange 处理器，nonce 仅从 Host-only Cookie 取回，脚本严格核对控制源与父窗口。成功设置 Secure/HttpOnly 访问 Cookie 并清除 nonce，凭据不放入 URL 或响应正文。真实 Chrome 验证 iframe 兑换跳转、实际 Cookie 隔离、错误 origin/窗口来源拒绝；HTTP 兑换和项目页为替身。另以真实 Workerd/本地 D1 验证 Workspace access RPC、重启、撤销、会话删除和门禁。

[完整本地回归](evidence/runs/m0-local-20260908093425151/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 182 pass、M2 360 pass、M3 129 pass，合计 1021 pass / 1 skip。主控实现访问会话、Workspace 接线及引导处理器，子 agent 完成访问/Workerd/Chrome 测试，低成本子 agent 完成协议边界测试。

主机名映射、生产控制端票据 API、用户面板、实际 HTTP/WS 容器代理和长连接撤销传播尚未接通，因此没有开放 Preview 或宣布 M3 完成。本轮无云部署、远程资源修改或模型调用，整体目标继续。

## 2026-09-08 Preview 私有短期票据（本地候选）

Workspace 已接 browser 用途的短期票据签发与一次兑换。票据绑定具体登录、Workspace、Preview/Run 来源和 runtime，最长 30 秒且受登录/运行截止约束，只持久化票据及 nonce 摘要。兑换复核主库会话和当前 Run/绑定后，以条件更新原子消费；并发、重启或持久确认丢失不能成功兑换第二次。每个 Workspace 最多保留 256 条未过期记录，签发时清理过期项。

[完整本地回归](evidence/runs/m0-local-20260908092632542/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 182 pass、M2 360 pass、M3 120 pass，合计 1012 pass / 1 skip。新增 8 项 SQLite 票据测试；扩展真实 Workerd/本地 D1 测试验证生产 Workspace 签发与兑换、门禁、删 session、重启及未 ready 拒绝。D1 身份是明确 fixture，Runtime 仍为替身，没有真实 Google 或容器代理。

主控实现票据与 Workspace 接线，子 agent 完成票据及 Workerd 测试，低成本子 agent 审查并补容量和异步过期测试。公开 nonce Cookie/引导入口、访问会话、HTTP/WS 代理和撤销传播仍待实现；票据 claims 不能直接当成持续访问授权。本轮无云部署、远程资源修改或模型调用，整体目标和 M3 云门禁未完成。

## 2026-09-08 Preview 登录会话校验（本地候选）

Gateway 已从真实 Better Auth 服务器结果提取私有 session 上下文。Preview 权限检查以主数据库 JOIN 同时验证具体登录、认证版本、owner 成员关系、项目和 Workspace 状态及 generation；查询返回后再检查截止，拒绝慢查询期间已过期的登录。公开响应不暴露 session id 或 token。

[完整回归](evidence/runs/m0-local-20260908091200130/local-checks.json)通过且源码稳定。新增四项真实本地 Better Auth/SQLite 测试覆盖签名 Cookie、当前登录退出、独立第二会话保留、过期、权限变化、错误 scope 和公开响应；可控时钟覆盖查询期间过期。主控实现生产身份接线与期限检查，子 agent 完成真实身份测试和只读复核。

本轮没有真实 Google OAuth 交换、模型调用、云部署或远程资源变更。登录校验尚未接入公开 Preview 访问入口；短期票据、HTTP/WS 代理、用户/Observer 分权及连接撤销传播继续按 M3 计划实现。实际原生 x86 SDK/容器复验仍未完成，整体目标与云门禁保持未完成。

## 2026-09-08 Preview 持久绑定与内部目标校验（本地候选）

新增 Workspace 内的 `SqlPreviewBindings`，固定 Preview、Run、来源和 runtime reference；同键重放不另建，当前相同目标可复用，替换需 CAS 匹配当前 ID，并原子撤销旧绑定。撤销不可被迟到重放清除，过期绑定不能用于目标解析。Workspace 从自身 serviceView 获取候选，绑定期间不创建第二套服务进程。

`previewTarget` 查询固定 Run 后再次检查当前绑定，拒绝替换、撤销、停止意图、过期或不匹配来源/runtime 的响应。它是内部瞬时路由目标，不是浏览器访问授权，也不保证连接存续期间的健康或权限。独立 M3_PREVIEW_ENABLED 开关默认未启用。

[完整回归](evidence/runs/m0-local-20260908090554379/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **182 pass**、M2 **360 pass**、M3 **108 pass**，合计 **1000 pass / 1 skip**。新增 5 项真实 SQLite 绑定测试及 4 项目标解析测试；扩展真实 Workerd 验证 Workspace/Run/绑定持久存储、重启、内部目标和未 ready 时维护撤销，Runtime 仍为替身。

主控完成私有 Workspace 接线、目标解析、复核和完整录证；子 agent 完成绑定 journal 与测试，低成本子 agent 完成目标测试及真实 session 接线审查。后续须从 Better Auth 取得私有 session 上下文，完成短期票据兑换、用户/Observer 分权、HTTP/WS 代理和登出/替换/停止的撤销传播；M0 合成身份和固定应用不迁入产品。步骤已写入 [M3 计划](m3-execution-plan.md)。本轮没有公开 Preview URL、云部署、远程资源修改或模型调用，真实 SDK/容器链路仍待验收。

## 2026-09-08 用户端服务面板与浏览器验收（本地候选）

生产静态工作台已接服务列表、分页、启动时限、详情、停止和刷新恢复。列表区分交付与运行状态，详情显示最近确认时间；超时或读取失败明确标记未知及旧确认时间。默认 15 秒网络等待，未确认启动保留原幂等键和时限，页面刷新后仍可复用；隐藏页面暂停读取，切换项目/退出登录清理请求并拒绝迟到响应。项目非 ready 时允许进入维护界面，禁用新建和 Turn/文件操作，仍可查询和停止独立服务。

[完整回归](evidence/runs/m0-local-20260908085925597/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **182 pass**、M2 **360 pass**、M3 **99 pass**，合计 **991 pass / 1 skip**。新增 6 项面板 Chrome 测试覆盖状态、幂等恢复、异步隔离、隐藏轮询和请求超时；新增 2 项整页浏览器测试验证桌面/手机刷新及停止、非 ready 维护不派发 Turn/文件请求。

[独立视觉记录](evidence/runs/m3-service-ui-20260908085908852/browser.json)包含 [桌面](evidence/runs/m3-service-ui-20260908085908852/service-desktop.png) 与 [手机](evidence/runs/m3-service-ui-20260908085908852/service-mobile.png) 截图，主控已查看布局和长 ID 换行，测试检查无横向溢出。页面为生产静态文件，API 使用明确 HTTP 替身；不证明真实服务健康、云端授权或容器退出。先前英文时间格式的截图保留，最终版本使用中文时间显示并明确列表加载态。

主控完成页面生命周期、非 ready 维护入口、样式、整页测试和视觉/完整录证；子 agent 实现独立面板及测试，低成本子 agent 只读复核生命周期。尚无 Preview URL/iframe、日志或 Observer；下一步连接 Preview 网关与观察契约，并继续完成原生 x86 SDK 和完整纵向验收。本轮无云部署、远程资源修改或模型调用，执行门禁保持关闭。

## 2026-09-08 用户 Service API 与持久运行视图（本地候选）

Gateway 已接 service 创建、列表、详情和停止入口。每次请求先执行真实身份/Admission/Catalog 授权；创建要求 ready，维护入口使用共享 ownership 查询但允许非 ready，保留 authVersion、租户成员、项目关联和 generation 校验。严格限制 body、查询游标和 Origin；只向 Workspace 传入服务器 scope/actor 与用户时限，不接受客户端镜像或来源配置。

新增 `createFromPolicy`，用户请求与平台镜像分别处理，同键镜像升级返回原意图，原严格私有入口与新入口共享唯一表。列表用 SQL 索引和创建时间/runId 游标，默认 20、最大 50 条。详情由 Workspace 查询固定 task 对应的 Run，校验身份、配置、时间与状态组合，5 秒超时返回不可用而非停止。公开响应使用白名单，区分 deliveryStatus 与 runStatus；列表/创建/停止的 runStatus 为 null，不能推断服务未运行。内部错误和执行引用不暴露。

[完整回归](evidence/runs/m0-local-20260908085038815/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **360 pass**、M3 **93 pass**，合计 **983 pass / 1 skip**。新增 16 项覆盖策略重放/分页、维护权限、运行回执及超时、真实 Gateway/Catalog/生产客户端的授权和投影；扩展 Workerd 验证策略入口镜像变更重放、列表恢复、门禁关闭时的真实 Run journal 查询。Gateway 测试的 Workspace RPC 与 Workerd 测试的 Runtime 分别为明确替身，尚未证明完整公开 HTTP→实际容器链路。

主控完成 Gateway/Workspace 接口、运行回执校验与完整录证；子 agent 完成 journal/接口测试，低成本子 agent 完成维护权限和定向校验测试，并独立指出已修复的时间/状态组合缺口。下一步接用户端服务列表、详情和控制，再接 Preview 网关、观察与实际容器验收。本轮未部署、修改远程资源或调用模型，生产 bindings 与执行门禁未启用。

## 2026-09-08 Workspace 服务提交与自动交付（本地候选）

已接通 Workspace 私有提交、停止和意图查询，首次请求同步冻结权威版本；意图 SQL、service 逻辑唤醒与三域物理 alarm 在同一事务提交。共享路由不再因初始化或 Turn 分支提前返回而遗漏 service。审查修正了未 ready 时停止无法转交、镜像配置升级后原请求不能重放的问题：停止使用 maintenance scope，正常来源解析与新建仍检查 ready；镜像校验仅在首次冻结时执行。

[完整回归](evidence/runs/m0-local-20260908084221825/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **360 pass**、M3 **77 pass**，合计 **967 pass / 1 skip**。新增真实 Workerd 集成使用生产 Workspace/ServiceRun/Quota/RevisionStore 和 R2，证明已保存来源冻结、事务失败共同回滚、无手工唤醒的交付、重启恢复、跨 scope 拒绝、私有镜像变更重放，以及门禁关闭且 Workspace 非 ready 时的停止和配额释放。另新增 3 项 service 路由测试。

集成测试预置已确认 Workspace 和保存回合，Runtime 是明确替身；不证明 M1 初始化、初始模型提交、Python 容器执行或公开 Preview 完整链路。`serviceSnapshot` 当前仅是持久意图，不能当作运行健康。主控复核生产改动与测试边界，两名子 agent 分别完成接线和集成测试；独立只读审查确定下一步 Gateway 所需的维护权限、公开字段投影、镜像升级幂等和列表恢复要求，已写入 [M3 执行计划](m3-execution-plan.md)。

下一步接用户 Gateway/API、实际运行状态投影与列表，再接 Preview 网关/UI。原生 x86 容器 SDK 全链路仍待验收；本轮无云部署、远程资源变更或模型调用，M2/M3 执行门禁继续关闭。

## 2026-09-08 请求交付恢复与原子停止接收（本地候选）

新增 `ServiceIntentDelivery`，把持久请求按冻结来源解析成任务，经已有 ServiceRun Host 交付。先持久 claim，再派发；超时或冲突回执保持未知并复用同任务。解析/接受期间的取消都会继续处理，停止未确认时保留恢复唤醒。迟到 RPC 响应不会被当作成功，并释放传输对象。此引擎不复制租约、进程或健康状态机。

新增 `ServiceRun.acceptStopped(task)`：在同一存储事务固定任务、永久 STOP 和首次 alarm，再补建/停止 journal。首次交付未知而用户取消时，恢复入口不采用先 accept 再 stop；普通迟到 accept 不会清除已保存 STOP。stop 本身也保存 STOP，使 journal 创建失败后的重启仍能恢复取消。新建门禁关闭时保留清理入口。

[完整回归](evidence/runs/m0-local-20260908072102293/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **357 pass**、M3 **76 pass**，合计 **963 pass / 1 skip**。新增 7 项交付测试使用真实 SQLite 与端口替身，验证确认丢失、两处取消竞态、错误回执、超时迟到响应释放和未确认停止。扩展真实 Workerd 验证首次 acceptStopped 零配额/Runtime 派发，关闭门禁后取消已运行任务、故障重启及普通 accept 不复活；Runtime 仍为替身。测试中还修正了多个运行错误共用停止确认 ID 的 fixture，不放宽生产配额校验。

主控实现交付引擎并审查回执/超时处理，子 agent 实现 Host 原子停止与 Workerd 验证。下一步连接 Workspace 意图与首次 alarm、服务投递 handler、Gateway/API/UI；当前没有产品提交入口，也没有通过真实 x86 容器 SDK 的剩余验收。本轮无云部署或模型调用，执行门禁保持关闭。详见 [交付契约](m3-service-run-contract.md)。

## 2026-09-08 持久运行请求与共享唤醒（本地候选）

新增 Workspace 的 `SqlServiceIntentJournal`：首次请求在同步 SQL 事务内冻结权威来源、主体/请求键、平台配置和固定 runId；重放不再次读 head，确认丢失后可按原请求恢复。初始来源候选无需伪造归档摘要，解析后固定完整不可变任务。交付前先保存未知状态；投递截止固定且与实际运行时限区分。取消、解析、交付与停止转交分别记录，不把 Host 接受解释为进程运行或停止。

主控扩展共享 alarm 为初始化、Turn、service 投递三个逻辑域，在事务内保留最早截止；子 agent 实现意图 journal 和真实 SQLite 测试。主控审查修复两处迟到重放问题：已转交停止的请求不重新挂唤醒，已交付请求不被迟到失败重试复活。SQL 内执行到期筛选/排序/LIMIT 与 MIN，避免反序列化全部历史任务。

[完整回归](evidence/runs/m0-local-20260908071621369/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **357 pass**、M3 **69 pass**，合计 **956 pass / 1 skip**。10 项新 journal 测试使用真实 SQLite，覆盖来源冻结、重放/重启、写入确认丢失、取消、任务篡改、固定投递截止和停止转交；真实 Workerd 验证三域 alarm 重建与交错清理，定向测试覆盖失败回滚。

当前是待接线基础，尚未在 Workspace 提交入口原子安排意图与首次唤醒，也未添加 service 投递 alarm handler、Gateway 创建/停止入口或 UI。下一步必须补齐这些交付路径，尤其不能让共享 alarm router 提前返回漏掉服务请求。本轮无云部署、容器或模型调用；先前原生 x86 容器完整 SDK 验收限制仍在，执行门禁保持关闭。详见 [运行契约](m3-service-run-contract.md)。

## 2026-09-08 Preview 双来源与 Workspace 权威选择（本地候选）

Preview 计划现统一采用 source：`saved-turn` 保留真实回合身份与保存收据；`initial-workspace` 使用确认的初始空间引用和归档摘要。官方模型初始版本不再需要虚构 Turn 或调用模型才能进入计划解析。Run/Runtime/Native 已适配两种来源，启动前按原来源重新读取并校验文件；私有归档接口不传 Pi Session。

Workspace 新增私有 previewPlan，仅从自己的已确认初始化状态或已保存 head 选择来源。TurnJournal 提供同步、与日志分离的 workspaceRevisionSnapshot，供下一步在同一存储事务内冻结运行意图；活动回合尚未保存的文件不成为 head。主控负责 Workspace 接线与验证，子 agent 完成来源契约、真实 R2 测试和消费者适配。

[完整回归](evidence/runs/m0-local-20260908065849321/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **355 pass**、M3 **58 pass**，合计 **943 pass / 1 skip**。真实 RevisionStore Workerd/R2 覆盖初始模型计划、纯归档、错误 actor/scope/hash 和损坏模型包拒绝；Workspace Workerd 以明确的解析替身验证初始/保存来源选择、缺失初始化检查点与未 ready 拒绝。Native 初始来源测试为传输替身，未重新证明真实容器执行。

[首次完整检查失败](evidence/runs/m0-local-20260908065620242/local-checks.json)保留：已有 M0 真实 Pi 流式测试等待完成阶段超时，未修改其超时阈值；单独复验 15 项通过，随后同源码完整回归通过。超时根因未确认。

下一步仍是持久提交意图、幂等 runId、共享 alarm 交付、Gateway 权限和停止入口，以及用户 UI。当前读取计划不会创建 Run，也不等于初始项目已能在产品中打开 Preview。seccomp/原生 x86 容器完整 SDK 验收门禁继续关闭；本轮未部署云端或调用模型。见 [运行契约](m3-service-run-contract.md)和 [执行计划](m3-execution-plan.md)。

## 2026-09-08 控制端口隔离修复与真实 SDK 验证（未通过完整运行门禁）

[漏洞复现](evidence/runs/m3-sdk-loopback-discovery-202609071528/discovery.json)确认旧测试镜像的 UID 10001 项目进程可经本机 Sandbox daemon 请求以 root 执行 `id -u`。禁止外网、目录权限和 UID 降权不能覆盖这一内网控制接口，因此旧隔离证据不支持完整权限隔离结论。

修复候选在 Service 和 Project effect 的 child 中共同安装 NoNewPrivs/seccomp，拒绝主动 connect 与 io_uring，规则缺失或加载失败则拒绝启动。主控复现并复核，子 agent 实现共享防护与定向测试，另一子 agent 完成真实 SDK 验证脚本；低成本子 agent 核对文档当前状态表述。没有移除防护来适配测试环境。

[原生 x86 Linux 验证](evidence/runs/m3-network-fence-native-20260907225924821/native-network-fence.json)通过且源码稳定：过滤前 IPv4 连接可用，过滤后 IPv4/IPv6/Unix 主动连接与三个 io_uring 调用返回 EPERM；fork/exec 后代继承，过滤后监听、accept 与 HTTP 200 响应正常。远端临时目录和测试进程已清理。该证据使用 AMD128 普通 UID 1000，只证明内核行为，不代表容器 UID 10001 或 Cloudflare SDK 全链路。

[真实 Workerd/SDK 重试](evidence/runs/m3-service-sdk-20260908045836545/service-sdk.json)构建并使用实际 ServiceSandbox 镜像，完成三次私有分块上传，服务 start 返回失败。同一容器诊断显示 seccomp_load=-125，项目进程为零；Mac ARM VM 的 x86 镜像环境目前无法完成服务验收。源码稳定，测试服务和出口代理容器全部清理。[SDK 日志](evidence/runs/m3-service-sdk-20260908045836545/sdk.log)保存具体调用结果。此前[第一次失败](evidence/runs/m3-service-sdk-20260907225925246/service-sdk.json)由测试 Worker 缺少 ContainerProxy 导出导致，已修正后另起运行记录，未覆盖失败证据。

[当前完整回归](evidence/runs/m0-local-20260908063559173/local-checks.json)通过且源码稳定：M0 350 pass / 1 skip、M1 180 pass、M2 354 pass、M3 56 pass，合计 **940 pass / 1 skip**。回归通过不消除上述真实容器验收失败。

后续需在支持该内核防护的原生 x86 容器环境重跑实际 SDK 链路，包括精确控制接口拒绝、正常 Preview、启动重放和停止。该环境限制不阻止 Workspace 权威版本、Run 入口和网关的本地开发，但 M2/M3 执行发布门禁继续关闭。本轮没有云部署、模型调用或修改远端系统配置。

## 2026-09-07 私有 ServiceRuntime 接线与 SDK 传输修正（本地候选）

已连接 `ServiceRuntime` DO、TenantQuota、RevisionStore 和原生适配器。启动前验证完整 actor 身份、固定镜像及有效 dispatched 租约；supervisor 的持久启动/停止标记在重启后继续生效。关闭新建门禁不阻止观察和停止。新增纯 Workspace 归档接口 `serviceFiles`，避免误把 `load` 返回的 Pi Session 传入服务容器。

主控检查锁定 SDK 0.12.9 的实际实现发现 exec 不转发 stdin，原有 Docker 替身支持该字段会掩盖接口差异。已改为先写 root 私有分块文件，再由固定命令重定向读取；SDK 接口不再声明 stdin，失败的文件写入不会继续上传或启动。子 agent 完成真实 Workerd 测试，主控复核输入边界并重跑原生容器与完整检查。

[完整回归](evidence/runs/m0-local-20260907152330177/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **55 pass**，合计 **939 pass**。Workerd 验证真实 Runtime/Quota/RevisionStore 的租约、actor、scope 和镜像拒绝，上传归档摘要一致且不含 Pi Session，重启不重复启动，提前停止阻止启动，以及关闭门禁后仍能清理。Sandbox 在此测试中为 RPC 替身。

[修正后 Docker 验收](evidence/runs/m3-native-service-20260907152331340/native-service.json)通过且与回归具有同一源码摘要。716,800 字节分块归档成功恢复；真实 HTTP 验证 UID 10001、输入只读、控制目录与环境隔离。启动计数为 1，两个项目进程停止后为零，迟到启动被拒绝；部分块恢复与停止先于上传也通过，测试容器已清理。它仍不是实际 Cloudflare Sandbox SDK 纵向链路或云验收。

下一步继续实际 Sandbox SDK 本地纵向验证和部署配置预检，再连接 Workspace 权威版本、产品 API、Preview 网关与 UI。最大归档内存和总输出配额仍需验收。本轮无云部署、迁移、发布或模型调用，M3 和整体目标保持进行中。详见 [契约](m3-service-run-contract.md)与 [执行计划](m3-execution-plan.md)。文档在检查后更新。

## 2026-09-07 service Run 持久调度（本地候选）

新增 `ServiceRunHost` 与私有 `ServiceRun` DO。任务与首次 alarm 原子保存，再补建固定 Run ID 的 journal；actor 地址和完整不可变任务均校验。每次 alarm 先预置重试，stop 只写停止意图，不等待外部启动。终态但配额未释放继续对账；截止时间后的租约查询必须成功且确认不存在，才写 `acquisitionClosed`，查询超时不能据此清除 alarm。

真实 Workerd 发现 RPC 返回值附带 `Symbol.dispose`，此前被核心封闭 schema 拒绝。已在 Runtime RPC 适配层仅处理这一已知传输字段并释放结果，保持核心协议严格校验。子 agent 独立审查指出了未确认租约时提前清闹钟的风险，主控补齐状态与恢复测试。

[完整回归](evidence/runs/m0-local-20260907151056601/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **53 pass**，合计 **937 pass**。真实 Workerd 验证关闭门禁和错误 actor 无写入、不可变任务冲突拒绝、运行后重启、自动到期停止及释放后清 alarm；还覆盖 task/alarm 已保存而 journal 创建失败，重启后恢复取消且零配额占用。协调器另验证 lookup 超时保留未确认租约，以及成功确认不存在后的收尾。

Workerd Runtime 为测试替身，本轮未复跑原生容器或调用模型。实际 Sandbox Runtime DO、生产 bindings、Workspace/Gateway/API、Preview 网关与 UI 仍待接线；新建 gate 默认关闭，未部署或迁移云资源，整体目标继续。见 [宿主契约](m3-service-run-contract.md)。文档在检查后更新。

## 2026-09-07 原生 Python service 验证（本地候选）

已实现 `SandboxServiceNativeBackend`、分块归档上传程序与 root 服务启动器。适配器先核对平台镜像、保存版本及输入摘要，再传输；容器再次验证归档与入口/依赖/声明，恢复只读输入，以 UID 10001、清空环境和补充组、NoNewPrivs 及资源上限启动 Python。依赖锁当前支持空包或固定 SimPy 4.1.1，运行时无联网安装。停止使用永久 seal 与整个项目 UID 进程域清除，停止可先于上传或启动。

[真实 Docker 验收](evidence/runs/m3-native-service-20260907145738276/native-service.json)通过且源码稳定：实际 HTTP 返回 UID 10001、只读输入、控制目录拒绝、测试凭据未继承和 NoNewPrivs=1；重复启动计数为 1。服务及独立 session 派生进程共两项，停止后活跃项目进程为零；迟到 start 被停止标记拒绝，重复停止回执稳定。716,800 字节归档在首块确认丢失并只留下 128 字节后，直接适配器重放恢复成功且仍只启动一次。错误镜像拒绝。测试容器禁用网络并已全部清理；不是 Cloudflare Sandbox 传输或云隔离证据。

[完整回归](evidence/runs/m0-local-20260907145738314/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **50 pass**，合计 **934 pass**。[先前失败验收](evidence/runs/m3-native-service-20260907145603614/native-service.json)保留：原生检查已完成，脚本末项把同步镜像拒绝误写为异步断言；修正断言后按新运行目录重新验收。

主控负责 SDK 形状适配、分块传输、真实 Docker 与回归，子 agent 实现 Python wrapper 并补强 NoNewPrivs 与安装版本核验。当前尚未连接生产 Workspace/Sandbox 路由、自动到期 alarm、输出总配额、Preview 网关或 Browser UI；直接适配器重放不等于产品自动恢复已接通。本轮无云部署、发布、迁移或模型调用，M3 和整体目标继续。详见 [运行契约](m3-service-run-contract.md)。文档引用在检查后更新。

## 2026-09-07 service Run 协调与永久停止标记（本地候选）

私有 `ServiceRunCoordinator` 已连接 journal、TenantQuota 和 runtime 端口。固定租约请求与 runtime 身份后，依次取得 journal 一次性许可与 Quota dispatch；确认丢失按原操作查询或观察，不另建实例。停止或到期时，只有带永久停止标记、匹配作用域/租约且时间有效的回执才能请求释放。配额释放确认丢失可按同一回执恢复。到期停止记录明确 `service-deadline`。

`SqlServiceRuntimeSupervisor` 固定完整运行输入，持久保存单次启动尝试和不可逆停止标记；停止不等待挂起 start，且缺少进程不能被解释为确认停止。原生后端必须另行证明延迟启动被阻止、全部子进程已停止，目前仍为待实现端口。主控完成协调器与集成测试，子 agent 完成 supervisor 和独立审查；审查发现并修复端口输入可变引用、过早停止证明被永久缓存两处问题，另修复租约字段顺序导致合法回执误拒绝。

[完整回归](evidence/runs/m0-local-20260907144158690/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **46 pass**，合计 **930 pass**。新增 11 项协调测试使用真实落盘 SQLite journal/Quota 加 supervisor 和原生端口 fixture；12 项 supervisor 测试覆盖停止先于启动、挂起/迟到启动、确认丢失、SQL 回滚与输入篡改。独立审查另以 SQLite 复核过早证明拒绝后可恢复释放。文档在检查后更新。

生产 Workspace 路由、实际原生服务后端、自动唤醒、Preview 网关、Browser UI 与云验收尚未完成；未启动 OS 服务，不能把 fixture 当作实际 Preview。下一步实现原生文件恢复、受限执行、健康探测和子进程停止，再做生产接线。本轮无云部署、迁移或模型调用，M3 和整体目标保持进行中。见 [Service Run 契约](m3-service-run-contract.md)。

## 2026-09-07 独立 service Run 与共享配额基础（本地候选）

新增私有 `SqlServiceRunJournal`：固定保存版本计划、镜像 digest、时限与发起人；启动引用在事务中持久化后才返回一次性 dispatch 许可。重放、重开与持久化确认丢失不再次授予许可；停止请求阻止迟到的健康回报。独立审查以 SQLite 复现并修复停机 proof 的异步可变引用和启动前观察被接受两处问题，增加针对性测试。

TenantQuota 新增带明确 runId 的 `service-run`，与同 Workspace 的 runtime 共用租户容量，但保留独立 generation 与占额约束。旧 SQLite 结构事务升级并保留租约、操作意图和停止确认；未知或过期运行继续占额，旧确认不能释放替代实例。现有 Workspace runtime 的 operation 校验仍拒绝 service 租约。主控负责 Run journal、Workerd 集成与质量复核，子 agent 完成 quota 与独立审查，低成本子 agent 编写契约说明。

[完整回归](evidence/runs/m0-local-20260907142957703/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **23 pass**，合计 **907 pass**。真实 Workerd 验证 journal 与 quota 在重启后的重放、停止和占额边界；实际 SQLite 覆盖事务故障回滚、确认丢失、旧 schema 迁移及并发最后名额竞争。文档在检查后更新。

这两项是待接线的平台基础。生产 Workspace、Run/Quota 协调器、runtime 不可逆停止标记、实际容器健康与停止、网关和 UI 尚未接通；不能以 journal 的 starting/running 状态声明真实进程或 Preview 已运行。本轮无部署、迁移或模型调用，M3 与整体目标继续进行。详见 [运行契约](m3-service-run-contract.md)与 [M3 执行计划](m3-execution-plan.md)。

## 2026-09-07 Preview 保存版本解析（本地候选）

Preview 项目声明冻结为 `app/preview.json`；`.riffology` 继续保留给平台控制数据。声明采用封闭 schema，只接受受限 Python 入口、依赖锁、固定端口和本地健康/观察路径，不接受命令、环境变量、外部地址或权限字段。平台从已保存 Revision 的规范归档读取声明、入口与依赖锁，并保存三者的 SHA-256；整包摘要与收据不一致、缺文件或超限均拒绝。归档解析保留单份不可变快照，返回内容切片不能修改内部状态。

私有 RevisionStore RPC 已接入解析器；真实 Workerd/R2 测试覆盖保存后解析、入口和锁摘要、错误 actor、跨租户请求及无效归档拒绝。类型检查和[完整回归](evidence/runs/m0-local-20260907141820176/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **9 pass**，合计 **893 pass**。文档引用在检查后更新。

当前返回的是 service 执行计划，不是正在运行的 Preview。没有安装依赖、创建 service Run、启动容器、开放网关或授予 Observer 能力；JSON 中的 observation 也不证明接口只读。独立 service Run、配额、运行镜像冻结、启停对账、鉴权网关与用户端仍待实现，见 [M3 执行计划](m3-execution-plan.md)。本轮无云部署、迁移或模型调用；M3/G3 与整体目标保持未完成。

## 2026-09-07 管理端规范包上传（本地候选）

草稿行已提供“上传规范包”入口，浏览器校验 8 MiB 上限和草稿摘要后发送原始文件。服务端独立限制流式 body、核验规范包与摘要，并以 R2 条件创建写入固定 `model-content/` key；已存在的不同内容不能覆盖。写入响应丢失以回读验证恢复，数据库接受结果与上传审计使用持久幂等 intent。上传后模型仍为 draft，验证与发布继续由上节内容门禁控制。

operator 和冻结草稿来源分别在读取 body 前、写 R2 前、写入接受结果时检查。R2 与 D1 不构成跨服务原子事务，写入期间撤权可能留下已验证的不可变对象，但不会产生成功审计或状态升级；重试可以确认既有匹配对象。浏览器失败后重选同文件复用 UUID 请求编号，超限或摘要不符不发请求。主控复核修正了前端初版编号包含非法字符的问题，并加入 Gateway 合法编号格式断言。

[完整检查](evidence/runs/m0-local-20260907140333486/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**。真实本地 Gateway/D1/R2 覆盖错误摘要无写入、正确上传与原始字节回读、同键回放单条审计、验证和发布；Chrome 覆盖文件选择、网络失败后的同文件重试、超限和摘要错误。主控负责 API/body 与集成验证，两个子 agent 分别完成存储和目录事务，低成本子 agent 完成界面与浏览器测试。此段是检查后的文档引用更新。

本轮无部署、云迁移或模型调用。官方模型的本地“草稿 → 上传 → 验证 → 发布”已接通；真实云验证与后续 Preview/Run 等计划项仍待完成，整体目标保持进行中。操作说明见 [模型发布运行说明](m1-local-runbook.md)。


## 2026-09-07 官方模型发布内容门禁（本地候选）

管理端验证/发布已接入实际 `MODEL_CONTENT` 读取与规范包验证。验证成功时在同一事务写 validated 状态、不可变内容收据、操作 intent 和审计；发布前必须重读原始包并与保存收据完全匹配。缺包、损坏、来源或收据不匹配，以及未配置验证器均拒绝。SQL 在存储读取后再次校验 operator 权限及冻结来源；成功请求同键回放无需重读包，不重复审计。撤回不依赖内容存储。新增 `0007_model_content_checks.sql`，验证后的内容引用不可修改。

主控完成生产 Gateway 接线、真实 Workerd D1/R2 测试和迁移清单核对；子 agent 完成模型事务与收据测试，低成本子 agent 完成管理端文案和 Chrome 失败重试回归。真实 Gateway 测试覆盖“缺包验证拒绝 → 上传原包验证成功 → 删除原包发布拒绝 → 恢复原包发布成功”，且收据恰好一条。校验仅证明格式、内容摘要和归档兼容性，不证明模型运行效果或安全审查完成。

[最新完整检查](evidence/runs/m0-local-20260907135431744/local-checks.json)：M0 **350 pass / 1 skip**、M1 **160 pass**、M2 **354 pass**，零失败且源码稳定。前次 [失败记录](evidence/runs/m0-local-20260907135255703/local-checks.json)保留：旧 provisioning 测试未提供实际模型验证器，被新门禁拒绝；该测试已改用真实规范包并通过。此段为检查完成后的文档引用更新。

上传仍由运维处理，管理页面没有上传功能；云迁移、MODEL_CONTENT 配置与发布尚未执行，本轮无云部署和模型调用。后续需完成受控上传/发布操作链路和云验收，整体计划与 M1/G1、M2/G2 保持未完成。操作顺序见 [模型发布运行说明](m1-local-runbook.md)。


## 2026-09-07 初始 Workspace → Turn 本地验收

初始引用已接入 WorkspaceAgent、TurnJournal、Runtime 恢复和 RevisionStore。首轮前 Files 显示平台 README、公共目录和官方模型文件；首轮把独立初始引用冻结进基线，不伪造已完成 Turn；首次 Diff 对照初始档案，后续回合优先使用已保存版本。初始来源仅由 confirmed-ready 服务端状态选定，checkpoint 和模型包分别从各自 R2 binding 读取。官方包和归档共用路径、条目及容量约束。

[完整检查](evidence/runs/m0-local-20260907134503067/local-checks.json)：M0 **350 pass / 1 skip**、M1 **154 pass**、M2 **354 pass**，零失败，检查期间源码稳定。[真实本地官方模型 CRUD 验收](evidence/runs/m2-product-turn-crud-fixture-20260907134503445/primary-review.json)：经真实 Gateway/D1/DO/R2、Project/Trusted Pi 容器完成 20 次写入/编辑/重命名/删除；最终保留 README 与两份官方原始文件，新增四份文件，首次 Diff 为 added=4；销毁两类容器后新实例恢复，归档 SHA-256 保持一致，恢复回合 Diff 为零。七类 Runtime 身份篡改、跨租户请求和损坏保存基线均拒绝。模型响应使用本地确定性 fixture，实际 Pi SDK、工具和文件链路运行；外部模型请求与模型预算计数均为零，不能据此声明真实 provider 或云隔离验收。

确定的初始对象缺失/损坏现在产生持久化 `turn-initial-base-unavailable`，不会一直排队。Workerd 覆盖失败状态跨重启与同键重放、零 Runtime 调用、恢复对象后新回合执行；网络暂时异常继续重试。公开提交/重放/取消响应及快照过滤内部初始引用。主控负责接线、故障复核与完整验收，三个子 agent 分别完成 Journal、恢复、Revision/Diff 及交叉审查。

本段为检查完成后的文档引用更新，不属于同次源码快照。本轮无部署、无模型调用，`cloudGatePassed=false`。管理端实际内容包验证收据、云部署验收，以及计划内后续模块仍未完成；M2/G2 不因本地链路通过而关闭。详见 [M2 初始基线计划](m2-execution-plan.md)。

### 先前阶段记录

更新：2026-09-07 11:27 UTC。**M0 的 G0 技术门禁 10/10 通过，共同候选已签收；M1 首个真实身份、个人空间、operator 管理端与首个项目已通过，官方模型内容完成真实本地 Container 链路，G1 尚未通过；M2 已通过 provider 关闭条件下的真实双 Turn、容器销毁恢复、跨租户拒绝、排队取消恢复、accept/cancel 响应丢失恢复、损坏基线拒绝、已保存 Revision 的 Files / Diff、受限 Project Bash，以及大结果 Artifact、引用权威、本地分页和工具卡读取入口；产品发布门禁仍默认关闭。** [主控签收](evidence/runs/m0-g0-accepted-20260906/progress.json)核对全部十项记录和 141 个证据引用，冻结 187 个源文件；本轮[不可覆盖完整检查](evidence/runs/m0-local-20260907110116681/local-checks.json)为 M0 349 pass / 1 skip、M1 146 pass、M2 300 pass / 0 fail，388 个源文件在检查期间保持一致，源码摘要 `136f2e83be4855eab33127c55af254e1f56eefaddcca1b8c13abe4b8b8e372e5`。检查 JSON SHA-256 为 `defc9dfc57981c0055b7f54c950dc67d7361e9e2e19cddbc54292001976505fc`，日志 SHA-256 为 `91674158c36f5029cb402a40ca880240bba528d897a34c33fbf1cb273fbf79de`。`cloudGatePassed=false` 表示本次没有把本地检查扩展成新的云发布门禁。前一记录 `m0-local-20260907105958681` 遇到既有 M0 并发进程用例的单次时序失败；该用例隔离重跑通过，随后同一源码的完整记录通过，失败记录原样保留。工作分支 `codex/m0-runtime-foundation`，修改未提交、未推送，仓库没有远端。

最新[真实产品 Turn 本地证据](evidence/runs/m2-product-turn-provider-disabled-20260907053121020/primary-review.json)使用当前产品 release assembly、真实 ProjectRuntime、Project Tool Sandbox、Trusted Pi Sandbox、D1/DO/R2 和库会话 fixture，完成项目初始化及两个连续 Turn。首轮运行时又创建两个排队 Turn 并在派发前取消；Workerd 重启后它们仍保持 cancelled，且没有 checkpoint。首轮在 provider 关闭时记录 503 并保存失败终态；随后强制删除首轮 Project 与 Trusted Pi 容器，以首轮同一不可变 receipt 同时恢复 workspace 与 Pi Session 到两个新 actor。第二轮文件哈希保持一致、Session 哈希推进，再次保存失败终态。随后删除第二轮 Session blob并再次销毁容器；第三轮在分配 Sandbox 前终止为 `turn-base-unavailable`，持久化明确为 `turn-checkpoint-unknown`，未创建第三个 manifest 或新 Sandbox。第二租户对 workspace snapshot/session/events、tenant projects 和 cancel 的五次访问均在 Runtime 前返回 404；内部 Runtime 对 tenant、project、workspace、generation、session、turn 和 dispatch 七个身份字段的逐项篡改均返回 409，拒绝过程未改变 R2 对象或容器集合。三轮在 Workerd 重启后终态一致。两轮可执行路径的模型预算各为 `attempts=0`、`dispatchedCalls=0`，外部 Worker fetch 为 0，容器全部清理。回执 SHA-256 为 `3b077263a36f5753cf54fec1f06101a0ff968ef4b6f0a10afada952231c5229c`。验收只在生成的 `m2-provider-disabled-v1` 镜像中启用候选 release；产品 Dockerfile 仍加载失败关闭 release，产品配置与 staging 的 Turn/provider 开关仍为 `false`，没有模型调用、云部署或容器滚动。[完整产品拓扑证据](evidence/runs/m2-product-topology-v2-local-20260907/primary-review.json)继续证明八个 DO、R2、两个私有服务和三类镜像可启动，且不依赖 `m0-*` 或 `Dockerfile.local`。浏览器已确认个人空间激活完成并进入项目列表。

[T10 发布与回退](m0-release-cloud-validation.md)已补齐真实 native monitor 退出码 42，以及原回退 W1/I1 的新实例从 R2 恢复 2、写入并回读 3。原保存点未变，新保存点独立下载核对；两个应用七条实例记录均 inactive。独立审查和正式门禁记录均完成，旧失败及未知观测保留。

[旧系统退役](m0-legacy-retirement.md)在 10:16 UTC 再次确认：`riffology-demo` Worker、旧根路由和两条 Tunnel CNAME 不存在。没有兼容入口。本地 UI 4173 返回 200。

T01 的两次 Go 调用已完成并撤权；本轮新增模型派发为 0，不补发第三次。预算仍为 US$5、模型最多 US$1，现金扣款待对账。G0 仅签收技术可行性；真实云登录与项目验收、持久回合、Browser 产品接线、Run、管理端及付费链路尚未交付。后续顺序见 [M1 执行清单](m1-execution-plan.md)。

## M1 当前实现

Trusted Pi 取消已补齐 SIGTERM 排空语义：信号发出后若同一进程仍运行，Runtime 保持非终态并只继续观察；只有后续观察到进程退出和匹配的 cancelled terminal 才生成停止证明，不会重复发送 kill 或提前释放队列。

Project Bash 已从 Trusted Pi 的工具定义接通到 Project Sandbox 固定 wrapper。平台只发送已校验的脚本与 30 秒以内超时；wrapper 读取 root-only 控制文件后降至 uid 10001，再以无 profile、固定环境和 `/workspace` cwd 启动 Bash。stdout/stderr 各保留 6000 字节并明确标记截断；超时杀死整个进程组，因超时前可能已有文件副作用，Tool Ledger 保持 `unknown` 且不自动重放。[真实 `linux/amd64` 本地镜像证据](evidence/runs/m2-project-bash-local-20260907072338/bash-local.json)验证 Bash 与产物 owner 均为 uid 10001，回执 SHA-256 为 `b7107d439918adf08e586b6861812805050cc9ea0a1513f53e7809dfe1e49a00`。云容器中的取消、资源上限和停止证明仍须单独验收。

官方模型库已完成本地元数据纵切、内容来源冻结、受控包构建、私有 resolver 与真实 Container 安装候选：第 6 个 D1 迁移定义固定版本、`draft → validated → published → withdrawn` 单调状态、发布后内容不可变、持久幂等 operator intent、独立追加审计和 Project 来源约束；Gateway 提供公开 published 列表/详情、operator 全状态列表与生命周期操作。`m1:model-package` 从受限目录生成唯一规范 JSON，拒绝符号链接、硬链接、特殊文件、非 NFC/越界路径、超限文件和覆盖输出，并只打印包级摘要。项目创建把固定版本与内容摘要冻结到 Outbox；ProjectRuntime 只从私有 `model-content/` namespace 解析最多 8 MiB 的包，重算包和逐文件 SHA-256，通过固定 Node 程序的有界 `stdin` 安装。安装意图、receipt 和 manifest 先进入 SQLite；完整安装但响应丢失时只读回文件，半安装只用同一冻结引用幂等补齐，到期、撤权或停止后不再安装，容器启动始终最多一次。已有目标测试覆盖非规范 JSON、硬链接和恢复窗口。[官方模型内容真实本地链路](evidence/runs/m1-workspace-20260907063137662/workspace-local.json)进一步经 Gateway、D1、WorkspaceAgent、TenantQuota、私有 R2 与原生 Docker 安装 392-byte/2-file 包，逐文件确认后生成绑定模型来源的 checkpoint，停止并释放配额，Catalog 最终投影 `ready`；源码前后摘要一致，回执 SHA-256 为 `7f5b6fe09f9da8ac2331cfa8c9ad12d349fd52f9d4fe1a1926abfac7af1a499c`。生产用户端与管理端仍只管理目录元数据；云 `MODEL_CONTENT` bucket/binding、operator 上传发布、迁移和双身份隔离尚未完成，因此不能称为模型库上线。

M2 Revision 的生产候选路径已改为私有 `RevisionStore` Durable Object：ProductTurnRuntime 只冻结 Project/Pi 字节并调用 RPC，release assembly 不再持有原始 R2 reader/writer；同一 Revision bucket 的 commit、observe、restore、load 和 GC 统一经过一个对象。写入或 GC 在首次 R2 await 前保存 operation fence，实时请求用对象内串行链覆盖 await 交错，DO 重建会把遗留 reserved 转成 unknown；不使用跨 R2 await 的 `blockConcurrencyWhile`。ProductTurnRuntime schema v2 在 commit 前持久化完整 descriptor，响应丢失或重启后只允许精确 reconcile。GC 本地候选现持久保存 `scan_manifests → scan_blobs → delete_candidates → completed` 阶段、分页游标、引用集、候选集、删除中的 key 和统计，并用 `operationId + inputSha256` 精确对账；只删除超过最小年龄、未被有效 manifest 引用且匹配规范内容寻址前缀的 blob，状态或 R2 读取不确定时失败关闭。完成态不阻断 observe/restore/load，下一次 mutation 才清理临时行。本地 Workerd 进一步注入“R2 delete 已生效但响应丢失”，首次 GC 进入 unknown，精确 reconcile 观察对象已不存在后只推进原候选和计数，重复 reconcile 返回同一完成结果，Revision 读取仍可用。线上调度及云 R2 大桶验证仍未完成，因此不能安排线上 GC，Turn 门禁保持关闭。

M2 大结果 Artifact 已形成独立平台候选。Project Sandbox 的 read/list/search 仍只负责产生有界 UTF-8 JSON；超过 16 KiB 的结果由 Tool Bridge 交给固定 `ToolArtifactStore`，该 SQLite DO 持久化完整 effect identity 和 operation fence，再以不可覆盖写入及回读摘要确认 `tool-artifacts/` 前缀下的对象。Ledger、Pi 和浏览器都只得到不含对象 key 的 receipt。WorkspaceAgent 复核 scope 和自身 actor，Gateway 先按 Catalog 当前成员关系与 ready Workspace 做所有权检查，再提供只读 JSON API；关闭新 Turn 的 `M2_TURNS_ENABLED=false` 不会阻断已保存 Files、Diff 或 Artifact。新增 `project_read_page` 以 UTF-8 字节 offset、8 KiB 单页上限和首段 SHA 锁定同一文件版本；20,000 字节文件在真实本地 Workerd + Project Sandbox 中以 3 页完整返回，同时生成 20,146 字节 Artifact，重复同一命令保持一个 R2 对象。Trusted Pi host 只提取严格 receipt，Runtime 二次校验后投影到 `tool.completed`，用户端工具卡以当前 Workspace 和合法 artifact ID 生成只读链接，伪造 ID、HTML media type 与失败工具均不生成链接。[分页、Artifact 与 UI 本地证据](evidence/runs/m2-read-page-artifact-ui-local-20260907/primary-review.json)保留原分页与 UI 纵向链路。

ArtifactStore 现在同时是唯一引用权威：新对象与 `tool_effect` 引用在同一 SQLite 事务出生；升级时严格解析旧 artifact identity 并幂等回填该引用；`tool.completed` 事件必须先完成 scope、Turn、dispatch、artifact ID 一致的 `turn_event` retain，才允许进入 Workspace journal。retain/release 重放幂等，已释放引用不能重新激活，跨租户或 generation 请求在对象读取和引用变更前拒绝。先 retain 后 journal append 的失败窗口只会造成保守保留，不会误删；WorkspaceAgent 已提供受 ready scope 保护的私有事件引用释放接口；只有 Turn 终止且事件及幂等回执均不再保留时才可释放。尚未接自动调度、工具效果引用释放，也没有 Artifact 删除或 GC 实现。[Artifact 引用权威本地证据](evidence/runs/m2-artifact-reference-local-20260907112445838/primary-review.json)记录旧行持久化升级和只读审查无本切片 P1；[生产 Workspace 装配证据](evidence/runs/m2-artifact-reference-wiring-local-20260907113144206/primary-review.json)进一步记录组合定向 25/25、M2 304/304、TypeScript 通过、真实 `tool.completed` 双引用、Workspace 读取和跨租户拒绝；第一次完整运行在既有模型预算并发测试中因两次动态 deadline 不同触发幂等冲突，[失败记录](evidence/runs/m2-artifact-reference-local-20260907112306283/primary-review.json)原样保留，测试随后改为复用同一不可变请求并完整通过。证据不代表 staging 或云 R2 已接线。下一工作包必须由 journal 终态/压缩与 Tool Ledger 的持久状态定义 release，再实现带 grace period、分阶段对账和严格前缀的 GC；在此之前继续禁止删除 `tool-artifacts/` 对象，代价是存储只增长。

TurnJournal 已升级 schema v3：Turn 自身保存本地 started/terminal sequence，workspace/session head 和请求 intent 不依赖事件数组；runtime event receipt 保存原事件并对活动 Turn 设置独立 4096 条上限。事件窗口同时限制 2048 条和 4 MiB，每次追加在同一事务内自动裁剪为合法尾部窗口；显式 compact 仍可缩小窗口。旧游标返回 `snapshotRequired`，SSE 在越过缺口前发送 `snapshot.required` 并关闭。v1/v2 状态在下一次写事务中迁移；裁剪后活动 Turn 的相同 runtime event 重放仍返回原 receipt，不创建重复事件。Turn 进入终态后不再接受 runtime append，因此同一事务会清理其 receipt，旧状态也会在 claim/compact 时回收，避免 workspace 生命周期累计触发上限；活动 Turn 达到 4096 条时仍失败关闭。长期事件审计归档仍未实现，但它不再是 runtime event 幂等性的前置条件。

WorkspaceAgent 的真实 Workerd 链路已补 `accept` 与运行中 `cancel` 的“终态已持久化、RPC 响应丢失”故障注入。调度器再次投递时只调用一次 `observe`，两个 Runtime effect 的调用计数都保持 1，原 Turn 分别恢复为 `completed` 与 `cancelled`，重复取消不再跨 Runtime。测试用具显式强制逻辑 alarm 到期，以验证持久 wake 的重投递语义而不依赖 Miniflare 对失败 alarm 的自动退避时序。pending provisioning 与活动 Turn 并存的产品级故障注入仍待完成。

M1 staging 已部署专用 D1/R2、Worker、三个声明式 Durable Object 和 Container application；[配置与预检](m1-staging-plan.md)为 20/20 passed。新入口 `m1.riff-demo.gaojihe.cn` 首页返回 200，未登录 `/api/me` 返回 401，不占用 M0 Preview 根域名；旧 `riffology-demo` Worker 与 DNS 入口均不存在。M2 已有 Tool SQLite 账本、一次性 effect dispatch、文件 effect envelope、SQLite Project effect supervisor、SDK Native adapter、双 Sandbox actor ID 和固定出站策略，以及用 `dir_fd + O_NOFOLLOW` 抵抗 symlink 和父目录替换竞争的文件适配器。本地项目镜像固定 Sandbox 0.12.9-python digest，root wrapper 读取 0700 控制目录后降至 uid 10001；[本地 Durable Tool Bridge 证据](evidence/runs/m2-tool-bridge-local-20260907/primary-review.json)确认 Workerd 通过真实 SQLite Ledger 授权、派生 Tool Bridge/Project actor、签发 capability、连续两次完成容器写入/读回并稳定回放。[Trusted Pi 内部 HTTP 证据](evidence/runs/m2-trusted-tool-http-local-20260907/primary-review.json)确认锁定 SDK 的 outbound `containerId`、HMAC 与三类 actor 绑定，错误 scope 在账本前返回 403。[共享 alarm 与 Turn engine 证据](evidence/runs/m2-shared-alarm-local-20260907/primary-review.json)确认 provisioning 与 Turn 共用一个物理 alarm 时仍保留各自 deadline，并发取消只有事务胜者调用一次 runtime。[产品 Turn Runtime core 证据](evidence/runs/m2-product-turn-runtime-local-20260907/primary-review.json)冻结独立 SQLite execution fence、完整 actor identity、observe-only 恢复、取消与 checkpoint 分栏。新增的[本地 Revision 证据](evidence/runs/m2-turn-revision-local-20260907/primary-review.json)验证内容寻址的文件/Pi Session blob、完整身份 manifest、R2 回读摘要、并发终态和 journal 两阶段对账；真实 Workerd 停止重启后 execution/freeze 仍各一次，收据与三个 R2 对象一致。R2 receipt 不是产品 `saved`，只有 Workspace TurnJournal 原子提交后才可报告保存成功。若首次 commit 与 observe 都无法确认，Runtime 保留一次性 materialization fence，Turn 继续处于 `checkpointing` 并由 alarm 观察同一 receipt；晚到收据可完成原 Turn，不能再次创建 Revision。确定损坏的基线仍直接失败并释放队列。

M2 新增的 Trusted Pi execution/native adapter、容器 turn host 与独立镜像候选把 `sessionId` 纳入 Runtime/Revision 全身份，并限制事件时间、数量与累计大小。Workspace TurnJournal schema v3 同时维护最新 workspace head、各 Session head、独立 start/terminal lineage 和有界事件窗口，在 claim 的同一事务中冻结两个不可变收据；Dispatcher、Product Runtime、Trusted Pi 与 Revision manifest 原样携带这组基线。恢复时 Session 字节必须匹配收据摘要，Revision 提交前必须回读基线 manifest 与两个内容 blob，并验证租户、项目、Workspace、generation 和 Session 归属。[本地基线版本链证据](evidence/runs/m2-turn-base-lineage-local-20260907/primary-review.json)关闭了“重试读取变化后的基线”和“父版本由项目侧自报”两个 P1，且覆盖旧 v1 本地状态的下一次写入迁移、head 回滚、伪造收据与跨 Session 拒绝。旧状态的迁移排序收紧为本地 journal terminal/start sequence，远端 `committedAt` 只作收据事实，不能倒置本地 head。host 的 control 不接受模型、prompt、skill、工具或凭据字段；这些只能由镜像内 release 模块提供。输出 Session 先于 terminal 结果持久化，且只有 supervisor 明确观察同一原生进程退出才产生停止证明；进程登记缺失保持 `unknown`。真实三容器验收修正了 Trusted Pi 镜像缺少 `pi-server`、Node 路径、符号链接入口、release 相对导入和非 2xx 响应观测五个装配缺陷，并确认失败终态仍保存项目与 Pi Session 摘要。[Workspace 归档与镜像证据](evidence/runs/m2-workspace-archive-local-20260907/primary-review.json)连续两次完成 Project Sandbox 空版本恢复、写入、规范 USTAR 冻结、源容器销毁、另一派生 actor 恢复与错误身份拒绝，归档摘要一致；R2 reader 同时增加实际字节和 files + Session 聚合上限。由于 `/workspace` 是独立挂载点，恢复器在挂载内完成临时树提取与重新冻结校验，再在 Pi 启动前安装目录项；失败不进入 Pi，保留输入供下次修复。[Workspace 与产品 Runtime 接线证据](evidence/runs/m2-workspace-runtime-wiring-local-20260907/primary-review.json)进一步验证了独立 `ProductTurnRuntime` SQLite DO、完整身份 actor、WorkspaceAgent 的 Turn engine、provisioning/Turn 共享 alarm 路由，以及真实 Workerd 中从 Session 入队到保存终态与事件回放的完整控制链。该链路还修正了跨 DO 时间语义：R2 物化时间可早于 Workspace 的 checkpointing 确认，终态和事件使用 Workspace 本地提交时间，避免回合卡死。[本地模型预算与代理门禁证据](evidence/runs/m2-model-budget-local-20260907/primary-review.json)新增 Tenant 范围的 SQLite Token/call authority、短期 Turn capability、Sandbox request MAC、实际容器 ID 校验与私有 `/v1/responses` gate；同一 Turn 的 Runtime 恢复不重置预算，派发响应丢失和 provider 不确定性只进入 observe/pending，调用方不能选择 model、provider 或凭据。[Workerd 预算证据](evidence/runs/m2-model-budget-workerd-local-20260907/primary-review.json)进一步确认跨 Tenant actor 拒绝、并发一次性派发、重启恢复、策略冲突与第二 Tenant 隔离。该 authority 不含价格、余额、支付或退款。[Turn admission 本地门禁证据](evidence/runs/m2-turn-admission-gate-local-20260907/primary-review.json)确认提交在解析 WorkspaceAgent 前返回 503，不会新增永久 `queued` 记录；开关只有精确字符串 `true` 才放行。该门禁已经以 `M2_TURNS_ENABLED=false` 部署为 staging Worker 版本 `beeb20f0-6346-405e-88ea-632ea87863d8`；[部署与线上只读证据](evidence/runs/m2-turn-admission-gate-staging-20260907/deployment.json)确认未构建或滚动 Container、主页 200、未登录 `/api/me` 401，以及激活记录为 1 个已接受邀请、1 个活跃用户、1 个活跃 Tenant 和 1 个有效成员关系。新增 ProductTurnRuntime、RevisionStore、TenantModelBudget、ModelProxyService、WorkspaceAgent 接线及其余 M2 Runtime/Revision/host 仍仅在本地，未部署。供应商凭据注入、真实付费模型回合、Artifact 云链路、云双 Sandbox 和真实登录 Pi Turn 仍未验收；本轮模型调用为 0。

2026-09-06：[最新完整检查](evidence/runs/m1-local-20260906134220998/local-checks.json)为 **M0 348 pass / 1 skip、M1 103 pass / 0 fail**，242 个源文件在检查期间保持一致，源码摘要 `72ef317d6cf3b92ef5cf8948ba9ec8c6d7f4daaf94090d55cabb03eb919f184f`。[首任 operator 本地证据](evidence/runs/m1-bootstrap-20260906134338/bootstrap-local.json)绑定第 5 个本地 D1 迁移、离线工具、事务故障和凭据边界；[管理端本地证据](evidence/runs/m1-admin-20260906130122/admin-local.json)绑定真实 Worker 静态响应与 Chrome 行为。[真实本地完整链路](evidence/runs/m1-workspace-20260906121130494/workspace-local.json)完成 Gateway → D1 outbox → WorkspaceAgent/alarm → TenantQuota → 原生 Docker → R2 → 原生停止 → 释放配额 → D1 ready。它们使用隔离数据库中的库会话 fixture，没有 Google、云、邮件或模型调用。

- Catalog/Admission：邀请、个人 Tenant、Membership、项目归属、幂等创建、追加审计；创建时固定原始 authVersion，持久 outbox 跨请求继续存在。每分钟私有扫描最多十项，与 DO 幂等接收共同覆盖“数据库已提交、派发前中断”。
- Gateway：Better Auth 1.7.3、数据库会话、撤权、同源写入、8 KiB / 5 秒请求体限制和固定认证入口。Google OAuth consent/callback、真实 Cookie、邀请准入和 operator 权限已在 staging 验证。写入成功后的首次 UI 读取曾短暂显示旧状态；远端 D1 read replication 已确认关闭，正在补客户端写入响应合并与恢复轮询。
- WorkspaceAgent：SQLite 状态和 watchdog alarm 原子保存。初始化、停止、dispatch 未知时只观察同一实例；配额申请和释放先 lookup，固定 payload 最多三次持久幂等尝试。晚到或撤权任务不能新启动实例，D1 恢复后可继续未确认投影。
- ProjectRuntime：固定空白目录与 nonce marker，读回真实文件后保存不可变 R2 checkpoint；先持久停止标记再原生 destroy。文件摘要、原生停止和配额释放全部确认才把项目投影为 ready；此时 VM 已停止，ready 指文件已准备并保存。
- 用户端：`services/web/` 接入真实 API，Google 登录入口、邀请准入、空白/官方固定版本项目创建、状态与退出。官方模型卡可直接打开并精确预选固定版本；目录支持刷新，撤回或加载失败会移除未提交的旧选项，首次请求失败后则锁定原选择、body 和 key，项目列表区分空白来源与官方独立副本。就绪项目可进入生产静态入口中的 Workspace，读取持久 Snapshot 与 Event，创建、切换 Session，提交或重试同一 Turn intent，并显示回合、provider、保存状态、合并后的 assistant delta/message 与折叠工具卡；合法大结果 receipt 会在对应工具卡显示当前 Workspace 下的“查看完整结果”链接，失败或伪造 receipt 不显示链接。页面固定展示平台与项目内 Pi 的职责边界。Workspace 右侧 Files / Diff 面板通过受所有权保护的 `GET /api/workspaces/{wid}/files` 和 `GET /api/workspaces/{wid}/diff` 读取最新已提交 workspace head。WorkspaceAgent 在私有 journal 内恢复完整 Runtime identity；RevisionStore 校验当前与父 Revision 收据，只在对象内部比较规范 USTAR 的类型、模式与文件字节。公开响应仅含 Revision 摘要及路径、变更类型、类型、大小和模式，不返回文件内容、R2 key、dispatch ID 或 Pi Session。无已保存 Turn 时显示真实空状态；Files 自动加载，Diff 只在选中页签时加载，手动刷新只请求当前页签。两条读路径均不受 `M2_TURNS_ENABLED=false` 影响，也不发起模型或容器写操作。可信项目 hash 只有在重新读取当前租户项目列表并匹配 ready Workspace 后才恢复，刷新后重新建立观察；无效或外来 hash 不请求 Workspace。真实 Chrome 验证目录失败时空白入口仍可用、目录变化后的固定版本精确重试、连续失败后同键重试、Session 切换、消息、工具与文件名只作文本、Files / Diff 安全文本渲染与定向刷新、Artifact 链接约束、取消表单、隐藏页面暂停、五分钟停止项目轮询、退出后忽略晚响应。Runs Panel、Browser 插件与事件归档仍待接真实 API。4173 的 `ui/` 工作台已删除机场图、文件、Diff、Run、成本和计时等伪运行数据，未连接时只显示禁用操作与明确空状态；其他项目页和管理页仍保留设计评审示例。本次改动仅在本地，未部署。
- 管理端：`/admin` 接入独立 operator 角色、平台摘要、租户状态计数、邀请创建/撤销和追加审计。模型管理 API 与生产静态页面已支持草稿创建、校验、发布、撤回和全状态列表，权限在 mutation SQL 内复核，只有实际状态变更写入独立 model 审计；网络失联按持久 intent 回放，不会重复创建或产生虚假成功审计。页面明确当前只管理元数据，内容包尚未上传或复制。普通 owner 统一拒绝；管理查询不持有 R2、Runtime 或项目内容绑定。邀请码明文只返回一次，D1 只存 hash；同键重试与丢失响应不会创建第二条邀请或再次泄露 token。真实 Chrome 已覆盖权限拒绝、精确重试、安全文本、模型状态流转、一次性 token、撤销和移动端布局。
- 首任 operator：新增无公开 HTTP 入口的离线引导脚本和第 5 个迁移。脚本只把 token hash 交给显式 local/remote D1，响应丢失按同一 hash 回读；已验证邮箱接受唯一 bootstrap 邀请时，在 Admission 同一事务授予角色并追加审计。普通邀请、第二个 bootstrap、既有 active operator、异 token/email 和每个注入失败点均拒绝或整体回滚。

**G1 尚未签收。** [首位运营账号与首个项目云证据](evidence/runs/m1-first-operator-cloud-20260907/acceptance.json)已确认正式 Google 登录、bootstrap 邀请接受、个人 Tenant、operator 管理端，以及首个项目从 D1 outbox 经原生 Container、R2 checkpoint、停止到 `ready` 投影；实例终态为 `inactive`。剩余：第二真实身份的并行与跨对象拒绝、同租户最后配额名额竞争、创建故障云对账。生产持久 Turn、可恢复的任意项目文件、Browser、Run、官方模型内容包和收费仍属后续阶段。本轮没有发送邮件、第三次模型调用、提交或推送；旧 `riffology-demo` 入口保持退役。

参见[初始化 ADR](adr/0003-m1-workspace-initialization.md)、[本地运行手册](m1-local-runbook.md)。以下保留 M0 历史结果，顶部 G0 签收只属于其冻结候选。

## 已交付的 M0 代码

| 模块 | 实际能力 | 证据边界 |
|---|---|---|
| 受控 Pi 宿主 | 显式资源、模型和远程工具清单；无项目扩展发现、全局凭据回退或本地 Shell 工具；Session 恢复重验归属与清单 | T03 恶意文件发现隔离和 T01 真实供应商调用/完整 Session 恢复均已云签收；生产工具接线属 M2 |
| 取消与终态 | 等待凭据或平台最终 payload 检查时可取消；晚完成/晚失败不会发请求；非协作工具超时关闭宿主，要求 supervisor 终止；显式 completed / aborted / failed | 本地竞态测试及云 DO 监督器通过；T01 的代理终态为 completed/cancelled，生产 durable Turn 属 M2 |
| 受限模型代理 | 固定请求/模型、原子预留、透明 SSE；SQLite DO 账本、两层 capability、取消 fence；新增独立 Go live profile，固定 run/两次调用/整窗预留 | 23 项 staging fixture 及真实两次 Go 云调用通过；独立账本回读与撤权通过；计费结算仍未知 |
| 保存协议与文件恢复 | 不可变内容和 Session 包、摘要校验、最后提交指针与事件、父版本及 generation 比较；保存收据、终态元数据在同一事务提交；真实文件 20 次 CRUD、销毁后重建与恢复后写入 | T05 云文件、T06 云 fault、T01 真实 Pi Session/R2 恢复均已签收；完整产品项目恢复属 M2/M5 |
| Sandbox 探针 | 独立可信/项目 Sandbox、固定操作、强 Bearer、合成租户 capability、出站观测和清理 | T02 云隔离、T04 资源矩阵、T09 HTTP 出口与固定依赖均已签收；DNS例外及 TCP 超时单列，生产身份属 M1 |
| Preview 探针 | 分离控制与 Preview hostname、短期 capability、固定 HTTP/WS 路由、凭据剥离、重定向过滤、真实 Chrome iframe 与撤权 | T07 云浏览器 15 case 已签收；主体为平台控制的测试身份，生产登录和跨站 Cookie 支持另行验收 |
| 中断与恢复探针 | DO alarm 独立推进真实 Pi，SSE 只观察；保存真实 Session 后 SDK kill / Sandbox 销毁，新实例从已确认上下文恢复，旧代事件与写入拒绝 | T08 三组云场景已签收；本地 SSE fixture，非真实供应商或生产 durable Turn；SIGKILL 是请求意图，具体 OS 信号未独立验证 |
| 发布策略探针 | 真实子进程握手、协议准入、任务版本固定、候选启动失败回退、已确认 checkpoint 恢复、未知副作用不重放 | G0-T10 已按固定探针范围签收；真实混合发布、原生退出取证及双回退恢复均有独立证据，生产发布流程属后续阶段 |
| 镜像与配置 | Pi / Sandbox / Wrangler 锁定；两种基础镜像固定 digest；可信镜像包含 Pi 宿主；独立 Worker 配置；staging 私有 R2 checkpoint bucket 已创建并与三个 `CHECKPOINTS` 绑定一致；Storage 与 fixture 模型代理 Worker/DO 已部署 | Boundary、Preview、Files、Recovery Worker / Container apps 及 Tenancy 已部署；历史 Registry 失败保留，其余云门禁继续 |
| 证据和流程 | 环境 preflight、完整源文件摘要、运行日志、不可覆盖的证据记录、失败阻断汇总及本地发布清单复验 | 清单始终 `canPromote=false`；本地记录只能作辅证，不直接关闭 G0 |

当前生产身份、真实云项目验收、持久回合、Browser 鉴权代理、仿真应用、Run、官方包和付费链路尚未交付。`ui/` 仍是独立示例原型。

## 历史验证记录

以下保留历次执行时的状态与失败记录；其中“最新”“未部署”“待验收”等表述属于当时状态，当前结论以上文与各单项最新签收文档为准。

- [受控 Pi 代理接线](m0-proxy-pi-bridge.md)已完成本地集成：完整 Session 首次/恢复历史、固定单次 capability、同 call 显式取消、响应头前后超时、错误/重定向无重试、跨片段凭据脱敏和原始图片 checkpoint 拒绝。客户端未部署，也未进入此前冻结镜像；云 Pi/真实供应商和完整工具协议仍待接入。
- [首次全检失败](evidence/runs/m0-local-20260905141740796/local-checks.json)发现 `message_start` 也可能携带已经更新的文本片段；修正为所有非终态事件保护累计文本后，强化的拆帧测试与最新全检通过。失败记录保留。

- [模型代理云端检查](evidence/runs/m0-model-proxy-cloud-1788613210899-49e0a3db/model-proxy-cloud.json)：23/23，50 次业务请求、50,210 响应字节、34.347 秒；4 个 run 均撤权且 active=0，真实供应商派发为 0。Worker [部署版本](evidence/runs/m0-model-proxy-staging-1788612744246/deployment-verified.json) `06e097f1-cb6d-4349-8cf5-af4472ba0079`，运行后 API 确认仍 100% 指向该版本，DO 使用 SQLite。该结果只签收 fixture 原语，不关闭 T01/T09。
- [替代镜像](m0-registry-alternative.md) trusted / project 已按当前 8 文件白名单上下文构建成功、冻结 manifest；尚未 push 或启动应用容器。2026-09-06 用户已批准[当前九文件镜像](m0-pi-proxy-image.md)的公开范围；`jihegao` CLI 设备授权已完成，见[环境确认](m0-setup-confirmation.md)。本条前述八文件产物为历史版本。

- 最新本地检查 [m0-local-20260905155634615](evidence/runs/m0-local-20260905155634615/local-checks.json)：192 项通过、1 项 opt-in Python 跳过、2 个自检通过；121 个源文件摘要稳定，源码摘要 `192d973b8caa5019c8fa10c6558ecab26b9d1486d8e0f8af9480f493f7ffba58`。保留原有 13 项真实 Pi → 本地 HTTP → 代理原语测试，并新增 3 项诊断 CLI/超时测试；下述 Workerd 联调保留前轮源码；本轮 staging 入口与镜像检查源码对应当前全检。
- [模型代理 Workerd 集成](evidence/runs/m0-model-proxy-local-1788611379474-ec85ee9b/model-proxy-local.json)：22 项检查通过，44 次业务请求和 2 次独立 cleanup 请求，业务响应 39143 bytes、cleanup 178 bytes；四个 scope 均撤权确认，最后[清理核验](evidence/runs/m0-model-proxy-local-1788611379474-ec85ee9b/cleanup-verification.json)确认 8794 关闭、UI 4173 原进程保持。显式取消和管理撤权均观察服务端流结束、cancelled/unknown 账本、预留保留及 active=0；intent 后实际 ctx.abort 保留 dispatched/未知状态，fixture=0；重启和拒绝重放后实际计数与账本不变。这是后续云部署之前的本地历史证据。
- [断线取消失败记录](evidence/runs/m0-model-proxy-local-1788611138874-d62e1d8d/model-proxy-local.json)显示，启用请求 signal 相关开关后，6 秒观察窗口仍有 1 个 active 请求；不宣称断线传播已修复。显式 `/v1/cancel` 是当前可靠取消契约。受控取消与 ctx.abort 的运行时错误保留在[日志](evidence/runs/m0-model-proxy-local-1788611379474-ec85ee9b/workerd-observed.log)，不能声称无错误日志。
- 最新 [Preview 预算回归](evidence/runs/preview-browser-1788605434924/artifacts/preview-browser.json)：真实本地 Chrome 的 14 个用例通过，对应前轮冻结源码；本轮模型代理/宿主变更未重跑浏览器，不能写成当前整仓浏览器验收；业务观察 199 请求、23868 bytes，约 32.8 秒，独立 cleanup 2 请求、226 bytes、90 ms，浏览器已关闭。仍保留 SDK `Network connection lost` 关闭日志，未归因；本地功能通过不替代 T07 云验证。[清理证据](evidence/runs/preview-regression-20260905104749/helper-cleanup.json)及[最终环境](evidence/runs/preview-regression-20260905104749/after.json)确认本轮 Workerd 与 4 个 helper 已停止，Docker 活动容器为 0、8791 无监听，UI 4173 保持原进程；15 条 SDK 关闭异常保留在[脱敏日志](evidence/runs/preview-regression-20260905104749/workerd-redacted.log)。
- [T02 分离边界](evidence/runs/m0-boundary-20260905083026073/boundary-local.json)：10 个 case 全部通过（6 个输入拒绝、完整 body 正控制、deadline、isolation、tenancy）；`probeSourceStableDuringRun=true`，真实 `SIGUSR1` 计数为 1，trusted canary、Session、两个写目标和 health 均未变化。SDK 的 `foreign_session_write` 与 forged write 返回 200，但只有各自独立 project 文件发生变化，说明能力被限制在 project 范围内，Session 不是安全边界；raw signal 为 `target_not_addressable`，未发送。两个最长 48 字符且尾部为 hyphen 的 run ID 清理均获 ack。
- [T08 三场景](evidence/runs/m0-recovery-20260905070637920/summary.json)全部通过：[SSE 断线](evidence/runs/m0-recovery-20260905070637920/disconnect.json)后 alarm 继续推进并完成；[杀 Pi 进程](evidence/runs/m0-recovery-20260905070637920/process.json)和[销毁 Sandbox](evidence/runs/m0-recovery-20260905070637920/container.json)均在真实 Pi 的固定长流窗口内确认中断。恢复使用新 generation、独立物理 Sandbox 和已提交 Session，新回合读取旧上下文，不重发未完成请求；旧事件被拒绝，按游标补发事件及重复接受请求保持一致。[Workerd 重启](evidence/runs/m0-recovery-20260905070637920/workerd-restart.json)后，三个报告的状态、保存收据与事件仍一致。供应商为本地 fixture，完整项目文件恢复和生产 durable Turn 不在此证据范围。
- [T10 本地发布策略](../spikes/m0-release/README.md)：8 个真实子进程测试在当前完整检查通过，覆盖准入失败零派发、旧任务固定版本、候选失败保留旧选择、摘要校验恢复、实际文件副作用后崩溃不重放，以及启动 / 停止 / checkpoint 竞态。两个 release 为同一固定程序的不同启动参数，云 Worker / 镜像混合发布仍待验证。
- [Storage staging baseline（历史）](evidence/runs/m0-storage-staging-20260905095532532/cloud-baseline.json)：部署观测时间为 `2026-09-05T10:01:39Z`；旧版本的六个外部 HTTP 检查成功、9 项 baseline observations 全为 true，只覆盖部分保存原语。[部署记录](evidence/runs/m0-storage-staging-20260905095532532/deployment.json)与[构建记录](evidence/runs/m0-storage-staging-20260905095532532/baseline-build.json)保留，不能代替当前源码验证。
- [Storage 云 fault 原语](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/storage-cloud.json)：部署验证记录与 artifact 对应于 Worker version `e0d311aa-ab18-4b55-9fd8-0c188376041b`；`checksPassed=true`、`sourceStableDuringProbe=true`，21 requests、74848 bytes。实际上传中断确认 65536 bytes consumed 且对象不存在；提交前/后崩溃均有新实例与指针核对；SSE 断线/游标重放应用一次并去重；GC 删除 3 个 orphan、保留 5 个对象，第二次 sweep 删除 0。[主控 T06 复核](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/primary-review.json)后，[T06 gate summary](evidence/runs/m0-g0-t06-cloud-20260905/G0-T06-gate-summary.json)正式记录 `status=passed`。该签收仅覆盖 T06，不能关闭整个 G0。
- [Storage 旧版本失败记录](evidence/runs/m0-storage-cloud-deploy-20260905102546347)：旧版本首次 fault run 的 `init` 返回 404（8 requests、0 mutations），已由 bodyfix 版本重新验证；保留作历史失败证据。
- [完整文件链路](evidence/runs/m0-files-20260905061426155/artifacts/files-local.json)：20 次真实操作、12 个目录/文件条目、内容摘要和权限核对；经 R2 提交后销毁 Sandbox，新运行时从持久文件恢复，并再次创建、重命名和删除探测文件；旧 generation 被拒绝，共两条保存事件。[重复请求](evidence/runs/m0-files-20260905061426155/artifacts/duplicate-run.json)与 [Workerd 重启](evidence/runs/m0-files-20260905061426155/artifacts/workerd-restart.json)均读取相同报告和版本。这是固定项目及合成 Session 的本地验证，未验证并发恶意写入、真实 Pi 恢复或云 VM。
- [保存适配器复测](evidence/runs/m0-recovery-20260905070637920/storage-metadata.json)：本地 Workerd 九项观测通过，包括元数据故障同时回滚保存收据与事件、同版本重试更新元数据但不重复保存，以及上传/提交故障、丢失响应、真正并发的父版本竞争和旧 generation 拒绝。[前轮七项观测](evidence/runs/m0-storage-20260905062641255/artifacts/storage-local.json)保留。
- [Preview 浏览器链路](evidence/runs/preview-browser-1788597480759/artifacts/preview-browser.json)：14 个 case 全通过，覆盖 alpha/bravo 合成主体、同租户独立 session、复制 URL 拒绝、一次兑换、真实 Chrome 152 HTTPS iframe/独立 origin、JS/HTTP/WS、CDP Cookie/Origin/403/CORS 取证、logout 后 12ms 关闭 WS、实际 19399ms 的 20 秒 TTL、generation 替换、两租户及同租户两实例。该证据仅是 local same-site/different-origin synthetic fixture，不是生产登录、跨站 Cookie 或云验收。[helper 清理](evidence/runs/preview-browser-1788597480759/artifacts/helper-cleanup.json)确认四只 helper 停止且剩余为 0；自身两处流取消 Promise 已补充拒绝处理并通过内存流回归；最终真实浏览器仍记录 15 条 [Network connection lost 日志](evidence/runs/preview-browser-1788597480759/artifacts/worker-stop.log)，尚未归因。锁定 SDK 的异步转发/关闭路径是复查候选，功能通过不等于异常已解决。
- [前轮 Preview HTTP / WS](evidence/runs/preview-live-1788589137844/artifacts/preview-local-smoke.json)保留为历史证据；旧 shared-origin/bearer 结果不代表本轮浏览器身份与 origin 结论。
- [本轮 Boundary push 失败](evidence/runs/m0-boundary-staging-20260905100830706/cloud-after-failed-push.json)：第一次 push 因 registry broken pipe 退出 1；失败后 Worker/DO bindings 已存在但 Containers 为空。[retry 终态](evidence/runs/m0-boundary-staging-20260905100830706/cloud-after-retry-timeout.json)及[最终 reconciliation](evidence/runs/m0-boundary-staging-20260905100830706/push-reconciliation.json)确认单并发认证兼容重试仍因 proxy broken pipe 退出 1；`deploy-retry-1.json` 的错误 `exitCode: 0` 不能当成功。远端 Worker version 为 `61647393-9f5e-4187-98a3-218a4a188116`，Container apps 仍为空；[独立镜像 push 记录](evidence/runs/m0-boundary-staging-20260905100830706/image-push-oauth-trusted.json)保留。不能称 Boundary 云隔离测试已执行或部署成功。
- [Registry 分块推送终态](evidence/runs/m0-registry-chunked-trusted-20260905111316067/result.json)：总耗时 `131184 ms`；`regctl v0.11.5` 官方 SHA 已核验，配置 4 MiB chunk、单并发；首个 30,649,033-byte layer 在 120 秒预算内超时，stderr 为 `failed to send blob (chunk), context canceled`，随后 HEAD 404，manifest 未发布、Container 未部署，未重试同一上传。`payloadBytesSubmitted` 是客户端输入，不是网络实际字节；费用未知，模型请求与云 VM 均为 0。该记录不证明 Registry 已支持 PATCH。
- [本轮五套 dry-run](evidence/runs/m0-validation-20260905084126533/builds.json)全部退出 0，构建期间源码清单一致；[镜像摘要](evidence/runs/m0-validation-20260905084126533/images.json)、[候选清单](evidence/runs/m0-validation-20260905084126533/candidate.json)与[复验结果](evidence/runs/m0-validation-20260905084126533/verification.json)已关联最终检查。候选只是本地完整性清单，`deployed=false`、`canPromote=false`，构建来源未签名认证。前轮构建保留为历史。
- [真实 Pi 请求](evidence/runs/m0-initial/artifacts/pi-live.json)：本机通过已配置的 `opencode-go / deepseek-v4-flash` 发送三次受限请求，两次完成后上下文恢复成功，第三次观察到取消。供应商响应头未返回可用请求 ID。首次脚本尚未采集 SDK `responseId`，其输出中的 `cost: 0` 是未配置价目的占位值，不能视为实际费用；取消请求的用量也不是最终结算凭据。后续代码已修正证据口径并通过本地测试，没有额外重发付费请求。此历史记录不证明最终宿主已通过云端或请求关联验收。
- [本地保存与并发](evidence/runs/m0-initial/artifacts/storage-workerd-concurrent-local.json)：上传中断、提交前失败、提交后响应丢失、真实并行的父版本竞争和旧 generation 拒绝均符合预期；一个竞争请求成功，另一个发生冲突，仅新增一个保存事件。
- [Workerd 进程重启](evidence/runs/m0-initial/artifacts/storage-workerd-restart-local.json)：停止并重新启动本地服务后，报告和保存收据保持一致。不是云容器销毁恢复的替代证据。
- [前轮本地分离探针](evidence/runs/m0-initial/artifacts/boundary-isolation-local.json)保留为历史观测；最新 T02 结论以 `m0-boundary-20260905083026073/boundary-local.json` 为准。
- [两个本地 Sandbox](evidence/runs/m0-initial/artifacts/boundary-tenancy-local.json)：同一路径内容互不覆盖。产品登录、跨租户完整 API 与云 VM 仍待验证。
- [第一次出口观测](evidence/runs/m0-initial/artifacts/boundary-egress-local.json)：可信端限定健康响应成功，其他 HTTP 请求被拒绝或发生传输错误；仅观察到 TCP 连接成功，不能据此判断应用数据已到达外网。[v2 协议复核](evidence/runs/m0-initial/artifacts/boundary-egress-local-v2.json)实际发送固定非秘密 DNS 查询后，通道在 DNS 响应前关闭，收到 0 字节；没有匹配的应用响应。仍不能以本地结果关闭云出口门禁。
- [镜像构建记录](evidence/runs/m0-initial/artifacts/local-images.json)：包含最终本地镜像 ID、架构和 Pi import 检查结果；未推送云注册表。
- [G0 汇总](evidence/runs/m0-g0-20260905/artifacts/summary.json)：十个门禁均无 staging passed，`accepted: false`；记录器以非零状态退出，符合阻断要求。

上述文件保留首次观测，不覆盖旧证据。需要区分单元 fixture、真实供应商、本地 Workerd、本地 Docker 和 staging。本轮五只 recovery 开发代理 helper 已按完整名称和镜像核对后[停止并确认](evidence/runs/m0-recovery-20260905070637920/helper-cleanup.json)；前轮两个 Preview helper 的[清理记录](evidence/runs/m0-build-20260905063357356/helper-cleanup.json)保留。`destroy_acknowledged` 只覆盖 Sandbox，不应推断所有开发 helper 已退出。本轮 M0 服务已停止，保留本地 UI 和 Colima。

## 版本与环境

| 项目 | 锁定 / 实测 |
|---|---|
| Pi SDK / 配套 pi-server | `0.85.0` / `0.85.0`；配套包弥补 SDK 实际导入缺少声明的依赖 |
| Sandbox SDK / Containers 库 | `0.12.9` / 锁文件解析为 `0.3.7` |
| Wrangler / TypeScript | `4.129.0` / `7.0.2` |
| 本机 Node | `25.3.0` |
| Sandbox Linux 镜像 | 可信宿主为 Node `22.23.2`；项目镜像 Python `3.11.14`；均为 `linux/amd64`。可信信号正控制使用 Node 自身信号，不依赖 Python |
| 本地容器宿主 | 独立 Colima `riffology-m0`；2 CPU、4 GiB、20 GiB 稀疏磁盘，不挂载宿主目录，不切换全局 Docker context |
| Cloudflare | 目标账号 `8b0d70250211aa10d89e20605a1c7e5e`；`wrangler whoami` exit 0，OAuth 凭据由加密文件与 macOS Keychain 保存；`riffology-m0-checkpoints-staging` 为私有 APAC/Standard 桶；Storage Worker 新版本已部署并完成 T06 单项签收，Boundary push 终态失败且 Container apps 为空，Preview 无专用域名 |

[历史环境报告](evidence/runs/m0-validation-20260905083304251/preflight.json)中本地检查通过，云检查因 `auth-required` 阻断；[历史连接器检查](evidence/runs/m0-validation-20260905083304251/cloud-connector.json)记录当时的 Workers Paid 与 R2 缺口。当前环境证据显示：[cloud-before](evidence/runs/m0-environment-20260905094527503/cloud-before.json) 的 Containers/R2 GET 均为 200，[bucket-create](evidence/runs/m0-environment-20260905094527503/bucket-create.json) 创建指定桶 exit 0，[bucket-verification](evidence/runs/m0-environment-20260905094527503/bucket-verification.json)确认 APAC/Standard、public development domain disabled、custom domains 为空；[preflight](evidence/runs/m0-environment-20260905094527503/preflight.json) 于 2026-09-05T09:46:34.008Z 记录 4 项本地与 3 项 CLI 云检查全部 passed。Storage 新版本的[部署验证](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/deployment-verified.json)与[云 fault 原语](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/storage-cloud.json)已由[主控 T06 复核](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/primary-review.json)并正式签收；Boundary [最终 reconciliation](evidence/runs/m0-boundary-staging-20260905100830706/push-reconciliation.json)显示 push 失败且 Container apps 为空。上述证据只证明资源配置、局部原语或失败状态，不等于全部 M0 Worker/DO/Containers 已部署或 G0 通过。基础镜像 digest 见 `infra/m0-*.Dockerfile`，本轮产物对应关系见候选清单。

[账号复核](evidence/runs/m0-environment-20260905094527503/account-binding.json)单独确认当前 CLI 授权包含配置指定账号；preflight 中的 `accountId: null` 是该记录器未提取到账号字段，不代表完成了账号一致性校验。

## Pi 代理镜像（本地）

[新镜像与发布范围](m0-pi-proxy-image.md)已冻结：真实 Linux SDK 与两个独立 staging-fixture child 的断网调用/恢复检查通过，六个 COPY 文件与冻结九文件上下文一致，保留 Sandbox 默认入口。trusted 实际重复构建一次的过程偏差、缺失的首次退出码及两种 index 均保留；没有上传、云部署或真实模型调用。当前 trusted 出口与云监督器尚未接通，G0 状态不变。

## Pi 与持久模型代理联调（本地）

[当前诊断收据](evidence/runs/m0-proxy-pi-local-1788622591199-4e3a43ff/proxy-pi-local.json)为 10 项通过、2.380 秒：真实 Pi 在三个独立进程中分别完成首次调用、磁盘 checkpoint 恢复和流式取消。第一轮进程关闭后保存 0600/fsync checkpoint，实际 DO 实例重启后 nonce 改变但账本不变；恢复实例发送完整历史。三个 wire 正文 SHA 与 DO 持久收据、平台请求 ID 一致；前两轮 completed/known，取消轮 cancelled/unknown，合成预留 576 μUSD 保留，金额仍为 null。7 次业务控制请求、13,354 响应字节；2 次清理请求、4,645 字节；子进程另有 3 次模型 fixture 请求及 1 次取消请求。

[协调器](../scripts/m0/proxy-pi-local.mjs)持有 operator secret，每个[Pi 子进程](../scripts/m0/proxy-pi-child.mjs)只接收当前 capability。父进程等实际 close 后回收临时目录，超时/输出异常保留退出事实，清理失败独立记录。初始化与 scope 仍为合成诊断身份；本地进程分离不证明 VM 安全隔离，fixture 不证明真实模型记忆，云 Worker 和旧冻结镜像没有包含新诊断入口。G0 仍为 1/10，T01/T09 未通过。

历史[首次 9 项通过](evidence/runs/m0-proxy-pi-local-1788621797044-105263a8/proxy-pi-local.json)和[服务定时退出后的 0 项失败](evidence/runs/m0-proxy-pi-local-1788622105371-0cc1d1af/proxy-pi-local.json)保留。首次全检在新增 TypeScript 测试导入内部 mjs 时缺少声明而失败：[记录](evidence/runs/m0-local-20260905153200141/local-checks.json)；诊断测试移至现有 mjs 测试目录后通过，该版源码与当时全检一致，本轮入口变更另见最新全检。Workerd 日志仍有受控 restart 和流取消的异常信息；持久终态/撤权/active=0 已分别核验，不能称日志无异常。[主控复核及清理记录](evidence/runs/m0-proxy-pi-local-1788622591199-4e3a43ff/primary-review.json)确认：本轮 Workerd 按预设时限退出，8794 无监听，原 UI 4173/PID 88606 保留；[脱敏日志](evidence/runs/m0-proxy-pi-local-1788622591199-4e3a43ff/workerd-redacted.log)保留诊断异常。

## 本轮复审关闭的问题

主控负责集成与门禁；两个复杂子任务分别实现 Pi 宿主和 Sandbox 探针，低成本 subagent 负责证据、环境工具与说明。主控复审后修复了以下问题：

1. 证据汇总可能让局部通过盖过失败、混合不同版本，现改为失败阻断并复验文件摘要。
2. Pi 在等待凭据时取消，晚返回仍可能发请求，现由回合 AbortController 阻断并验证零请求。
3. SDK 估价为零及取消用量可能被当成费用依据，现显式标记金额未知、用量未对账。
4. 原“并发”测试实际顺序执行，现增加真正并发的内存和 DO 检查。
5. TCP connect 可能被误当成端到端连通，现拆分连接和协议响应证据。
6. Sandbox ID 超过 SDK 的 63 字符限制导致探针未开始；现从服务端协调者标识生成长度固定的 ID，并捕获清理初始化失败，保留首次失败证据。
7. 文件模式 0640 不符合 checkpoint 允许集合；已统一模式契约，以真实文件系统复核内容和权限。
8. 文件清理与新运行可能竞争移除 watchdog；现清理同样占用协调者运行锁。跨 generation 复用相同 Revision 也不能绕过父版本与 generation 校验。
9. WebSocket 101 响应不能沿普通 RPC 返回；Preview 现经 SDK fetch 传输进行握手，并在转发期间复核撤权。
10. 本地发布清单可能接受过期检查、漏源文件或被替换的构建产物；现复验完整源码、必需字段、依赖锁、检查记录和产物摘要，始终禁止据此推广。
11. 保存指针与恢复终态若分两次提交，崩溃后可能出现“最终版本已保存但回合仍中断”；现将保存收据、事件和协调者元数据放入同一 DO 事务，注入元数据失败验证共同回滚。
12. 旧 generation 的延迟销毁可能误杀新恢复实例；现按 generation 分配独立物理 Sandbox，外部调用捕获目标 generation 后再执行。
13. SSE 首次读取可能无限等待，故障注入也可能错过真实流窗口；驱动现限制连接 / 读取时间，并以实际流开始、进程状态、最终文件和停止确认判定窗口，错过即失败。
14. 发布探针的晚启动、晚响应及 checkpoint 提交可能覆盖停止状态；现等待启动收尾、拒绝晚结果复活，并在无异步间隔的授权与指针切换间执行停止约束，真实子进程竞态测试通过。

15. 浏览器 opaque ID 以普通对象键读取时可能命中原型属性；现要求 64 位十六进制标识并做 own-property 检查。
16. 登出之前发起的授权 RPC 可能晚到；现先持久化 sid 撤权围栏，HTTP 返回、WS 注册和发送前同步重验。旧 alarm 只处理已到期的 active 状态。
17. 借所有者浏览器导航可能提前消耗复制的 ticket；现仅在正确 nonce 的最终兑换事务中消费 ticket/code/challenge。
18. HTTP 请求上传未结束时，本地代理延后交付 Worker 拒绝；探针增加完整 body 正控制，并完成延迟上传后检查 `invalid_body`，不声称提前收到响应。
19. 默认健康检查路径和可信镜像实际依赖不匹配；改用明确 `/health`，可信服务通过固定 nonce 入口只向自身发送 SIGUSR1，再独立回读计数。项目侧缺少 pidfd 或身份不匹配仍拒绝发送。
20. SDK 写入返回 200 不能说明跨容器成功或失败；两种写入使用独立目标，Worker 分别核对项目 marker 与可信原内容。
21. CORS 拒绝时 Playwright 未交付普通 response 事件；现在用 Chrome CDP 对同一 iframe 请求关联 Cookie、Origin、网络 403 和 CORS 失败。
22. 两条拒绝路径的流取消 Promise 会产生未处理拒绝；已补 catch 并验证原 400/502 状态不变。SDK 内部关闭日志未因此标记解决。

失败记录保留：[请求上传等待](evidence/runs/m0-boundary-20260905075738294/boundary-local.json)、[健康路径](evidence/runs/m0-boundary-20260905080501982/boundary-local.json)、[可信镜像缺少 Python](evidence/runs/m0-boundary-20260905081020250/boundary-local.json)、[SDK 写状态假设](evidence/runs/m0-boundary-20260905082511433/boundary-local.json)、[普通浏览器响应事件超时](evidence/runs/preview-browser-1788596255014/artifacts/preview-browser.json)。这些记录未覆盖或改写；成功记录来自修正后的独立运行。

## 历史未通过清单（已被本页顶部最新签收替代）

| 门禁 | 现状和必须补齐的工作 |
|---|---|
| T01 / T03 | 代理原语、最终 payload hook 和离线 SDK 检查已实现；仍需将受控 Pi 镜像接入云端限定模型代理；验证真实流式事件、请求关联、取消、恶意资源首次启动和恢复；模型 wire 与预算缺口见 [前置记录](m0-model-proxy-budget.md) |
| T02 / T04 | T02 本地 10 case 已通过；云上分离信任域已有局部观测；仍需解决慢上传负向失败，并补控制 RPC/失效 capability 和跨对象入口矩阵。T02 的成功写入仅限 project，不能描述为两次写入被拒绝 |
| T05 | 本地完整 20 次 CRUD、保存、销毁重建与恢复后写入已通过；在云 R2 / Sandbox 重做，补真实 Pi Session 和故障窗口 |
| T06 | Storage 云 fault 原语已单项签收 `status=passed`；实际上传中断、提交前/后崩溃、SSE 游标重放去重、GC 3 删 5 留均有证据；总汇仍仅 1/10 staging passed，不能扩展为整个 G0 |
| T07 | [staging 技术门禁已签收](evidence/runs/m0-g0-t07-cloud-20260906/G0-T07-gate-summary.json)：当前同站点不同 origin、受控测试身份的完整入口、HTTP/JS/API/WS、Cookie 网络正反控制、CSRF、撤权、过期及 generation 替换均通过；SDK 无公开端口。M1 正式登录后重验生产链路，跨站第三方 Cookie 支持另行验收 |
| T08 | [三组云恢复原语已签收](m0-recovery-cloud-validation.md)：浏览器关闭后继续、SDK kill Pi / 容器销毁后新实例恢复、旧代事件和写入拒绝；真实 Pi + 本地 SSE fixture，生产 Turn / Run 另属后续阶段 |
| T09 | 原子预留、DO 账本与合成身份已通过本地及 staging fixture 集成；仍需云出站、DNS、真实身份/供应商接入和依赖白名单；不根据本地 HTTP 拒绝宣称所有网络均隔绝 |
| T10 | 本地候选完整性及 8 项子进程发布策略测试通过；仍需两个真实镜像、新旧 Worker 混合窗口、云启动失败、实际 rollout 和回退验证 |

本轮 T02/T07 的本地补验已完成，环境认证、Workers Paid/Containers 资格和 R2 bucket 配置前置已完成；Storage T06 云 fault 原语已单项签收，Boundary 单并发认证兼容 push 与后续 regctl 分块上传均失败且 Container apps 为空，Preview 尚无域名、T07 云 runner 未执行。本次云验证模型调用与云 VM 启动均为 0，Registry 客户端输入字节不等于网络实际字节，费用未知；历史本地供应商调用另有独立记录。预算仍为 US$5（LLM 最多 US$1，不含 Workers 月租）。总汇为 1/10 staging passed、`accepted=false`、exit 2；下一步按上表完成其余门禁，G0 仍未通过，暂不进入 M1。

参见[职责 ADR](adr/0001-pi-project-trust-boundary.md)、[M0 运行手册](m0-local-runbook.md)及[开发部署计划](development-deployment-plan.md)。

引用确认补充：Dispatcher 现在严格验证 retain 回执的 artifactId、kind、referenceId 和 active 状态；错误或已释放回执不得写入事件日志，失败工具也不得携带 Artifact。新增故障注入验证 retain 成功但 journal append 失败后，只观察原 Runtime 并幂等登记同一事件。该补充已通过 TypeScript 和 Dispatcher / 真实 Workerd 定向 26 项测试，尚未重跑整仓检查；此前 304 项证据对应此前冻结源码。

事件引用释放：`artifactEventReleaseEligibility` 只读核对完整 Workspace scope、原 Turn 与 dispatch；活动回合和仍在日志中的事件保持引用。`releaseRetiredArtifactEvent` 在满足前置条件后调用唯一 ArtifactStore，并严格核对已释放回执；丢响应可重试同一引用。未知 Turn 和错误 dispatch 失败关闭。该接口不删除对象，Tool Ledger 和已保存 Pi Session 中的 Artifact 收据仍需独立保留策略。

最新事件释放切片验证：TypeScript 通过，M2 全量 311/311 通过，检查期间源码摘要一致。[不可覆盖回归记录](evidence/runs/m2-event-retirement-1788781004034/result.json)及日志仅证明本地结果；未部署，新增模型调用为 0。

事件释放的真实 Workerd 验证已完成：生产 WorkspaceAgent 在事件保留时拒绝释放，压缩后只释放对应 turn_event；跨租户请求拒绝，tool_effect 保持 active，Artifact 原字节继续可读。Workerd 完整停止并重建后，同一释放请求返回原回执，读取仍一致。[本地持久化验证记录](evidence/runs/m2-event-retirement-workerd-1788781122274/result.json)包含 5/5 定向测试，源码在检查期间稳定；TypeScript 与 diff 检查通过。该验证使用真实 DO/SQLite/R2 和显式 Runtime fixture，不代表云 Sandbox 或真实模型验收。

自动事件引用维护候选：ArtifactStore 使用自身独立 alarm，不改写 Workspace 的 provisioning / Turn 共享唤醒。登记新事件引用前预置唤醒；已有活跃引用在 Store 再次激活时补唤醒（从不再访问的旧实例仍需运维启动）。每轮固定 rowid 上界，持久保存游标，每次最多 50 条；轮末归零，1 小时后重查。每次扫描前先预置 1 分钟重试，满页在 1 秒后续扫。向派生 WorkspaceAgent 查询终态及日志缺失证明时不持有 Store 串行锁，避免跨 DO 回调死锁。不可访问或非 ready Workspace 保守保留，并在下一轮重查；此类引用不阻塞其他 Workspace。该候选仅释放 turn_event，不释放 tool_effect，也不删除 R2 对象。

自动调度验收：TypeScript 和 M2 315/315 通过，[冻结回归证据](evidence/runs/m2-retirement-scheduler-1788781388088/result.json)记录检查期间源码一致。真实 Workerd 验证由 Store alarm 释放已退出 journal 的事件引用，随后手动重放返回原回执；对象仍可读且重启后一致。只读子 agent 审查未发现本切片阻断问题。该轮尚未覆盖的维护鉴权与 highwater 恢复已由下述补充验证完成；完整 GC 生命周期仍未完成。

维护鉴权修正：WorkspaceAgent 的引用维护接口现按持久化 WorkspaceTask、tenant/project/workspace/generation 和派生 actor 验证身份，不再要求 projection ready；journal 仍要求原 Turn 已终止且事件和幂等回执已退出窗口。用户读取接口继续要求 ready。真实 Workerd 注入 projectionConfirmed=false 后，用户 Artifact 读取被拒绝而 Store alarm 仍能释放旧事件引用；恢复 ready 后原字节继续可读。TypeScript、5 项定向测试和 diff 检查通过。测试验证非 ready 状态下的维护行为，不代表真实云停止流程验收。此前“非 ready 会永久 deferred”的限制已由此修正；缺失状态或身份不符仍保守保留。

扫描恢复补充：真实 ArtifactStore SQLite/R2 测试创建 51 条事件引用，第一页 50 条全部 retained，保留原游标及扫描上界后再插入第 52 条并完整重启 Workerd。下一页只释放原上界内第 51 条，新引用在下一轮才被处理；未释放引用与 tool_effect 仍 active，R2 保持一个对象。[最新冻结证据](evidence/runs/m2-retirement-recovery-1788781623486/result.json)记录 TypeScript 通过、M2 316/316、检查期间源码一致。未部署，新增模型调用为 0。

整仓复核：[完整检查](evidence/runs/m0-local-20260907114833277/local-checks.json)通过 M0 349 pass / 1 skip、M1 146 pass、M2 316 pass，源码在检查期间一致。随后只读退出审查定位 Project 工具停止 / Checkpoint 静止证明为当前优先工作包：Pi 停止不代表远端工具停止，现有取消验收不足。已先修复 Bash 正常退出时遗留原进程组后台任务的问题，并新增延迟写入回归；这不代表逃离原进程组的进程或产品级取消已被覆盖。后续代码变化不包含在上述整仓源码摘要中。

### 2026-09-07 Project 进程静止候选与 M0 并发修复

Project freeze 已接入 SQLite 准入 fence、root spawn/seal 互斥和 UID 10001 进程清理；平台 archive 共享锁并拒绝迟到 restore。静止证明不改写工具 unknown 结果。真实本地 Docker 的 9 项检查与源码稳定性记录见 [证据](evidence/runs/m2-project-quiescence-1788782799943/result.json)。M2 独立测试 324 项通过；当前证据使用缓存镜像挂载源码，不是新发布镜像或云验收。

首次完整检查 [失败记录](evidence/runs/m0-local-20260907120601634/local-checks.json)定位到 M0 release-probe 的既有竞态：意图持久化后提交结果再次申请锁，可能输给重复请求的只读检查而遗留 running。修复仅允许原执行者在结果提交阶段有界等待 1 秒，重新核对 pid/digest，不重发 effect、不接管陈旧锁；真实进程回归 12 项通过。完整检查需以修复后的新记录为准。

修复后的[完整检查](evidence/runs/m0-local-20260907121022570/local-checks.json)通过且执行期间源码稳定：M0 350 pass / 1 skip，M1 146 pass，M2 324 pass。历史云 completion 验证仍默认固定原发布源码摘要，本地 fixture 显式以当前源码独立摘要验证，包含错误摘要拒绝回归。两份失败记录保留；本轮未部署、未调用模型、未提交或推送。下一步仍为真实产品链的启动/停止竞态与故障恢复验收。

### 2026-09-07 启停竞态、丢响应与 SDK 产品链恢复

[Docker 故障证据](evidence/runs/m2-quiescence-recovery-1788783405917/result.json)覆盖已预留命令与 seal 竞争、归档摘要稳定，以及生产 SQLite supervisor/native 的开始响应丢失、停止证明丢失和重开数据库：effectStarts=1，sealStarts=2，原 effect 保留 unknown。该传输为 Docker SDK-shaped adapter。额外增加全新容器缺少恢复标记时拒绝 freeze，防止默默保存空目录。

[真实 Workerd + SDK 验证](evidence/runs/m2-product-turn-provider-disabled-20260907121618357/primary-review.json)使用新构建镜像通过 provider-disabled 回合保存、容器销毁后恢复、损坏基线拒绝和 Workerd 重启恢复。模型预算 attempts/dispatchedCalls 均为0。它不证明真实模型续接，也不等于 SDK 运行中工具取消故障注入。首次使用默认2GiB Docker 环境时预检失败，改用已运行的4GiB `riffology-m0` 专用环境后通过；未重启其他环境、未部署云端。

### 2026-09-07 20 次真实文件变更与恢复验收

[完整产品链](evidence/runs/m2-product-turn-crud-fixture-20260907131241876/primary-review.json)已通过：测试专用确定性模型响应驱动真实 Pi，经 Tool Bridge、SQLite Ledger、capability、Sandbox 完成 mkdir 前置以及20次文件变更（创建8、编辑4、重命名4、删除4）。R2归档逐字比对最终4个文件，Files列出相同结果；首回合净Diff为新增目录1+文件4，回合内创建再删除不误算为基线删除。销毁两种Sandbox后，新回合真实读取4个文件、归档哈希一致、Diff为空；Workerd重启恢复同一收据。模型调用与预算尝试均为0；这不是自然模型推理能力验收。

真实链路修复了两处问题：Bridge首次得到running后需在截止时间内观察同一effect直到终态；默认工具deadline留出5秒时钟余量，服务端120秒上限不变。执行不重发，传输异常保留unknown。[完整本地检查](evidence/runs/m0-local-20260907131307395/local-checks.json)通过且源码稳定，M0 350 pass/1 skip、M1 146 pass、M2 326 pass。失败诊断记录保留。

**下一优先缺口：初始内容衔接。** M1的README/官方模型虽已初始化和保存，但首个M2 Turn的workspace base为null，恢复空归档，尚未承接M1内容。应建立独立初始base收据并验证checkpoint与模型包，供首回合恢复及Files/Diff共同使用；不得伪造已完成Turn，也不得复制旧控制目录。原M1对象未被删除。当前验收明确使用空M2基线并通过真实Bash建立model目录，不能据此签收官方模型首次进入Agent。未部署云端、未提交或推送。
