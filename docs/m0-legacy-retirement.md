# riffology-demo 退役记录

2026-09-06 10:16 UTC 再次独立核对：[Worker 查询](evidence/runs/m0-release-completion-1788689659147/legacy-workers-after.json)为空，[路由与 DNS 查询](evidence/runs/m0-release-completion-1788689659147/legacy-routes-after.json)确认旧根路由与两条 Tunnel CNAME 均不存在。当前 Preview 使用新 Worker 的专用通配路由；没有旧兼容入口。

2026-09-06 09:40 UTC，T10 发布与双回退后再次[查询](evidence/runs/m0-release-deploy-rollback-1788687343387/legacy-after.json)，旧 `riffology-demo` Worker 与旧路由均为空，没有恢复兼容入口。

历史复核：2026-09-06 08:20 UTC，[真实 Pi 部署与验证后](evidence/runs/m0-pi-live-cloud-1788682207606/legacy-after.json)，`riffology-demo` Worker 与旧路由仍不存在。当前唯一相关新 Preview 通配路由为 `*.preview.riff-demo.gaojihe.cn/*`，归属 `riffology-m0-preview-staging`；未恢复兼容入口。当前 [G0 为 9/10](evidence/runs/m0-g0-progress-live-20260906/progress.json)，下文保留各历史时点记录。

2026-09-06，用户明确要求不保留旧路由、退役 riffology-demo 相关 Worker，并继续新平台开发。此指令替代此前保留旧入口的临时安排。

[退役前快照](evidence/runs/m0-legacy-retirement-20260906/before.json)记录账号内 Worker、路由、旧 DNS、目标 Worker 的绑定名称与部署版本。没有导出凭据值，配置快照不等于含 Secret 和静态资源的完整恢复备份。

已完成四项删除，Cloudflare API 均返回 200 / success=true：

- Worker `riffology-demo`，最后部署版本 `0049c183-7d21-4687-9e08-7d4220913775`；其 workers.dev 和版本预览入口在删除前均已关闭，没有 cron。
- 路由 `riff-demo.gaojihe.cn/*`。
- 旧主入口 `riff-demo.gaojihe.cn` 的 Tunnel CNAME。
- 旧 Preview 入口 `riff-demo-visual.gaojihe.cn` 的同一 Tunnel CNAME。

[删除回执](evidence/runs/m0-legacy-retirement-20260906/delete-results.json)与[删除后复查](evidence/runs/m0-legacy-retirement-20260906/after.json)确认目标 Worker、路由和两条 DNS 均不存在。先删旧 DNS，再删路由与 Worker，防止 Worker 移除后旧入口回落至 Tunnel 后端。

账号中未发现其他 Worker 通过服务绑定依赖 riffology-demo；本次明确关联的旧 Worker 只有这一项。`cadence-ai-riff-studio` 使用独立的 `riffology.gaojihe.cn/*` 路由，没有关联服务绑定；2048、poker 及新 M0 Worker 均保留。没有删除共享 Tunnel、VPC service、后端主机、数据、模型凭据或其它项目。

`riff-demo.gaojihe.cn` 已重新绑定新 M0 Preview Worker；[新入口](m0-preview-cloud-entry.md)使用独立 generation 子域名、DNS 与证书，未恢复旧 Worker、旧兼容路由或 Tunnel CNAME。[Container 拉取与独立 VM 局部验证](m0-boundary-cloud-validation.md)也已继续执行；退役本身不关闭 G0 门禁。

03:16 UTC [再次查询 Cloudflare](evidence/runs/m0-legacy-retirement-20260906/rechecked-after-files-deploy.json)：旧 Worker、旧路由及两条 Tunnel CNAME 仍不存在；新 Preview DNS 为 AAAA `100::`，唯一相关 wildcard route 指向 `riffology-m0-preview-staging`。随后继续完成[云文件保存与恢复验证](m0-files-cloud-validation.md)。

04:37 UTC [再次实查](evidence/runs/m0-legacy-retirement-20260906/rechecked-after-tenancy-deploy.json)：账号内不存在 `riffology-demo` Worker，旧路由与 Tunnel CNAME 均未恢复；唯一相关通配路由仍归新 Preview Worker。继续推进 T02 / T04 云验证。

06:04 UTC [Recovery 部署后实查](evidence/runs/m0-legacy-retirement-20260906/rechecked-after-recovery-deploy.json)：旧 Worker 不存在，旧路由与两条 Tunnel CNAME 未恢复；仅有新 Preview 通配路由及 AAAA 记录。继续完成 [T08 云恢复签收](m0-recovery-cloud-validation.md)，当前 G0 为 6/10。
