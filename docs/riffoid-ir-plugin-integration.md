# 固定 IR 插件接入

本次交付范围为 [#254](https://github.com/jihegao/riffology-cloud/issues/254)：按共享包合同 M3/M4 接入一个官方固定包。共享工具 schema、skill、Business→Plan 编译和浏览器 runtime 来自同一 npm 制品；不把浏览器计算提升为 Verified Experiment/Evidence。

`vendor/riffoid-ir-plugin.lock.json` 与 `services/project-tools/vendor/riffoid-ir-plugin.lock.json` 固定包 SHA 和完整文件清单。Trusted Pi 在加载 skill/工具前校验全部文件；Project Tools 用平台固定 Node 路径运行同包 CLI，校验同样清单。用户项目不能选择包根目录或导入任意 Node extension。

受控 Pi 提供四个 pipeline 工具，另有 mode/show/install 辅助工具。`/sim ir`、`/sim code`、`/sim show` 由宿主在 provider 前处理；只生成请求写草稿并同步展示后停止。check/compile 沿原 Tool command/effect 身份进入 Project Tools。编译成功必须先验证 Business、simpack、Plan、runtime/worker 图并提交 Workspace SQLite/R2，再向 Agent 返回产物引用。run/result 直接由同一 Workspace IR 投影处理，不分配仿真云容器。

项目原生页面通过 nonce MessagePort 调用有界 `irRequest`。Gateway 和 Workspace 在异步读前后检查 invitation、owner/authVersion、scope/generation、归档及当前 package。opaque iframe 保持原沙箱和网络策略；只增加 `worker-src blob:` 以执行经 SHA 校验的固定 Worker/runtime。浏览器提交结果必须匹配冻结运行、当前 actor 的浏览器 lease 和 artifact 身份，并在持久化后才发布终态。

普通保存的 draft/settings 在无 active Turn 时取 canonical Revision；Turn 内取即时登记投影以支持编译后立即运行。浏览器 heartbeat/result 不推进 canonical head。历史运行冻结模型、输入、运行时与 seed；按 sourceRunId 复跑产生新 runId 并保留来源。丢失 ACK 按原 effect 观察，不自动重放；持久化确认未知继续作为 unknown。

源码基线为 main `240378f65fee54d917b053f565087095a07244db`，原工作区未重置。独立分支的离线回归与实际本地浏览器证据见 [准备记录](../evidence/releases/riffoid-ir-m3-m4-preparation-20261019.json)。完整检查与双端 ACC 结果按实际执行追加。真实 Project Tools 镜像已通过固定 Node/SDK、UID、网络隔离及 B1 check/compile 探针；该记录仍不证明生产部署或线上 Agent 验收。首次新项目先结束保存 Turn，用户打开已保存页面后在下一 Turn 运行；不把尚未连接的浏览器当成执行成功。线上集成需以当前进行中工作确认后的合并基线串行进行，沿用 #104/#214 原身份和发布保全约束。G5/M3/M4 云执行门禁不因本次浏览器执行开放。
