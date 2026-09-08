# ADR 0003：M1 项目初始化与持久派发

日期：2026-09-06。状态：本地实现与完整原生链路通过，G1 云验收待完成。

## 责任与成功条件

初始化属于平台：身份、Catalog、配额、目录结构、运行环境、保存点、停止和审计均不交给项目内 Pi 修改。项目 Pi 的建模与应用生成在后续阶段进入已授权目录。

项目创建返回 `provisioning`。平台先核验实际文件，写入不可变 R2 checkpoint，再确认原生容器停止并释放租约，最后原子更新项目、Workspace、创建意图、outbox 与审计为 `ready`。这里的 ready 表示文件已经准备并保存，VM 已停止；它不是模型已运行，也不表示持有活动 Pi 会话。

## 持久协议

1. 创建批次同时保存项目、Workspace、幂等意图、outbox、原始 authVersion 和审计。客户端不提供 runtime ID、租约或文件路径。
2. Gateway 等待 WorkspaceAgent 的持久接收；每分钟私有扫描最多十项补偿数据库提交后、DO 接收前的中断。处理中的任务使用原 Task 幂等接收，unknown 只发起观察。旧记录缺少原始 authVersion 时不猜测新授权。
3. WorkspaceAgent 将状态和下次 alarm 放入同一 SQLite 事务。当前权限与 Task 真实性分别核验；真实但已过期或被撤权的任务仍能记录失败结果，伪造任务不能占用 actor。
4. TenantQuota 只准许一个持久 dispatch；租约绑定 Tenant、Project、Workspace、generation、operationId 和固定 deadline。申请和确认停止具备持久幂等性，丢失回执时先 lookup，完全相同请求最多三次；dispatch、initialize、stop 未知时不会重放。
5. ProjectRuntime 先保存启动意图，再核对完整租约和当前权限，并在实际启动前同步复查停止标记与期限。停止先持久化标记，迟到初始化永远不能重启这一实例。
6. 固定程序创建目录和文件，写入后 fsync。原生只读 exec 核对目录类型、文件内容和 marker；输出最多 16 KiB、整体观察最多五秒。停止的容器不会因为观察而重新启动。
7. checkpoint 为固定 scope 下的不可变 JSON 包，包含初始目录与文件；保存未知时仅回读原 key。只有正文和摘要完全一致才接受保存点。原观察时间持久化，避免丢失回执后生成晚于停止时间的假初始化时间。
8. 原生停止收据绑定完整 identity。无原生停止证据就不释放配额，期限届满本身不构成释放依据。投影失败可重新接收原任务后继续对账，不重新执行 runtime 操作。

底层采用原生 Container API，是为了明确控制启动和停止。官方说明 `exec` 仅在已运行容器中启动进程，`running` 不等于应用就绪，`destroy` 的 Promise 在容器销毁后返回。[Container API](https://developers.cloudflare.com/durable-objects/api/container/)

`kill` 只是信号请求，不能推断进程退出。观察超时会取消读取并清理迟到的进程句柄；是否停机仍由后续原生观测确认。[Execute commands](https://developers.cloudflare.com/containers/guides/execute-commands/)

alarm 会重试，处理器必须依赖持久状态和幂等边界；浏览器不拥有初始化任务。[Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

## 发现的风险与措施

| 风险 | 本次措施与证据 |
|---|---|
| 数据库提交后浏览器或 Gateway 断开 | outbox + 私有定时扫描 + 同 Task 持久接收 |
| 申请/释放意图提交但 RPC 尚未发送 | 先 lookup，原请求最多三次持久幂等尝试；重建不能重置次数 |
| 启动授权或回执丢失 | 不把 lookup 的 dispatched 当成新的启动许可；只观察或停止原实例 |
| 停止和启动、保存发生并发 | 停止标记先持久化；每个异步等待后，在新副作用前复查标记和 deadline |
| 晚到初始化污染停止证据 | 拒绝期限后新建 checkpoint；保存原观察时间；停止收据独立验证 |
| D1 投影暂时不可用 | 原 receiptId/sequence/hash 重试；非 unknown 但尚未确认的投影可重新唤醒 |
| 页面网络失败造成重复项目 | 原 payload 与幂等键保留，连续重试真实浏览器验证；取消按钮不提交 |
| 退出后旧请求重新显示项目 | 视图序号使旧响应失效；退出与隐藏页面停止轮询 |
| 本地工具失败被误判为平台失败或通过 | 保留 DockerHub EOF、socket 路径超时和 Node RPC proxy 诊断；改用规范 socket URI 和仅测试内存中的 HTTP 观测桥，成功证据独立存放 |

## 证据与范围

- [全检](../evidence/runs/m1-local-20260906120751944/local-checks.json)：M0 348 pass / 1 skip、M1 88 pass；含真实 SQLite 故障测试、Workerd/D1/DO/alarm 重启测试、真实 Chrome 行为测试。
- [两容器隔离](../evidence/runs/m1-native-20260906112850149/native-checks.json)：A 的修改不进入 B，停止 A 不影响 B，测试容器已清理。
- [原生完整链路](../evidence/runs/m1-workspace-20260906121130494/workspace-local.json)：真实生产模块、Workerd、Docker、R2 与 D1，从 API 创建到 ready；身份为库会话 fixture，云费用和模型调用均为零。
- [本地界面](../evidence/runs/m1-web-20260906/browser-check.json)：Worker 资产 HTTP 200、无 JavaScript 错误、手机无横向溢出；真实 OAuth 未配置，身份 API 返回 503。

尚未证明两真实 Google 身份的云隔离、生产部署、M2 任意文件恢复、Pi Turn、Browser、Run、管理端或付费。保留原 G0 冻结候选，不恢复任何 `riffology-demo` 兼容入口。
