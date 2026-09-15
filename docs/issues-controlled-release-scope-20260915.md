# 受控发布与外部执行范围草案

日期：2026-09-15。状态：本地准备，**未发布、未执行收费模型任务、未完成G3，不是执行授权**。关联[计划](issues-subagent-plan-20260915.md)、[签收矩阵](issues-acceptance-matrix-20260915.md)。G3最终候选和检查结果完成后再冻结本清单。

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

- G3完整两模型真实产品链路、非作者阻断修复、最终`npm run check`：待完成；源码候选仍推进中。
- G4普通用户账号和所用通道的实际entitlement、调用/费用/时限范围：待指定并核对。
- #46真实OpenAI/BYOK账号、候选模型、Gateway配置、当前rate card、日志/隐私选择、任务目标及金额预算：待指定。示例manifest的null仍非执行值。
- G6普通作者、非作者审核管理员和新复制用户：待固定；不直接写catalog或替作者修改项目。
- 生产发布配置、迁移差异、原生产image版本与回退流程：待G3候选冻结后补全。

上述账户读取只确定提案命名和现有资源是否冲突，不证明应用的当前release/gates、配额或付费模型可用。本清单补全前不宣称任何issue已满足线上关闭门槛。

## 发布前只读快照（2026-09-15，非候选验收）

Cloudflare Deployments读取确认当前100%版本为 `f2a8e4e6-570f-4fef-be53-7bfbbf2cf25e`（deployment `3c6e4b73-f830-4c32-bc04-e7209a286f74`，2026-09-14T13:47:53Z）。Settings读取确认现有应用origin为 `https://m1.riff-demo.gaojihe.cn`，Turns/Model provider/Service/Simulation四门禁当前为true，旧Simulation image为 `registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-phase1-simulation@sha256:be02d18823ae778f3eb3d73e87772e90549c4f2a5a2e22777067ea5e6775f888`。

此快照没有修改任何门禁，也没有调用该线上模型。它仅提供发布前比较与回退候选；尚未核验当前Worker源commit、实际Trusted Pi模块、容器清空或新候选兼容性，不能作为本轮G4 sign-off。正式执行前重新读取；回退到旧Worker版本不能假定回退了容器image配置或新增资产，必须按冻结回退清单逐项恢复并核对。
