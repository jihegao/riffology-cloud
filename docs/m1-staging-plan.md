# M1 staging 配置与放行计划

更新：2026-09-06（Asia/Shanghai）。本页记录 M1 云环境的资源边界、部署顺序和当前阻塞。它不把本地验证写成 G1 云验收，也不恢复已退役的旧 Worker 或旧路由。

## 已部署但尚未完成 G1 的资源

| 资源 | 当前值 | 状态与边界 |
|---|---|---|
| Worker 配置 | `riffology-m1-gateway-staging` | 已部署，当前 deployment 将版本 `beeb20f0-6346-405e-88ea-632ea87863d8` 配置为 100%；`M2_TURNS_ENABLED=false` 在 Runtime 接线前拒绝新 Turn |
| 测试入口 | `https://m1.riff-demo.gaojihe.cn` | 自定义域名已生效；首页 200，未登录 `/api/me` 401，未接管 M0 Preview 使用的根域名 |
| D1 | `riffology-catalog-staging` / `993f2fd9-a135-4a93-9caa-10828dec6635` | `0001` 至 `0005` 已应用；首个 operator 邀请已接受，个人 Tenant、operator 角色和首个项目已落库 |
| R2 | `riffology-m1-workspace-checkpoints-staging` | 私有 APAC bucket；首个 workspace 的 734-byte 初始 checkpoint 已下载并核对 SHA-256 |
| Container application | `riffology-m1-project-staging` / `a035c941-2207-406e-97aa-a42ab6e9d249` | 固定镜像 digest `sha256:bb9c…ba00`，`basic` 上限两个；首个真实实例完成初始化后为 `inactive` |
| 运行镜像 | `services/runtime/Dockerfile.cloud` | 最小 Node 22.19 运行环境，固定 linux/amd64 基础 manifest；不继承 M0 探针镜像 |
| 定时派发 | 无 | staging 首次验收阶段禁用 cron，避免无人值守空转和费用漂移 |

旧 `riffology-demo` Worker 的云端只读复核返回 `Worker does not exist`。M1 配置和预检同时拒绝 `riffology-demo`、`riffology-m0`、`local-catalog`、`workers.dev` fallback、旧 Preview wildcard 以及任何 cron。`riff-demo.gaojihe.cn` 是用户指定的新测试域名，与旧 Worker 名称不是同一个概念；M1 首轮只使用 `m1.` 子域名。

## 当前验证结果

`npm run m1:preflight:staging -- --cloud --dry-run` 检查配置、账号、Origin、资产、D1、R2、三个 Durable Object、声明式 DO `exports`、Container 上限、禁用 cron、五份 Catalog 迁移和 Wrangler bundle/binding。M1 作为新 Worker 直接使用声明式 class lifecycle，没有引入旧 `migrations` 数组。Wrangler dry-run 使用 `--containers-rollout=none`，不会单独更新已部署的云 Container。前一份[只读云预检收据](evidence/runs/m1-staging-preflight-20260906141243339/staging-preflight.json)保留为改用 `exports` 前的历史记录，不能代表当前源码。

本地另以 `linux/amd64` 构建 `Dockerfile.cloud`，容器内回读为 Node 22.19、uid 1000、工作目录 `/workspace`，并成功以非 root 用户创建和读取 workspace 文件。该结果证明镜像的最小文件权限，不证明 Cloudflare VM 已拉取或运行它。

云端十个 M0 Container application 的所有历史实例已逐一回读为 `inactive`。Wrangler 列表的 `LIVE INSTANCES` 列是应用容量配置，不能据此推断 VM 正在运行；当前没有为清理审计资源而执行删除操作。

部署 secrets 文件现已在被 Git 忽略的 `.local` 路径生成，权限 `0600`，并且只含：

- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

预检只检查名称、非空下限和文件权限，不返回或记录值。Cloudflare 只读回读确认 Worker 存在这三个 secret 名称。首个 operator token 不属于 Worker secret；离线 bootstrap 只把 hash 写入 D1。真实登录接受成功后，本机 token 文件已经删除。

[首位运营账号与首个项目云证据](evidence/runs/m1-first-operator-cloud-20260907/acceptance.json)记录正式 Google OAuth、bootstrap 邀请接受、个人 Tenant、operator 权限、管理端访问，以及 `G1 云验收项目` 从 D1 outbox 经原生 Container、R2 checkpoint、停止到 `ready` 投影的完整结果。第一次读取在两个写入动作后都短暂显示旧界面，刷新后收敛；远端 D1 明确关闭 read replication，回读也由 primary 提供，因此暂不把现象归因于读副本，后续以客户端写入响应合并和短时恢复轮询消除空白或拒绝闪烁。

[写入后 UI 收敛发布证据](evidence/runs/m1-post-mutation-ui-staging-20260907/deployment.json)已将成功响应合并到客户端视图：接受邀请后直接使用返回的 Tenant，创建项目后保留返回的项目卡片，直到服务端列表出现同一 ID。完整检查为 M0 348 pass / 1 skip、M1 108 pass、M2 85 pass；20 项云预检通过，已登录浏览器复核项目页和管理端均显示当前数据。

最新[源码稳定全检](evidence/runs/m1-local-20260906154722809/local-checks.json)通过：M0 348 pass / 1 skip、M1 107 pass、M2 42 pass；检查期间 260 个源文件稳定。M2 SSE 增量发布前的云预检为 20/20 passed；[发布收据](evidence/runs/m2-sse-staging-20260906153434/deployment.json)记录当前版本、唯一域名、未滚动的 Container digest、0 个运行实例，以及旧 Worker 10007 / 旧域名不解析。全检中新增的 alarm 与 Tool Bridge 协议还未部署。这些证据仍不代替两身份 G1 验收。

首次部署暴露两个本机构建问题：专用 Colima socket 缺少 `unix://` scheme，以及 Homebrew `docker-buildx` 未加入 Docker CLI 插件目录。两者均在本机修正；Cloudflare registry 的一次性 Docker 配置和临时令牌目录在发布后删除。失败尝试产生的旧 Worker 版本没有流量残留，当前 deployment 只指向上面的 100% 版本。

## 部署与验收顺序

1. **已完成：** 建立 Web OAuth client，写入私有 secrets，cloud preflight 20/20 passed。
2. **已完成：** 应用五份 D1 migration，部署 Worker/DO/Container application，核对 100% deployment、自定义域名、镜像 digest 和 0 个运行实例。
3. **已完成：** OAuth 品牌配置生效；指定 Google 测试身份完成 consent/callback 和正式 Cookie 会话。
4. **已完成：** 首个 operator 接受唯一 bootstrap 邀请并取得个人 Tenant；管理端权限与追加审计已回读，本机明文 token 已删除。
5. 建立第二个受邀测试身份，完成对象 ID 篡改、撤权、同租户最后一个配额竞争、初始化各持久点故障和刷新恢复矩阵。模型调用保持为零。
6. 停止测试项目并回读全部实例为 `inactive`，对账 D1/R2、配额租约、审计日志和 Cloudflare 用量。满足四项 G1 场景后再形成独立签收。

部署不会接管 `riff-demo.gaojihe.cn` 根域名；后续从 M0 Preview 切换到产品入口需单独形成路由交接记录，先确认新版本可回退，再移除 M0 route。
