# Linear 关联与 Pi 扩展任务冲突复核 — 2026-10-15

对应 [#211](https://github.com/jihegao/riffology-cloud/issues/211) 与 [审计PR #217](https://github.com/jihegao/riffology-cloud/pull/217)。三名原审计agent按runtime/purge、页面、门禁/CI重新读取GitHub正文、最新评论及关联PR；root读取Linear项目、全部46个JHG任务、三个开放PR的Linear Review和机器人评论，并在临时git对象中做合并检查。未执行产品代码、删除、部署或门禁变更。

## 自动关联的实际结论

| 层次 | 当前证据 | 结论 |
|---|---|---|
| GitHub PR → Linear Review | [PR210 Review](https://linear.app/jhgao/review/feat-upgrade-product-pi-to-gpt-6-luna-with-guarded-profile-migration-c2d1ad96d7c2)、[PR217 Review](https://linear.app/jhgao/review/docs-pi-可扩展工作台审计与34项目永久删除范围-90a8bd112f52) 的head SHA与GitHub一致 | **PR自动同步有效**，不是手工创建的同名Issue。 |
| PR → Linear任务 | PR210、PR217均issueLinks=[]、linkedIssues=[]；PR208关联JHG-46 | **本轮模型/审计PR尚未关联Linear任务**。GitHub正文Refs #209/#211不是JHG标识，不能当已建立任务映射。 |
| 新GitHub Issue → Linear任务副本 | 全team46项、Cloud项目21项均hasNextPage=false；没有本批#209/#211/#212–216的标题/执行卡 | **本批自动建任务未发生**；不能称已自动同步Backlog。不能仅据此判定设置关闭，可能涉及映射/错误/开通时点。 |
| GitHub Issue附件/回链 | #196有JHG-41 linkback；JHG-41将Fire #196列为“发布证据”附件 | 这是相关证据关系，不是Fire任务与社区库父项一对一镜像，不能同步关闭状态。 |
| Delivery Project Status → Linear | [官方文档](https://linear.app/docs/github#configure-github-issues-sync)明确自定义GitHub Project状态不随Issue Sync同步 | Backlog/Acceptance等仍需按当前交付语义核对。JHG-22当前In Review，描述明确Acceptance，因为现有team无该状态；不等于仍待实现。 |

官方将PR关联、Issue Sync、工作流自动化分成不同功能。Issue Sync需repo/team映射，可一向或双向；PR可用Linear ID/完整URL关联。为了遵守人工Done/关闭规则，相关引用应优先“related to”而非关闭关键词；官方说明该关系不改变状态。自动化设置是否实际配置为no-action，本轮不能确认：connector不暴露集成/工作流设置，CUA没有可用浏览器，Safari无窗口。未开启或更改同步、状态规则，也未制造一批重复Linear任务。

**确定的错误回链：** [PR208机器人评论](https://github.com/jihegao/riffology-cloud/pull/208#issuecomment-6172760383)把Cloud #182/#185/#206/#207链接为sim_engine_compiler同号PR。对照[JHG-46原文](https://linear.app/jhgao/issue/JHG-46/workspace-modelpreviewruns-内容由模型产物声明取消固定内容框架)，源URL均指riffology-cloud；错配发生在回链渲染。不要据此把compiler任务设为依赖或误关；修复时用完整仓库URL和清楚标签，并回读实际bot输出，不推断根因或用裸数字跨仓库关联。

## 必须消除的范围冲突

| 范围 | 冲突或重复 | 最小调整 |
|---|---|---|
| #209 / PR210 ↔ #212 | #209顶部已记录purge方向，尾部仍要求保留旧Session/用户文件并真实旧Session→新模型验收；PR210仍以旧5.6历史兼容和显式反向模型迁移为长期描述。 | 新项目GPT6→工具→保存→冷恢复→释放为当前验收；旧reader仅purge前过渡，引用零后删除。人工回到5.6与用户“删除历史模型”方向分开明确，不以恢复目标项目证明兼容，也不混同自动fallback。 |
| #152 / #148 ↔ #212 | 原9项目已纳入34删除集，但#152仍Acceptance/blocked等owner登录恢复，#148中段仍派发旧恢复。 | 标明9/9归档是历史已交付事实，未做的原owner恢复验收被永久删除决定取代；不虚构恢复成功、不重开实现，不让旧登录阻碍成为purge前置。 |
| #196/#202、JHG-41–45 ↔ #212 | Fire作者/复制/submission的hash与34冻结集一致，关联已发布netlogo-fire-python-beta@0.1.0。新社区库仍依赖它作当前可复制/体验素材。 | purge前封禁目标模型新复制/引用，核对共享对象/CAS；清理完成后追加“历史验收完成、当前内容退役”记录。历史closed结果不撤销，但当前目录不可继续承诺Fire可用；社区库采用真实新素材，不能复活旧内容。 |
| #207 / Draft PR208 ↔ #212 | 原认证Fire项目的files/preview根因及修复验收要求在purge后不可执行。 | 区分旧现场只读诊断与通用修复；删除前若未诊断，记录根因未覆盖及目标由用户删除。后续修复用明确新fixture/新案例验收，不能默默换目标或恢复原ID；purge不等待整PR上线。 |
| #213 ↔ #37/PR59 | #37旧不变量要求TrustedPi与Project双域，#213将整个可扩展Pi置于不可信项目域。lazy/lease/reuse已有PR49/59/61实现。 | 新trust ADR把“控制平面在外”作为不变量，替代固定受信Pi进程形状；复用原execution/writer/lease/release接口，不另造Turn状态机，不重新开发已交付warm/lazy。 |
| #214 ↔ JHG-46/#150/#127 | JHG-46保留三页、明确不开放任意HTML/脚本、不得新增平行manifest；#150受限Canvas和#127固定scene3d，与#214通用HTML/modules多页不同。 | 区分领域声明页面与通用隔离host：JHG-46/仿真renderer作为消费通用基础的profile增量；统一manifest/content identity接口。若要整体替代三页导航则需明确产品范围，不能两个任务各建通用host。 |
| #214 ↔ #182/#184/#185（JHG22/24/25） | 产物保存/包闭包、导航、共享view状态与版本恢复重叠。PR198已合并并部署，不能因父项未闭合重新开发answer/design/一层tabs/CAS。 | #182管Revision/candidate权威及已部署核心验收；#214只管通用隔离页面/资产/broker增量；#184管真实领域观测/布局，#185管输入/播放/恢复矩阵。共用已有接口，未完闭包切口只分配一个owner。 |
| #215 ↔ #183（JHG23）/#37 | #183已有backend能力矩阵、完整依赖/lock/debug/冻结输入合同；#215同时提出能力/依赖build/lease。 | #183管计算语义和依赖可执行合同，#215管平台broker、作业和资源策略；共用矩阵/lock/cache合同，不做两套installer/scheduler。 |
| #215 ↔ #104/#153/#136 | 容量N/per-user放宽与现行批准每user1/全局/时限边界不同；Runs single/comparison/cold-prep已交付，失败/隔离矩阵尚未验收。 | 统一配置切口保持当前limits；上线扩容须#104冻结新policy并按原actor迁移验收。#136继续拥有未完矩阵，不重做已交付单次/对照。原资源映射和release证据先于缩全局fence。 |
| #212 ↔ #216 | 两者都把六旧profile/adapter/测试删除列为完成条件；若互等或等整个新Pi/UI，会拖住内容purge。 | #212拥有内容purge与零引用证明；retained代码/资产/测试由独立早期清理切口负责，两个Issue只留一个实现owner。不要让purge依赖#213全功能、#215扩容或#101费用结清。 |
| #216 ↔ #73/现有CI | #73独立synthetic归档不在34生产项目范围；过去CI额度waive已生效，native SDK基线崩溃未解决。 | #73可退出全PR默认执行，但不得借生产purge删它的独立档案或重跑付费A/B。重整组件CI是新delta，既有waived PR无需为green重跑；不删除真实SDK测试掩盖环境问题。 |
| #214/#215 ↔ #151 | #151仍有用户明确的10月20日JSgeo/Cesium目标，generic页面显示不证明GIS计算、WebGL/assets和普通作者验收。 | 只调整host依赖/可选领域profile；不能静默取消原目标或使全部通用页面等待Cesium。排期变化回Project做真实决策。 |

上轮新增任务的方向成立，但只在顶部写新purge方向不足以消除旧正文与完成条件的矛盾。应重写当前执行卡并明确历史段过期，不能只再加一个日期段继续并存相反验收。

## 相关但不是重复任务

- #85负责文本资源发现/加载/来源；#213负责原生可执行扩展；#191负责ChatGPT/WorkBuddy外部MCP/OAuth插件发布。#191对#85“仅仿真skill”的描述需更新，但三者不是同一插件实现。
- #87/#106/#199、PR159/200已有执行隔离与严格只读核对，保留无内容安全事实并复用；不能为拆历史门禁重开临时窗口或使用observe假充只读。
- #101费用pending与内容purge可独立推进；保留最小无内容费用/原请求身份，不能把tool script/result/stdout与指标整份留下。
- #35已有冻结提交/审核/不可变发布/复制实现；原Queue/Inventory/Maintenance验收不由Fire替代，也不是每个通用网页必须跑仿真证据的门禁。
- #77执行身份、Managed清理/ACK恢复等已交付基座可以复用；关闭不等于任意Pi插件已经安全。

## 既有PR尚未处置的评审

PR203已合并、部署并完成指定审核者single-Run验收；仍有两条not-resolved/not-outdated评审：
[比较组与one-Run资格](https://github.com/jihegao/riffology-cloud/pull/203#discussion_r4268576913)、
[bootstrap reserve后ACK丢失恢复](https://github.com/jihegao/riffology-cloud/pull/203#discussion_r4268576928)。

当前代码形状与评论描述吻合，但没有本轮真实复现，不能宣称新线上故障。应分别triage为最小后续缺陷或记录有证据的处置；不能在#215“删Managed分支”中吞掉风险，旧34内容删掉也不证明未来新copy路径安全。不重开整个已验收#202。

## 三个开放PR的合并检查

当前只有Draft #208、#210、#217，base均fbc0e46。检查使用完整PR208 patch构建临时tree，PR210本地tree与已发布candidate tree一致，PR217本地tree与远端一致；未更改原用户工作区或真实分支历史。

| PR组合 | 初始结果 | 处置 |
|---|---|---|
| #208 + #210 | git merge-tree exit0 | 未见文本冲突；不等于组合运行验收。 |
| #210 + #217 | exit0 | 未见文本冲突；历史模型/purge仍有上述语义冲突。 |
| #208 + #217 | 初始exit1，docs/release-readiness.md；调整后exit0 | 两者在索引顶部插入新段；本审查把#217规划段移到已部署main证据段之后，保留双方内容。调整后的#210+#217也再次exit0。 |

没有执行合并、部署或新的产品付费调用。源码与验收范围冲突不能只靠git能合并来判断。关联/状态设置未改，旧issue未关闭，产品承诺与范围调整以上表为具体审阅依据。
