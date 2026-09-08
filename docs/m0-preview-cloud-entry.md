# M0 Preview 云入口

更新：2026-09-06（Asia/Shanghai）。旧 `riffology-demo` Worker、旧路由和 Tunnel DNS 已[退役](m0-legacy-retirement.md)。本页描述全新的 M0 staging 诊断入口，不是生产用户端工作台。

## 实际部署

| 项目 | 实测配置 |
|---|---|
| Worker | `riffology-m0-preview-staging` |
| 当前版本 / deployment | `5e5f3e22-69b2-460a-b03b-354d9d803c1d` / `23f0ba54-8306-4a76-ab8e-f55bea0fc9bb`，100% |
| 控制域 | `https://riff-demo.gaojihe.cn`，精确 Custom Domain |
| Preview base | `https://preview.riff-demo.gaojihe.cn`，精确 Custom Domain |
| generation 路由 | `*.preview.riff-demo.gaojihe.cn/*` → 新 Worker；应用只接受 `p-<32位十六进制 generation>` |
| generation DNS | proxied AAAA `100::`；没有指向旧 Tunnel 或旧后端 |
| Container 应用 | `a0332851-f795-46df-9f8e-ee0ddc220095`，basic，最多两个实例，默认禁用互联网 |
| 镜像 | `docker.io/jihegao/riffology-m0-project@sha256:c010768e37d6ad06da137308d30faf32b9ec7fcc21916f29f146c281c7a6946e` |
| secrets | 独立 probe / signing secret，0600 本地文件，首次公开路由前注入；不与 Boundary 共用 |

首次精确域部署于 02:03 UTC 完成；02:09 UTC 增补通配路由，Container 镜像无变化。两次 deploy 均 exit 0。[最终部署日志](evidence/runs/m0-preview-domain-deploy-20260906/wildcard-deploy.log)、[配置和 bundle 摘要](evidence/runs/m0-preview-domain-deploy-20260906/wildcard-deploy-result.json)、[API 复核](evidence/runs/m0-preview-domain-deploy-20260906/cloud-wildcard.json)与[严格部署清单](evidence/runs/m0-preview-domain-deploy-20260906/deployment-manifest.json)可交叉核验。

类型生成首轮因输出父目录不存在退出 1，创建目录后通过；dry-run 与[最终完整本地检查](evidence/runs/m0-local-20260906020555567/local-checks.json)通过，193 pass、1 skip、0 fail，源码摘要稳定。

## DNS 与 TLS 实测

Workers Custom Domains 自动创建两个精确域的证书申请。本账户返回的 Preview 证书包 `643ef831-a965-49f0-b45c-44c21e4ca9c2` 包含 `gaojihe.cn`、`preview.riff-demo.gaojihe.cn`、`*.preview.riff-demo.gaojihe.cn`。02:09:56 UTC API 确认 active。这是本次账户实测，不能由此宣称 Custom Domain 配置支持通配主机。[官方 Custom Domains 说明](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

初次 TLS 检查时 Preview base 握手失败，保留[初始记录](evidence/runs/m0-preview-domain-deploy-20260906/https-initial.json)。证书 active 后，[公网检查](evidence/runs/m0-preview-domain-deploy-20260906/https-active.json)对三个主机均取得 curl exit 0、ssl_verify_result 0：

- 控制域匿名 `/health`：403 `browser-session-required`。
- Preview base `/health`：403 `preview-origin-denied`。
- 不存在的 generation `/health`：404 `preview-route-not-found`。

未关闭证书校验，未使用本地 CA 或 hosts 替代 DNS，没有主动购买证书订阅。上述检查证明 TLS / 路由 / 匿名拒绝，不证明已启动可交互 Preview。

## 浏览器验证与边界

已使用严格部署清单与本地 token-only 输入启动有界云浏览器驱动：业务上限 300 秒 / 600 请求 / 8 MiB，另有 45 秒、最多三次清理请求；最多两个 Preview 实例。身份为服务端合成 alpha / bravo，不是生产用户登录。[首轮云驱动](evidence/runs/preview-cloud-1788660667710/artifacts/preview-cloud.json)在 75.9 秒后因备用 workers.dev 直连超时失败：已通过自定义域的 16 条匿名入口检查，第 17 次请求未完成，未启动浏览器或 VM、无变更操作。驱动原先设置 `agent:false`，绕过 Node 环境代理；现云模式使用默认 agent，显式 `--use-env-proxy` 生效，local 模式保持原直连 TLS。单独复测备用入口返回 403，TLS 校验保持启用。

[驱动修正复核](evidence/runs/m0-preview-domain-deploy-20260906/driver-proxy-review.json)记录原始及新 scoped 摘要、未改变的已部署 Worker/config/bundle，以及[全检](evidence/runs/m0-local-20260906021336511/local-checks.json)。这次只修改测试驱动，未重新部署 Worker。使用[新清单](evidence/runs/m0-preview-domain-deploy-20260906/deployment-manifest-proxy-driver.json)的[第二轮](evidence/runs/preview-cloud-1788660897238/artifacts/preview-cloud.json)仍在备用入口传输阶段失败，9.3 秒、17 请求、0 变更，源码稳定，未启动浏览器或 VM。因此代理设置修正不能写成问题已解决。

[进一步传输对照](evidence/runs/m0-preview-domain-deploy-20260906/transport-comparison.json)共九次匿名请求，其中八次 403，备用 workers.dev 的普通 `/ws` 一次达到 15 秒上限（ABORT_ERR）；同路径 WS 握手可返回 403。传输失败呈间歇性，尚未定位全部原因。

随后依据[范围决定](evidence/runs/m0-preview-domain-deploy-20260906/scoped-browser-run-decision.json)单独运行自定义域名浏览器矩阵，显式排除备用入口且保留两次完整驱动失败；不据此签收全部公网入口或 T07。[自定义域独立运行](evidence/runs/preview-cloud-1788661058387/artifacts/preview-cloud.json)实际启动 Chrome 152 和一个 Preview VM：5 case passed，随后 `document_JS_API_WS_and_iframe_load_with_isolated_httponly_credentials` 发生 AssertionError，运行整体 failed。已通过的项目包括自定义域原始入口拒绝、三上下文合成会话、复制票据对跨租户及独立同租户会话拒绝、真实 DO 并发一次性授权/兑换、借用所有者导航不能消耗原票据。

业务阶段 30.8 秒、74 请求、19,044 响应字节；清理 1 请求、109 字节、0.895 秒，返回 destroy_acknowledged。浏览器已关闭，源码前后稳定。浏览器另记录 37 个完成响应、4 个失败请求、3 个 WS 帧，不能据此宣称完整 iframe / WS 测试通过。API 单实例复核确认 02:18:11 UTC 已 inactive；[最终全部实例复核](evidence/runs/m0-preview-domain-deploy-20260906/instances-final.json)记录三类应用，防止仅凭清理 RPC 判断停止。

下一步在 iframe 断言前增加无凭据的分项诊断：控制页/iframe 响应状态、secureContext、DOM Cookie 是否为空、Preview Cookie 的 HttpOnly/Secure/host/path 布尔检查，以及 principal Cookie 是否出现在错误域。当前收据只有 case 和 AssertionError，不能据此判断是应用 Cookie 泄漏、浏览器行为还是测试断言问题。先补诊断，再执行一次有界复验；备用入口的传输问题仍独立保留。

G0 仍仅 T06 正式签收；证书与路由就绪不自动通过 T07。生产登录、跨站第三方 Cookie、云错误归因及完整门禁须按各自证据复核。

## 最终技术签收（02:56 UTC）

[完整新运行](evidence/runs/preview-cloud-1788662851221/artifacts/preview-cloud.json)纳入 workers.dev，15 case 全部通过，46 条入口与 29 条凭据记录通过。iframe case 永久保存实际 Cookie 正反控制：两边均 HTTP 200、marker 正确，Preview 请求仅携带 Preview Cookie、控制页请求仅携带 principal。先前失败和首次成功收据保留。

[主控复核](evidence/runs/m0-preview-diagnostics-20260906/primary-review.json)核对 29 份 scoped 文件摘要、12 份与已部署版本一致的 runtime/config 文件、实际 Worker 100% 版本、Container 镜像与应用版本。最终 CLI 查询的 11 条实例记录均 inactive，无下一页。已正式[签收 G0-T07](evidence/runs/m0-g0-t07-cloud-20260906/G0-T07-gate-summary.json)，范围为 M0 平台控制 staging 身份、同站点不同 origin 的技术原语。

SDK getExposedPorts 为 0，结合源代码与全入口拒绝，未创建的 SDK capability URL replay 记为不适用；未来启用 exposePort 必须重开验收。M1 正式登录、跨站第三方 Cookie 产品支持、账单对账和运行日志归因不冒充已完成，也不作为原计划未要求的 M0 循环先决。G0 当前 2/10，尚未进入 M1。
