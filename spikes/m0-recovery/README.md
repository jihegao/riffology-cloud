# M0 T08 本地中断与恢复探针

这是固定单项目、固定本地 SSE provider 的恢复探针。它使用真实 Pi SDK 进程，但 provider 是本地 fixture，不访问外部供应商，也不产生真实模型或计费证据。Worker 的 durable alarm 拥有任务推进；HTTP 只负责接受操作或读取状态，SSE 只观察持久事件，断开 SSE 不会取消任务。

## 本地运行

从仓库根目录执行，先按 [M0 本地运行手册](../../docs/m0-local-runbook.md) 设置独立 Colima profile、`DOCKER_HOST` 和项目 `DOCKER_CONFIG`，再在一个终端启动 Worker：

```sh
DOCKER_HOST="unix://$HOME/.colima/riffology-m0/docker.sock" \
DOCKER_CONFIG="$PWD/.local/docker" \
npm run m0:recovery:dev
```

Worker 监听 `127.0.0.1:8793`。另一个终端运行完整本地集成：

```sh
npm run m0:recovery:integration
```

驱动脚本从已有 `infra/.dev.vars.staging` 在 Node 进程内读取 `M0_PROBE_TOKEN`，只以内存 Bearer header 发送；不要把 token 写入命令行、日志或证据。脚本为每次执行创建新的、不可覆盖的 `docs/evidence/runs/m0-recovery-<timestamp>/`，保存 `disconnect.json`、`process.json`、`container.json` 和 `summary.json`；若目录已存在，脚本拒绝覆盖。

## 管理接口

所有请求均为无 body、无 query 的固定 run 路径，并要求 Bearer：

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/probe/<run>/accept` | 事务写入 queued 状态并安排 durable alarm |
| GET | `/probe/<run>/report` | 读取状态、收据、generation 和运行时摘要 |
| GET | `/probe/<run>/events` | 以 SSE 观察持久事件；支持 `Last-Event-ID` 重连 |
| POST | `/probe/<run>/kill-process` | 在 streaming 窗口请求真实 Pi 进程 `SIGKILL` |
| POST | `/probe/<run>/kill-container` | 在 streaming 窗口请求销毁当前 Sandbox |
| POST | `/probe/<run>/recover` | 从最后确认的 seed checkpoint 接受新恢复 turn |
| POST | `/probe/<run>/late-event` | 注入旧 generation 事件，验证被拒绝且状态不变 |
| POST | `/probe/<run>/cleanup` | 安排或确认清理；可重复调用 |

## 探针验证什么

初始 turn 先产出候选 `seed.json`；Worker 校验后上传不可变 R2 对象，在同一个 DO 事务中提交 checkpoint 指针、摘要、回合元数据及事件，随后才由 alarm 写入 `go` 并推进长 SSE 流。候选 `final.json` 也须通过同样的持久提交才成为完成依据。运行时文件的临时文件改名只保证本地原子写入，不能代替平台保存收据。相关元数据回调与保存指针的失败回滚已在[本地 Workerd 验证](../../docs/evidence/runs/m0-recovery-20260905070637920/storage-metadata.json)。

集成脚本依次覆盖三种场景：断开观察 SSE、SIGKILL Pi 进程、销毁 Sandbox。后两者在真实打开的固定 12 秒 SSE 流窗口内触发，要求最终报告记录 `windowHit=true`、无 final 文件、清理确认和 `interrupted`。随后 `recover` 使用新的 runtime generation 和新的恢复 prompt，从最后确认的 seed 恢复；`replayInterruptedRequest=false`，不会重放被中断的请求。恢复完成后应有新的 Sandbox 身份、上下文恢复标记、sequence 为 2 的 final checkpoint、旧 generation late event 拒绝，以及从旧 SSE cursor 精确补发事件。

`cleanup` 由 alarm/协调者负责销毁并重试；只有 `destroy_acknowledged` 才能形成完整成功记录。中断、恢复和清理均不能靠 HTTP 请求本身取得任务所有权。

## 测试范围与边界

`spikes/m0-recovery/runtime.test.ts` 的 Node 测试报告为 15 项通过（含子测试），直接启动真实 Pi SDK 子进程和本地 SSE fixture，覆盖原子 seed/final、12 秒流、SIGKILL、新 generation 恢复、无 go 隔离和损坏 snapshot 拒绝。它们独立于 `tests/m0/pi/` 的受控 Pi 宿主测试。`spikes/m0-recovery/worker.test.ts` 有 2 项测试，覆盖鉴权/路径/body/环境拒绝，以及 SSE 取消不改变生产者和 cursor 重连。这些本地原语测试不等于云 T08 验收。

停止并重启本地 Workerd 后，[三个场景的状态、收据与事件保持一致](../../docs/evidence/runs/m0-recovery-20260905070637920/workerd-restart.json)。收尾另行核对并[停止五只开发代理 helper](../../docs/evidence/runs/m0-recovery-20260905070637920/helper-cleanup.json)；Sandbox 的销毁确认不包括这些 Wrangler 开发进程的生命周期。

实现按官方 [DO alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) 和 [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) 约束设计：alarm 可能重复执行，派发与外部副作用仍需本探针的持久意图、generation 校验和未知结果处理。官方 API 行为不能替代本产品的云端验收。

`npm run m0:recovery:integration` 是本地 Docker/Workerd 集成，provider 仍为 local SSE fixture。当前三个场景均已通过：[summary.json](../../docs/evidence/runs/m0-recovery-20260905070637920/summary.json)、[disconnect.json](../../docs/evidence/runs/m0-recovery-20260905070637920/disconnect.json)、[process.json](../../docs/evidence/runs/m0-recovery-20260905070637920/process.json) 和 [container.json](../../docs/evidence/runs/m0-recovery-20260905070637920/container.json)。process 与 container 均记录了 fresh running/streaming、`finalAbsent`、12 秒流窗口内的 kill/destroy、`windowHit=true`、新 Sandbox `g2` 恢复、`requestCount=1`、seed/hash/上下文保留；SSE 断开和游标重放也通过。上述本地记录仍保持 `gate_decision=not_evaluated`、`cloudGatePassed=false`。云端 T08 仍是 `not_evaluated`，还需要真实云 durable Turn、浏览器断线、Pi/Container 故障、恢复和旧实例事件拒绝证据；本地成功不能关闭 G0，也不能证明云 VM、调度、发布或隔离行为。
