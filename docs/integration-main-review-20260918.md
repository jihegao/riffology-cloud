# 集成分支并入 main 的范围与验证

本次整合基线为 `main` 的 `40aee17ed810430ee71fa4afb02af6fecf59b26a`，集成分支为 `80936501d4b21bbe051380d829d4374c45387726`。集成分支完整包含该 main，累计 238 个提交、320 个文件，包含正式 Browser Preview、Workspace UI、持久化构建/版本绑定、Mesa 服务端 profile，以及 G4/G5 的预算控制、诊断和受控验收工具。它不是单独的前端样式更新。

本次使用独立工作树，保留原 main 工作目录的未提交开发改动。合并准备只清理四份模型 fixture 的末尾空行并更新整合说明，不改变模型算法、运行配置、隔离规则或付费门禁。

## 验证与评审

锁定依赖通过 `npm ci --no-audit --no-fund` 安装。浏览器固定资产经 `prepare-assets.mjs`、`execution/materialize.mjs` 和 `materialize-browser-preview-web.mjs` 生成，未使用更新收据选项；提交中的 profile、delivery 和静态索引校验通过。

全量 `npm run check` 已完成，退出码 0：UI 语法检查、TypeScript 类型检查通过；共 2176 项测试，2165 通过、11 跳过、0 失败。分组结果如下：

| 分组 | 通过 | 跳过 | 失败 |
| --- | ---: | ---: | ---: |
| M0 | 350 | 1 | 0 |
| M1 | 213 | 0 | 0 |
| M2 | 700 | 0 | 0 |
| M3 主测试 | 791 | 10 | 0 |
| Browser Preview runtime/execution | 15 | 0 | 0 |
| Phase1 脚本 | 9 | 0 | 0 |
| Model/G5 脚本 | 87 | 0 | 0 |

跳过项包含 opt-in Python HTTP/WS、冻结 Mesa/Queue 服务端 profile 和真实 Mesa interpreter 边界验证；未执行的项目不算通过。M0 evidence/preflight 自检另行通过。

独立真实 Chrome/Pyodide `browser-acceptance.mjs` 完成 31/31 项，退出码 0，包括 Queue/Mesa 执行、可视化播放、确定性、取消/超时、包篡改与网络/存储/消息隔离。验收产物位于本次独立工作树的 `.local/browser-preview/acceptance/`；六份产物的 SHA256SUMS 校验通过，并已查看 Queue/Mesa 截图。这是本地测试模型包的真实浏览器验收，不是登录用户线上预览验收。

验证基于 `6b4f0d017500c799b0d89bf41844abee337a9561`，后续只补充本说明。完整检查日志 SHA-256 为 `67c46976f87db0f4773382aab5872c2ae2007608a1217d5e756951a478ce705b`，浏览器验收日志为 `d2ec8c8b22b6eebc08287e17c166dff90ed0b29a7d9e1042ebaf75ffeb99c032`。`git diff --check origin/main` 通过。

本仓库当前没有 GitHub Actions 工作流，PR 也无托管 CI 检查结果；本地验证不能表述为 GitHub CI 通过。

本次人工评审重点为认证后的 Preview 访问、包的来源与版本绑定、初始模型发现和持久化事务、Worker 静态资产校验、浏览器运行隔离，以及 G4/G5 的任务接纳、幂等、预算和未知费用保留。评审参考 Cloudflare Workers 官方最佳实践及最新类型定义，验证仍使用仓库锁定版本。未发现阻止本次源码整合的确定性问题；没有开展独立第三方安全审计，也不将大范围整合视为全部生产路径的完整验收。

## 已知限制与后续工作

- [Issue #78](https://github.com/jihegao/riffology-cloud/issues/78)：普通登录用户实查发现已有 Mesa/Queue 的 `dependency-unsupported` / `python-unsupported`，测试项目混列、官方模型为空及状态文案不准确。本次不关闭该问题。
- #64、#65、#71、#35、#46、#37 的未完成验收按各 Issue 继续跟踪；分支整合不自动关闭这些 Issue。
- 2026-09-17 的发布记录明确未完成该版本登录后的 Queue/Mesa 线上验收。历史 G4 成功、本地真实浏览器成功和当前线上可用性是不同证据。
- 合并不包含部署、官方模型发布、线上项目清理、开启付费门禁、注册预算窗口或模型调用。
- 后续单独部署需要核验 D1 迁移 `0010_project_budget_routes.sql`、生成的静态资产目录、独立执行站点 origin、真实绑定/命名空间及关闭态门禁；不能直接把示例配置当作当前线上完整配置。
- 原本地主目录若仍有并行开发的未提交改动，更新其 main checkout 必须另行处理冲突；不得通过自动 stash、覆盖或重置来清理它。
