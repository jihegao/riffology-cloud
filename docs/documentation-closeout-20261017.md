# 文档审计收口 — 2026-10-17

本次交付负责人 **@jihegao**；执行为独立文档分支，关联 [#211 / JHG-48](https://github.com/jihegao/riffology-cloud/issues/211)。本页是有日期的审计与交接证据，不另建路线图：优先级与状态仍以 [Delivery Project](https://github.com/users/jihegao/projects/1) 为入口，范围、启动条件和验收回到原 Issue/PR。此次只整理文档与证据，没有修改产品源码、权限、门禁、镜像或资源；没有合并、部署、删除内容或重放请求。

## 当前事实与历史分界

- [#235](https://github.com/jihegao/riffology-cloud/pull/235) 已合并为 `29da0349719dba23d5c9ce95b4b83b97ebf7091a`。源码 `services/web/project-view-local.js` 接受 `browser-local` / `native-dom/v1`；当前方向为用户浏览器原生 DOM 执行，不继续发展云端 Chromium/PNG。旧 js-frame、marks、600×420、五/七文件仿真合同退出目标，不作为可选 profile。
- [#236](https://github.com/jihegao/riffology-cloud/pull/236) 的 `04419a5b639cfc4555cf4bbf69f020301af4bcc8` 记录实际默认关闭发布：Gateway `b62db92d-693a-4043-9ad1-f126e3a70c64`、模块 `0475703a…`。公开资产首轮 95 通过/1 读取超时，明确授权的单 URL 后续通过，共 97 GET 验证 96 个不同路径；不改写为单轮全绿。真实普通 Pi 用户创建、保存、刷新/冷恢复与完整 JHG-56 仍待验收。
- 同一 #236 最新结果为：离线构建成功，镜像兼容 mock 在源码 owner/mode 检查失败，尚未进入 SDK imports；原容器清理已核对，Registry 凭据 mint 原结果仍 unknown。没有 Registry push 或线上 Pi 镜像替换。本轮只读引用，原执行者继续持有其 worktree、原请求和修复工作。不得把构建成功写成兼容通过，亦不得重新 mint/replay 绕过未知结果。
- 用户接受原生 DOM 页面可能外发已经授权交付的数据；不承诺硬性无外发、所有请求无 Cookie、硬 CPU/RAM 限额或任意库完整兼容。主站凭据/DOM 隔离、跨项目 scope、generation、撤权与迟到响应边界仍需保留与验证。
- 未来无浏览器 Rust 云端执行与计费沿 [#67](https://github.com/jihegao/riffology-cloud/issues/67)、[#68](https://github.com/jihegao/riffology-cloud/issues/68) 另立具体方案，不成为当前浏览器功能的商业化前置。

## #234 独有证据保全

按 #234 head `d55ca7fb0235fb5b0e6088fe81cf540f8a07ff95` 的 18 个变更文件逐字节比较 main 合并点与 #236 `04419a5`：两者均 **12 个路径不存在、6 个内容不同**。因此 #235/#236 没有完整承接 #234，单有摘要回链不能替代原始收据。

18 个文件以原目录结构、原字节完整归档在 [历史快照](evidence/pr234-historical-snapshot-20261017/README.md)。其中保留初始 ACK0→GET1 不一致、max0 hold、明确 max1 恢复授权、恢复 ACK/26 GET/23 checks、前后 witness、Worker reconciliation、公开资产与发布机器收据。恢复读回 SHA256 为 `f1df09ecee66055a3b065262b0b5108d9a6be64121b467f19aa8572b7f4f5ecc`。历史 max1/空实例列表是 08:43 UTC 的窄范围观察，不证明当前资源停用、零历史执行或零费用。

归档不是重新发布合同；不覆盖 main 原有文件，也不把当时“当前发布”改成今天的授权。所有来源 SHA、保存位置、SHA256 与比较结果见 [来源清单](evidence/document-closeout-provenance-20261017.json)。安全方案：本替代文档 PR 审阅并获批准合并后，再给 #234 添加替代链接并关闭；无需合并旧的整套发布状态文本。

## #217 / JHG-48 审计交付

保留原 head `2dacc5cb49933e0c6fa98b044396c4694a389af4` 的三份报告、四份机器证据；原发布索引另存历史快照。三份报告仅增加醒目的历史说明，原源码定位、65 点审计、34 项目清单、共享引用及外部评审失败均保留。机器记录保持原字节。

- “通用 host 尚未实现”属于 10/15 基线，现由 #235 已合并实现及 #236 默认关闭发布证据取代；完整用户可用性仍未完成。
- “缺 read:project”是历史访问失败。本轮 `gh project view/item-list` 成功；观察 #214 为 Acceptance/P1，#211、#209、#216、#228 为 Backlog，负责人均 jihegao。不据此声称 Project 写权限或 Linear 同步已验证，不自动将审计/产品改为 Done。
- 原审计中的运行期限、旧 PR 候选、旧 Preview 验收和删除计划均保留其当时语境。容量配置日期不扩展人类授权期限；本审计不证明固定 34 项目 purge 或旧资源退役已执行。
- JHG-48 范围为审计、冲突边界和证据入口，不等待全部功能或 purge。原任务整理记录的 33 卡/40 条依赖无环是历史读回结果，本轮未重新读写 Linear，不能冒充当前全图验证。历史任务正文仍需由其负责人按当前范围维护。

此次文档范围可提交审阅；审阅批准并合并替代后 #217 可注明替代关闭。#211/JHG-48 的最终验收及状态仍由负责人按审计范围确认，不用关闭关键词自动结项。#236 保持独立，由原执行者继续更新，是否合并须独立批准。

## 已接受的后续交接顺序

以下是本次用户决定的交接快照，不代表这些候选同时开工或取得线上执行授权。交付 owner 均为 **@jihegao**；具体编码执行者由 owner 在启动时落到原执行卡。现有实现不重新安排为从零开发。

| 顺序与原入口 | 执行分工与启动条件 | 可验证完成条件 |
|---|---|---|
| 先完成 Pi 兼容镜像：[#214 / #236](https://github.com/jihegao/riffology-cloud/pull/236) | 原镜像执行者继续；沿原请求先只读定位 owner/mode 失败，最小修复与新验证范围明确后再执行。文档执行者不接管镜像。 | 可信 image-mode 兼容通过及原 ID 清理，再独立准备 OCI/Registry 发布；真实普通 Pi 流程另验。当前失败与 unknown 不抹除。 |
| 本次文档收口：[#211 / #217](https://github.com/jihegao/riffology-cloud/issues/211) | 独立文档执行者；保全 #234、分开历史/当前事实，避开 #236 活跃文件。 | 来源摘要、JSON、链接及 diff 检查；审阅独有证据完整性；替代关系清楚，不宣称产品完成。 |
| 下一优先：[#228 / #231](https://github.com/jihegao/riffology-cloud/pull/231) | Pi 兼容镜像工作及本次文档收口后优先整合；基于届时 main 解决冲突，保留当前源码变更，不借用旧 head 的测试结论。 | 当前 `/api/me` 身份显示/复制；退出、换号、401 与迟到响应不残留旧身份；中英文、键盘、窄屏、剪贴板降级与相关完整检查。真实 OAuth/系统剪贴板单独验收。 |
| Pi 稳定后再审：[#209 / #210](https://github.com/jihegao/riffology-cloud/pull/210) | 清理候选旧反向迁移/5.6 生产回滚说明与 fixture 后重新审查；按实际引用决定过渡 reader，保留历史费用身份；不恢复旧项目。 | 最终 tree 的模型/代理/Pi/CAS、未知执行/暂停/账本保持检查；无自动 fallback；新模型镜像、profile/价格和账户访问、全新 Session 保存恢复/释放分别验收。 |
| 低优先级：[#216 / #225](https://github.com/jihegao/riffology-cloud/pull/225) | 不阻断上述交付；以最新测试目录重新核对重复选择，仅整理 i18n 选择范围。 | 全部唯一测试仍被选中，断言覆盖不减；i18n、typecheck、选择清单与归一化内容摘要验证。不得删测试掩盖失败，不能由局部耗时宣称完整 CI 加速。 |

当前 Project 已能读取，但本轮没有修改其字段或原执行卡状态；上述三项仍是计划交接，非已开始。文档 PR 推送后仓库协作者可访问该入口；没有原执行者的已读回执，不能声称对方已收到或接受分工。CI 零步骤额度失败既不代表源码测试失败，也不代表通过；本轮不重跑产品或付费验收。
