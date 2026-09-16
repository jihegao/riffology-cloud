# G5 隔离 Worker / Gateway 出口准备证明（2026-09-16）

本轮按用户授权新建完全隔离的探针 Worker 和专用 AI Gateway，用于判断 G5 是否可以从 Cloudflare Worker 出口继续准备。探针没有绑定主 Worker、Service Binding、DO、D1、R2、Queue、Container 或主站域名；唯一入口是专用 `workers.dev` 主机上的空 body `POST /probe`，需要256-bit operator capability。错误方法、query 和未授权请求统一返回404，无 CORS，响应禁止缓存。

仓库实现为 [services/g5-probe/index.ts](../services/g5-probe/index.ts) 和 [infra/wrangler.g5-probe.jsonc](../infra/wrangler.g5-probe.jsonc)。出站目标、Gateway、模型和方法均固定：只允许一次 `GET /openai/models`，`redirect=manual`、10秒总时限、64KiB响应上限、不跟随重定向、不接受调用方URL或header输入。请求关闭cache与Gateway日志并固定单次尝试；输出只含白名单状态，不回传原始响应、header、URL或凭据。主控复跑typecheck及6项定向测试通过。

## 实际结果

- 精确仓库版本部署为 Worker version `e32f8d7e-1f1c-46d6-9cf5-92062f41c68a`；活跃模块 `index.js` 8696字节，SHA256 `e4b09c57d7b110ae886b1c11a4bdf819122dd8db3d46e1edecdc85d85a4eb0a1`。
- Worker 仅有三项 `secret_text` binding；compatibility date为 `2026-09-16`，唯一flag为 `global_fetch_strictly_public`。未授权 GET 与带query POST均返回404。
- 独立 Gateway `riffology-g5-probe-20260916` 回读为authentication、BYOK-only和ZDR开启；collect logs、logpush与cache关闭；retry为一次/0延时/constant，fixed rate limit为32次/60秒。
- `2026-09-16T08:55:01.886Z`，SJC出口返回HTTP 200，模型 `gpt-5.6-luna` 存在，`inferenceCalls=0`。这证明独立 Worker 出口、Gateway鉴权、provider鉴权和模型可见性；没有调用 Responses，不证明余额、费用账本、付费推理或普通用户研究闭环。
- 本轮复用了已授权的现有 Gateway Run token；Cloudflare未提供这次操作可证明的per-Gateway token scope，因此不能称作Gateway-scoped token。没有读取或输出token值。

## 主 Worker 与 G5 准备

隔离探针成功后，A出口候选已按授权以closed-gate方式发布到主 Worker，当前版本为 `d72c0145-5124-415d-87bd-6aa82d82d4f8`、100%。活跃 `index.js` 4120280字节，SHA256 `ba7f989e7cf0de7ae16e67314e0875c79650b7235ebbc9887d4d617b190a1b03`，与原冻结bundle逐字节摘要一致；新的script etag为 `97cdfea5b3e5ea57d18bdac6677ab7dd325dee5a7d4236767eeb0d0ac35d896f`。45个vars逐项等于冻结A，两个production secret binding保留，新增flag已实际回读。六项门禁均为false，`G5_WINDOW_GUARD`、`G5_TOKEN_BUDGET`、`PRODUCTION_MODEL_BUDGET`仍各0对象，`catalog_project_budget_routes`仍0行，首页200；没有Project/Turn/Run admission、付费模型调用或两小时时钟启动。

已生成三个新的私有、不可覆盖候选overlay：A、B和B-cold均固定使用原冻结bundle SHA256 `ba7f989e7cf0de7ae16e67314e0875c79650b7235ebbc9887d4d617b190a1b03`，只增加 `global_fetch_strictly_public`、`no_bundle`和绝对固定bundle入口。逐字段核对确认其余45个vars、预算、window/profile/source、bindings、routes与各自原overlay一致。候选SHA256分别为：

- A `fe8f099913bc0ffc1100398223fa8c72318e61b583213e148277802ed6ea4f86`
- B `80e8914adb76c9af059e27a79832d62a7a20485756d57b247196a1b604b1bdbe`
- B-cold `cd3c88e2ca250eaed60f813e73ec5f921491f9d780f8526fd62f7757b9ab0ee0`

A已在门禁关闭状态部署并完成active module、etag、vars、bindings和namespace对象数回读；B与B-cold尚未部署。正式开始G5-A前仍须完成容器库存、生产Gateway配置和A release proof的最终汇总，然后才能按原预算/2小时规则决定是否开启门禁。进入B前须同样发布并回读B；B-cold只在冻结对照步骤使用。隔离探针和models 200均不能替代Responses及普通用户验收。

## 清理与证据

实际测试后已删除隔离 Worker及其公开路由，API独立回读为Worker不存在`10007`，hostname返回404；专用 Gateway已删除，独立回读为`7002 Not Found`。两份本地上传secret JSON已精确删除；原项目 `.dev.vars` 和现有Run token未修改。仓库源码保留，后续可以按同一契约重建探针。

[脱敏机器证据](g5-isolated-probe-readiness-20260916.json) SHA256为 `e01595f9a2ab44673fbb11faab9b8e5309be859669c09ac6e243d8a86a0e2f73`。同一字节已分别PUT至7天diagnostics前缀和30天evidence前缀，并独立GET逐字节一致。该新增证明不改写原冻结/readback证据。

Cloudflare官方依据：[Workers compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)、[Workers.dev路由](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)、[AI Gateway鉴权](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)、[AI Gateway日志控制](https://developers.cloudflare.com/ai-gateway/observability/logging/)。
