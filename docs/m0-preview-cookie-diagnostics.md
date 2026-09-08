# M0 Preview Cookie 诊断记录

本文记录三次 Preview 云探针（`preview-cloud-1788661724558`、`preview-cloud-1788662248859`、`preview-cloud-1788662478279`）的 Cookie 与 iframe 诊断边界。文中不记录任何 Cookie、token、授权 URL 或其原值。

## 结论边界

三次运行均使用 server-owned synthetic principal，而不是产品登录；`product_login`、跨站第三方 Cookie 矩阵和 gate decision 仍为未执行/未评估（[第一次证据](evidence/runs/preview-cloud-1788661724558/artifacts/preview-cloud.json)、[第二次证据](evidence/runs/preview-cloud-1788662248859/artifacts/preview-cloud.json)、[第三次证据](evidence/runs/preview-cloud-1788662478279/artifacts/preview-cloud.json)）。因此以下结果是 Preview staging 的传输与边界诊断，不能写成生产登录或 G0-T07 最终通过。

## Playwright 存储查询误报

前两次 artifact 都记录了 `document.cookie` 为空、Preview Cookie 存在且为 HttpOnly/Secure、host/path 属性正确、控制面没有 Preview Cookie，但 `preview_has_no_principal_cookie` 为 `false`（[第一次](evidence/runs/preview-cloud-1788661724558/artifacts/preview-cloud.json)、[第二次](evidence/runs/preview-cloud-1788662248859/artifacts/preview-cloud.json)）。这项断言来自 `alice.cookies(frame.url())` 的存储枚举，而不是请求线上实际发送的 Cookie。Playwright 的 URL 过滤会对 host-only cookie 的域名做后缀匹配；同站点的祖先控制域 Cookie 因此可能出现在枚举结果中，造成“Preview 持有 principal Cookie”的误报。

当前 driver 已把判断拆成固定布尔值和实际 request wire 检查，并明确注释“Storage enumeration is not wire evidence”（[driver](../scripts/m0/preview-browser.mjs)）。实际线上控制应以请求头的 Cookie 归属为准，同时保留 `document.cookie === ''` 和 HttpOnly/Secure/精确 host/path 检查。

## 禁止人工重放祖先 Cookie

人工重放只允许把固定 fixture Cookie 集合中、与请求 URL hostname **完全相等**、根路径、HTTPS 安全且 HttpOnly 的条目带入请求；协议不是 HTTPS 时直接拒绝（[preview-cookies.mjs](../scripts/m0/preview-cookies.mjs)）。因此不得把控制面或祖先域 Cookie 复制到 Preview，也不得用人工重放绕过浏览器的 host-only 语义。driver 的 wire 断言分别要求 Preview 请求只携带 Preview Cookie、控制请求只携带主体 Cookie（[driver](../scripts/m0/preview-browser.mjs)）。

## 实际网络正反控制与复验状态

第一次 `preview-cloud-1788661724558` 只保存到存储诊断，未运行 wire 检查。第二次 `preview-cloud-1788662248859` 首次加入 wire 检查，但 API 路径写错，Preview 请求得到 404；这不能用于判断 Cookie 隔离失败。第三次 `preview-cloud-1788662478279` 为 custom-domain-only staging 运行，15 个 case 全部通过，最终状态为 `cloud_checks_passed_gate_not_evaluated`（[第三次摘要](evidence/runs/preview-cloud-1788662478279/artifacts/preview-cloud.json)）。业务阶段耗时 140243 ms、306 requests、93565 response bytes；清理阶段耗时 1020 ms、2 requests、222 response bytes，4 个 Sandbox destroy acknowledgment 均有记录；这仍不包含云实例停止/计费核对（[第三次预算与清理](evidence/runs/preview-cloud-1788662478279/artifacts/preview-cloud.json)）。

当前 driver 已修为相对路径 `./api/state`，由 iframe origin 解析到 Preview API（[当前 driver](../scripts/m0/preview-browser.mjs)）。第三次运行执行了源码中的网络正反控制断言，包括成功路径、403/无重定向、Cookie 归属、CSRF/CORS、WS Origin、撤权和过期；但其最终 artifact 的 `iframe_diagnostics` 已被后续 case 覆盖为空，未保留该 case 的 wire booleans（[第三次 artifact](evidence/runs/preview-cloud-1788662478279/artifacts/preview-cloud.json)）。主控已将 wire 结果加入对应 case 的永久字段，后续仍在复验；本文不预写尚未完成的新复验结果。

## 部署范围

本次修复仅改变 driver/证据采集路径；Worker 没有重新部署。三份 manifest 保持相同 Worker `versionId`、`deploymentId` 和 container image digest，只有 `deploymentSourceSha256` 随采集代码变化（[第一次 manifest](evidence/runs/preview-cloud-1788661724558/artifacts/preview-cloud.json)、[第二次 manifest](evidence/runs/preview-cloud-1788662248859/artifacts/preview-cloud.json)、[第三次 manifest](evidence/runs/preview-cloud-1788662478279/artifacts/preview-cloud.json)）。后续复验须明确记录 driver 源码摘要、实际请求路径及 Worker 版本，且继续禁止输出 Cookie/token 原值。

## 完整复验结果

[最终完整入口运行](evidence/runs/preview-cloud-1788662851221/artifacts/preview-cloud.json)已通过全部 15 case，并在 `document_JS_API_WS_and_iframe_load_with_isolated_httponly_credentials.request_cookie_evidence` 永久保存两边 HTTP 200、marker 正确、无重定向和 Cookie 归属布尔值。备用 workers.dev 已纳入，共 46 条入口、29 条凭据检查。经[主控审查](evidence/runs/m0-preview-diagnostics-20260906/primary-review.json)正式签收当前 staging [G0-T07 技术门禁](evidence/runs/m0-g0-t07-cloud-20260906/G0-T07-gate-summary.json)，生产登录仍由 M1 交付并重验。
