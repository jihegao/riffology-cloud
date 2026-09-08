# ADR 0002：M1 身份、目录与配额权威

日期：2026-09-06。状态：选型和本地接线已实现；真实 Google OAuth、staging G1 和生产接线仍待验证。

## 决策

使用锁定的 Better Auth 1.7.3、Google OAuth 和数据库会话。实际安装版本与完整性记录在 package-lock.json；不采用邮箱密码注册、自动账户关联、邮件发送或 Cookie 会话缓存。Google 请求只需要本次登录范围，使用 online access。OAuth tokens 由库加密保存，密钥只从平台 Secret 获取。

Better Auth 当前提供原生 D1 数据库接入和迁移生成；本项目以实际安装包的 `getMigrations(authOptions)` 生成 `services/catalog/migrations/0002_auth.sql`，运行请求不自动修改 schema。[数据库与迁移](https://better-auth.com/docs/concepts/database)、[Google 接入](https://better-auth.com/docs/authentication/google)。

认证身份与平台准入分开：Google 的已验证邮箱必须匹配有效邀请，才能建立新认证账户；随后同一身份还须出示一次性邀请 token，平台才原子建立 catalog User、个人 Tenant 和 Membership。认证库的 user ID 是平台身份引用，邮箱不会直接成为项目所有者 ID。已有运维角色不能替代 Membership。

会话保存不可由客户端提交的 `platformVersion`。平台每次请求同时检查认证库会话和 catalog 当前状态/版本，撤权后旧版本会话不能继续使用。身份 Cookie、Google Secret、OAuth token 均不进入 Workspace、项目进程或前端文件。

## 数据库权威与竞态

平台目录使用独立 `catalog_` 表，认证库使用 `auth_` 表。Project 创建的项目、Workspace 保留身份、幂等意图、outbox 和审计在单个 D1 batch 中提交。数据库约束禁止项目归属切换与跨 Tenant Workspace 引用；未真正初始化前状态始终为 provisioning。

D1 batch 提供数据库内事务，但不能包含 DO/R2 的原子提交；跨存储派发需由后续 WorkspaceAgent 通过 outbox、幂等接收和对账完成。[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。

权限查询直接使用 D1 binding 的 prepare/batch，不复用 read-replication session。`first-primary` 只确保 session 首个查询在主库，后续查询可能到副本，不能据此声称所有撤权检查都是当前主库读取。[D1 Sessions](https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession)。已有用户接受另一邀请也按 invitation ID 追加独立审计；重试不重复记账。

TenantQuota 使用每 Tenant 一个 SQLite DO，仅限内部 RPC。DO 名称、Tenant、Workspace/Project 绑定和 generation 均校验；容量与策略版本落盘固定。过期或通信结果未知的租约保留占额，停止证据由可信运行监管器生成。配额通过不代表进程已启动、已停止或 Token 已结算。

## 请求边界

平台写请求必须携带精确主应用 Origin，跨站 Fetch Metadata 拒绝；JSON 请求限制为 8 KiB、5 秒。认证只暴露 Google 登录/回调、会话读取、退出和错误入口。应用不读取任意 `X-User`、Tenant 或管理员请求头作为身份。配置缺失时返回 503。

本地 Worker 配置关闭 workers.dev 和版本预览，没有云资源 ID、旧路由或真实身份密钥。生成的类型不向 Node 进程全局注入 Secret。真实 Google Web client 的回调地址需要在本地和 staging 配置完成后逐项核对；不以测试身份替代真实 OAuth 验收。

## 已验证与尚未证明

已实际执行 SQLite 事务、重开文件数据库、真实 Better Auth 钩子/签名 Cookie/数据库会话、Workerd/D1 启动和拒绝矩阵，以及 Workerd SQLite DO 的重建与跨项目配额竞争。身份来自本地 fixture，没有发起 Google 账户交换、邮件或模型调用。

尚未完成 WorkspaceAgent 消费 outbox、隔离 runtime 初始化、生产用户/管理 UI、真实登录后 Preview/WS 撤权、云 G1 和部署运维。受控 Pi 的生产 Turn、Run 和付费链路仍属于后续阶段。M0 历史签收保持其冻结版本，本次依赖变化不等于已经更新已发布镜像。
