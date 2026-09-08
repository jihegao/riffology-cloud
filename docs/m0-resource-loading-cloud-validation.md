# M0 云 Pi 资源加载验证

更新：2026-09-06。[原 G0-T03 已正式签收](evidence/runs/m0-g0-t03-cloud-20260906/G0-T03-gate-summary.json)，[G0 进度为 9/10](evidence/runs/m0-g0-progress-live-20260906/progress.json)。本次将固定恶意文件放入 Pi 工作目录，检查首次启动与已保存 Session 恢复，再执行普通 SDK 发现流程作为正控制。模型响应来自注入的固定 SSE；没有真实供应商调用，不替代 T01 或生产身份接线。

## 实际结果

[云矩阵](evidence/runs/m0-resource-cloud-1788676841756/summary.json)共 8 次请求、5,208 响应字节、13.892 秒；无请求重试或未知写操作重放。Pi SDK 0.85.0 在真实 Cloudflare VM 中执行两次固定响应请求，首次及恢复阶段均完成。

| 检查 | 观察 |
|---|---|
| `.pi/extensions/poison.mjs` | 首次和恢复阶段 marker 文件均不存在，扩展清单为空，未新增工具 |
| 项目及 agent 目录 settings / models | 恶意默认模型和工具未生效，只保留平台指定模型，实际请求没有 tools |
| 伪造 Skill、SYSTEM.md、AGENTS.md | 未进入系统提示或实际消息；`/skill:m0-poison` 保持普通用户文本 |
| 正常固定 Skill | 平台仿真 Skill 同时存在于宿主系统提示和两个实际 wire 请求 |
| Session 恢复 | 新受控 Session 含先前 assistant 历史，实际请求也含该历史，snapshot 无合成凭据 |
| 普通 SDK 正控制 | 在上述两阶段之后，同一批文件被正常发现；扩展真实写入 marker 并注册恶意工具，伪造 Skill、settings/models 均可被识别 |

八个夹具文件都记录实际落盘大小和 SHA。正控制最后才执行，不能把它写入的 marker 误当成受控启动执行过扩展。两次 Session 位于同一个受监督进程中；跨实例中断恢复已有独立 [T08](m0-recovery-cloud-validation.md) 证据，本次不重复声称该范围。

## 部署与清理

Worker `riffology-m0-pi-host-staging` 当前版本为 `b30e9f9d-dc60-4ea3-985c-6c6291f20513`，100% 流量；[部署验证](evidence/runs/m0-resource-deploy-20260906/deployment-verified.json)记录 bundle `eb3a8f791810661affa65e2f5d986a793e3a0a385ca9f6ff9f711a3ada0f8e6c`、额外 Text 模块摘要和 21 项 scoped 来源。Text 模块内容与当前探针源码完全一致，运行时将其写入受控宿主目录。沿用已批准的可信镜像 digest，没有重新发布镜像。

[云绑定](evidence/runs/m0-resource-deploy-20260906/deployment-api.json)为 HOST namespace `6990a51e4a4d441caf6681d8e982e0c2`、PiHostSandbox namespace `3f54614572894e1394797b699602343d`。Container app `a0321718-f17e-4ccf-974a-fd447dde5920` 为 basic/max 1，默认禁用互联网。操作员凭据只进入 Worker Secret 和本机 0600 文件，不进入容器或报告。

[最终独立 API 查询](evidence/runs/m0-resource-deploy-20260906/final-api.json)确认唯一实例 `m0-ph-resource-loading-20260906-s` 为 inactive，镜像一致。运行报告 closed=true、operation=null、cleanup=confirmed，DO 审计保留；该探针没有 R2 绑定。实际账单仍待对账，响应字节不代表现金费用。

## 质量检查与边界

固定 API 仅允许当前 run 的 accept/report/cleanup、操作员鉴权和空正文，不接收任意命令或资源代码。accept 不重复派发；清理早于初始化也会保存关闭标记。每个 SDK 操作先保存意图，超时不假称取消；实际 RPC 结束前不启动下一操作或销毁实例，重启后未知意图需独立核对。

[部署前独立复核](evidence/runs/m0-resource-deploy-20260906/predeploy-review.json)发现 exec 已完成但 collecting 尚未提交的重启空隙，修复为 exec 前持久保存一次执行标记；回归确认重入不执行第二次。驱动总请求最多 100，业务最多 80，余下额度供清理；业务 240 秒、清理 90 秒，单请求 15 秒。

[完整本地检查](evidence/runs/m0-local-20260906063733403/local-checks.json)为 248 pass、1 skip、0 fail，151 项来源稳定。[主控复核](evidence/runs/m0-resource-deploy-20260906/primary-review.json)逐项核对云报告、请求日志、源码、镜像、部署与实例终态；这验证固定文件发现控制，不代表允许任意扩展后仍可隔离其行为。

[最终独立复核](evidence/runs/m0-resource-deploy-20260906/independent-review.json)接受原 T03 范围，完成后才写入正式签收；主控记录的 pending 字段保留其当时状态。
