# ADR 0004：Turn 权威账本先使用 WorkspaceAgent SQLite

状态：Accepted，2026-09-06。

## 决策

Session、Turn、事件 sequence、运行 dispatch identity 和 Checkpoint 指针由每个 Workspace 的 WorkspaceAgent SQLite 单写。Gateway 只做身份与对象归属检查；Runtime 只能通过私有 RPC 提交绑定 `turn_id + dispatch_id + runtime_generation` 的事件和收据。

接受 Session/Turn 的事务必须在 `sync()` 确认后返回。模型、文件工具、R2 和 Container RPC 不得在 SQLite transaction 内运行。调用前先保存 effect intent；结果未知时查询同一 operation 或观察同一 Runtime，不自动重发有副作用动作。

Cloudflare Agents SDK 可以作为 alarm/fiber/WebSocket 调度适配器，但不成为业务终态或外部副作用的权威。采用它之前必须证明其恢复回调保留当前 generation fence、一次派发、取消和 unknown 语义。

## 原因

Pi 执行、项目命令、R2 上传和模型请求都发生在 Durable Object 事务之外。通用 fiber 能恢复控制流程，不能判断外部效果是否已经发生；平台仍须保存自己的 intent、receipt 和 Checkpoint。因此先冻结可独立测试的数据契约，避免把产品状态绑定到 SDK 的内存执行对象或聊天消息格式。

Workspace 是文件与执行隔离边界，一个 WorkspaceAgent 串行所有 Turn，可以直接执行“一 Workspace 一个活动 Turn”，并让多个 Session 共享同一文件写锁。事件先落 SQLite 再广播，浏览器连接仅观察。

## 限制

当前切片已有独立验证的 TurnDispatcher 核心和 SSE 观察窗，但尚无 alarm 接线、真实 Pi Runtime、R2 Revision 和事件归档。Dispatcher 只接受同时包含原生停止、写入 fence 与保存结果的终态回执；取消结果未知时保留 fence，后续只 observe，不重复 cancel，也不重新 accept。实际 Runtime port 尚待实现。事件达到本地上限时明确拒绝继续而不丢弃；游标过期只要求先取完整快照，不跨缺口推送新事件。加入归档前不能宣称长会话可无限运行。是否加入 WebSocket 由真实双向交互需求决定，SSE 已覆盖首版服务端事件观察。
