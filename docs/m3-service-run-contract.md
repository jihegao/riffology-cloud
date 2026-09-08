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
