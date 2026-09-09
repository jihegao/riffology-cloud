# M3 Service Run 运行契约

本文记录当前私有 service Run journal 的边界。它是生命周期登记与对账日志，不是生产调度器，也不证明操作系统进程已经存在或已经退出。

## 持久化与幂等

创建 Run 时，journal 持久保存固定的 `plan`（已解析的 Revision、声明及入口/锁文件摘要）和固定 `runtimeImage`、时限、发起 actor 与请求幂等键。相同 actor 与请求键重放时返回原记录；输入变化则拒绝。

`begin` 使用一次性 start fence：它把完整 runtime 引用（`runId`、`runtimeId`、`dispatchId`、`leaseId`、generation、deadline）写入 journal，再返回 `{ dispatch: true }`。同一 Run 重放同一 begin 不会重新授权 dispatch，返回 `dispatch: false`；不同引用会冲突失败。`dispatch: true` 只表示 journal 已提交一次派发许可，不是进程启动、健康或退出的证据。

## 健康、未知与停止

runtime 只能以已登记且完全匹配的引用报告健康。健康报告把 `starting`/`unknown` 变为 `running`；已请求停止、过期、终态或不在允许状态时，health fence 拒绝报告。

无法确认 runtime 状态时应报告 `unknown`（已有停止请求则为 `stopping`），并继续观察同一 runtime。丢失 begin 的 ack 后，可以用同一引用重放确认记录，但不会再次获得 dispatch 许可；必须观察同一 runtime，不能另建第二个实例。未知停止不释放租约或配额；已经登记启动后，只有带有匹配 runtime 引用、有效确认时间和固定 `confirmationId` 的停止 proof，才能把状态落为 `stopped` 或 `failed`。停止 proof 的 `observedAt` 必须不早于 `startedAt` 且不晚于当前时间；重复提交相同 proof 幂等，内容不同则冲突。

`startedAt` 是 journal 接受 begin 时写入的持久时间，表示启动尝试进入 `starting` 的时间，不等同于 OS 进程真正启动时间。runtime 协调器必须为可能延迟的 start 保持不可逆停止 fence：一旦收到停止请求，不得让延迟到达的 start/health 把 Run 重新变为运行中；应先完成停止对账，再按 proof 释放资源。

## 当前实现边界

当前已实现私有协调器与 runtime supervisor，并以实际 SQLite journal/Quota 加原生端口 fixture 验证对账；持久 alarm 已在私有 ServiceRun DO 与真实 Workerd 验证，尚未接入生产 Workspace 权威状态与生产 bindings；独立原生适配器已在本地 Docker 启动并停止实际 Python 服务。journal 自身不授予租约、不分配配额、不执行镜像、不启动进程、不做健康探测，也不证明进程停止。M3.2–M3.3 的生产接线、真实容器启动/健康/停止与资源释放仍需独立验收。

定向契约测试：

```sh
node --test tests/m3/service-run.test.ts tests/m3/service-run-workerd.test.mjs
```

本文件与上述测试均不包含部署或模型调用。

## 协调器与运行监督

`ServiceRunCoordinator` 先固定租约请求编号、runtime ID 和绝对截止时间，再按同一 operation 查询或申请共享配额。配额拒绝在原生启动前终结 Run；申请确认丢失后查询同一操作。启动顺序为 journal 一次性许可、Quota dispatch、持久启动标记、runtime start。任一步确认丢失都不产生新的 runtime ID 或再次派发；后续观察原实例，必要时到期停止。

外部调用有界等待，但等待超时不等于外部操作结束；宿主必须通过 `hold` 保持原始调用存活，并安排下一次 reconcile。`requestStop` 先写停止请求，再调用 runtime 的不可逆停止操作。只有范围、租约、fence 与时间均有效的证明才能保存并请求 Quota 释放；证明时间不得早于 journal 启动时间和租约获取时间。过早或不匹配的回执不会永久缓存，后续可以重试取得有效证明。

`SqlServiceRuntimeSupervisor` 固定完整输入、永久保存启动尝试与停止标记。停止不排队等待可能挂起的 start；它在调用原生 `fenceAndStop` 前先持久化停止标记。重复 start 只观察；`absent` 不能生成停止证明。声明的截止时间届满后，协调器停止服务并记录 `service-deadline`，不把超时当成普通成功停止。

原生适配器还必须实现独立、持久的停止约束，拒绝停止后到达的延迟启动，并验证全部子进程停止。JavaScript journal、接口命名或 fake backend 的返回值都不能证明该原生保证。后续需要实际容器、固定版本文件恢复、受限依赖、健康探测和父子进程停止验收。

新增定向测试：

```sh
node --test tests/m3/service-coordinator.test.ts tests/m3/service-runtime-supervisor.test.ts
```

协调器测试使用实际落盘 SQLite、真实 `SqlTenantQuota` 与 journal；runtime 侧使用 supervisor 和可控原生端口 fixture。它覆盖时序与存储边界，不是 OS、生产跨 DO 路由、云隔离或真实 Preview 证据。

## 原生服务适配器

`SandboxServiceNativeBackend` 重新校验固定 Revision 与三份输入文件摘要，要求请求镜像与平台选择的镜像一致，并把归档按至多 256 KiB 分块传输。原生上传程序验证偏移、长度及重复块内容，部分写入可重放补齐；`service_process.py` 在执行前再次校验整包及文件摘要。命令只包含平台固定程序、动作、身份摘要 token 和分块偏移生成的私有路径，项目路径或数据不拼入 Shell。

项目依赖锁在该运行镜像中采用 JSON：`{"schemaVersion":1,"packages":{}}`，或 packages 为 `{"simpy":"4.1.1"}`。镜像构建时安装固定 SimPy，启动时核对实际版本；运行时不联网安装。其他依赖需后续受控镜像策略，不能解释为已支持通用 requirements 文本。

容器内控制程序由 root 持有，输入文件恢复后改为 root 所有且只读。Python 应用运行于 UID 10001、清空补充组及环境，启用 `NoNewPrivs`，限制 CPU、地址空间、文件大小、进程数和打开文件数。`/run-output` 可写；stdout/stderr 每文件受 1 MiB 限制，尚无总输出字节配额或 Artifact 发布。健康探测仅访问容器本机固定端口和声明路径，不跟随重定向。

停止使用共享 spawn lock 与永久 seal，按整个项目 UID 进程域清除派生进程。停止前即使尚未上传输入，也先固定 token 和停止状态，迟到启动不可执行。原生 wrapper 在观察到截止时间时停止服务；无访问时仍须平台持久 alarm 主动停止，不能仅靠请求触发清理。

本地原生验证命令：

```sh
node scripts/m3/check-native-service-local.ts
```

脚本使用独立、禁用网络的 Docker 容器，按镜像 ID 运行，测试结束清除本次容器。它实际调用原生适配器和 root wrapper，覆盖 HTTP、只读输入、控制目录与环境隔离、重复启动、派生进程停止、停止前置和分块传输恢复。分块恢复是直接适配器重放验证；当前 supervisor 在启动确认丢失后仍只观察，不据此宣称产品自动重试已接通。Cloudflare Sandbox 真实传输、云出口策略、Preview HTTPS 和生产完整链路需另行验收。

## 持久 Run 宿主与闹钟

`ServiceRunHost`/`ServiceRun` 按 scope 与 Run ID 派生私有 actor 名称。accept 在写入前验证 actor 地址，并将完整不可变任务和首次 alarm 放入同一存储事务；之后即使 journal 创建失败，alarm 也能按固定 Run ID 补齐记录。相同任务重放不换 Run，修改 actor、请求键、版本或镜像会拒绝。`M3_SERVICE_ENABLED` 默认关闭，仅控制新接受；已有 Run 的停止和清理不应被新建门禁阻断。

alarm 在读取任务、协调和外部调用前先预置重试；并发 alarm 复用同一进行中的任务。stop 只预置唤醒并保存停止意图，不等待外部 start。调度不推迟已存在的更早唤醒；正常运行按截止时间安排下一次观察，到期进入停止对账。宿主通过 `ctx.waitUntil` 保持本地等待超时后的 RPC。

Run 终态不等于清理完成。只有配额已释放、申请明确拒绝、从未开始协调，或截止时间后成功查询确认未取得租约并保存 `acquisitionClosed`，才允许清除 alarm。查询失败不能变成不存在证明。已保存停止回执但释放确认丢失时，alarm 继续复用同一回执对账。

真实 Workerd 的 RPC 返回对象附带 `Symbol.dispose`。Runtime RPC 适配层只移除这一已知传输字段并释放结果，再调用封闭 schema 校验；不会放宽核心协议的额外字段限制。

当前已有独立 ServiceRun DO 类和 Runtime namespace 路由契约，尚未配置生产 bindings，Workspace/Gateway 路由和产品 API 也尚未完成。下节 Runtime DO 已有本地接线验证。Workerd 验收使用真实 Run/Quota DO、存储与自动 alarm，Runtime 为测试替身。它证明无浏览器驱动的调度恢复，不证明实际云容器生命周期。若崩溃发生在 journal begin 后、Quota dispatch 前，现有策略仍只观察并可能等待到期清理，不声称所有中断都可无损继续启动。

## 私有 Runtime DO 与 SDK 传输边界

`ServiceRuntime` 按完整不可变运行输入派生 actor 地址；启动前核对自己的地址、平台镜像配置、开启门禁及 TenantQuota 中完全匹配且有效的 dispatched 租约。拒绝在 Sandbox 操作之前发生。观察和停止不依赖新建门禁或当前镜像配置，以保留已有运行的清理通道。每个输入派生独立 Sandbox 名称，supervisor 保存启动尝试和永久停止回执。

源文件通过私有 `RevisionStore.serviceFiles` 获取，返回经 scope、manifest 和摘要验证的 Workspace 归档。不能复用 `load`：后者返回 Pi Session。真实 Workerd 测试验证上传内容哈希等于保存收据，且未包含 Pi Session；单独 RevisionStore 测试覆盖会话 blob 缺失时仍能读取服务文件。

锁定的 SDK 0.12.9 中 `BaseExecOptions` 没有 stdin，实际 `buildExecutionRequestOptions` 也不转发此字段。因此采用 `writeFile` 写入 `/var/lib/riffology/archives/<token>.<offset>.chunk.json`，再执行固定上传程序并从该路径重定向读取。该目录由 root 独占，数据与命令分离；不同块使用不同路径，避免迟到读取命中下一块。写文件确认丢失不继续派发上传或启动。`ServiceSandboxApi` 不再声明 stdin，Docker 验收也不通过 exec stdin 提供上传数据。

`ServiceSandbox` 单独导出，继承锁定 SDK，禁止互联网及出口，平台环境为空；它以 TypeScript 接口检查实际 SDK 的文件和命令方法兼容性。实际容器镜像必须在部署配置和预检中对应 `M3_SERVICE_IMAGE` 的 digest，仅传入字符串不构成运行镜像证明。

Workerd 测试采用真实 Runtime、RevisionStore、TenantQuota 和持久存储，Sandbox 是 RPC 替身；Docker 测试采用真实 root wrapper 和项目进程。两类证据分别成立，尚未形成 Workerd→实际 Sandbox SDK→容器的完整纵向验证。最大归档的 Worker 内存、输出总配额、生产 bindings、用户 API 和 Preview 网关继续作为后续验收项。


## 控制端口隔离发布门禁

本地缓存镜像的 [实测漏洞](evidence/runs/m3-sdk-loopback-discovery-202609071528/discovery.json) 表明：仅以 UID 10001 运行、禁止容器外网和保护控制目录仍不足以隔离项目。项目可主动连接容器内 root Sandbox daemon 的 `127.0.0.1:3000/api/execute`，执行 `id -u` 得到 `0`。因此此前进程 UID 与只读文件测试不能被引用为完整权限隔离证明。

修复候选在 Service 和 Project effect 两类 child 中设置 NoNewPrivs，并加载 seccomp 规则拒绝 `connect` 及三个 `io_uring_*` 调用。连接限制覆盖 IPv4、IPv6、Unix socket，随 fork/exec 继承；监听、accept 和已接受连接的 HTTP 响应应保留。库缺失或加载失败必须拒绝启动。父进程不得把已连接 socket 传入项目 child；UDP sendto 仍依赖独立容器出口策略。这不是通用 syscall 沙箱或完整云隔离验收。

Mac ARM 虚拟机运行 x86 镜像时内核规则可能无法加载，不能以跳过规则解决兼容问题。需要分别保存原生 Linux 内核验证、实际 Sandbox API 提权拒绝、正常服务功能和环境兼容性证据。失败环境不得开放项目执行；M2/M3 发布门禁保持关闭。


## 初始模型与已保存回合的统一来源

`ResolvedPreviewPlan.source` 现为封闭联合：`saved-turn` 携带已提交 identity/revision；`initial-workspace` 携带平台确认的 InitialWorkspaceReference 和归档 filesSha256。初始模型不携带虚构 session、turn 或 checkpoint receipt。两个分支共享声明、入口和锁文件摘要，Run/Runtime 的 scope 与文件摘要均通过统一 helper 从 source 派生。

RevisionStore 的 `previewPlan(source)` 与 `serviceFiles(source)` 统一处理两种来源。初始模型先验证已确认初始化检查点、模型包和文件字节，再产生计划；Native 再读取同一来源并复核摘要。`initialPreviewPlan(reference, expectedScope)` 供平台首次确定归档摘要，不能从客户端选择初始来源。项目容器仍只接收归档和执行必要摘要，不接收 Pi Session 或平台引用。

Workspace 私有 `previewPlan({scope})` 从自身已确认状态选择权威来源：存在已提交 head 时读取该回合，否则解析初始空间。返回前再次检查 Workspace 可用性。同步 `workspaceRevisionSnapshot` 用于在存储事务内冻结意图；返回对象与日志分离，活动回合未保存的工作不会成为 head。`previewPlan` 本身只读取计划；持久提交由下面的 `submitService` 独立执行。


## Workspace 持久提交意图与第三逻辑闹钟

`SqlServiceIntentJournal` 是 Workspace 的持久请求记录，不重复实现 ServiceRun 的租约和进程状态机。首次创建在同步 SQL 事务中调用权威来源读取函数，固定 runId、主体、请求键、平台镜像/时限和来源；同一用户与键重放只返回原记录，不重新读 head。来源读取或写入失败回滚同事务副作用，持久化确认丢失仍可查回同一请求。

初始来源候选只冻结确认的引用，解析后才加入真实文件摘要；保存来源直接冻结真实回合身份与收据。`resolve` 固定完整不可变 ServiceRunTask，改写来源、actor、runId、时限或摘要均拒绝。开始外部交付前先保存 `delivery-unknown`；未知结果只能复用同任务，不能按未发生处理。`deliveryDeadlineAt` 是固定的请求投递截止，不等同于 ServiceRun 自己的运行截止。

停止在首次交付 claim 前取消请求并禁止迟到解析复活；claim 后保存停止意图并继续对账。`delivered` 仅表示任务已交给 Host，`stopForwarded` 仅表示停止意图已交给 Host，都不表示进程已经运行或退出。完成后的迟到重试或重复停止不复活空轮询。到期任务查询在 SQL 中过滤/排序/限量，下一次唤醒由 SQL MIN 取得，不把全部历史任务加载到内存。

Workspace 的单个物理 alarm 现在投影三个逻辑截止：初始化、Turn、service 投递。任何域更新、清除或重建都在同一存储事务中读取其它域并保留最早时间。真实 Workerd 已验证重启和交错清理，定向故障测试验证 alarm 写入失败的回滚。

`WorkspaceServiceHost` 现把 journal SQL 修改、SERVICE_WAKE_KEY 和三域物理 alarm 投影放入同一个异步存储事务；来源读取仍在事务内同步执行，无远程 RPC。提交后崩溃由持久 alarm 恢复，router 在原有初始化/Turn 分支提前返回或失败时仍访问 service 分支。缺失 Workspace 状态时保留未来唤醒；存在合法 scope 但暂未 ready 时仍处理停止，来源解析与正常 accept 各自拒绝未就绪启动。

Workspace 新增私有 `submitService({scope,actor,key,request})`、`stopService({scope,runId})` 和 `serviceSnapshot({scope,runId})`。新建要求 M3 门禁和配置镜像一致；镜像检查位于首次冻结回调，旧请求携带原冻结镜像重放不受配置升级影响。停止与查询使用 maintenance scope，允许门禁关闭或 Workspace 非 ready，但仍拒绝跨 scope。`serviceSnapshot` 只提供意图记录；后续公开 Gateway 使用下面的独立提交及详情接口。


## 交付恢复与首次接收停止意图

`ServiceIntentDelivery` 读取到期持久意图，解析冻结来源并保存不可变任务，先 claim 交付再调用现有 ServiceRun。RPC 超时保留未知状态，同一任务继续对账；迟到响应不会自动把请求改成已交付，已脱离等待的 RPC 返回值会释放。仅匹配 task 身份和配置的 Host 回执才能确认交付，匹配停止意图或终态的回执才能确认停止转交。

如果交付未知时用户要求停止，恢复调用 `ServiceRun.acceptStopped(task)`。该入口将任务、永久 STOP 与首次 alarm 原子保存，然后补建 journal 并应用停止。初次交付尚未发生时，不经过先 accept 后 stop 的短暂启动窗口。普通 accept 的迟到重放不能清除 STOP；已有运行则继续由同一协调器停止和释放配额。关闭新建 gate 不阻止该清理入口。stop 也持久保存 STOP，journal 写入失败后可重启恢复。

解析期间取消的请求不交付；普通 accept 进行中到达的取消会在回执后继续转交 stop。交付循环合并本实例内的并发 advance，外部调用有等待上限且由宿主持有剩余 Promise；它不执行租约、进程健康或资源回收判断。Host 返回 queued 只确认交付，不投影为 running。

交付引擎通过真实 SQLite 加端口替身验证，acceptStopped 通过真实 Workerd/Quota 与 Runtime 替身验证。新增 Workspace Workerd 集成采用生产 Workspace/ServiceRun/Quota/RevisionStore 和真实 R2：测试准备已确认 Workspace 与保存回合，通过实际共享 alarm 完成交付及重启恢复；故意破坏同域 Turn wake 验证首次提交 SQL、service wake 和物理 alarm 共同回滚。测试也覆盖已保存来源冻结、私有镜像变更重放，以及门禁关闭且非 ready 时的停止。Runtime 仍为替身，测试准备不证明 M1 初始化或初始模型提交已走完同一纵向路径；公开 HTTP 到实际容器及 UI 的整体验收仍未完成。

## 用户 API 与运行视图

Gateway 已接创建、列表、详情与停止 API，路径和请求形状见 [执行计划](m3-execution-plan.md)。每次服务器身份和 Catalog 授权后才调用 Workspace；维护入口允许非 ready 状态，仍要求有效成员、用户认证版本、租户和项目关联、project/workspace generation 一致。跨 scope 拒绝，mutation 继续执行 Origin、媒体类型和严格 body 校验。

`submitServiceRequest({scope,actor,key,body:{maxDurationMs}})` 用 journal `createFromPolicy` 将用户输入与平台镜像策略分开，同键镜像升级复用原请求；旧私有严格入口保持原语义且共享相同唯一键。`listServices` 使用 SQL 索引和创建时间/runId 游标，默认 20、最大 50 条，不读取全部历史，也不逐项探测远端 Run。

`serviceView` 根据意图保存的 task 定位 Run，未开始交付时只返回意图。已 claim 后查询真实 Run journal，回执必须匹配 id/scope/actor/spec，时间顺序及 runtime/status 组合必须一致。读取最多等待 5 秒；超时和错误不报告停止，迟到回执释放。此查询返回持久 Run 状态而非额外 HTTP 健康探测，UI 应使用更新时间展示状态的新旧。

对外投影只包含 runId、kind、deliveryStatus、runStatus、createdAt、updatedAt、stopRequestedAt、errorCode。创建、停止和列表不查询 Run，runStatus 为 null；详情才可提供实际 Run 状态。平台配置、凭据、来源对象引用、租约和内部确认字段不暴露，未知错误统一脱敏。创建和停止返回 202；幂等冲突 409，不存在/无权访问 404，内部暂不可用 503。

Gateway 测试使用真实 Catalog/Admission、请求处理器和生产 Service 客户端，Workspace 是 RPC 替身；Workerd 测试独立验证真实 Workspace 的策略提交重放、列表和运行详情，Runtime 是替身。两者不代替完整登录→Gateway→实际容器→浏览器的纵向验收。Gateway 入口接线不启用 M3 生产门禁，也不自动创建生产 bindings。

## 用户端服务面板

生产静态工作台 `services/web` 已接 service API，独立模块 `services.js` 提供列表、分页、时限选择、启动、详情和停止。列表的运行状态为空时显示待查询；选择记录后才读取 Run 详情，显示最近确认时间。读取错误明确表示当前状态未知，并标记上次确认时间为旧状态，不把旧终态继续当作当前结论。尚不提供 Preview URL、嵌入页面、观察或日志。

启动前将原请求键与时限写入按 tenant/workspace 隔离的 sessionStorage；网络失败、超时或页面刷新后的重试复用同一请求，不生成第二次启动。存储不可用时不发起首个提交。接口等待默认上限 15 秒；中止网络等待不等于取消服务，未知提交保留幂等意图。停止请求提交后仍需读取运行端确认，关闭页面不自动停止服务。

选中非终态详情每 3 秒读取；隐藏页面暂停读取，重新可见时恢复。切换项目、返回列表或退出登录关闭面板并使旧响应失效；请求与定时器随生命周期清理。项目列表允许打开非 ready 项目进行维护，禁用新服务和 Turn/文件操作，仍保留独立服务的读取和停止。服务 API 服务端鉴权仍是最终权限依据。

[Chrome 浏览器证据](evidence/runs/m3-service-ui-20260908085908852/browser.json)记录桌面与手机截图、真实页面刷新/停止和非 ready 维护流程。页面使用生产静态文件，HTTP 响应为明确替身；它证明 UI 与接口形状的交互，不证明云权限、容器停止或 Preview 访问。面板另有请求超时、相同请求重试、迟到响应、隐藏轮询和关闭清理测试。

## Preview 持久绑定与内部目标

### WebSocket 私有传输与连接所有权（2026-09-08 本地候选）

新增 `M3_PREVIEW_WS_ENABLED` 独立开关，默认未配置即拒绝升级，仍同时要求 Preview 主开关。真实 Workerd 探针证明普通 DO RPC 无法序列化 WebSocket（包括携带 WebSocket 的 101 Response）；私有 DO.fetch / Service Binding.fetch 能传递升级并完成 echo/close。故 WS 使用 Gateway → Workspace.fetch → ServiceRuntime.fetch → ServiceSandbox.fetch 的私有传输，不复用 HTTP RPC，也不开放任意内部代理入口。

公开握手要求 Preview 精确 HTTPS Origin、GET、WebSocket v13 和有效 access Cookie，拒绝跨站请求。内部请求重建为固定 endpoint，scope/access/runtime 等信封只在可信 bindings 内传递；进入项目前移除 Cookie、Authorization、浏览器握手 key 和平台控制头，端口固定 8080。协议只允许最多 8 个唯一 token、256 字节，项目选中的单一协议必须来自客户端 offer。项目响应的其它头不透传。私有 JSON 信封编码为 ASCII 转义，保留 Unicode 路径，限制 64 KiB；路径限制 8 KiB 并复用保留路径检查。

连接由 Workspace 与 Runtime DO 主动持有，使用标准 WebSocket accept，不采用休眠连接恢复。每个 actor 最多 8 个活跃或握手中的连接；退出/关闭/失败释放登记。活动连接登记是内存状态，持久权限依据仍为会话、绑定、Run 栅栏和租约；不能把旧连接恢复为已授权状态。宿主重建和云部署期间的实际断连表现仍需云/原生环境验收。

每条消息发送前重新查询权限。Workspace 验证具体登录、ACL、Preview/Run；Runtime 验证持久停止栅栏与当前 dispatched 租约。空闲连接每次检查完成后约 1 秒再检查，单次权限等待最多 1 秒；失效或超时关闭两端。原始授权截止只缩短、不续期。Runtime stop 直接中止本 actor 所有连接。总握手最多 10 秒，包含前置路由/权限等待；迟到升级也关闭。单消息最多 64 KiB，待处理队列最多 32 条/1 MiB，每连接累计最多 16 MiB，超限拒绝；二进制显式采用 ArrayBuffer。已发送消息无法撤回。

本地证据包括真实 Workerd Gateway/Workspace→Runtime echo 替身，验证文本/二进制、子协议、凭据剥离以及 D1 删除会话后空闲连接 1008 关闭；独立真实 ServiceRuntime/Quota/持久栅栏→Sandbox 替身验证连接数上限、停止关闭与停止后拒绝。原生容器端口仍为独立替身测试，未证明实际 Python WebSocket、真实 Chrome WebSocket 或云端完整链路。开启前还须实测轮询鉴权负载与配额，不能仅凭本地通过解除云门禁。

ServiceRuntime 已新增私有 HTTP 转发候选。发送前核对 actor、完整持久 input、attempted 状态、停止栅栏、截止及当前 dispatched 租约，最后同步检查与 invoke 之间没有 await；未知运行不会插入 fence 记录或调用 start。停止会中止本 actor 正在等待的 HTTP 请求，响应头返回后及响应流读取前后仍检查持久栅栏。单次转发最多 15 秒、响应最多 8 MiB；原生 Sandbox 使用独立截止处理本地中止，避免跨 RPC 序列化 AbortSignal。

ServiceSandbox 直接检查平台 container.running 并访问固定 getTcpPort(8080)，不使用会自动启动的 containerFetch。running 只代表进程容器存在，不证明应用端口已就绪；真实端口失败仍按失败处理，不重启。请求体最多 1 MiB、读取最多 5 秒，URL 固定 localhost:8080，仅保留必要请求头；Cookie、Authorization 和平台控制头不进入项目。HTTP 层拒绝 Upgrade、TRACE 和保留控制路径。响应策略移除项目 Cookie/CORS/安全策略覆盖，固定 iframe sandbox/CSP/no-store，仅允许内部或本实例重定向并重写为公共源。

Workerd 测试使用真实 Runtime、配额与持久存储及 Sandbox RPC 替身，验证正常转发、启动前/错误租约/关闭门禁/停止后拒绝，以及 stop 中断等待响应头。平台端口使用独立替身测试固定端口、停止和读取 body 期间停止、截止及迟到响应清理。尚未完成原生 Sandbox 端口和云 bindings 的纵向验收。Gateway 项目路径现已接入此私有转发，有限 HTTP 会在读取过程中重复复核会话；WebSocket 撤权已有本地候选；Observer 和实际原生纵向验收仍待完成。

控制端已接 `POST /api/workspaces/:id/previews` 与 `POST /api/workspaces/:id/previews/:previewId/tickets`，要求当前登录上下文、Catalog owner/ready scope、精确 Origin 和封闭输入。打开请求经 Workspace 绑定及实际目标复核，再登记不可变主机映射，只返回 previewId、runId、bootstrapUrl 和期限；票据响应只返回 ticket 与期限。客户端不能指定租户、会话、来源、运行引用或主机名。

`PreviewRoutes` 使用新迁移 `0008_preview_routes.sql`，固定 Preview ID、Workspace/generation、摘要主机标签和期限，丢失提交确认后可按原请求重放；冲突不覆盖旧记录。lookup/get 过滤过期、未 ready 和 generation 变化，但不是授权。Gateway 的非控制源分支只接受配置的独立 HTTPS 基域中已登记的完整 origin，复核当前目标后进入 bootstrap/exchange；兑换额外绑定主机对应的 previewId，错误实例不消费票据。

当前主机分支同时处理平台保留路径与有限 HTTP 项目请求。项目请求使用 access Cookie，先通过 fresh authorize，再进入 `Workspace.forwardPreviewHttp` → `ServiceRuntime`。Workspace 从权威目标中的 Run 构造 spec、完整 reference 和 lease，Runtime 核对持久 input、已派发租约、停止栅栏及截止；客户端不能选择这些执行参数。

`authorizedPreviewHttp` 在上传分段读取前后、转发前、响应头返回前，以及响应分段读取前后检查当前访问权限。请求总期限最多 15 秒且不得超过访问授权期限；上传上限 1 MiB、读取期限 5 秒，响应上限 8 MiB。取消或拒绝终止等待和后续字节转发，已交付字节不能撤回。请求不会自动重试。此处是有限 HTTP 接线，不代表已有 WebSocket 连接具备撤权传播。

用户工作台已有本地 Preview 面板候选：选择已确认 running 且未请求停止的服务后打开，刷新可从只读 GET 恢复当前绑定与引导入口。GET 不创建资源；已撤销/过期绑定仍返回最小 current 字段以便 CAS。打开请求冻结幂等键与参数，未知结果重试不另建意图；确定 409 清除旧意图后重新读取。浏览器票据仅从精确 iframe 窗口和 origin 的 nonce 交接，不存入 sessionStorage；本地存储仅保存未确认的打开参数。普通状态渲染保持 iframe 原位，关闭、过期或离开工作区卸载视图，不能因此停止 Run。控制页 frame-src 默认 none，只有明确启用并校验独立 HTTPS 基域后才放行其子域。


控制页 iframe CSP 与用户 Preview UI 已有本地候选。原生 Sandbox 端口验证、云 bindings、生产 DNS/证书、真实浏览器/原生 WebSocket 和 Observer 仍待验收。M3_PREVIEW_ENABLED 未开启，云端尚未应用 0008；本地分层替身测试不等于实际容器与浏览器纵向验收。

本地纵向测试 `tests/m3/preview-vertical-browser.test.mjs` 已将真实 Chrome 面板、生产 Gateway/Preview host、Workspace、票据/访问会话和 D1/R2 串联。恢复时不重复创建 Preview 或启动服务；登录会话删除后，旧 Cookie 的项目请求在进入运行端前被拒绝。此测试的身份提供方返回值和项目 Runtime 响应是明确替身，不证明原生 ServiceRuntime/Sandbox 或真实 OAuth 交换；其证据范围不能扩展到云端完整链路。另以 Chrome 延迟票据测试验证旧 iframe 的回包不会交给同源新 iframe。

Workspace 私有 `exchangePreviewTicket` 将已消费票据转换为独立访问会话，最长 5 分钟且不超过原登录和 Run 截止。只保存 access 摘要，每次 `authorizePreviewAccess` 重新查询登录与实际目标，并在异步检查后再次读取撤销状态；读取不会续期。最多保留 128 条未过期访问记录。兑换中途失败需重新取得授权票据，不允许重放已消费票据。`revokePreviewAccess` 在 Preview 开关关闭或 Workspace 未 ready 时仍可维护撤销。

`preview/browser.ts` 提供保留路径的引导与兑换处理器候选。HTTPS Preview 源设置 `__Host-riff_nonce`，脚本仅向精确控制源传递 nonce，仅接收该父窗口的票据，再同源 POST 兑换；服务器仅从 Cookie 读取 nonce。成功后设置 `__Host-riff_preview` 并删除 nonce，响应正文只含 ok。Cookie 均为 Secure、HttpOnly、SameSite=Strict、Path=/、无 Domain；引导页面有受限 CSP 和 frame-ancestors，不在 URL 中传递票据。该处理器已接入 Gateway 主机路由与控制端票据 API 候选，已有本地用户服务面板接线但尚未部署云端，不能把局部处理器当作已开放 Preview。

真实 Chrome 拦截测试验证控制页 iframe 接收 nonce、回传票据、同源兑换并跳转项目页，浏览器实际保存 host-only/HttpOnly Cookie，删除 nonce，且项目 JavaScript、控制域及兄弟 Preview 域不能读取该 access Cookie。错误 origin 或同 origin 的错误窗口来源不能触发兑换。兑换端口和项目响应为明确替身，不证明已连接实际容器；单独 Workerd 测试验证真实 Workspace/D1 的访问授权及维护撤销。浏览器首次失败源于测试项目响应未声明 UTF-8，修正 fixture 后通过，生产处理器未因该失败变更。

Workspace 私有 `issuePreviewTicket` / `redeemPreviewTicket` 已接 `SqlPreviewTickets`，使用真实 Catalog 主库会话校验和 `previewTarget` 的 Run/绑定复核。票据用途固定为 browser，包含不可变主体、具体登录、Workspace、来源及 runtime；最长 30 秒，且不超过登录或 Run 截止。票据与 nonce 各为 256 bit，数据库只存摘要。兑换先复核会话和目标，再用同步事务条件更新 consumed_at，持久确认后才返回内部 claims；并发只能成功一次，确认丢失后不能重新兑换。

每个 Workspace 最多保留 256 条未过期记录（包含已兑换），签发时清理过期记录。错 nonce 不消耗票据；未知、过期、已兑换、撤销的登录或更换的目标均拒绝。nonce 必须来自 Preview 独立源的 bootstrap Cookie，不能仅跟票据一起放在共享 URL 中；当前私有接口不代表浏览器已经获得安全的 nonce。Observer 不复用 browser 票据。

`redeem` 返回内部一次交接记录；`exchange` 可将其转为已有的短期访问会话与独立源 Cookie。当前 HTTP 转发必须继续复核该访问会话，不能仅凭兑换结果持续转发；WebSocket 授权与连接期间撤销仍待实现。

票据的 SQLite 测试覆盖重启、并发唯一、错误 nonce、会话撤销、目标替换、摘要存储、确认丢失、期限及容量。Workerd 测试执行真实本地 D1 Catalog/auth 迁移并写入明确 fixture 会话，调用生产 Workspace、绑定与 Run 视图，验证签发/兑换、重启、删 session、关闭 Preview 门禁及未 ready 拒绝；Runtime 是替身，没有实际 Google 登录或容器代理。

登录上下文已从服务器 Better Auth `getSession`（禁用 Cookie 缓存）提取，包含私有 session id、过期时间及认证版本；`browserPrincipal` 将它与 Admission 的平台主体绑定，公开 `/api/me` 不暴露 session id 或 token。`requirePreviewSession` 在主数据库的一次 JOIN 中检查登录有效、已验证身份、当前认证版本、活跃 owner 成员与租户、所属项目和 Workspace 的 ready 状态及 generation，返回后再次检查过期。慢查询不能延长授权。这是单次权限检查，尚不具备连接存续期间的撤权传播。

真实本地 Better Auth 与 SQLite 测试覆盖签名 Cookie、退出当前登录而保留独立第二登录、过期、错误 scope/generation/身份、认证版本变更、成员撤销及非 ready Workspace。可控时钟验证数据库读取期间过期。没有真实 Google OAuth 交换、云部署或公开 Preview 请求。

`SqlPreviewBindings` 保存每个 Workspace 的当前 Preview 和历史记录：固定 previewId、scope、runId、source、完整 runtime reference，过期时间等于该 Run 的固定运行截止。绑定候选必须已确认交付、处于 running、无停止意图且未到期。绑定请求按 actor/请求键幂等；已撤销绑定的重放返回原记录，不复活。相同当前 runtime/source 可复用，切换当前绑定需要 expectedPreviewId 匹配，并在同一 SQL 事务永久撤销旧绑定、保存新绑定和幂等记录。

Workspace 私有 `bindPreview` 从自身 serviceView 取候选，客户端不能注入 Run 回执；`currentPreview` 和 `revokePreview` 使用维护 scope。`previewTarget` 要求 Workspace ready 和独立 `M3_PREVIEW_ENABLED` 开关，先读取当前有效绑定，再查询固定 Run，核对 source/runtime/status，最后再次读取绑定并检查截止。读取期间发生替换或撤销时拒绝迟到结果，不调用 start 或创建第二套服务进程。

绑定不是浏览器访问凭据，也不证明 HTTP 服务持续健康；`previewTarget` 只是一次内部状态解析。票据、Cookie 和主机引导路由已有本地候选，并已连接有限 HTTP 项目请求；原生端口纵向验证、WebSocket 连接登记和会话撤销已有本地实现，实际浏览器/原生与云环境的长连接验收仍未完成。不能把内部绑定查询当作完整用户/Observer 授权，不能仅凭绑定未过期就转发流或长连接。每个实际访问还需当前登录、ACL、Run 与生命周期复核；连接建立后的撤销须由后续网关持久机制实现。

SQLite 测试验证幂等、替换、过期、跨 scope、停止候选拒绝、SQL 故障回滚与持久确认丢失。目标解析测试验证迟到 Run 响应不能绕过绑定变化。Workerd 测试独立接入生产 Workspace/Run/绑定存储，覆盖重启、目标解析与未 ready 时的撤销；Runtime 仍为替身。这些证据不证明真实浏览器访问、Google session、HTTPS 或容器代理已可用。
