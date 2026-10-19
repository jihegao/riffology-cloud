# 固定 IR 插件接入

本次交付范围为 [#254](https://github.com/jihegao/riffology-cloud/issues/254)：按共享包合同 M3/M4 接入一个官方固定包。共享工具 schema、skill、Business→Plan 编译和浏览器 runtime 来自同一 npm 制品；不把浏览器计算提升为 Verified Experiment/Evidence。

`vendor/riffoid-ir-plugin.lock.json` 与 `services/project-tools/vendor/riffoid-ir-plugin.lock.json` 固定包 SHA 和完整文件清单。Trusted Pi 在加载 skill/工具前校验全部文件；Project Tools 用平台固定 Node 路径运行同包 CLI，校验同样清单。用户项目不能选择包根目录或导入任意 Node extension。

受控 Pi 提供四个 pipeline 工具，另有 mode/show/install 辅助工具。`/sim ir`、`/sim code`、`/sim show` 由宿主在 provider 前处理；只生成请求写草稿并同步展示后停止。check/compile 沿原 Tool command/effect 身份进入 Project Tools。编译成功必须先验证 Business、simpack、Plan、runtime/worker 图并提交 Workspace SQLite/R2，再向 Agent 返回产物引用。run/result 直接由同一 Workspace IR 投影处理，不分配仿真云容器。

项目原生页面通过 nonce MessagePort 调用有界 `irRequest`。Gateway 和 Workspace 在异步读前后检查 invitation、owner/authVersion、scope/generation、归档及当前 package。opaque iframe 保持原沙箱和网络策略；只增加 `worker-src blob:` 以执行经 SHA 校验的固定 Worker/runtime。浏览器提交结果必须匹配冻结运行、当前 actor 的浏览器 lease 和 artifact 身份，并在持久化后才发布终态。

普通保存的 draft/settings 在无 active Turn 时取 canonical Revision；Turn 内取即时登记投影以支持编译后立即运行。浏览器 heartbeat/result 不推进 canonical head。历史运行冻结模型、输入、运行时与 seed；按 sourceRunId 复跑产生新 runId 并保留来源。丢失 ACK 按原 effect 观察，不自动重放；持久化确认未知继续作为 unknown。

源码基线为 main `240378f65fee54d917b053f565087095a07244db`，原工作区未重置。独立分支的离线回归与实际本地浏览器证据见 [准备记录](../evidence/releases/riffoid-ir-m3-m4-preparation-20261019.json)。完整检查与双端 ACC 结果按实际执行追加。真实 Project Tools 镜像已通过固定 Node/SDK、UID、网络隔离及 B1 check/compile 探针；该记录仍不证明生产部署或线上 Agent 验收。同一冻结 runtime/worker 已在真实本地 Chromium 与 WebKit 26.6 的 opaque 页面运行；[WebKit 兼容证据](../evidence/releases/riffoid-ir-m3-m4-20261019/webkit-compatibility/manifest.json)包含正确结果、篡改拒绝和 Worker/页面清理，仅属本地 synthetic scope。首次新项目先结束保存 Turn，用户打开已保存页面后在下一 Turn 运行；不把尚未连接的浏览器当成执行成功。线上集成需以当前进行中工作确认后的合并基线串行进行，沿用 #104/#214 原身份和发布保全约束。G5/M3/M4 云执行门禁不因本次浏览器执行开放。

独立候选分支已整合公开 SDK 修复 #257（`fca66cb0`），尚未合入 main 或部署。HTTP/RPC/SDK/module/startup 分别有界；IR HTTP 为25秒，整次 RPC 为30秒、外层 SDK 为35秒，并把取消信号传入 IR 请求。心跳交付不确定仍关闭原页面。此交叉候选的 Chromium27项、WebKit17项和 broker17项本地检查见选定证据，整合候选 `f905d790` 已通过 Linux 完整 CI（3,446 Node、8 Python 通过，13 条件跳过）；确认最终基线后再核对差异、完成必要检查及线上验收。

AMD128 的 [Trusted Pi 实际镜像探针](../evidence/releases/riffoid-ir-m3-m4-20261019/trusted-pi-image-probe.json)也已通过：验证同一固定包、SDK0.85.0及UID10002，实际原生host/受控Session与进程封存覆盖59个目标。其模型和工具传输为synthetic callbacks，尚不证明线上Turn、部署或容量释放；与真实Project Tools编译探针一起作为上线前证据保留。

两份实测镜像的[原始OCI完整校验](../evidence/releases/riffoid-ir-m3-m4-20261019/oci-image-verification.json)已通过：TrustedPi58层、ProjectTools36层，manifest/config与全部blob原字节及解压diffID匹配，前后Engine投影相同；每镜像只导出一次，同一归档已在本机完整复核。Registry发布、生产部署与线上ACC仍未执行。[Gateway离线构建](../evidence/releases/riffoid-ir-m3-m4-20261019/gateway-offline-build.json)绑定候选源码与1129个模块输入，96资产仅project-views.js改变。待前批验收结束并交接writer后，核对实际main闭包再串行发布，保留全部原资源与未知历史。
