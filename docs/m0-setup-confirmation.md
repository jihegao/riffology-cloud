# M0 环境确认与接续步骤

更新：2026-09-06。后续用户明确要求退役旧应用，已完成，见[退役记录](m0-legacy-retirement.md)。用户已批准当前镜像公开范围、确认 Go 订阅额度，并指定测试域名。三项输入已收到，无需重复申请同一授权。[本轮核验记录](evidence/runs/m0-setup-confirmation-20260906/setup.json)区分用户报告、浏览器标签观察与 Cloudflare API 实测。

## 镜像发布

用户同意 [Pi 代理诊断镜像](m0-pi-proxy-image.md)列出的平台源码、依赖和 provenance 元数据公开范围。浏览器标签为 `Repositories | jihegao`；已发布到 `jihegao/riffology-m0-trusted-proxy` 和 `jihegao/riffology-m0-project`，使用已冻结的 `20260905T155750Z-167375ff` tag，不重新构建。

本机 Docker 官方设备授权已完成，CLI 返回 `Login Succeeded`、退出码 0。设备代码只通过当前交互呈现，不写入文档或证据。浏览器页面控制超时，用户已在官方激活页手动完成设备授权。本机配置文件权限已核对为 0600。[Docker 登录流程](https://docs.docker.com/reference/cli/docker/login/)

两份镜像均已公开发布，远端 index、运行 manifest、config 和 layer HEAD 均与冻结内容核对通过，四套 staging 配置已固定摘要并通过 dry-run。首次上传超时和后续按缺失层恢复的过程见[发布记录](m0-dockerhub-publication.md)。随后已完成[Boundary 云部署与真实 VM 观测](m0-boundary-cloud-validation.md)，证明 Cloudflare 已拉取并启动两份镜像；完整 G0 尚未通过。

## Go 账户

用户确认订阅有效，5h、weekly、monthly 三个额度窗口剩余均接近 100%。来源为用户报告，不是自动读取的精确余额。用户已确认 `Use balance` 关闭；既有授权总预算 US$5、模型最多 US$1 保持不变。没有新增真实模型调用。[预算与派发约束](m0-model-proxy-budget.md)仍需接入云模型代理。

## Preview 域名

用户指定 `riff-demo.gaojihe.cn`，并随后明确要求删除旧路由、退役 `riffology-demo`。旧 Worker、旧路由和两条指向旧 Tunnel 的 DNS 已[退役](m0-legacy-retirement.md)。没有保留兼容路由或重定向。

新入口由 `riffology-m0-preview-staging` 独立承载：控制域 `riff-demo.gaojihe.cn`，Preview base 为 `preview.riff-demo.gaojihe.cn`，每代 Preview 使用 `p-<generation>.preview.riff-demo.gaojihe.cn`。控制域在 Preview base 外；仍须依赖 host-only Cookie、CSRF 和主体绑定，不能仅凭域名结构宣称 Cookie 隔离完成。

两个精确主机已通过 Workers Custom Domains 创建 DNS 和自动证书申请。证书 API 返回的 SAN 包含 `*.preview.riff-demo.gaojihe.cn`；本次无需为每个 generation 逐一注册 Custom Domain，也没有主动购买证书订阅。通配 DNS 已建立，证书生效与完整公网矩阵的最新结果见[Preview 云入口](m0-preview-cloud-entry.md)。这一账户的实际自动签发记录不等于 Custom Domain 本身支持通配主机。[Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

新入口是 M0 诊断环境，不是用户端工作台或生产登录系统。G0 仍仅 T06 单项通过。
