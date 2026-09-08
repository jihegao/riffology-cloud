# M0 镜像替代发布方案：本地待审阅产物

日期：2026-09-05。本页记录旧的冻结镜像。**当前接入 Pi 代理的新镜像见[2026-09-06 构建与发布范围](m0-pi-proxy-image.md)，已于 2026-09-06 [公开发布并核验](m0-dockerhub-publication.md)。** 下列 trusted / project 两份历史镜像均已在专用本地 Docker daemon 构建成功。 本页构建时目标仓库及公开授权尚未确定；2026-09-06 用户已批准上述新版镜像的公开范围，浏览器显示 namespace `jihegao`，CLI 设备授权已完成，见[环境确认](m0-setup-confirmation.md)。下文未获授权措辞只描述历史构建时点，不是当前阻塞。本记录不提出购买订阅，不授权部署，也不关闭任何 G0 门禁。

后续状态：下列镜像仍是构建时冻结的版本，不含新增 [Pi 代理客户端](m0-proxy-pi-bridge.md)和后续受控宿主改动。构建收据不覆盖当前工作树；用于云 Pi 接线之前必须更新构建上下文、COPY 和诊断入口，再生成新镜像与公开范围。下列历史 manifest、源码清单和上传状态保持原值。

本次仅使用 `unix:///Users/gaojihe/.colima/riffology-m0/docker.sock` 和仓库 `.local/docker`。没有执行 push、registry login、Docker run 或云资源创建；构建前后活动应用容器均为零。BuildKit 执行了 Dockerfile 的构建期 RUN，不等于启动业务服务。没有读取或传输凭据值，没有修改 daemon、SSH 或网络设置。

## 可审阅镜像与证据

完整命令、退出码、源码清单、构建日志、缓存观察及镜像摘要见[本地构建收据](evidence/runs/m0-registry-alternative-local-20260905125524016/build-evidence.json)。构建输入在运行前后稳定，其规范化清单 SHA-256 为 `41d7c7bcc93e1a31b7ec8815f04979a2f89389cff79158949fbda4d945e465ac`。它覆盖当前 Dockerfile、排除规则和 COPY 源文件；不能用仓库旧 Git HEAD 代替这个输入快照。

| 项目 | Trusted | Project |
| --- | --- | --- |
| 本地唯一 tag | `riffology-m0-trusted-alternative:20260905125524016-a3` | `riffology-m0-project-alternative:20260905125524016-a2` |
| 平台 | `linux/amd64` | `linux/amd64` |
| 成功构建退出码 | 0 | 0 |
| 成功构建耗时 | 2,194 ms | 307 ms |
| Manifest SHA-256 | `eab5723438fe6e5bc6482b79502b5e097639f1a14066ae3ac224e501904f41ac` | `dd7b4210a2c28bada26ef0aca1cb4cfae82918602b96cc2916c9a5045f39fdda` |
| Config SHA-256 | `6e79b2421d7c11638694e50dae871328105c946756a111258af7936dbbbe487f` | `ffa7f77ec007ce13c193e9280e3c06a9d46b37cbbd3aafca4c8c38f745eda3d0` |
| Manifest 中压缩 layer 大小之和 | 272,333,107 字节 | 361,823,969 字节 |

[Trusted manifest](evidence/runs/m0-registry-alternative-local-20260905125524016/trusted-manifest.json) 和 [Project manifest](evidence/runs/m0-registry-alternative-local-20260905125524016/project-manifest.json) 列出所有压缩 layer 的 digest / size；收据另存 config 中的未压缩 `rootfs.diff_ids`，二者不混用。两份 manifest 和 config 均从该本地 Colima VM 的 containerd content store 只读取得并重新核对 SHA-256。镜像未在远端 registry 验证，压缩 layer 大小之和也不是实际上传流量或费用。

Trusted 的三个 COPY layer 另做了本地内容校验：五个源文件的镜像内 SHA-256 均与冻结上下文一致，没有通过启动容器来检查。所有大基础层仍使用既有缓存；没有重新拉取大基础镜像。构建可能进行 registry 元数据解析，未将本次记录描述为全程零网络请求。

## 构建上下文与将公开的内容

已核对当前 [.dockerignore](../.dockerignore) 为默认 `**` 排除、逐项放行的白名单，且不存在 Dockerfile 专用 ignore 覆盖。本次进一步制作只包含下列 8 个文件的独占 context 目录，避免依赖扫描整个仓库：

- `.dockerignore`、`infra/m0-trusted.Dockerfile`、`infra/m0-project.Dockerfile`。
- `package.json`、`package-lock.json`。
- `services/runtime/controlled-pi.mjs`、`services/runtime/pi-probe-evidence.mjs`。
- `scripts/m0/pi-live-probe.mjs`。

白名单快照和原始 tar 保存在仓库 `.local/m0-registry-alternative-local-20260905125524016/`；tar 为 245,760 字节，SHA-256 为 `d516a6bf7ff01c583eb195eb3f7ac332c17c3e93948a5e7fc45209fdb2428b14`。`.local`、`.env*`、`.dev.vars*`、凭据文件、Git 数据、证据目录、UI 和其他源码均未被打包；没有读取这些排除目录的内容。上下文目录内没有符号链接。

| Dockerfile 的实际操作 | 公开镜像将包含的本项目内容 |
| --- | --- |
| [Trusted](../infra/m0-trusted.Dockerfile) `COPY package.json package-lock.json ./` | `/opt/riffology/package.json`、锁文件中的依赖版本、完整性摘要和公开下载地址，以及 package scripts 等平台结构信息 |
| Trusted `RUN npm ci --omit=dev --ignore-scripts` | 锁文件对应的生产依赖，包括 Pi、pi-server、Sandbox SDK 及其传递依赖；不是仅发布自己的五个文件 |
| Trusted `COPY services/runtime/controlled-pi.mjs services/runtime/pi-probe-evidence.mjs ./services/runtime/` | 完整受控 Pi 宿主与证据适配器源码 |
| Trusted `COPY scripts/m0/pi-live-probe.mjs ./scripts/m0/` | 完整本地模型探针脚本；包含运行时读取凭据的代码接口，但构建没有注入 live 凭据 |
| [Project](../infra/m0-project.Dockerfile) 没有 COPY / ADD | 官方 Python Sandbox 基础镜像和 ENV / EXPOSE 配置；没有本项目源码、权威 Pi Session 或平台凭据 |

两者还包含官方基础镜像、镜像配置与构建历史。当前检查确认构建输入边界和五个 COPY 文件，不是对全部第三方基础层的安全审计；发布前仍应审阅上述完整公开范围。元数据收据没有保存任何运行时 token 或凭据值。

## 构建失败与最终成功均保留

1. 两份镜像首次使用 stdin tar context 时，buildx 均在构建前返回 `ambiguous Dockerfile source`，退出码 1；改为相同白名单文件的本地 context 目录，没有改 Dockerfile。
2. Trusted 第二次使用 `--network=none`，基础层与 package COPY 命中缓存，但 RUN 的网络模式改变了缓存键；`npm ci` 因 `EAI_AGAIN` 失败，退出码 1，耗时 75,378 ms。该失败不是缺少基础镜像，也不代表供应商调用失败。
3. Project 在相同目录 context、`--network=none --pull=false` 下成功，复用了既有基础层。
4. 主控允许 Trusted 使用同一冻结上下文，以默认网络模式、唯一新 tag、`--pull=false` 和 120 秒上限再构建一次。实际 `npm ci` 命中既有缓存，两个当前源码 COPY 层重新构建，锁定 SDK 的真实 import 检查成功，退出码 0。没有重试上传。

对应日志：[Trusted 初次失败](evidence/runs/m0-registry-alternative-local-20260905125524016/trusted-build.log)、[Project 初次失败](evidence/runs/m0-registry-alternative-local-20260905125524016/project-build.log)、[Trusted 离线失败](evidence/runs/m0-registry-alternative-local-20260905125524016/trusted-a2-build.log)、[Project 成功](evidence/runs/m0-registry-alternative-local-20260905125524016/project-a2-build.log)、[Trusted 成功](evidence/runs/m0-registry-alternative-local-20260905125524016/trusted-a3-build.log)。

## 待授权的最小发布步骤

Cloudflare 官方支持直接拉取公开 Docker Hub 镜像，使用完整 `docker.io/<namespace>/<repository>:<tag>`，不需要为公开镜像新增拉取凭据。它不是任意 OCI registry 支持；其他 registry 不能自动绕过现有 Cloudflare Registry 上传问题。[官方镜像管理](https://developers.cloudflare.com/containers/guides/image-management/)

1. 用户指定有权限的 Docker Hub namespace / repository，批准公开上述平台代码、依赖和镜像内容，并提供受控上传权限。当前这些条件尚未满足；本地 tag 中自动显示的 `docker.io/library/` 不是用户拥有的发布仓库。
2. 在单独有界的上传任务中复制这两个已冻结镜像；未知上传结果先检查远端状态，不自动反复 push。验证远端 manifest、config、layer 摘要；若 registry 改写 manifest，必须记录新摘要并验证内容等价，不能沿用未经核对的本地摘要。
3. 只替换对应 `containers.image` 为已核验的完整远端引用，保留当前 trusted/project 两个独立 Container / DO、鉴权桥、出口策略、实例上限和版本记录，再进行获授权的部署及门禁验证。

此处没有创建 Docker Hub repository、配置 Secrets Store 或执行上述步骤。Docker Hub 拉取限制仍适用，远端上传和 Cloudflare 拉取均未验证；官方文档说明外部镜像不缓存，因此不将一次成功拉取推断为未来稳定可用。[镜像管理限制](https://developers.cloudflare.com/containers/guides/image-management/#use-pre-built-container-images)

## 裸官方镜像不能替代当前产物

两份当前 Dockerfile 已分别固定官方 `cloudflare/sandbox:0.12.9` 和 `0.12.9-python` 基础 digest，与 SDK 0.12.9 对齐。官方基础镜像可以继续作为基础；裸 trusted 基础镜像不包含当前锁定 Pi 依赖和受控宿主文件，不能直接替换后冒充同一版本。Project 也有明确的 pool 配置和端口元数据，换为裸基础镜像仍需重新核验差异。[Sandbox 镜像版本与扩展要求](https://developers.cloudflare.com/sandbox/configuration/dockerfile/)

[ADR 0001](adr/0001-pi-project-trust-boundary.md) 要求可信执行与项目代码使用独立执行信任域。官方文档同样指出同一 Sandbox 内共享文件系统、进程和 localhost；不能借镜像发布改为同 VM 多 Session 并缩减门禁。[Sandbox 安全边界](https://developers.cloudflare.com/sandbox/concepts/security/)

此前 [Cloudflare Registry 分块上传失败](evidence/runs/m0-registry-chunked-trusted-20260905111316067/result.json) 继续保留；本次本地构建没有证明该链路恢复，也没有证明 Docker Hub 上传、云实例运行、真实 Pi 模型代理、输入 token 计费上界、取消传播或 Preview 云域名边界。G0-T01 / G0-T09 及其余未完成门禁仍保持未通过。
