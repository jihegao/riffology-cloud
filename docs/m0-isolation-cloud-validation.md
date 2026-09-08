# M0 可信与项目执行域隔离验证

2026-09-06，T02 在 Cloudflare 两个独立 Container 应用与 DO namespace 上完成固定项目 Shell 攻击探针。[运行记录](evidence/runs/m0-isolation-1788667134876-7c5f6681c9ec3c78ad81e93/isolation-cloud.json)绑定 Worker `f43bcfe0-03c3-4d76-9662-9deeacc750d6`、runtime 源码、镜像和部署摘要。

可信 VM 内放置合成私有文件、Session 包、环境 marker，并启动真实 HTTP/IPC 服务；服务收到固定正向请求后向自身发送 SIGUSR1，计数确实从 0 变为 1。项目 Shell 随后尝试读可信路径、扫描进程环境和命令行、连接可信 IPC/loopback 控制、调用控制 HTTP/RPC，以及用可信进程和 Session 标识调用本地 SDK。Worker 通过可信 VM 的独立通道回读文件、服务身份、信号计数及控制变更计数，确认攻击未改变可信状态。

信号验证有一条明确保留的[首次失败](evidence/runs/m0-isolation-1788666613594-34db1d2565f1dc1ad3485c2/isolation-cloud.json)：云环境缺少 pidfd 能力，只得到 `capability_unavailable`，不足以证明跨 VM 目标不可寻址。当前实现先核对真实 Linux kernel boot identity；可信与项目的两个启动摘要不同，且目标摘要与可信侧记录一致。只有这种情况下才报告 `target_not_addressable`，同内核缺少 API 仍不能通过。它证明可信目标不在项目可寻址的 PID 域中，没有向别的进程猜测 PID 或发送信号，也不宣称一次跨 VM kill 返回了 EPERM。

两项带伪造 Session / Sandbox 字段的本地 SDK 写请求返回 HTTP 200，实际写入均限于项目自己的文件系统，可信目标独立回读未改变。Session ID 和请求头不是跨 VM 授权能力，不能将这些 200 写成“返回 403”；验收标准是越权目标不可读、不可控制。可信 Session 读取、进程查询和进程控制 RPC 返回 404；跨域控制请求未产生成功控制效果。HTTP 状态和实际作用范围分别保留在证据中。

[远程绑定](evidence/runs/m0-boundary-kernel-20260906/remote-settings.json)确认可信和项目 namespace 不同；[应用记录](evidence/runs/m0-boundary-kernel-20260906/apps-final.json)确认两种已批准镜像及各自应用。运行后可信应用 5 条、项目应用 10 条实例记录均为 inactive，分页结束；这 15 条包含历史已停止实例，不是本次同时启动 15 个实例。

成功运行包含 4 个控制请求，耗时 10.497 秒；首次未通过运行也是 4 个控制请求、9.333 秒，两次均完成独立 cleanup。两轮都未调用模型，实际账单仍待对账。[25 项 runtime/Worker 测试](evidence/runs/m0-boundary-kernel-20260906/runtime-worker-tests.log)通过，包含真实子进程信号正控制、pidfd 身份约束、不同内核的早期拒绝，以及内部读体期限。

云内读体与公网交付问题有独立[诊断记录](evidence/runs/m0-boundary-internal-20260906/internal-observations.json)：真实滴流/停滞均在 1000 ms 超时且资源清理完成；[公网上传](evidence/runs/m0-boundary-internal-20260906/public-ingress-observations.json)仍先被合并，预期 400 / 实际 200 的历史检查不改写为通过。这个入口交付问题不能冒充 T02 的隔离失败或成功。

[T02 签收](evidence/runs/m0-g0-t02-cloud-20260906/G0-T02-gate-summary.json)仅覆盖原计划的固定隔离原语；不替代真实 Pi Session、恶意扩展、跨租户资源矩阵、模型出口策略或生产 Tool Bridge 的后续验收。
