# JHG-46 下一批：一次原应用 ec8 rollout＋新有限三 Turn（待授权）

本包固定26项作者输入，清单 SHA256 `2937a30ee4f81458c48b40e31f77644435c323a86c33fa3695287be337c2b5b4`。[完整清单](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/preparation-manifest.json)、[最终独审](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/reviews/final-independent-review.safe.json)（mustFix=[]）及[公开文件索引](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/inventory.json)可直接核对；作者原稿逐字保留在证据目录。以下仅作新的具体执行提案，仍待明确授权。

本批拟将已合并 #253 的 optional resources 严格快照兼容修复对应 ec8 镜像上线，以全新普通受邀项目验证 skill → 双页/授权文件与产物 → V1/V2 保存和刷新冷恢复；旧 project_write 错误仍待真实流程验证。

本目录只准备同一 JHG-46 的下一批执行输入，未产生新授权、grant、once 锁或任何线上调用。已完成的 Gateway9c8 发布、Registry证明、PR253普通合并不再执行，见[固定实际结果](https://github.com/jihegao/riffology-cloud/blob/242f35b32085f4a9fd38005f2ce5bdf7ab9096fc/docs/project-view-trusted-pi-local-registry-readback-result-20261018.md)。实际主线源码为 `240378f65fee54d917b053f565087095a07244db`，本地Git已核其树与已批0a10相同；旧失败、锁和费用历史全部保留。

入口：[准备身份](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/preparation.json)、[操作合同](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/operations.json)、[窗口/两差异选择](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/window-and-choices.pending.json)、[fresh只读与派生合同](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/fresh-read-contract.json)、[来源绑定](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/source-bindings.json)。本包不是任务路线图；未解析的值明确pending，不能发送null模板或旧before/after请求。

## 仅变化的输入

- 新维护 request `c1f9e955-96a6-56dc-acd2-4a0e84410442`；begin/end四键不变，expectedRevision来自fresh **state.revision**，policy/原operator/authVersion/control绑定原ACK。hold只挡新准入，不取消现有工作；end恢复既有Pi新准入，必须先全条件通过，且不自动到期解锁。
- 一次原a036 rollout request `35abe255-f107-522d-a0f0-e86618c656a9`：[canonical](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/rollout/body.canonical.json)和[planned wire](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/rollout/body.wire.json)同455B/SHA `d02b6f60f2aecbc09cf0be8bf011770ddd5b6e7e429b78aed3bd46b776a90891`；只改description/image，rolling/full_auto/100%，supported command/entrypoint/observability和basic等效profile保持。实际wire/ACK尚未发送，不能拿准备字节冒充已发送证据。目标version/rolloutID只取本次可信原ACK，不预填13。完整非image配置必须canonical相同。
- 一新blank标题含本批短ID d0b12dd5，便于识别而不作为scope authority；两个Session、最多且只计划三个显式Turns。[T1](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/prompts/turn-1-create-skill.md)仅采用已审一次≤30s mkdir前置，其后2698B [skill](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/skill/SKILL.md)不变；[T2](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/prompts/turn-2-build-v1.md)/[T3](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/prompts/turn-3-cold-edit-v2.md)逐字复用，不从旧T1继续剩余Turns或追加第4修复Turn。模型仍OpenAI/gpt-5.6-luna/profile7291181d…，详见[普通输入](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/ordinary-input.json)的原硬时限/并发。
- R2和原释放之后，才依新create/R2/me/原SELECT凭据元数据派生唯一scope/actor/generation/[有限gate计划](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/browser-gate/plan.pending.json)。复用已有pure Secrets PUT/DELETE factory，不加整份Worker/assets PUT；secret写会部署新Worker version，须原ACK/实际source与全资源保全。DELETE仅原owned key/version/bodySHA，不能把write-only GET列表当明文回读。

## 已有旧T1证据仍有边界

[14:44 fresh原owner摘要](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/prior-owner/fresh-owner-summary.safe.json)及[独审](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/prior-owner/independent-fresh-owner-review.safe.json)支持原T1仍failed/native-exit/checkpointunknown/null、1Session/1Turn、active null/三holdclear、Betaavailable的产品authority投影。前两console/投影错误保留，不把这次最终5GET当所有历史请求总数。它不证明当前authVersion/受邀角色、raw native stop/ticket或物理资源释放。下一次必须在新hold下取得联合quiescence与完整logical/scheduler/Dash原资源证据；未知不得以新项目绕过。

## 两项仍需新的明确选择

1. 目标应用live版本列表允许“本次ACK目标＋fresh原当前版本”，原更早列表对象可能移出；完整快照/原镜像/历史rollout保留，不保证旧对象可用或rollback。其他15应用/全部versions不适用此例外。
2. 全目标应用最多一份已知default/basic/max1 idle基线，VM可running但container stopped，可能持续费用。若原d030/758仍存在，只标它实际v12/f18身份，不称已经加载ec8；或者记录本次目标version的新唯一placement。无rollout_id外键就只报告版本/时间/singlewriter关联，不升级因果。额外/unknown资源保留hold停止，不主动stop/delete/PATCH/rollback制造通过。

旧两差异的接受不自动批准新范围；[选择字段](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/window-and-choices.pending.json)保持null。具体新窗口≤4h且不晚于2026-10-20T15:59:59.999Z，旧12:42:46Z窗口不延长。原kill、硬并发、每call/Turn/tool/release时限、metering和unknown隔离继续；无费用上限/欠费通知不授权支付或订阅。

## fresh来源与执行停点

[新pure请求generator](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/fresh-preservation/make-preservation-request.mjs)只生成future GET-only connector source：[before source](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/fresh-preservation/before-runtime-rollout.request.txt)已离线生成/语法编译、未调用；[after派生合同](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/fresh-preservation/derivation.pending.json)要求原ACK目标version、before witness和新差异选择receipt真实哈希，当前仍未派生。旧b62/047/v11 request files明确不可执行。新源复用已审分页、实际credential值拒绝、double controls/apps/module bracket、16个完整versions、16000B compact/pretty上限、actualtime trace，不导出配置正文。after不是把before原件改名复制；scope/value/source/response SHA必须实际绑定。

原baseline只是日期化输入。任何source/role/policy/profile/config/resource漂移、不完整分页、raw credential值、旧执行/释放未知都停止，只按原身份只读核对。runtime的before/after getter只适用closed Worker；opened-gate witness必须另从实际owned gate ACK/version/fresh完整GET按已有gate factory schema本机验证，不能错用closed getter或旧b62源。factory不认证输入来源，也不提供serverCAS，实际root需具名singlewriter与原intent/ACK/即时完整回读。

每Turn必须真实canonical/CAS/Session checkpoint与原runtime/tool/container/capacity释放闭合后才继续；T2产物需独立重组chunk JSON字节算SHA，不能以原17KiB文本hash替代。双页、参数/暂停/订阅、刷新离开和R3冷恢复从保存源码重建，始终browser-local/unverified，不作为Verified Evidence或完整JHG56矩阵。阶段失败即停，无provider fallback、旧项目恢复或额外Turn。

## 本批必要认证访问（随新窗口一次明确授权）

[认证合同](../evidence/releases/project-view-trusted-pi-native-resource-host-rollout-acceptance-preparation-20261018/authentication-contract.json)只沿用同账户8b0d…的既有Personal Cloudflare受支持连接器；若预选流程需要本机token，仅正常读取/续期现有同用户六scope OAuth，固定Wrangler4.129/原CLI SHA和正确末尾env-file参数，不发起新CF login/consent、不加scope、不读或生成Registry JWT、不传AMD。D1仅既有受支持连接器上的已审单SELECT；权限失败或未知不自动换身份/连接器/凭据绕过。Safari仅在原批准operator与ordinary两个Google身份之间正常切换app.riffoid.com会话，不读/导出Cookie、密码或身份行。原授权持续OAuth和Google会话不因本批≤4h到期自动撤销；本批访问/动作仍只在新具体窗口内。没有新认证执行器或新的认证调用由本包产生。
