# ec8 rollout、T1/T2 与 V1 首次失败的实际结果（作者脱敏稿）

本批截至 2026-10-18T17:04:31.276Z：固定目标应用13/ec8 rollout、原维护 begin/end、普通 Session1 的 T1/R1 和 T2/R2 保存/释放已确认；V1 首次 Dashboard 显示 `Load error: page request timeout`，随即停止。原有限 browser gate 已按同一 owned request 单次 DELETE 关闭。没有 Session2/T3/V2，也未通过 Report、20/50、Pause/Resume、订阅、刷新/离开重入或 artifact body chunks 验收；整体 JHG-46/父#214仍未完成。

T1 的17条事件包含3次provider200、2个工具completed；mkdir exit0，skill2698B/f050。R1只新增三个目录及skill。原assignment-guard pending、物理读取held和后续产品级authority释放closure分别保留，见 [T1阶段](ordinary-t1-checkpoint.safe.json)、[产品级门槛](sources/t1-product-authority-release-threshold-review.safe.json)、[实际closure](sources/t1-save-release-closure.safe.json) 和 [确定性关联](sources/t1-canonical-key-dispatch-identity-review.safe.json)。README既有文件未改由Diff支持，但没有实际README内容hash。

T2在原Session1单次提交，R2f53f与checkpoint/Session head一致、T1未变；235条连续分页事件含6次provider200、9份remote ledger成功回执及一次原生load_resource成功。实际读原2698B/f050 skill，6份写入保存manifest/两页/module/CSS/V1 series。manifest/series完整expected byte candidate与实际写回执bytes/SHA一致。16:38:44–53原身份五GET与16:39:42–45物理四GET闭合保存/释放，见 [T2阶段](ordinary-t2-checkpoint.safe.json)、[资源工具独审](sources/t2-product-resource-tools-stage-review.safe.json)、[实际closure](sources/t2-save-release-closure.safe.json) 及 [派生关联](ordinary-t2-sandbox-identity.safe.json)。logical9不是VM9，也不冒充raw native stop/lease原件。

实际V1包7597B/058b已取得，R2/scope/manifest和全部五资产逐bytes/SHA/sourceSha与T2原写入一致；实际main.mjs为2542B/f358，见 [包验证](sources/actual-package-validation.safe.json)。这证明取得了保存包及实际JS，不能替代页面功能验收。初始SDK请求在observer安装前；后续7个package poll200不证明SDK未发请求或功能成功。性能resource buffer不完整、未绑定原请求identity，不能确立唯一线上原因。[静态诊断](sources/v1-page-sdk-timeout-source-diagnosis.safe.json) 证明5000ms SDK预算可小于串行host授权路径，但不是唯一实际根因。实际生成app的artifact按钮还存在JSON envelope前缀解析和独立SHA缺口，按钮未实测，不能称这就是本次timeout原因。

大结果artifact回执17567B/1f1934与17408B源文本区别保留，完整chunks/body重组SHA没有执行。原AX partial、单次缓存local Blob导出及bytes/SHA校验过程保留，没有HTTP/Turn重放；见 [capture恢复](sources/console-capture-format-recovery.safe.json)。

原门禁PUT201于16:51:27.113Z发送、16:51:28.060Z获201，产生ba8d，owned DELETE200于16:59:50.923–51.494Z产生closed Worker `4f887d24-7874-4fb3-b3ac-caf6d74ab461`，latest sole100%。54 GET完整after-close witness确认门禁absent和source9c8/106bindings/11secrets/25exports/6container关联/96assets/16apps/50namespaces等保全，见 [门禁过程](browser-gate-checkpoint.safe.json) 与 [独立收尾](sources/owned-gate-close-failed-acceptance-closure.safe.json)。原raw metadata64d4与旧2b886确实不同；[精确annotation桥](sources/browser-gate-exact-annotation-bridge-review.safe.json) 完整重建旧hash，不是宣称raw相等或secret明文回读。96项是保全配置及此前字节验证，没有在本浏览器阶段重新下载96body。

17:04:08–10Z最后普通读取保留一Session两completed/saved、四holds/active均null、Beta available，project-views503、frame0、原UI nonGET计数4。17:04:28–31Z当前物理四GET显示logical9全inactive、Dash instances0/DO9，唯一d03b13/ec8/8ef5已知basic/max1 VM running、container stopped；仍可能计费，见 [最终产品与物理投影](after-owned-delete-product-physical.safe.json)。这不证明所有历史placement处置或全局零执行；usage/费用unknown不记零，旧失败/unknown/锁/费用历史不清除。

本次#252自身host scope已验收，父#214仍Acceptance/P1/blocked，#104仍Acceptance/P0。Project变更只以原API读回为准，本稿没有声称已把#252改Done或移除blocked；Issue保持OPEN。新最小SDK预算修复已拆为[#255](https://github.com/jihegao/riffology-cloud/issues/255)，离线推进，尚未部署，也没有新增线上尝试或延长原19:07:16Z窗口。

公开allowlist是本目录脱敏作者JSON/文案及已有安全审阅原件；[来源](source-bindings.safe.json)仅绑定private原件路径/bytes/SHA，不复制其body、prompt、raw UID/email/tenant、精确host/location、凭据或实际project script正文。测试request/Turn/Revision/rollout资源ID及摘要仅用于对账。[inventory](inventory.json)列明所有安全文件；新投影待另一位agent及root独审，作者不独立审自己的稿件。

17:07:10Z 后续 [UI退出观察](sources/ui-exit-observation.safe.json)：完整页面导航回项目列表，旧context instrumentation随document消失，Console清空并关闭Inspector；没有打开/恢复旧项目或点Retry。这只是AX观察，不是HTTP、物理或账单证据。#255已原API更新In progress/P0、owner jihegao/M1，修复离线推进且未部署。
