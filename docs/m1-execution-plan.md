# M1 身份、项目与配额执行清单

2026-09-06。前置 [G0 10/10 与共同候选](evidence/runs/m0-g0-accepted-20260906/progress.json)已通过，冻结源码摘要 `5178ec196a5ce48d1638688d9a43a0edb26f3dbd42889c0e3acb28ed2b31f43d`。本文件定义 M1 退出条件；已实现 Catalog、登录接线、配额、Workspace 初始化、用户项目页和受 operator 权限保护的管理端元数据页，并取得真实本地容器/R2 链路证据，具体范围见[运行手册](m1-local-runbook.md)，G1 尚未通过。

目标是两个受邀用户通过正式登录各自创建项目，项目创建在中断后可以对账，同一租户的并发配额由服务端原子控制。保留新仓库边界，不接回 `riffology-demo` 的路由、身份、数据或部署配置。

## 工作包与顺序

| 顺序 | 交付 | 负责层与文件范围 | 验收 |
|---|---|---|---|
| M1.1 | 核对一个受维护的登录方案与 Workers/D1 接入条件，冻结身份适配接口、D1 schema 和迁移 | 平台 Gateway / contracts / migrations；主控整合身份与权限决策 | 登录方案有官方当前依据；真实登录和测试身份明确分离；User、Membership、Tenant、Project 约束可执行 |
| M1.2 | 登录、邀请准入、服务端会话、撤权、Origin/CSRF 和 WS 准入 | 平台 Gateway；不从 UI 演示邀请码导入权限 | 有效/过期/撤回邀请；撤权后的旧 Cookie/WS 拒绝；无有效身份不能访问对象 |
| M1.3 | 项目幂等创建、不可变归属、初始化状态和持久派发 | Project Catalog + WorkspaceAgent，D1 投影 | 同键同内容返回同一项目，同键异内容 409；创建中断恢复后不重复建 Workspace；未就绪项目显示初始化状态 |
| M1.4 | TenantQuota 原子租约、释放和失联对账 | 每 Tenant 一个配额权威协调器；Workspace 只申请租约 | 同租户两个项目争最后一个名额只成功一个；重复释放不增名额；未知运行状态继续占额直到确认停止，不能仅靠 TTL 重发 |
| M1.5 | 用户项目页连接真实 API，管理端连接运维元数据和审计 | 用户端 / 管理端平台 UI | 两用户并行，刷新恢复；加载/空/失败/初始化状态区分；管理员无文件、对话、Preview、结果读取权限 |
| M1.6 | 本地集成、staging 两身份验证、故障窗口与 G1 独立复核 | 主控验收，独立审查代码与证据 | 四项 G1 场景完整，版本与证据一致，资源清理与配额对账完成 |

登录方案选型与身份配置核查先做只读评估；缺少外部身份配置时继续数据库、权限、项目与配额契约的本地工作，不能把模拟登录标为云验收。实际发送邀请邮件另需用户明确授权，开发过程使用测试收件箱或本地 outbox，不自动联系其他人。

管理端当前只实现平台概览、租户生命周期和项目计数、邀请创建/撤销、审计事件。邀请 token 使用 256 位随机值，D1 只保存 SHA-256；首次成功响应后不保留可再次显示的明文。同一 operator、操作与幂等键固定首次规范化 payload，丢失响应后的重试只返回原邀请和 `token: null`。

首个 operator 使用部署外的 `scripts/m1/bootstrap-operator.mjs` 建立唯一的 `initial_operator` 邀请。脚本要求显式 local/remote 数据库、从 `RIFFOLOGY_INITIAL_OPERATOR_TOKEN` 读取 64 位小写十六进制 token、从 Wrangler 子进程环境删除明文，只提交 hash；写入响应丢失后按邮箱和 hash 回读同一邀请，不另发凭据。受邀本人以已验证 Google 邮箱接受时，`0005_initial_operator.sql` 在同一 D1 事务中授予 operator 并写入审计；普通邀请不会授予角色，出现既有 active operator 时流程拒绝。仓库没有公开 bootstrap HTTP 入口，也不从客户端推导 operator。[staging 证据](evidence/runs/m1-first-operator-cloud-20260907/acceptance.json)已确认这条正式 OAuth、邀请、角色和首个项目链路；明文 token 已删除。

## 必须冻结的接口

- 服务端从合法会话解析 User，通过 Membership 确认 Tenant；客户端的 owner、tenant_id 和管理员角色不构成授权。
- Project 创建只接受标题、允许的起始包版本和幂等键。Tenant、Workspace、generation、内部资源名称由服务端生成；项目归属创建后不可通过普通更新改变。
- 幂等范围包括主体、操作、目标和规范化 payload 摘要，保存前先建立持久意图。D1 Catalog 与 DO 不具备跨存储原子事务，采用持久 outbox、幂等接收及状态对账处理部分完成。
- 项目状态至少区分 provisioning、ready、failed、deleting。运行控制仅在已确认的 generation 与租约下派发；迟到的旧 generation 响应不能把项目恢复为 ready。
- 配额租约绑定 Tenant、Project、Workspace、generation、操作与服务端期限；不能让不同 Workspace 各自维护同一租户剩余额度。
- 未归属的对象统一拒绝，不在响应中泄露存在性。平台运维角色单独授权；用户角色可以访问自己的项目内容，运维角色只访问允许的元数据和控制操作。

## 平台与项目内 Pi 的分工

本阶段的认证、邀请、Catalog、配额、Workspace 生命周期、存储提交、API/WS 鉴权和管理审计全部是平台功能，不能由项目 Pi 生成的 Python/JavaScript 接管。

项目 Pi 后续只在授权 Workspace 构建模型、项目应用、参数与实验内容。机场 Starter、仿真控件、项目 API 和结果解释在 M2–M4 接入；M1 不把这些业务逻辑嵌进平台项目列表或运维控制器。

## G1 证据与残余条件

G1 必须包含 staging 上受审计的首个 operator 引导、两真实测试身份的并行操作、对象 ID 篡改矩阵、同租户跨项目竞争最后一个配额名额，以及在创建各持久状态点中断后的对账。测试覆盖同键异内容、撤权竞态、晚响应和清理失败；源码、迁移、Worker/DO 版本及脱敏证据共同绑定。

首个真实身份和首个项目已经完成，项目为 `ready`，对应 outbox/receipt、734-byte R2 checkpoint 和停止后的 `inactive` Container 已对账。该证据只覆盖 G1 的第一身份主路径；第二真实身份、跨对象拒绝、最后名额竞争和故障窗口仍是签收条件。

正式身份接入后重验与 Preview 相同的授权链，后续 M3 完成产品 Browser 链路；不会因 M0 合成身份测试通过而跳过。当前 UI 4173 原型继续作为视觉与流程参考。

预算仍为 M0 已授权新增 US$5、模型最多 US$1，已执行的两次 Go 派发保持关闭，不重置额度。现金用量尚未完成对账；G0 通过不扩大金额、订阅、模型请求或生产发布授权。下一阶段先完成本地代码与可核对的部署清单，再检查实际云验证所需资源是否仍在授权范围内。

M1 staging 已完成[独立配置与放行计划](m1-staging-plan.md)：专用 D1/R2、Worker、三个 Durable Object、Container application 和 `m1.riff-demo.gaojihe.cn` 均已部署；正式 Google OAuth、首个 operator 和首个项目链路已通过。G1 尚待第二真实身份、跨对象拒绝、配额竞争与云故障恢复矩阵。

官方模型内容的本地扩展链路已通过：受控构建器生成唯一规范 JSON，私有 `MODEL_CONTENT` R2 binding 提供冻结包，真实 Gateway/D1/WorkspaceAgent/TenantQuota/ProjectRuntime/原生 Docker 完成逐文件安装核验、模型收据投影、checkpoint、停止与配额释放。[本地回执](evidence/runs/m1-workspace-20260907063137662/workspace-local.json)只使用隔离库会话和本地 R2，不代表云模型库、第二身份或 G1 签收。
