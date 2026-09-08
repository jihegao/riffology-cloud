# M0 云文件保存与恢复验证

2026-09-06，G0-T05 在独立 staging Worker / DO / Cloudflare VM / 私有 R2 上完成验证。验收依据是[开发部署计划的 T05](development-deployment-plan.md)：连续 20 次文件操作，提交后销毁重建，恢复的文件清单、摘要、权限和删除项一致，且恢复后仍可写入及重命名。

[云运行记录](evidence/runs/m0-files-1788664612564-25cdd006/files-cloud.json)包含 9 次新增、6 次修改、3 次重命名、2 次删除，以及恢复后的新增、重命名和删除探针。最终目录树为 5 个目录、7 个文件；Worker 和本地验证器分别从固定预期内容核算摘要。Linux guest 启动标识的 SHA-256 在销毁前后不同，新环境中原目录、暂存目录和临时 marker 均不存在。逻辑 Sandbox ID 复用，不能把这一点误写成复用了旧 VM 文件系统。

恢复只读取已提交的 R2 revision。两次保存生成连续的 generation / sequence 1、2；第二次 manifest 指向第一 revision，当前指针与第二收据一致，旧 generation 写入被拒绝。[独立 R2 读取](evidence/runs/m0-files-deploy-20260906/r2-independent-read.json)最初有两个 GET 因网络连接失败未完成；[只读重试](evidence/runs/m0-files-deploy-20260906/r2-independent-retry.json)后，10 个对象的实际长度和 SHA-256 全部与预期一致。失败记录保留，没有重放云文件运行。

部署为 `riffology-m0-files-staging`，Worker version `98cc1d73-0efe-4d6f-9e43-7616f841b8c3`；Container app `a03c0d4b-d529-4d81-a2b6-bfb901222a18` 使用已批准的 project 镜像 digest `c010768e37d6ad06da137308d30faf32b9ec7fcc21916f29f146c281c7a6946e`，basic，最多 2 个实例。[部署核验](evidence/runs/m0-files-deploy-20260906/deployment-verified.json)绑定源码、配置和 bundle 摘要；[实例复核](evidence/runs/m0-files-deploy-20260906/instances-final.json)确认唯一实例记录为 inactive，分页已结束。

本轮业务探针 7 请求、25,069 响应字节、22.119 秒；额外独立 R2 读取共 12 次 CLI 调用。没有模型调用。实际增量账单仍待平台对账，不将这些计数折算成已核实费用。R2 保留 10 个共 3,041 bytes 的 checkpoint 对象用于恢复审计，Sandbox 清理不删除 checkpoint。

[本地全检](evidence/runs/m0-local-20260906031327004/local-checks.json)为 204 pass、1 skip、0 fail，源码在检查、部署和云运行期间一致。云驱动限制请求、响应字节和总时长；未知运行请求结果只读查询已持久报告，不自动重放运行；服务端有 180 秒 alarm 和销毁超时。

[主控复核](evidence/runs/m0-files-deploy-20260906/primary-review.json)与[T05 签收](evidence/runs/m0-g0-t05-cloud-20260906/G0-T05-gate-summary.json)仅覆盖上述文件原语。Session 包明确使用固定合成内容，真实 Pi Session 由 T01 / M2 验收；并发项目写入、生产 durable Turn 和灾难恢复仍按各自阶段完成。这不降低 T05 文件标准，也不把整个产品提前算作完成。
