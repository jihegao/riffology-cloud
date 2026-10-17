# 浏览器 native DOM 发布候选（2026-10-17，草案）

本包只准备替换 `riffology-m1-gateway-staging` 的 Gateway bundle 与变动静态资产，保持现有资源、配置和门禁。当前原生 DOM 实现已提交为 `e689beb4a1babd8546405181cf3daf74625ed59d`；这不是发布或已认证用户验收完成声明。用户已选择优先兼容现有 DOM JavaScript，并接受页面可外发已获授权的项目数据；其合同见 [浏览器本地合同](project-view-browser-local-contract-20261017.md)。

2026-10-17 09:40:49 UTC，经既有 **Personal** Cloudflare 连接器的 10 次 GET 冻结基线，全部 200；settings、deployment、原 app 前后读取稳定。线上版本仍为 `eae8764f-fda5-4241-9f51-cf01ecc46b00`，deployment 为 `0f9c6266-2541-41ff-877e-9e9bbb85f3a2`。从实际 content/v2 multipart 精确提取的 `index.js` 为 5,768,905 字节、SHA256 `d92548f0f07bb782527618dd26166b11985eaed1723801d6e65cb49b9a41ea78`，与上一发布的实体相同；fresh main 仍为 `1585280c76e55cae61f3969db5545f76edce678c`。

完整配置仅存于本地 `.local/jhg46-browser-native-publication-20261017/baseline-full.private.json`（0600，SHA256 `ce8277c2cfb39feba6ce93e09754525e9a02e68c03a41402bbc9c0c14c99680a`），没有请求 secret 值。settings 与 version bindings 完全相同：106 bindings（其中11个 secret 类型）、25 exports、6 个容器关联、50 个 namespace。实际 compatibility date 为 `2026-09-09`，三个 flags 为 `nodejs_compat`、`nodejs_compat_do_not_populate_process_env`、`enable_request_signal`。旧静态 wrangler 文件不能替代该线上配置。

原 app `a031ae38-f967-483f-ae2e-3dbed3d35268` 仍为 default scheduling，GET 的 instances 字段为1、max_instances 为1，完整 instances-v2 列表为空；镜像仍为 `742a5fd2…e2a5339`。既有字段差异的用户接受记录保留，未宣称其官方语义已证明。本轮没有 fresh 读取其他 app 的全部 versions，不能据这个局部列表推导账户全局零执行或零费用。远程 `PROJECT_VIEW_POLICY_JSON` 仍关闭，本地 `PROJECT_VIEW_BROWSER_POLICY_JSON` 仍不存在；本批不新增该 binding，浏览器准入继续默认关闭。

离线构建使用已安装 esbuild 0.28.1、neutral/ESM、现有 workerd 条件和 external 范式；捕获并核对1,123个 source graph 输入的构建前后字节，没有打包 Playwright 依赖。候选 `gateway.mjs` 为 5,774,530 字节，SHA256 `e2eef2c0b20c4d10c2757bea3dc38691f7df5459b9728a43fcb19d0bee0571e2`。源图 canonical SHA256 为 `15e70ad53230b696f3418e09143c6569e0903e9c245f2b6e9d880c908d49da4a`；固定 implementation commit 为 `e689beb4a1babd8546405181cf3daf74625ed59d`，其生产输入与完整检查时逐字相同。frame HTML 固定摘要为 `c68704b393d12755bc65e3b937666cfd7e0d2592bc1d8a5d60ff8287b0f3b58d`。

候选静态资产共96条：28条 web 资产、68条 immutable Browser Preview 资产。新增 `/project-view-local.js`，变更 `/project-views.js`，无删除；68条 immutable 与已发布冻结清单逐字相同。资产地址算法核对 installed Wrangler 4.129.0 的 hashFile 实现，并对全部未变资产与旧 manifest 校验相同。新 inventory canonical SHA256 为 `2c070d067c5b40344ada259d57e6efdc8b421a7daa0659fd3a2e31db6be3fafd`，manifest canonical SHA256 为 `af86f2031af0b781d5f4354f3fc8577d6c759e52936ee7b7ee0d9092e32fc14d`。具体文件和安全投影见 [候选机器证据](../evidence/releases/project-view-browser-native-publication-candidate-20261017.json)。

未来实际发布只允许基于 fresh 完整线上快照替换 `index.js` 与静态资产：logical bindings 保持106，wire 不含11个 secret 值并通过 `keep_bindings: ["secret_text","secret_key"]` 保留；25 exports、6 associations、全部 namespace ID、app/image/policies、其他 settings、日期/flags、资产路由保持。没有 migration、namespace/app 创建或修改，没有 container/model/Turn/Run。资产路由继续 `html_handling:none`、`not_found_handling:none`、`raw_run_worker_first:true`，并以实际回读核其余字段。

**准备边界：目前没有 metadata 或可执行发布请求。** 原受审 generator 固定旧100 bindings/23 exports 基线并新增 namespace，不能复用到本轮106 bindings 的纯替换发布；原 publisher/锁/旧 bundle/请求记录均未修改。按本批范围停于新 bundle、96资产、manifest 与只读快照；发布前还需最终 commit 身份、fresh 资源保留 guard、独立评审的纯替换 metadata/sender 和具体操作范围。未知 ACK 必须保留原 request/lock，仅查原身份，不能重新 PUT；回退仅用保留全部 lifecycle 数据的前向替换，不能套用旧 lifecycle 之前的版本。

完整 `npm run check` 已在 09:45:24 UTC exit 0：3,303 Node passed、13 conditional skips、8 Python passed；日志 SHA256 为 `122701a27f1d77ca21ef50d239bcf14ae06bb71f7efc67f876a3cf49fce91405`。前一小批6组本地 UI fixture 为112/112，check:ui 为21/21；它们不代表线上普通身份验收。离线初次准备因空目录复制 EEXIST 终止，修正脚本后完成，失败和原空目录另存本地，未发生云端请求或候选覆盖。本批 asset session/upload、Worker/Registry 写、凭据读取、UI 登录、容器/模型执行均为0。普通身份目前仅只读核对；真实保存、参数交互、刷新/恢复与隔离验收仍待后续具体范围，完整 JHG-56 不作为下一批开发前置。
