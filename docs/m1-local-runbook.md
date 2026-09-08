# M1 本地运行与验证

当前实现包括平台后端、Workspace 初始化、`services/web/` 用户项目页和 `/admin` 平台管理页；`ui/` 仍由 4173 原型服务提供。没有云部署或真实 Google 账户交换。运行凭据不写入仓库、前端或命令行参数。

## 检查

```sh
npm run check
node scripts/m1/record-local-checks.mjs
```

`check` 包含 UI 语法、TypeScript、既有 M0 和全部 M1 测试。第二个命令另外保存不可覆盖的日志与源码摘要；不需要在检查已经通过且源码未变时重复执行。

M1 的 node:sqlite 测试执行真实 SQL 与事务，Workerd 测试执行本地 D1 和 SQLite DO。测试用的认证身份由内存内测试代码创建，网络出口关闭；代码没有把测试身份作为可部署的登录入口。Google 本身的签名和账户回调尚未做真实云验收。

## 首次初始化本地数据库

本地 `riffology-catalog-local` 是测试名称，不是现有云数据库 ID。七个 schema 在同一个迁移目录，Wrangler 按 `0001_catalog.sql` → `0002_auth.sql` → `0003_provisioning.sql` → `0004_operator_invitations.sql` → `0005_initial_operator.sql` → `0006_model_catalog.sql` → `0007_model_content_checks.sql` 顺序应用，并记录已经执行的迁移。

```sh
npx wrangler d1 migrations apply riffology-catalog-local --local --config infra/wrangler.gateway-local.jsonc
```

进入 staging 前以相同迁移序列核对实际数据库；不只检查 Catalog 表存在，也核对认证 schema 与锁定版本一致。

## 正式登录配置

使用 Google Cloud 的 OAuth Web client。主应用本地地址为 `http://127.0.0.1:8795`，对应回调为 `http://127.0.0.1:8795/api/auth/callback/google`。staging 固定 origin 为 `https://m1.riff-demo.gaojihe.cn`，对应回调为 `https://m1.riff-demo.gaojihe.cn/api/auth/callback/google`；它尚未部署，不能把旧 `riffology-demo` 路由或当前 M0 Preview 根域名当成回调入口。

Wrangler 配置声明三个必需 Secret 名称：`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。本地通过私有 env 文件或工具的安全输入配置，密钥长度至少 32 字符；不要把值写进本文件、Git 或聊天。`APP_ORIGIN` 只允许当前唯一主应用 origin。

```sh
npm run m1:dev
```

缺少身份配置返回 `authentication_not_configured` / 503。没有开发身份请求头、万能邀请码或管理员内容旁路。静态用户页和 `/admin` 可在身份未配置时加载，API 明确返回 503。管理端只接受当前数据库会话和每次请求重新核对的 active operator 角色；普通租户 owner 得到与不存在一致的 404。

首个 operator 不能从网页自授予。仓库提供一次性离线引导工具；调用者必须自行生成并保管 64 位小写十六进制 token，通过临时环境变量传入。脚本不会打印 token，不会把它传给 Wrangler 子进程，D1 只接收 hash。不要把 token 写入命令参数、Git、文档或普通日志。

```sh
read -rs "RIFFOLOGY_INITIAL_OPERATOR_TOKEN?输入已安全保存的 64 位 token："
export RIFFOLOGY_INITIAL_OPERATOR_TOKEN
npm run m1:bootstrap:operator -- invite \
  --email operator@example.com \
  --database riffology-catalog-local \
  --config infra/wrangler.gateway-local.jsonc \
  --local
unset RIFFOLOGY_INITIAL_OPERATOR_TOKEN
```

本地和远端必须二选一；远端只有在实际 staging 数据库、迁移和授权范围已经核对后才改用 `--remote`。同邮箱与同 token 可安全重试，异邮箱或异 token 拒绝。本人登录并接受该邀请时，数据库在同一事务创建个人空间、授予 operator 并追加两类审计；任一步失败全部回滚。普通邀请永远不会产生 operator。实际发送 token 或邀请邮件仍需另行授权。

## 当前 API

| 入口 | 权限与结果 |
|---|---|
| `/api/auth/sign-in/social` POST | 同源 JSON；库处理 Google OAuth |
| `/api/auth/callback/google` GET | 库处理回调验证；无有效邀请的新账户拒绝 |
| `/api/auth/get-session` GET、`/api/auth/sign-out` POST | 数据库会话；退出也要求同源 |
| `/api/invitations/accept` POST | 真实会话、已验证邮箱与一次性 token 共同准入 |
| `/api/me` GET | 已准入身份与当前个人 Tenant |
| `/api/tenants/:tenantId/projects` GET、POST | 当前 Membership；创建要求 Idempotency-Key，相同 payload 返回同一项目 |
| `/api/tenants/:tenantId/projects/:projectId` GET | 项目归属校验，越权与不存在统一拒绝 |
| `/api/admin/overview` GET | operator；平台计数与待处理状态 |
| `/api/admin/tenants` GET | operator；租户生命周期与项目状态计数，不含项目内容 |
| `/api/admin/invitations` GET、POST | operator；邀请列表与幂等创建，明文 token 只在首次成功响应出现 |
| `/api/admin/invitations/:invitationId/revoke` POST | operator；仅撤销 pending 邀请，重复请求不重复审计 |
| `/api/admin/audit` GET | operator；最近 100 条平台元数据事件 |

新项目返回 202 / provisioning，直到 WorkspaceAgent 真正完成初始化才可进入 ready。Gateway 会等待持久接收，DO alarm 独立推进；服务端 scheduled 扫描恢复未接收任务。ready 表示文件和 checkpoint 已确认，初始化容器已经停止，不表示持有常驻 VM。

## 容器与独立本地验证

使用既有 Colima `riffology-m0` profile 和项目专用 Docker 插件配置，保持不含用户凭据的原生进程环境。`Dockerfile.local` 复用已构建的 M0 本地镜像，只用于开发；云 staging 使用独立的 `Dockerfile.cloud`，固定 Node 22.19 linux/amd64 基础 manifest，不继承 M0 探针程序。

```sh
DOCKER_CONFIG="$PWD/.local/docker" \
DOCKER_HOST="unix:///Users/gaojihe/.colima/riffology-m0/docker.sock" \
npm run m1:dev
```

当前 Wrangler 在启动容器开发时会强制拉取 egress helper，DockerHub OAuth 请求在本机曾返回 EOF。独立本地检查直接使用 Miniflare 与已缓存 helper，采用同一 native Container API，不修改依赖包或全局 Docker 设置。`containerEngine.localDocker.socketPath` 必须包含 `unix://`；裸文件路径会使本地原生接入超时。

```sh
node scripts/m1/check-native-runtime.mjs
node scripts/m1/check-workspace-local.mjs
```

前者运行两个真实 Docker 文件系统并检查隔离和独立停止；后者使用真实生产 Gateway/Workspace/Quota/Runtime、D1、SQLite DO、alarm 与本地 R2，验证从创建到 ready。身份仅为隔离测试库中的 Better Auth 会话 fixture；脚本内存中生成的只读观测入口不会进入部署源码。证据写入新的不可覆盖目录，清理本轮实例。Workerd 的本地 Docker FUSE 权限属于专用 Colima 测试环境，不能用本地通过代替云隔离验收。

仅预览界面时可运行 `npm run m1:dev -- --enable-containers=false`；该模式不验证容器。Wrangler 本地不会自动触发 Cron；使用其提示的 `/cdn-cgi/local/scheduled` 测试入口触发私有扫描。M1 staging 首次验收配置禁用 Cron，故障恢复矩阵由受控请求驱动，避免无人值守触发容器费用；验证后再单独评估生产扫描频率。DO alarm 本地会自行推进。

浏览器行为测试使用已安装 Chrome；其他环境可通过 `M1_BROWSER_CHANNEL` 选择已安装的 Playwright channel。用户端覆盖项目创建重试和轮询生命周期；管理端覆盖无角色拒绝、邀请丢包同键重试、一次性 token、撤销、移动端溢出，以及请求记录中没有项目内容 API。API fixture 只存在测试网络拦截中，实际产品页面没有演示项目、身份或 operator 旁路。

## 本轮实际结果与后续

[完整检查](evidence/runs/m1-local-20260906141121538/local-checks.json)：M0 348 pass / 1 skip、M1 107 pass / 0 fail；246 个源文件保持一致，源码摘要为 `3ea864703c18f16f8c34d1741281a3df29a368410738ac3693a0491b7a910b7a`。[首任 operator 本地证据](evidence/runs/m1-bootstrap-20260906134338/bootstrap-local.json)记录第 5 个迁移、离线工具和 Admission 原子授予；[管理端本地证据](evidence/runs/m1-admin-20260906130122/admin-local.json)记录真实 Worker 响应和 Chrome 行为。[真实本地初始化](evidence/runs/m1-workspace-20260906121130494/workspace-local.json)完成 R2 文件核验、原生停止和配额释放，最终 D1 ready。[只读云预检](evidence/runs/m1-staging-preflight-20260906141243339/staging-preflight.json)确认专用 D1/R2、dry-run、旧 Worker 不存在和所有 M0 历史实例 inactive；唯一阻塞是部署 secrets。[界面截图与实际 Worker 响应](evidence/runs/m1-web-20260906/browser-check.json)记录未配置真实登录时的用户端状态。

邀请管理、运维元数据页和首个 operator 离线引导已经本地接入，`0004_operator_invitations.sql` 与 `0005_initial_operator.sql` 已在本地 D1 应用。M1 云端已创建空的专用 D1/R2，配置与绑定 dry-run 通过；具体资源和放行顺序见[staging 计划](m1-staging-plan.md)。G1 仍待远端迁移、部署、首个 operator 引导、真实 Google OAuth、两用户云并行与故障验收。M2 将接入 Pi durable Turn、任意项目文件保存与新实例恢复；M1 的固定空白 checkpoint 不等于完整编辑器或模型运行能力。M0 的两次模型调用继续关闭，本轮新增模型调用为零。


## 官方模型内容验证与发布（本地候选）

管理员先用规范包构建器生成内容包，创建草稿并记录原始包的 SHA-256 和固定内容引用，然后在草稿行选择“上传规范包”。浏览器发送原始文件字节，服务端通过 `POST /api/admin/models/:id/content` 接收，最多 8 MiB。上传前重新验证规范包和摘要，并映射到私有 `MODEL_CONTENT` 桶的 `model-content/` namespace；不能覆盖已存在的不同内容。验证 API 通过当前 operator 鉴权后，重新读取包，检查规范 JSON、整包和逐文件摘要及初始归档兼容性。成功时在同一 D1 事务变更为 validated、写入不可变内容收据与审计；缺包、损坏、未配置验证器或收据不匹配返回 `not_ready`，不会把模型标记为已验证。

发布必须同时满足持久收据与重新读取的包完全匹配。状态变更的 SQL 再次检查 operator 权限与冻结内容引用，避免读取期间撤权仍能发布。同键已成功请求直接回放，不重读内容或重复审计；撤回不依赖内容存储可用。验证后的来源引用不可修改，需要变更内容时创建新版本。收据证明本次内容格式与摘要验证，不代表仿真语义、模型效果或恶意代码审查已经完成。

新增 `0007_model_content_checks.sql` 已纳入本地测试与 staging 预检迁移清单，尚未应用到云。部署前需先应用此迁移并配置独立 `MODEL_CONTENT` binding，再发布相应 Gateway 代码；目前没有从缺失收据自动补造证据的兼容路径。真实云上传、操作员端到端发布和双用户复制验收仍待完成；本地 Gateway/D1/R2 已覆盖上传、验证、发布与重试。


### 上传的失败与重试

上传成功只记录 `model.uploaded` intent 与审计，模型仍为 draft，需要另行验证和发布。operator 与草稿来源在读取 body 前、写 R2 前及接受审计时复核。内容写入和 D1 审计不能跨服务组成一个事务：R2 已写但响应或审计失败时保留不可变对象，下次相同请求通过回读摘要恢复，不覆盖、不重新生成内容。R2 写入使用条件创建，已占用 key 的不同内容始终拒绝。若写入期间身份撤销，对象可能已经存在，但不会写成功审计或升级模型状态。

浏览器用独立 UUID 作为请求编号，失败后重选相同文件会复用该编号。成功的同键回放返回先前确认结果，不重新消费上传 body；草稿来源固定摘要定义了该次上传目标。服务器不信任客户端的文件大小或摘要检查，仍对流式 body、原始包及回读对象执行有界验证。上传入口不提供删除或覆盖操作。
