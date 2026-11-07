# JHG-46：SDK 修复发布与全新项目验收包

固定输入、操作件及独审已经准备完成，**本批尚未获得新的执行授权**。原 a25f 批在 V1 页面超时后已停止：两个 Turn 保存与释放可信，原门禁已关闭，旧项目没有 Session2/T3。本包提议一次新的 SDK 发布和全新项目验收；保留旧请求、Revision、失败、费用与锁，不续用旧窗口。

[总固定输入](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/final-freeze-v1/frozen-inputs.final.safe.json)为11,160 B，SHA256 `c65b9f38a1086748617f1651fb8a448c19b80253619aba29c711b2d09238e657`；[公开 inventory](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/inventory.json)列全部可审文件。两份完整配置及发布前 metadata 仅保留在本机，公开文件保留它们的固定尺寸/哈希。旧作者稿、partial provenance 和 pending 文件保留原时点状态；本页与总固定输入补齐准备状态，不将未来运行回执伪造成已有证据。

## 固定输入与评审

| 输入 | 固定身份 |
| --- | --- |
| 源码 PR | [#257](https://github.com/jihegao/riffology-cloud/pull/257)，head `fca66cb0e1024b4e86bbbeb9a6d955b137599efa` |
| Gateway bundle | 5,774,988 B，SHA256 `304373a50d7a9ca8a99cdfbda0dcae261aa34d53727b757dfeb099c88efb5e0b` |
| 静态资产 | [96 项 manifest](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/build-candidate-v2/output/assets-manifest.json)；[正文 SHA 清单](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/build-candidate-v2/output/assets-sha256.json)，共53,784,755 B；94项不变、两份 web 脚本更新、68项不可变资产保留 |
| 原生 frame | `/project-views/63ebcd050b0ccf5019265070890bee69d99902120f2252c376678aff299d374b/frame.html`，正文 SHA 为路径中的63eb… |
| Gateway 操作件 | [manifest](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/gateway-ops-candidate-v1/operations-manifest.json)，4,317 B / `1f91432d7546a7dfce12aee5345b58048314590aa2c2e0881bd8372b17419598` |
| 有限门禁操作件 | [manifest](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/browser-gate-ops-candidate-v1/operations-manifest.json)，6,616 B / `88ed7584237cccf6c7ae2a61993622a9655e7446551f9740d5f411c282b3210f` |
| 新批身份 | batch `fb07e239-2cb4-4379-9581-5711d86a0f30`；发布 `1feadf24-3eb8-58be-abd7-872c68ab45e6`；门禁 `95b9b8c6-8d52-566d-8476-dfa3e02f6b79` |

[构建独审](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/reviews/root-independent-offline-build.safe.json)、[当前 dated baseline 独审](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/reviews/independent-current-baseline-review.safe.json)、[Gateway 源码独审](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/reviews/independent-sdk-gateway-ops-review.safe.json)、[门禁源码独审](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/reviews/independent-sdk-browser-gate-ops-review.safe.json)、[内容独审](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/content-candidate-v1/reviews/independent-content-review.safe.json)及[合同稿独审](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/reviews/independent-contract-draft-review.safe.json)均无 must-fix。新发布凭据/原始 ACK、实际合并证明、项目身份、窗口及 gate body 仍待新授权后按原回执派生；review plan 不会被覆盖，运行计划通过固定函数另存，不需要以后修改源码解锁。

## 执行顺序与上限

1. 按当时保护、review 和 checks 普通合并固定 #257；核实际两父 merge、origin/main 及全部选定生产源码与冻结构建一致。向既有 `riffology-m1-gateway-staging` 做一次固定 Gateway/assets 发布，页面准入保持关闭。资产协议仅允许一个固定 manifest session、服务端原 session 指定的上传桶和一次 Worker PUT。
2. 保存可信原 ACK，完成新请求的前后完整资源见证和实际 source/sole-active version 回读。随后对96资产公开、无 Cookie GET，逐项核完整正文 bytes/SHA；另 GET 新 frame 并核 SHA。静态核验完成后再进入普通用户 Turn。
3. 使用既有已批准普通受邀 owner 与原 OpenAI/gpt-5.6-luna profile，创建**一个全新 blank 项目、Session1**。[T1](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/content-candidate-v1/prompts/turn-1-create-skill.md)先普通 project_bash mkdir 成功，再写[固定 skill](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/content-candidate-v1/SKILL.md)，保存 R1 与原请求释放证据。[T2](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/content-candidate-v1/prompts/turn-2-build-v1.md)同 Session 真实 slash-load R1 skill，构建两页 V1/[2,3,5]，生成17KiB合成源文本及实际 artifactId/receipt，保存 R2；必须核原 canonical/Session head、runtime/tool/capacity 产品 authority 与完整 physical scope 释放。
4. 在一次有限 browser gate PUT **之前**安装并保留原 bounded 请求观察器，覆盖 hidden Model 首次 SDK 请求。仅 R2 与释放可信后，以新 create/R2/me/只读 SELECT 的实际 scope、actor、generation 与回执 quartet 派生一条有限 policy。首次切换 Model 是观察时刻，不代表请求开始；不用后续 poll200 代替初始轨迹。
5. V1 实测两页20/50、参数、Pause/Resume、订阅、artifact完整 chunks/body SHA、刷新和离开重入。只有 V1 通过，才创建唯一 Session2、发唯一 [T3](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/content-candidate-v1/prompts/turn-3-cold-edit-v2.md)，冷加载 R2 skill，仅改 docs 为 V2/[2,3,7]，保存 R3/释放并验证24/60及冷恢复。计划共三次显式 Turn，阶段失败即停；不重试页面、追加修复 Turn、恢复旧项目或向旧项目补 T3。
6. **若已有可信原 open ACK**，成功或阶段失败均在同一授权窗口内对原 owned policy 一次 DELETE。按原请求、body SHA、201/200及实际版本读取链派生 final-closed GET；未知 owner/ACK 不盲删。最终核 gate absent/default-closed、source/assets及全部资源保全、原用户 canonical/hold-clear/capacity、完整 physical scope 和 UI/frame/port/listener 退出。

保存、elapsed、available 或空 Dash 任一项不能替代联合释放证明；不要求将未公开内部 raw stop/lease字段冒充为已取得原回执。未知执行按原身份停止并保留锁、intent、ACK；仅只读对账，不自动重试、换 scope/provider 或回滚。

## 配置、身份与窗口

保留106 bindings/11 secret条目、25配置 exports、6容器关联、50 namespace、全部16 app及完整版本列表、镜像与配置。沿用已部署 ec8/v13；本批无 Registry 镜像导出/推拉/凭据生成、AMD/SSH/Docker、新代理路由、maintenance hold 或 image rollout。必需的资产 session JWT 只在本机临时用于固定上传协议，不公开、不传 AMD；既有本机路由可继续使用。

两项已接受平台差异沿用：目标 app 当前13/12滚动列表，更老版本可用性不作保证；最多一份已知 d03b… deployment / 8ef5… placement 的 basic/max1 空闲 VM 可 running、容器 stopped，仍可能计费。不将该例外扩大到新/unknown placement，不为清理删除或重启 VM。

[认证合同](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/contract-candidate-v1/authentication-contract.json)限定正确 Personal 账号、同用户既有六 scope OAuth 正常读取/必要续期，不新增 OAuth login/consent/scope；Safari 两个既有批准账号可在原应用正常切换。普通身份仍须 fresh me bracket 与既有只读 SELECT 验 accepted invitation/authVersion2/personal owner/非operator。观察不读取/导出 Cookie，不改 AppleEvents JavaScript 等设置。

新窗口从实际收到本批授权起≤4小时，且不超过 **2026-10-20 23:59:59.999 Asia/Shanghai**。模型、单用户/全局并发、每 Turn/tool 时限、监控与停止标准沿[原普通输入](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/contract-candidate-v1/ordinary-input.json)；不因无费用上限取消这些边界。费用无上限、明确欠费通知、保留计量/预留/usage/history，不改订阅、付款方式或自动付款；费用未知不记零。

## 已知平台行为与具体校验

[门禁请求构造](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/browser-gate-ops-candidate-v1/requests.mjs)仅接受可信新发布 ACK/afterRaw/全资源回执派生的实际 closed version 与固定3043 source。[精确注解桥](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/browser-gate-ops-candidate-v1/gate-transition-binding.mjs)先用原发布后的完整 projection 预测仅 settings/version.annotations 变为 `{"workers/triggered_by":"secret"}` 的哈希；当前 raw hash 必须完全相等，才能另存派生比较值。raw/derived 两值和原回执身份均保留，不任意忽略字段，也不把原 c36 桥泛化成白名单。

原 Unix 毫秒及严格 ISO 时间格式已有纯解析检查，policy body 按产品 parser 规范后再散列。原201/open实际版本及原200/close新版本分别绑定；DELETE 后闭门 getter从该原 ACK链派生，既有 publishedClosedVersion 保持不变，不修改源码来接受任意新版本。闭门106/11→开门107/12→闭门106/11的计数、同 actor/scope/generation、完整资源与 source 校验保留。

## 实际验证与尚未覆盖

[源码证据](https://github.com/jihegao/riffology-cloud/blob/fca66cb0e1024b4e86bbbeb9a6d955b137599efa/evidence/releases/project-view-native-sdk-deadlines-20261019.json)区分原57项检查绑定的早期测试 helper、相同四份生产源码，以及最终三项相关用例分别 Chromium3/3、WebKit3/3；typecheck、UI21/21和 frame 一致性通过。[固定 head CI](https://github.com/jihegao/riffology-cloud/actions/runs/39149750214)的原 attempt/job 于2026-10-18T17:41:30Z成功，14个顶层步骤通过；未据此推断历史账单解除，也未编造单项测试数或 skip详情。线上原初始 SDK 请求未完整捕获，本地复现不证明唯一线上根因。

[离线构建](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/build-candidate-v2/public-build-summary.safe.json)核477 Git源文件/1124模块（303Git+821依赖）、工具/依赖元数据及资产 before/after 字节；模块导出30项与配置导出25项分开。原 v1 post-build schema失误和 v2成功原回执保留，未以部分输出冒充完整构建。[参考 artifact 读取器](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/content-candidate-v1/read-checked-artifact.mjs)将原 Uint8Array chunks 连续连接并核完整正文 SHA 后才 JSON.parse，检查 envelope.content 前缀；JSON正文 SHA 与源文本 SHA 分开。其8个 synthetic案例只证明参考函数，重复输出格式运行不算额外8例。

Gateway initial13检查为历史作者观察，stdout未另存；最终 getter 两个真实 body fixture 各39 GET、compact/pretty均<16KB。[Gate最终9项](../evidence/releases/project-view-native-sdk-publication-acceptance-preparation-20261019/browser-gate-ops-candidate-v1/checks-final-v2/receipt.safe.json)包含三个真实 dated raw+3043 module 的 getter闭环，各53 GET且两种传输形式均<16KB；早期5/6的 fixture Buffer复制错误、重复9项运行均保留，不累加为额外独立案例。它们是本地 dummy GET，不是实际发布或新用户验收。

当前 fixed-input准备完成，实际新合并/发布/三 Turn/gate 回执尚不存在。#255/#257 In review，父 #214 仍未完成；#252按自身 host 范围 Done/Issue OPEN。Browser Preview 始终 local/unverified，完整 JHG-56矩阵单独保留。本批准备包含29次只读配置 GET，完整 raw配置保留本机；它们是 dated expectation 的来源，不能代替未来新请求的 fresh 前后见证。
