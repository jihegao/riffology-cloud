# 受控发布与外部执行范围草案

日期：2026-09-15。状态：本地准备，**G0–G3本地通过，未发布、未执行收费模型任务，不是执行授权**。关联[计划](issues-subagent-plan-20260915.md)、[签收矩阵](issues-acceptance-matrix-20260915.md)。实施候选bafc48a完整check及主控独立整链通过；本清单用于补齐本次真实执行参数后审批。

## G4候选资源范围

- 应用候选仍为既有 `riffology-m1-gateway-staging` 与配置中的 `https://m1.riff-demo.gaojihe.cn`；实际装载源码、release profile、门禁、容器库存与待执行任务须在开始前重新读取，历史证据不替代本轮证明。
- 拟新增一个仅交付固定Worker/frame字节的 `riffology-browser-execution`。2026-09-15通过只读Cloudflare API核对账户Workers subdomain为 `jihe-gao`，同名Worker不存在。候选执行来源为 `https://riffology-browser-execution.jihe-gao.workers.dev`；这是提案，尚未启用workers.dev、上传代码或改变DNS。
- 应用与执行站点使用不同注册域；静态执行站点无R2/D1/项目/认证/LLM绑定，固定APP_ORIGIN/CSP与资产清单，拒绝查询、Cookie、Authorization、动态代码和API路径。现有执行配置默认origin空、workers.dev关闭，不能原样视为可用部署配置。
- 应用ASSETS必须包含本候选web源码和逐字节核验的平台固定runtime资产；旧profile对应旧host/renderer和执行资产必须保留。最终构建收据、源commit和资产SHA在G3通过后固定。
- 服务端发布使用原生产x86_64镜像和限制。G3 ARM64测试bridge不上传为生产镜像；Mesa生产镜像、Trusted Pi实际装载的新生成policy、回退镜像均须逐项记录不可变registry digest。

## 必须串行的真实验收

G4仅一个发布/门禁窗口：检查源码/镜像/profile后，普通用户空白项目分别Agent生成Schelling与Queue；初次建模、本地重跑、显式Verify分开计数。本地窗口所有云计算新执行为0；随后独立服务端Verify、历史输入/权限/失败恢复与显式baseline+intervention Evidence。完成三视口Workspace回归、R2与账本交叉核对，所有残留资源停止并释放后结束窗口。失败时先诊断unknown并按原身份恢复，不盲目重复发布。

G5的#46/#37与G6三模型按计划在后续独立窗口进行。执行前必须明确该次窗口的用户账号/entitlement、模型、最大任务/上游调用数、截止和费用上限；不能把旧token上限当美元授权，也不能把清单里的字符串当许可。

## 当前外部输入与冻结条件

- G3完整两模型真实产品链路与非作者审查已通过；最终`npm run check` exit0，1971项/1960通过/11 opt-in跳过/0失败，实施候选bafc48a。
- G4普通用户账号和所用通道的实际entitlement、调用/费用/时限范围：待指定并核对。
- #46真实OpenAI/BYOK账号、候选模型、Gateway配置、当前rate card、日志/隐私选择、任务目标及金额预算：待指定。示例manifest的null仍非执行值。
- G6普通作者、非作者审核管理员和新复制用户：待固定；不直接写catalog或替作者修改项目。
- 生产发布配置、迁移差异、原生产image版本与回退流程：待G3候选冻结后补全。

上述账户读取只确定提案命名和现有资源是否冲突，不证明应用的当前release/gates、配额或付费模型可用。本清单补全前不宣称任何issue已满足线上关闭门槛。

## 发布前只读快照（2026-09-15，非候选验收）

Cloudflare Deployments读取确认当前100%版本为 `f2a8e4e6-570f-4fef-be53-7bfbbf2cf25e`（deployment `3c6e4b73-f830-4c32-bc04-e7209a286f74`，2026-09-14T13:47:53Z）。Settings读取确认现有应用origin为 `https://m1.riff-demo.gaojihe.cn`，Turns/Model provider/Service/Simulation四门禁当前为true，旧Simulation image为 `registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-phase1-simulation@sha256:be02d18823ae778f3eb3d73e87772e90549c4f2a5a2e22777067ea5e6775f888`。

此快照没有修改任何门禁，也没有调用该线上模型。它仅提供发布前比较与回退候选；尚未核验当前Worker源commit、实际Trusted Pi模块、容器清空或新候选兼容性，不能作为本轮G4 sign-off。正式执行前重新读取；回退到旧Worker版本不能假定回退了容器image配置或新增资产，必须按冻结回退清单逐项恢复并核对。

只读Settings进一步确认当前PHASE1_RELEASE_PROFILE为 `user-preview`；Browser执行origin与lazy/reuse/version三项绑定尚不存在，不能声称当前线上启用了新Browser或warm路径。

## 本地生产镜像准备

已按 `Dockerfile.trusted-pi.vertical` 构建linux/amd64生产候选，local image identity为 `sha256:1a1acfa3b308ab6d4d9e3297f19940b63ac242156e55368c6a9b727531054e3d`。在该精确镜像里以无网络Node导入实际 `trusted-pi-release.mjs`，其摘要 `56e13a838baae1a994aff44c8fcb49bda1535332907607e070083239179f942d` 与release-candidate字节相同；六个实际复制模块均对照当前repo原字节。嵌入adapter摘要为 `fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898`，generation contract包含五文件/两固定profile/500steps/501frames及输出上限。没有调用resolveOptions或provider，没有上传镜像。

生产Simulation候选仍为G1本地image identity `sha256:1f9b5bbf70f74fde7764d7eb270e7616e9cf79a38c12418ddef8bb8bb1b1851f`。这些是本地身份，不是已上传Cloudflare registry digest，不证明线上装载或原生隔离。构建、actual-module probe及独立对照收据保存在ignored `g4/local-image-preparation`，含SHA256SUMS；G4须在上传后重新核对managed image manifest/config和实际SDK装载源码。

## 可复现的G4审阅包（零上游费用）

专用准备器：`node scripts/m3/g4-candidate-readiness.mjs`。默认只读本地源码、Git身份与资产收据，输出审阅检查及阻断项。`node scripts/m3/g4-candidate-readiness.mjs --output-dir=.local/g4-review` 可在**不存在的新目录**生成 `manifest.review.json`、`paused.review.json`、`userPreview.review.json`、`execution.review.json`。不会调用Wrangler、读取secret值、访问账号或Provider、上传镜像或部署。已有配置不变。重复默认运行清单稳定；新提交后必须重生成，不能继续使用旧sourceCommit。

这些JSON是审阅材料，**不是可直接部署的配置**：相对路径以原 `infra` 为基准；两张候选镜像未取得托管digest，overlay仍包含既有镜像。当前生成器故意拒绝把填入的授权/预算或上传digest当成已验证事实。后续执行工具须由主控依据具体审批单另行选择，不通过修改该清单绕过审批。

### 精确配置与门禁

| 项目 | 现有phase1配置 | 同源暂停overlay | user-preview提案 |
| --- | --- | --- | --- |
| PHASE1_RELEASE_PROFILE | isolated-acceptance | isolated-acceptance | user-preview |
| M2_TURNS_ENABLED | false | false | true |
| M3_SERVICE_ENABLED | false | false | true |
| M3_PREVIEW_ENABLED | false | false | true |
| M4_SIMULATION_ENABLED | false | false | true |
| M2_MODEL_PROVIDER_ENABLED | true | true | true |
| M3_PREVIEW_WS_ENABLED | true | true | true |
| M3_OBSERVER_ENABLED | false | false | false |
| Provider / Model | opencode-go / gpt-5.6-luna | 保持 | 保持；不替换成BYOK |
| Lazy/reuse/version参数 | 未登记 | 不新增 | 不新增；G5另审 |

应用：`infra/wrangler.phase1-staging.jsonc`，账户 `8b0d70250211aa10d89e20605a1c7e5e`，Worker `riffology-m1-gateway-staging`，既有三个应用/Preview路由不扩展。ASSETS固定 `../.local/browser-preview/gateway-assets`、binding `ASSETS`、`run_worker_first:true`。独立execution提案以 `infra/wrangler.browser-execution.jsonc` 为基准，显式同一账户，`workers_dev:true`、`preview_urls:false`；移除 `env.local`，固定 APP_ORIGIN为上述应用HTTPS，EXECUTION_ORIGIN为上述workers.dev HTTPS，`ALLOW_LOCALHOST_HTTP:false`。仅 `RUNTIME_ASSETS` binding，目录固定 `../.local/browser-preview/execution-assets`，无数据库、容器、Durable Object、Service或项目访问绑定。

### 源、资产、镜像与迁移身份

manifest记录实际生成时Git HEAD/已跟踪改动、两份原配置、两个Dockerfile、TrustedPi release模块、canonical adapter、native Mesa profile/requirements、package-lock、runtime profiles和static-index的SHA256。最终提交必须再次生成并确认工作树清洁。应用资产验证使用现有严格只读验证器，逐项比对当前static-index、40个app资产、当前web全文件清单与实际组合目录字节；缺失资产只会阻断，不伪造通过。

五个容器分别列出checked-in托管引用。ProjectRuntime、ProjectToolSandbox、ServiceSandbox保留原引用；TrustedPiSandbox与SimulationSandbox必须取得本轮**真实上传后的**托管 `@sha256`，当前 `candidateManagedReference:null`。scope中已观察的linux/amd64本地image ID只放在 `localImageId`，标明未由本准备器重新inspect；绝不当成上传digest或生产原生验收。G3 ARM桥接镜像不在候选范围内。

本地迁移清单固定 `0001_catalog.sql` 至 `0009_model_submissions.sql` 的文件SHA。远端已应用ID、待应用差异、回退schema兼容性为null：执行前只读取得实际远端迁移状态，与九项逐项对照。不能因为本地有九个文件就认定远端无需迁移；禁止未审schema回退。五个容器及R2/D1保持既有资源身份，不自动创建替代资源。

### 执行计数与必须由审批确定的参数

提案固定串行两种模型、两个初始Agent任务，每模型三次本地运行与一次显式Verify。本地运行允许的新增云Turn/容器/Experiment数量是零。纠错Agent任务数、追加研究Run数、修改假设任务数保持null，不能由失败重试自动扩展；baseline/intervention Evidence要求仍须完成，具体追加任务及其上限在审批单明确。此提案不是Provider实际call数预测，每个Agent任务可能包含多次Provider调用；现有每Turn八次dispatch/预算约束不等于本轮总调用或美元授权。

以下字段均为null并阻断执行：operator、账号引用、普通用户、entitlement、approvalReference、deadline、maxPaidCalls、maxNanodollars；Provider/Gateway日志、保留期、允许个人数据范围也均null。账号ID只用于核对候选配置，不能替代执行身份、预算账号或批准。G4不得把G5/G6预算合并使用。

### 逐项回退审阅顺序

1. 同候选源码关闭四门禁，重新读取Worker版本和门禁；有delivery-unknown先诊断，不重复收费请求。
2. Stop本轮资源，等物理释放，再读取五个容器应用库存及租约/费用账本；并记录暂停状态证据。
3. 刷新前述旧Worker版本/Deployment观察，并逐项确认旧五镜像引用与schema兼容；恢复Worker与恢复镜像是不同动作。
4. 保留旧host/renderer/frame/worker/依赖字节与平台冻结版本映射，禁止回退时删掉历史Revision依赖；新execution Worker的保留/停用取决于历史包的交付要求，不能直接删除。
5. 回读应用与execution来源、实际源码版本、门禁、配额、迁移和完整库存。旧版本回退不自动证明新历史包仍可读。

本轮本地定向命令：`node --test tests/m3/g4-candidate-readiness.test.mjs`、`node --check scripts/m3/g4-candidate-readiness.mjs`、默认准备器只读执行。检查证明候选材料可复现、配置不被改写、隔离和空授权约束严格；不证明发布、账号权限、收费额度或远端回退可执行。
