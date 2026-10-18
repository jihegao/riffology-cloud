# Linear 关联与 Pi 扩展任务冲突复核 — 2026-10-15

> **历史审计快照（2026-10-15）**：以下“当前”、未实现、Project 权限及候选状态仅描述原审计基线，不是现态。当前产品决定、证据迁移与 JHG-48 文档验收见 [2026-10-17 收口](documentation-closeout-20261017.md)。原扫描/JSON 保持历史字节；不据此重新授权执行、删除或延长容量。

对应 [#211](https://github.com/jihegao/riffology-cloud/issues/211) 与 [审计 PR217](https://github.com/jihegao/riffology-cloud/pull/217)。当前目标保留通用项目页面、技能和保存恢复，**撤销仿真 Browser Preview 及全部旧案例，旧合同不作为可选 profile 保留**。本报告区分此前已授权完成的任务整理，以及用户随后限定为文档与清单的撤销增量。

## 已完成的执行卡整理

用户授权直接调整冲突任务后，三个既有 agent 分工回读并更新范围，root核对关联和依赖。共更新29个既有 GitHub Issue、新增2个最小 triage Issue；新增9张 Linear卡、更新22张既有卡及项目说明；三个开放 PR 的说明和任务关联已核对。数量及对象见 [执行记录](evidence/releases/pi-task-reconciliation-20261015.json)。这些是元数据操作，没有产品部署、付费执行、容量变更或数据删除，也没有关闭/重开 Issue 或写入 Done。

| GitHub 范围 | Linear 执行卡 | 唯一职责 |
|---|---|---|
| [#85](https://github.com/jihegao/riffology-cloud/issues/85) | 沿 GitHub 卡，不另建镜像 | 项目 AGENTS/skills/prompts 加载与来源；与页面主线并行。 |
| [#214](https://github.com/jihegao/riffology-cloud/issues/214) | [JHG-46](https://linear.app/jhgao/issue/JHG-46) | 通用 HTML/JS 页面、资产、路由、typed 只读订阅、基础保存恢复。保留原 In Progress 与10/20日期。 |
| [#209 / PR210](https://github.com/jihegao/riffology-cloud/pull/210) | [JHG-47](https://linear.app/jhgao/issue/JHG-47) | GPT6默认与原 actor 迁移；候选源码仍有5.6 reader及反向迁移，合并前待修订，未部署。 |
| [#211 / PR217](https://github.com/jihegao/riffology-cloud/pull/217) | [JHG-48](https://linear.app/jhgao/issue/JHG-48) | 审计、范围和关联，不以所有产品实现或实际purge为文档验收前置。 |
| [#212](https://github.com/jihegao/riffology-cloud/issues/212) | [JHG-49](https://linear.app/jhgao/issue/JHG-49) | 固定34项目与关联内容purge、防复活及原释放核对。未实现、未执行。 |
| [#213](https://github.com/jihegao/riffology-cloud/issues/213) | [JHG-50](https://linear.app/jhgao/issue/JHG-50) | 整个可扩展 Pi 不可信，平台权威置外；复用原租约/保存接口。 |
| [#215](https://github.com/jihegao/riffology-cloud/issues/215) | [JHG-51](https://linear.app/jhgao/issue/JHG-51) | 平台能力/资源与受监督构建服务，和计算依赖合同分工。 |
| [#216](https://github.com/jihegao/riffology-cloud/issues/216) | [JHG-52](https://linear.app/jhgao/issue/JHG-52) | CI和历史实现退役；不与purge重复拥有数据删除。 |
| [#206 / #207 / PR208](https://github.com/jihegao/riffology-cloud/pull/208) | [JHG-53](https://linear.app/jhgao/issue/JHG-53) | 初始文件与首会话上下文的小修复；旧Preview专项仍见下文待调整。 |
| [#219](https://github.com/jihegao/riffology-cloud/issues/219) / [#220](https://github.com/jihegao/riffology-cloud/issues/220) | [JHG-54](https://linear.app/jhgao/issue/JHG-54) / [JHG-55](https://linear.app/jhgao/issue/JHG-55) | PR203未解决评论分别triage：Comparison资格、首次预留ACK丢失。未真实复现，不宣称线上缺陷。 |

新 Linear 卡为3张 In Review、6张 Backlog，无新增日期或假完成。33卡、40条硬依赖核对无环、无缺失目标；purge、完整资源与全量CI不在页面主线硬依赖路径。JHG-22保留PR198已部署核心的Acceptance语义，移除旧全局阻塞；领域任务不再要求重做已部署核心。GIS改为后续可选且撤销原日期，未设新日期；这不恢复旧 Browser Preview 合同。

## 关联与自动化的实际边界

PR Review自动摄取有效。此前初次审查时PR210/217没有任务链接、本批也无自动任务镜像；该**历史快照**见 [原始记录](evidence/releases/pi-extensibility-conflicts-20261015.json)，不能再当当前状态。授权整理后，PR208只关联JHG-53、PR210只关联JHG-47、PR217只关联JHG-48；PR208与JHG-46的错误职责关联已移除。

Linear会将含仓库歧义的短编号渲染到另一个repo。本次把描述改成完整 `jihegao/riffology-cloud` URL并读回；[PR208旧机器人评论](https://github.com/jihegao/riffology-cloud/pull/208#issuecomment-6172760383)的四个错误compiler链接已修正。JHG-26→compiler#549、JHG-28→compiler#551是合法跨库依赖，保留。

使用 `Related to JHG-…` 建立相关关系，避免用关闭词承诺验收。[Linear官方文档](https://linear.app/docs/github)将PR关联、Issue Sync和状态自动化分为不同能力，GitHub自定义Project状态不会通过Issue Sync同步。集成设置仍未暴露，未开启/修改同步或工作流；Delivery Project仍缺 `read:project` 权限，不能宣称已同步其Status/Priority/Milestone/Assignees。Linear无Acceptance状态，已部署待验收卡用In Review并在正文说明。

## 已消除的范围重复

- #148/#152不再派发旧owner恢复；9/9归档是历史交付，未做恢复由永久删除决定取代。purge不等待旧身份登录。
- #212拥有数据闭包、fence、释放及内容清除；#216拥有引用清零后的仓库代码/资产/专用测试退役。二者不互等完整新Pi、页面、扩容或费用结清。
- #213复用#37/PR59的execution/writer/lease/release基座，用平台权威外置替代“固定可信Pi进程”的旧拓扑承诺，不重做warm/lazy。
- #214唯一拥有通用页面宿主及基础恢复；#182/JHG-22保留已部署产物核心验收，#184/#185拥有独立领域观测及完整领域状态矩阵。
- #183拥有计算语义、依赖/lock/debug合同，#215拥有平台broker、构建作业和资源策略。当前meter-only及原限制不因任务调整而改变。
- #196/#202历史完成不撤销；Fire关联内容位于固定34集合，仍未purge/撤回。已完成记录不等于当前或未来案例可用承诺。

## Browser Preview 撤销后的待调整项

用户在 [首次范围评论](https://github.com/jihegao/riffology-cloud/pull/217#issuecomment-6188237585)及[澄清评论](https://github.com/jihegao/riffology-cloud/pull/217#issuecomment-6188262716)明确：只更新本PR说明、审计文档并列清单，不自动改写或关闭其他Issue/PR，不开始删实现。因此以下是**尚未执行的调整清单**，不是已同步完成：

| 对象 | 待调整 |
|---|---|
| #150/#127、JHG-14/JHG-45 | 撤销仿真Preview开发与旧案例验收，旧受限Canvas/scene3d不保留为可选profile；保留过去实现/部署事实。 |
| #151、#35、JHG-41–44 | 移除旧Preview/Cesium案例及旧案例排期；GIS后续能力或社区功能需独立决定，不追加替代需求。 |
| #206/#207、PR208/JHG-53 | 保留真实初始Files与首会话上下文；撤销参数/Seed/旧Preview包及新仿真案例验收。PR208仍含 `services/web/browser-preview.js` 与专用panel测试差异，合并候选须移除或单独退役，不能只改文案称完成。 |
| #212/JHG-49 | 固定34数据purge不变；旧Preview包属于关联待删内容。撤销功能不等于已停止执行或已删除数据。 |
| #216/JHG-52 | 独立清理仓库旧案例、旧宿主/DSL/合同、资产与专用测试；共用adapter/网页资产职责先迁出。不得把退役改成兼容profile维护。 |
| #214/JHG-46及相关领域任务 | 保留通用页面、路由、只读订阅；清掉仍将旧Preview描述为可选profile的分工。不把实现中的通用host写成已上线。 |

全库命中清单、案例文件、生产引用及实施顺序见 [退役盘点](browser-preview-retirement-audit-20261015.md)。本次撤销增量未修改以上任务或生产内容；不因审计生成另一个状态表。

## 验证与剩余缺口

此前三个Draft基于fbc0e46：#208+#210文本可合并；#208+#217发布索引顶部冲突已通过移动本PR规划段消除，#210+#217也通过。此前merge-tree结果保留为对应树的历史检查，不冒充本次文档新树的运行验收。

本次只验证文档链接、JSON结构、扫描清单一致性及 `git diff --check`。没有新产品测试、付费调用、数据删除或部署。PR210源码修订、PR208候选范围收缩、旧路径实际删除、固定34实际purge及普通受邀真实验收仍各有未完成范围。
