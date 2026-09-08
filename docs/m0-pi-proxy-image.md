# Pi 代理诊断镜像：构建、公开范围与发布

更新：2026-09-06（Asia/Shanghai）。新 trusted 镜像包含受控 Pi、模型代理客户端和固定 staging fixture 诊断入口，**Linux 构建与断网 SDK 检查通过；两份镜像已公开发布并匿名核验，Boundary 已部署并完成真实 VM 局部观测**。Project 镜像也已本地构建，其运行配置与 layer 内容保持不变。当前 G0 仍为 1/10，本文不放行真实模型调用。

## 已验证产物

构建文件位于[本轮证据目录](evidence/runs/20260905T155750Z-167375ff/receipt.txt)；最终内容经主控从本地 containerd 读取并核验：[镜像元数据](evidence/runs/20260905T155750Z-167375ff/verified-image-metadata.json)、[COPY 校验](evidence/runs/20260905T155750Z-167375ff/copy-verification.json)。两份镜像均为 `linux/amd64`，默认入口仍为 `/container-server/sandbox`，没有替换 Sandbox 服务启动方式。

| 字段 | Trusted | Project |
| --- | --- | --- |
| 本地 tag | `riffology-m0-trusted-proxy:20260905T155750Z-167375ff` | `riffology-m0-project:20260905T155750Z-167375ff` |
| OCI index digest | `sha256:42eb9a36e2aa6098c9a146c5c0f149efe29f638d8d304efea523a592aa4002dc` | `sha256:1d82f27d7cd328aef4f7125e0e27fe42fa6a03803c97ca7783951aba385cf42f` |
| amd64 manifest digest | `sha256:4be14ca3e2191e2a2941d4eb0ff7ac904c5a694b60ee839f75ac429eac7f3e67` | `sha256:c010768e37d6ad06da137308d30faf32b9ec7fcc21916f29f146c281c7a6946e` |
| config digest | `sha256:482804a737ab81448752c2df9b8ffc714fdb398c243cef011520b6c91f4076a6` | `sha256:ffa7f77ec007ce13c193e9280e3c06a9d46b37cbbd3aafca4c8c38f745eda3d0` |
| 压缩 layer 大小合计 | 272,337,644 字节 | 361,823,969 字节 |
| 最后一次构建退出码 | 0 | 0 |

Index 包含运行 manifest 和构建 provenance，不能将 index、平台 manifest 和 config 三种摘要混写。Project 的 config 和 layer digest/size 与前轮完全相同；本轮 OCI manifest 格式和 provenance 使外层摘要变化。这些大小不是上传流量或实际费用。

## 真实 Linux SDK 检查

[Dockerfile](../infra/m0-trusted.Dockerfile) 在 `RUN --network=none` 中执行 [pi-image-check.mjs](../scripts/m0/pi-image-check.mjs)。它通过固定临时 preload 替换 fetch，在两个独立 Node 进程中运行实际 `--staging-fixture` 入口，验证首次完成、checkpoint 恢复、完整历史、固定 Skill、模型与生成参数。两次均使用 Pi SDK 0.85.0；[构建日志](evidence/runs/20260905T155750Z-167375ff/trusted-build.log)记录 `linux/x64`、`childCalls=2`、`passed=true`。检查生成的临时文件已移除，对应最终 layer 为空。

这是断网注入 SSE 的诊断，未建立真实 HTTPS 连接，没有云 DO 或供应商参与，synthetic ID 和 usage 均不是实际供应商证据。之前[本地 Workerd 的 10 项联调](evidence/runs/m0-proxy-pi-local-1788622591199-4e3a43ff/proxy-pi-local.json)绑定当时入口源码；本轮 Linux 检查不把那份记录改成新镜像的云验收。

[当前全检](evidence/runs/m0-local-20260905155634615/local-checks.json)为 192 项通过、1 项跳过、2 个自检通过，121 个源码文件摘要 `192d973b8caa5019c8fa10c6558ecab26b9d1486d8e0f8af9480f493f7ffba58`。[主控复核](evidence/runs/20260905T155750Z-167375ff/primary-review.json)记录当前源码、检查、镜像摘要与范围；独立审查另核对固定目的地、凭据边界及构建内容。

## 将发布的内容

本轮上下文只包含 9 个普通文件，无 symlink：`.dockerignore`、两个 Dockerfile、`package.json`、锁文件，以及以下四个运行/检查文件：

- `services/runtime/controlled-pi.mjs`
- `services/runtime/proxy-pi.mjs`
- `scripts/m0/proxy-pi-child.mjs`
- `scripts/m0/pi-image-check.mjs`

Trusted 镜像实际 COPY 的六个文件（上述四个加 package/锁文件）逐文件与冻结上下文和当前源码 SHA 一致。还包含官方基础镜像、生产 npm 依赖、镜像配置/历史及 BuildKit provenance。旧 `pi-live-probe.mjs` 和 `pi-probe-evidence.mjs` 已移出镜像 COPY/白名单；仓库中的历史文件和证据保留。Project 不复制本项目代码。此校验不构成全部第三方基础层的安全审计。

`.local` 的文件内容、凭据、Git 数据、UI、文档和证据均没有打包。**Provenance 元数据仍包含本地上下文相对路径 `.local/pi-image-build-20260905T155750Z-167375ff`、构建时间和 Git HEAD `16219ff…`**；这与打包该目录内容不同，也不能证明未提交源码属于该 Git commit。实际源码依据是本轮冻结清单与 COPY 摘要。发布范围包括这些元数据；未将其伪装为签名或受信 CI 证明。

## 构建过程偏差与处理

Trusted 实际执行了两次构建，Project 一次。子代理在首次工具观察超时后未正确续查运行句柄，误对同一新 tag 重新构建；主控发现后停止后续构建，保留原日志及收据。首次 trusted 开始时间为 15:58:21Z，独立结束时间/退出码未保留；第二次退出 0，检查步骤命中首次成功缓存。不能写成仅一次构建，或称首次有单独 exitCode=0 证据。

两段日志报告相同运行 manifest `4be14c…`，最终 manifest/config/六个 COPY 文件已独立重验。首次 index `1a6630…` 当前本地 content store 返回 not found，不能声称已重读首次 index；最终 index 为上表 `42eb9a…`，包含第二次的 provenance。原 `receipt.txt` 未覆盖，纠正信息以本页及主控复核为准。

构建使用专用 `riffology-m0` Docker daemon 和冻结上下文。npm ci 命中缓存，未观察到大基础 layer 下载；解析 registry 元数据仍有网络访问，不能声称整个构建离线。前后 `docker ps --all` 文件包含已有 Exited 容器；主控另查运行列表为空，未启动业务容器。构建当时没有上传、登录镜像仓库或创建云资源；后续公开发布见[2026-09-06 发布记录](m0-dockerhub-publication.md)。

## 云接线尚需完成

镜像内的固定命令为：

```sh
node /opt/riffology/scripts/m0/proxy-pi-child.mjs --staging-fixture
```

输入经 stdin 传入单次 capability、平台 scope、固定诊断 prompt、可选 checkpoint 和可信监督器分配的工作目录；不从项目读取目标 URL、模型或操作员凭据。该模式只访问既有 staging 代理 HTTPS origin 的模型/取消 POST，校验实际响应 URL、重定向和 fixture 标记。`--local-fixture` 才映射至 127.0.0.1:8794。

当前 [TrustedSandbox 出口](../spikes/m0-cloud/index.ts)仍只允许合成 health。真实 VM 已完成隔离与出口局部观测；云监督器、capability 注入和固定模型代理出口尚未接通；应在 Worker 中实现这些平台功能，并保留独立项目执行域。镜像发布、Cloudflare 拉取及 Worker/DO 版本关联已完成；下一步补齐云门禁。2026-09-06 用户已明确批准本页所列公开发布范围；浏览器标签显示 namespace `jihegao`，本机 Docker CLI 已完成官方设备授权（exit 0、Login Succeeded）。已公开发布到 `jihegao/riffology-m0-trusted-proxy` 与 `jihegao/riffology-m0-project`，保留本页唯一 tag；两份远端摘要及匿名访问核验通过，四套 staging 配置已固定运行 manifest digest 并通过预检，[Cloudflare 拉取及 VM 实测](m0-boundary-cloud-validation.md)已完成，完整门禁未通过。[发布证据](m0-dockerhub-publication.md)。无需再次询问同一发布范围，详见[环境确认](m0-setup-confirmation.md)。

真实 Go 调用继续遵循[既有预算与两轮候选方案](m0-model-proxy-budget.md)，没有因本轮两个离线调用或此前三个 fixture 调用而增加付费次数。M0 预算仍为 US$5，模型最多 US$1。
