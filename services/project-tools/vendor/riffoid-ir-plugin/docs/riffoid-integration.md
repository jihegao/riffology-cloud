# Riffoid 固定包接入 0.3.1

本包提供同一套工具 schema、skill、Project Tools CLI、Business→Plan 编译与浏览器运行时。合同 M3/M4 必须以实际部署和双端 ACC-01～05 的运行记录验收；本地适配测试、PR 合并或静态页面可读均不替代线上完成条件。宿主跟踪项为 [riffology-cloud#254](https://github.com/jihegao/riffology-cloud/issues/254)，关联普通页面 #214 与容量 #104。

## 固定包与执行边界

Riffoid 将同一 npm 包按逐文件 SHA 锁定在 Trusted Pi 与 Project Tools 镜像。Trusted Pi 只读取固定包的工具定义与 skill，经原 Tool Ledger 发送严格的 `ir` operation；不启用任意项目 Node extension。Project Tools 的固定 helper 验证包文件、版本、目录与锁后，使用无 shell Node CLI、固定 Python 和 compiler 0.1.0 完成检查或编译。包制品 SHA、wheel SHA 和 runtime SHA 进入产物身份。

CLI 入口为 `scripts/riffoid-cli.mjs`。四工具保持 `project_ir_check`、`project_ir_compile`、`project_ir_run`、`project_ir_result`。宿主辅助工具 `project_ir_mode/show/install` 承接项目默认、只读展示与普通页面安装；`/sim ir|code|show` 在模型 prompt 前执行相应操作。本次显式用户要求优先，已有模型不自动转换。

`adapters/riffoid/index.mjs` 的本地文件适配器用于 Project Tools 内的模型与页面操作；临时容器内写文件不构成线上运行结果保存。页面的 `app/views.json` 沿原 canonical Revision 保存和冷恢复；首次“只生成”流程先保存模型及安装页面，打开页面后再明确运行。

## 活动 Turn 与持久记录

检查/编译返回封存 Business、simpack、browser artifact、runtime 与 worker 的字节及摘要。宿主在原 effectId 下验证关联图，先写不可变 R2 内容、回读验证，再原子发布 Workspace SQLite 投影，随后才返回编译成功。注册缺失或引用冲突不会确认成功。

`project_ir_run` 和 `project_ir_result` 访问同一 Workspace 投影，不启动 Project Tools 或云端仿真。run 绑定当前 owner/authVersion、项目代际、模型/Plan/runtime/worker、seed 和原 effect；只有授权浏览器保持连接时才接收新运行。浏览器领取后在用户设备执行，结果写完整 R2 并确认后才发布 `succeeded`。心跳和结果提交不推进 canonical source head，避免页面因自己的运行记录而被替换。

KV 已写但保存 ACK 不确定时保持 `unknown`；后续只观察原 effect，不能以新 run 重试。浏览器断连、脚本异常或保存不确定会停止本次执行。历史 `sourceRunId` 显式复跑创建新 run，仍用原封存模型、Plan、runtime、worker 和输入，不读取当前草稿替换原条件。

## 普通页面通道

`window.riffoid.irRequest(operation,input)` 通过 nonce 绑定的 MessagePort 与当前 packageIdentity 进入单一 `POST /api/workspaces/:id/project-ir`。页面只允许 show、draft、records、heartbeat、submit、detach 和指定 run 的结果读取。检查、编译、模式、文件写入与新运行仍由 Agent 的原授权工具完成。

每次调用检查邀请、owner/authVersion、workspace generation、归档状态和当前页面授权；异步边界之后复核。IR 输入上限 256 KiB，页面响应 512 KiB，Agent 结果 384 KiB；历史列表最多 50 条摘要，不传无界事件集合。达到上限给出明确诊断。

原 opaque frame 保持 `allow-scripts` 和 `connect-src 'none'`，只允许 Blob Worker。Riffoid 用 classic Worker 装载原封存 ESM；PI WEB 使用 module Worker。缺少 WebCrypto 时用同包 SHA-256 实现校验原 runtime 内容，篡改后不创建可执行 runtime Blob。计算逻辑与版本相同，不使用 fixture 预期代替执行。

## 集成与验收

插件与宿主均使用独立 worktree 准备 PR，保留源仓库未提交工作。合入前核对当时已确认的宿主 main、接口与正在进行的 #104/#214 验收；部署与实际普通用户验证串行执行。部署保留现有绑定、容量、费用计量和历史记录，单独记录 Gateway、Trusted Pi、Project Tools 的实际版本与资源释放。

双端 ACC 使用同一固定包，保存自然语言对话、四工具回执、B1 七指标与第 30 分钟顺序、第二任务后移五分钟、重开与旧条件复跑、坏 JSON 诊断与修复的真实记录。浏览器结果始终为 local/unverified。原始日志、token、工作区和备份在仓库外，仅选定证据及 SHA 清单入库；当前实际状态见验收记录和宿主发布索引。
