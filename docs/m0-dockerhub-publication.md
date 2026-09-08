# M0 Docker Hub 发布记录

日期：2026-09-06。用户已明确批准[镜像公开范围](m0-pi-proxy-image.md)，Docker CLI 已通过官方设备授权登录。此次发布使用此前冻结镜像，没有重新构建，也没有公开仓库凭据或项目数据。

## 远端镜像

共同 tag：`20260905T155750Z-167375ff`；运行平台：`linux/amd64`。

| 镜像 | 远端引用 | OCI index 摘要 | 当前核验 |
|---|---|---|---|
| Trusted | `docker.io/jihegao/riffology-m0-trusted-proxy:20260905T155750Z-167375ff` | `sha256:42eb9a36e2aa6098c9a146c5c0f149efe29f638d8d304efea523a592aa4002dc` | 匿名读取成功；index、运行 manifest、config 与冻结字节一致，22 个 layer descriptor 的 HEAD 摘要和大小匹配 |
| Project | `docker.io/jihegao/riffology-m0-project:20260905T155750Z-167375ff` | `sha256:1d82f27d7cd328aef4f7125e0e27fe42fa6a03803c97ca7783951aba385cf42f` | 匿名读取成功；index、运行 manifest、config 与冻结字节一致，21 个 layer descriptor 的 HEAD 摘要和大小匹配 |

Trusted 的[匿名核验](evidence/runs/m0-dockerhub-publish-20260906/trusted-remote-verification.json)不使用账户凭据；Docker Hub 公开仓库 API 也返回 `is_private=false`。层 HEAD 证明可寻址及服务端报告的大小/摘要，未重复下载所有大层。Cloudflare 拉取和云实例运行仍未执行，本页不关闭任何 G0 门禁。

## 失败与恢复

1. [首次 Docker push](evidence/runs/m0-dockerhub-publish-20260906/riffology-m0-trusted-proxy-push.json)达到 300 秒上限，CLI 被终止；Project 的 Docker push 尚未开始。保留[原始日志](evidence/runs/m0-dockerhub-publish-20260906/riffology-m0-trusted-proxy-push.log)，不能把其中多个 `Pushed` 当作整个镜像发布成功。
2. [认证 manifest 检查](evidence/runs/m0-dockerhub-publish-20260906/authenticated-manifest-check.json)确认 tag 尚不存在；[逐层 HEAD](evidence/runs/m0-dockerhub-publish-20260906/missing-layer-heads.json)确认三个约 45–48 MB 的层缺失，其中两个在官方基础仓库存在。
3. [基础层仓库间复制](evidence/runs/m0-dockerhub-publish-20260906/base-layer-copy.json)均退出 0。47,294,130 字节依赖层从本地 content store 读出并重验摘要，使用独立 regctl 配置、4 MiB 分块和单并发[上传](evidence/runs/m0-dockerhub-publish-20260906/dependency-layer-put.json)，约 39 秒完成、返回摘要一致。未改 Docker daemon 配置；未测量实际网络字节，不把层大小当作网络账单。
4. [首次 manifest 发布](evidence/runs/m0-dockerhub-publish-20260906/manifest-publish.json)成功发布 Trusted 的 runtime、attestation 和 index，随后因 Project 的 HEAD 非预期错误停止。[Project 单独续接](evidence/runs/m0-dockerhub-publish-20260906/project-manifest-publish.json)完成更多层后再次遇到 HEAD 非预期错误；错误原因为未分类，不推断为权限不足或限流。
5. 后续恢复保留已有内容，按 digest 跳过已存在层；HEAD 未确认时仅执行已获授权的、按内容摘要幂等的复制或上传，不将 HEAD 未确认写成对象缺失。提交所有引用对象后才发布原始 manifest 与 index，最后独立验证匿名访问。

Project 的[最终匿名核验](evidence/runs/m0-dockerhub-publish-20260906/project-remote-verification.json)通过；首次已发布状态的检查发生 `URLError`，保留[失败结果](evidence/runs/m0-dockerhub-publish-20260906/project-remote-verification-first-published.json)，仅对只读 HEAD 增加一次有界重试后重新核验。最终[发布恢复记录](evidence/runs/m0-dockerhub-publish-20260906/project-manifest-publish-resume.json)为 completed=true。

## 接续部署

四套 staging 配置已固定到核验后的 linux/amd64 运行 manifest digest，保留原有实例类型、实例上限、独立执行域与鉴权设置。[配置摘要](evidence/runs/m0-dockerhub-publish-20260906/staging-image-config.json)和[四套类型生成及 dry-run](evidence/runs/m0-dockerhub-publish-20260906/staging-preflight.json)均已记录，八次命令退出码均为 0。[完整本地检查](evidence/runs/m0-local-20260906005756440/local-checks.json)为 192 pass、1 skip、0 fail，源码摘要稳定；[主控复核](evidence/runs/m0-dockerhub-publish-20260906/primary-review.json)确认 Registry 发布与配置预检通过，当时 Cloudflare 部署和拉取尚未执行；随后已完成[Boundary 云部署及真实 VM 观测](m0-boundary-cloud-validation.md)。Cloudflare 可直接引用公开 Docker Hub 镜像，但并不缓存其外部拉取结果。[Cloudflare 镜像管理](https://developers.cloudflare.com/containers/guides/image-management/)

后续记录必须区分 Registry 发布、Worker/Container 应用创建、镜像拉取、实际 VM 行为与 G0 签收。此次公开镜像不代表云 Pi、真实模型代理、Preview 域名或完整平台功能已完成。
