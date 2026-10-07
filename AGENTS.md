# riffoid 工作约定

当前 reviewAt 以已执行的 [PR #169](https://github.com/jihegao/riffology-cloud/pull/169) / #104 最新证据为准：2026-12-31 23:59:59.999 Asia/Shanghai；其文档尚未合并，下文旧 10 月 20 日 reviewAt 已被替代。M1 验收截止仍为 10 月 20 日，历史费用与账本保留。

## 任务入口与分工

- 开始产品开发或验收前，读取 [Delivery Project](https://github.com/users/jihegao/projects/1)、目标 Issue 及其最新评论/关联 PR，再核对 `docs/release-readiness.md` 和实际源码。旧标题中的 P0/P1、关闭状态和历史文档不能替代最新证据。
- Project 管优先级、当前交付状态和负责人；Issue 管范围、依赖、验收条件及证据入口；仓库文档管设计、发布快照和可复查证据。不新增平行路线图或多份手工任务状态表。
- 日常维护 Status、Priority、原生 Milestone、Assignees 四项。优先级按当前阶段比较：P0 当前阻断，P1 下一批优先，P2 后续候选。旧 Scope/Evidence 字段退出日常维护；证据链接回到 Issue/PR 和发布索引。

## 交付流程

- 状态顺序：`Backlog → Ready → In progress → In review → Acceptance → Done`。Ready 表示任务已明确且可开始；Acceptance 表示实现具备、目标环境或用户验收尚未完成。已合并的实现不得重新作为待开发排期。
- 每个进入 Ready 的 Issue 顶部必须说明：本次交付、明确不做的范围、依赖/阻塞、可验证的完成条件、证据位置；必须有一个明确交付负责人。给编码 Agent 一个这样的具体任务。
- 同时实际推进最多两项：一项 Pi 内测常态容量、一项已部署功能验收。Acceptance 队列不代表所有任务都已开始；执行记录应指出当前选中的那一项。
- 验收发现缺陷时拆最小修复并关联原验收项；大父 Issue 只提取当前必要子范围，不将完整架构/商业化范围拖入当前里程碑。
- 阻塞用 `blocked` 标签，并在 Issue 写清原因、下一项安全动作和解除条件。缺证据保持 pending，不伪造成功，也不反复重跑未知请求。
- 新增事项自动加入 Backlog；不要开启“关闭 Issue → Done”“合并 PR → Done”或“Done → 自动关闭 Issue”。Done 和 Issue 关闭都按各自验收条件人工确认；纯文档/离线任务按自身范围验收。
- 完成一次实现、评审、发布或验收后，将范围、实际验证、剩余缺口及证据入口回填目标 Issue/关联 PR，并更新 Project 到真实阶段。只有完成条件满足才使用关闭关键词。

## 当前产品方向

- 当前版本定义为 **riffoid Private Beta（邀请制内测版）**：面向受邀用户的受控内测版本，支持 Pi 提需求、修改 Python、保存 Revision、Browser Preview、参数修改与刷新/离开后继续。不承诺 Verified Experiment/Evidence、公开注册、商业 SLA、Credits/支付或多用户高并发。
- 当前里程碑仍为 [Pi 线上恢复与核心流程验收](https://github.com/jihegao/riffology-cloud/milestone/1)。[#87](https://github.com/jihegao/riffology-cloud/issues/87) 已完成执行隔离与有界核心流程验收，保持关闭；`docs/pi-developer-mode.md` 保留现有实现和证据边界，不重复开发或恢复已结束的临时窗口。
- 常态容量由 [#104：邀请制内测运行与常态容量](https://github.com/jihegao/riffology-cloud/issues/104) 承接。[#153](https://github.com/jihegao/riffology-cloud/issues/153) 已在原 `private-beta-capacity-v1` 完成 v2 meter-only 迁移：所有当前有效受邀用户及其新个人项目可参与，调用次数和费用额度不再作为准入上限；原计量、费用预留、历史隔离与审计保留。每用户一个 active Turn、全局并发、单次/Turn/tool 时限、监控告警及停止/退出标准仍为硬边界；授权 reviewAt 仍为 2026-10-20 23:59:59.999 Asia/Shanghai。实际开通/暂停和未覆盖验收以 #104 与发布索引最新证据为准。
- [#152](https://github.com/jihegao/riffology-cloud/issues/152) 的冻结旧项目清单已完成 3 个普通受邀 owner／9 个项目可恢复归档，原身份与历史回执保留。下一轮线上验收使用全新项目；owner 恢复与跨身份验收尚待真实认证身份。不得恢复旧项目或重放旧请求来绕过归档/执行边界。
- [#136](https://github.com/jihegao/riffology-cloud/issues/136) 使用独立受邀 Runs 容量门禁，沿用原 Beta pin/kill/邀请与 Legacy/G5 资源核对。源码已合并，普通受邀真实单次、对照及释放验收尚待完成；首次验收通过后才能宣称持续可用，不能以新 namespace、镜像发布或直接打开 M4 代替验收。
- 保留全局 kill switch，禁止自动 retry/provider fallback；未知执行立即隔离并暂停相关容量，不能通过新项目、policy 或窗口绕过。Turn 结束检查 runtime/tool/container 释放，释放未确认不返还容量；G5/M3/M4 继续关闭。
- [#101](https://github.com/jihegao/riffology-cloud/issues/101) 独立核对历史费用，不阻塞正常内测；原 usage、费用和预留保留。发现新的执行风险或原隔离失效证据时仍须暂停相关容量。
- 核心流程稳定后再推进首个官方 Queue 案例、受邀用户验证、邮箱入口和可选仿真技能；之后依据用户证据推进公开试用与商业化。邮箱登录仅在真实受邀者被现有登录阻挡时提前。
- 全面 Managed 替换、多 Agent、全面性能优化、完整 Credits/支付及团队/教学管理不自动成为当前前置。#73 保留 `retain-current-runtime` 的归档决策及证据边界；重启实验需要明确的新问题和执行范围。
- 官方案例沿普通作者建模、实验、提交、非作者审核、冻结发布、新用户复制运行的路径；不通过直接写库或管理员专用内容通道代替用户流程。

## 证据与执行边界

- 分开报告：已实现、已合并、已部署、公开/静态验证、已认证用户验收、付费执行验收。CI、首页 200、历史成功、fixture 或单一账号的局部测试不能替代当前版本完整线上验收。
- 证据标明日期、部署版本、模型/Revision/包身份、测试身份范围、实际行为、结果和未覆盖项。零云端执行要由请求轨迹与作用域内权威计数共同证明；隔离验收覆盖跨运行、跨项目及第二认证身份。
- Browser Preview 结果始终是 local/unverified。Verified Experiment/Evidence 必须由服务端针对冻结 Revision、参数、seed 与 intent 重算，不能提升浏览器指标为权威证据。
- 排期、创建 Issue 或合并代码不扩大线上门禁、付费调用和数据修改授权。执行前沿用已有明确授权；只在缺少必要范围时补齐身份、项目、provider、请求/时限与费用政策。
- 执行未知按原请求身份核对，不能自动重放或靠新项目、policyId、窗口、provider 绕过。只有可信执行终态而缺 usage 时才归为费用待核对；费用未知不记零、不清历史预留、不伪称结算。
- 保留用户变更、历史模型/Session/Revision、实验和费用证据。验收失败优先定位最小缺陷；不得借此重置账本、删除历史或扩张架构。

## 验证

- 先运行与改动风险匹配的检查；源码改动按 `package.json` 和现有 CI 运行相应测试。浏览器资产准备及完整检查步骤见 README。
- 文档/排期修改核对链接、事实、字段与 `git diff --check`；不为纯文字改动发起付费调用或线上实验。
