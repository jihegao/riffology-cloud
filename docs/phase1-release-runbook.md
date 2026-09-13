# Phase 1 release runbook

本 runbook 只定义可审查的发布配置和证据，不执行部署。配置生成器 `scripts/m3/phase1-config.mjs` 是候选配置变换：它要求 `simulationImage` 与 `trustedPiImage` 都是带 `sha256:<64 位 digest>` 的固定镜像，加入 `SimulationSandbox`，设置 `M4_SIMULATION_ENABLED=false`、`M2_TURNS_ENABLED=false`、`M3_SERVICE_ENABLED=false`、`M3_PREVIEW_ENABLED=false`，并把租户容量从基础配置提升为 2、策略版本设为 `phase1-preview-simulation-v1`，同时记录 `TENANT_QUOTA_UPGRADE_FROM`。它不会部署，也不会隐式迁移配额账本。

证据校验器 `scripts/m3/phase1-release-profile.mjs` 只验证调用方提供的结构化 manifest。它不能把未观测、fixture 或测试 token 声明变成线上证明；Cloudflare Worker version、binding、Container inventory、D1/R2、浏览器和普通用户路径必须由独立步骤实际回读。

## Profiles

`isolated-acceptance` 是 `phase1-config.mjs` 生成的默认 profile。最终回读的四个 gate 必须全部关闭：`M2_TURNS_ENABLED`、`M3_SERVICE_ENABLED`、`M3_PREVIEW_ENABLED`、`M4_SIMULATION_ENABLED` 均为 `false`。最终 Worker version 必须仍是 source manifest 指定的同一版本，且 cleanup 后保持关闭。

`user-preview` 不是默认配置，只有独立 release wrapper 获得明确授权后才能使用。validator 本身没有打开门禁的能力；最终实际 Worker version 的上述四个 gate 都必须回读为 `true`，并且必须完成普通用户 smoke、清理、最终 inventory 和 cleanup 后的 smoke 记录。打开付费模型、真实 provider 或用户 Turn 的 E2E 需要另行明确授权；本 runbook 不构成该授权。

## Required evidence

manifest 必须包含 source `workerSha`/`workerVersionId`，与 source 相同的 final Worker version，按时间顺序完成的 `source`、`preflight`、`deployment`、`user-smoke`、`cleanup`、`final-inventory` 阶段，以及 Workspace/session 前后 Revision。实验记录至少包含三个不同 run 的 `experimentId`、`runId`、Revision、parameters、seed、completed result digest，并且 Revision 必须落在 Workspace 前后 Revision 之内、至少有一次同版本参数干预，且新结构版本至少有一个完成 Run。

Preview 必须记录与 Workspace 前后 Revision 一致的 `beforeRevisionId`/`afterRevisionId` 和实际变化。刷新前后的 `workspaceId`、`sessionId`、`runId`、`experimentId` 必须相同，证明刷新没有自动重跑。`user-preview` 还必须记录不早于最终 inventory 的 `finalSmokeAt`。`fixture=false`、`testToken=false` 和 `observedByOrdinaryUser=true` 是强制字段。

阶段顺序为 source → preflight → deployment → ordinary-user smoke → cleanup → final inventory。清理后再次核对 Worker version、四个 gate、Workspace/Experiment/Preview 状态、容器实例和配额账本，再生成最终 manifest。任何缺失、错链路、版本漂移、gate 与 profile 不符或仅有本地声明都阻断签收。

## Runtime evidence boundary

本地原生 ARM Linux Docker 运行只能证明在 ARM 主机、指定本地镜像和本地运行时下的行为，例如 schema、参数、文件和结果链路。它不能证明生产使用的 `linux/amd64` 镜像可拉取、Cloudflare Sandbox/Container binding 正确、Worker version 已激活、D1/R2/配额/网络路径可用，或普通用户线上 smoke 成功。生产验收必须使用实际发布的 amd64 digest、Cloudflare 资源和最终域名，独立回读版本、bindings、容器 inventory、持久对象和浏览器结果。

Issue #37 的容器复用仍是独立 ADR：先测量 cold start、容量等待、释放确认、复用命中率和失败恢复耗时，再决定优化；它不是 Phase 1 发布前置条件，也不能替代当前的安全释放与 recovery evidence。

## Local implementation limits

有限 Run 首版持久化声明的数值指标、不可变 JSON 摘要和最多 4 个候选输出文件（txt/csv/json/png，每个不超过 16 KiB，总计 32 KiB）。文件必须是输出目录下无链接的普通文件；平台先确认执行停止，再校验并写入 R2，全部回读成功才完成 Run。依赖首版仅支持标准库与固定 SimPy 4.1.1；多个重复试验、参数组比较和通用依赖安装均不在此接口中。Spec 在 Pi 创建或修改模型时随代码保存，缺少声明的空白/旧项目保持可对话，参数运行关闭。

历史 Revision 的保护沿用现有 GC 的保守策略：所有持久 Revision manifest 引用的 files/sessions blob 均保留，GC 不删除 manifest；Experiment 固定完整 source 引用。将来若引入 manifest 删除，必须先添加 Experiment 引用检查。R2 结果使用独立 simulation-results-v1 前缀，不属于现有 Turn blob GC 范围。

本地复核命令：`npm run check`。原生 Linux Docker 执行验收：构建 `tests/fixtures/simulation/Dockerfile.native` 后设置 `M4_SIMULATION_DOCKER_TEST=1 M4_SIMULATION_TEST_IMAGE=<本地镜像>` 运行 `node --test tests/m3/simulation-docker.test.mjs`。显式启用该测试而缺少镜像时应先构建，不把 skip 作为通过证据。
