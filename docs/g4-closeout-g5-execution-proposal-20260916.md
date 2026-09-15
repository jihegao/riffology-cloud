# G4收口与G5执行提案（2026-09-16）

状态：本次授权仅完成可审阅准备清单。没有部署、开启门禁、调用上游模型或接纳新Run；G5/G6线上执行尚未授权。G4窗口已关闭，剩余额度不可作为新窗口授权。主控管理流程和独立验收，三个只读subagent分别审阅#46、#37与G4缺口；文档在集成分支编辑并同步新增文档，不覆盖main原有五份脏文档。

依据：[阶段计划](issues-subagent-plan-20260915.md)、[G4实际记录](g4-online-acceptance-20260916.md)、[#37准备](runtime-reuse-g5-readiness-20260915.md)、[#46固定任务](production-model-benchmark-task-fixtures.md)。本次集成基线`b9695b5`，生产历史冻结source`924803b36d587b95f92d6b252d87a8a0aa567a7d`；实际开跑必须重新核对当前release、源、镜像、gate与库存，不能把历史版本当当前证明。

## G4剩余验收矩阵

| 项目 | 实际验收动作和判据 | 前置与计划开销 |
|---|---|---|
| #65错误状态 | 触发实际项目加载/准备失败，再使无关轮询成功；原错误不得误清，重试成功后才清除；跨项目快速切换不覆盖新项目状态 | 新建1专属合成项目，实际准备→ready及失败/超时故障各自留记录；模型0/Simulation Run0仍可能有Project Runtime计算。网络拦截503不能冒称后端失败 |
| #65 Service Stop | 实际Service Preview绑定Run，Inspect切历史后Stop必须只指向当前显示Service；旧读取不重开iframe，保存/刷新一致、终态与原生停止/quota释放交叉核对 | 模型0；计划1 Service Run，若测试换绑最多2。Service与Simulation分别计数；不是Turn取消验收 |
| #65旧导航 | 从旧URL/旧本地导航状态、刷新、前进后退进入两个项目；准备提示不残留、标题/工作区租户一致；三视口检查 | 已有项目读操作，模型0/Run0 |
| 第二认证主体 | A私有包及对应冻结源码/结果，B不同已认证principal实际请求应拒绝；A仍能读取；撤权后旧URL不可读取 | 第二真实测试账号及独立session；无新模型/Run，不以未登录401替代 |
| Python与网络隔离 | 受控合成包分别尝试import js、fetch、WebSocket、动态安装、非固定资产访问；记录实际网络与runtime拒绝结果，应用会话不得泄露 | 先确定受支持的任务自有源/包创建流程，不能直接伪造D1；离线样例不计线上验收；建议3敌意Revision各1普通Agent Turn，规划6–12上游、硬限24，Native Run0；静态unsupported与实际运行限制分别签收，reason以真实构建结果为准 |
| 消息与项目边界 | 按实际Browser frame/host协议，用错误origin/source、MessagePort数量、schema/requestId/packageIdentity及迟到结果构造postMessage；nonce/revision仅作为额外未知字段探针，不假设Service ticket协议适用；UI不得采用伪造结果或启动Verify；跨项目包请求拒绝 | 实际浏览器与隔离执行域；模型0/Run0 |
| 逐Run内核事实 | 先审查并补可归属的运行证据：PID/startTicks、uid/gid、实际PR_SET_NO_NEW_PRIVS（NPP）、RLIMIT_NPROC/AS、网络限制、pidfd/封口及退出；再跑一个受控Run核对源/镜像/输入/生命周期 | 当前G4未逐Run独立发出这些字段；需代码/观测评审，最多1Native Run，无模型。没有证据不能宣称内核验收通过 |

先做已有项目零新增任务UI/权限/消息窗口，再做新项目状态、Service Stop、敌意Revision与内核窗口；不需要为了补齐G4重新执行已通过的七Run。#64/#65逐项签收，缺失或不支持明确保留，未关闭issue。新G4补测若含Turn/Run或云故障，需另行冻结范围和预算；本表是准备方案，不是补测授权。

## G5配置阻断

#46现有`services/model-proxy/production-profile.ts`和`scripts/model/benchmark-plan.mjs`要求OpenAI、openai-responses、Cloudflare Gateway及platform-byok。G4的opencode-go/gpt-5.6-luna不能填入该profile，也不能据其结果关闭#46。选择现有#46生产契约并确认账号/模型/密钥引用，或者另行授权修改契约；不得把不同通道结果混为一次生产验收。

#37需要第二个真实tenant/principal、暖租约发布overlay和实际物理身份/epoch/三账本/双域释放观测。已有十轮云driver是单Session且不收集这些事实；必须先补驱动与观测并非作者审阅，不能直接重跑即宣布复用通过。现有暖租约闲置60秒、最大30分钟、guard360秒、quiet30秒、最多16binding、租户容量2的事实须执行前核对；低容量窗口冻结共享FIFO，不暗改容量策略。

## G5-A：#46固定任务与计数

三个独立普通用户排队项目，每项目按六任务依赖顺序执行，串行运行；fixture digest `3e410718f9143da69f3bc63407f4452ae7802afb299f250657be51a40a756fb4`。reference源码仅非作者判定oracle，不预置为Agent成果。

| 任务 | 成功判据 | 每项目计划显式Run |
|---|---|---:|
| 建模 | 40客户FCFS；Spec/假设、Python、实际保存版本；终态守恒、非负有限指标和逐帧队列一致 | 1 |
| 参数变化 | 同冻结源arrival_rate .8 vs1.2、同seed两配置；引用实际结果，源不变化 | 2 |
| 机制变化 | 加max_wait/default2及放弃机制；新Spec/Revision；completed+abandoned=40 | 1 |
| 验证修复 | 按授权文件流程注入固定SyntaxError，留失败摘要和artifact；Agent修复并验证，不泄露oracle答案 | 1 |
| 测量证据 | servers1/2×三固定seed，完整组/六Run、claim/artifact/卡片；解释选择偏差，不编造普适单调结论 | 6 |
| 重开继续 | 无执行恢复历史文件；增加容量并运行120/2对照，新Revision且completed+abandoned+rejected=40 | 2 |
| 合计 | 18任务；三项目使用文档中固定seed序列 | 39 |

估计每任务上游：建模4–6、参数2–4、机制4–6、修复3–5、证据3–5、重开4–6；合计三项目60–96，仅流程估计。每任务计划硬上限8上游，18×8=144；另预留最多3次独立故障probe（未知usage、传输不确定、无重试证明）。其余401/403、429、5xx、deadline、cancel、流中断、incomplete、账本finish回执丢失及版本变化先通过本地契约验证；本地通过不替代线上故障证据，若需全量真实触发必须另扩范围，合计147。三个probe在正常benchmark后或单独批准窗口运行；首unknown立即停止其后probe/任务，不保证三probe全部执行。probe不是成功任务，不自动重试原未知请求；至少一次未知金额必须保守占用并阻断后续，不能为了跑完矩阵清零。39Run是明确计划需求，不是现有driver会自动完成的保证；ToolBridge/Python进程和组childRun分别计数。准入task按项目+Turn+Run至少3+18+39=60，probe另账，最终task硬限须包含probe Turn/项目、计数规则中的group intent和额外合法多Turn；60只是最低值，不能直接作为完整manifest硬限。

报告总通过率、每类别通过、首次成功率、费用/合格任务、阶段耗时/p95及错误假设。现有benchmarkPlan的建议阈值16/18、每类别至少2、安全/伪造0仅是benchmark目标，不是完整issue关闭替代；18个样本p95不作为长期SLO。单次provider请求只能上游一次，合法工具循环是多个独立请求，各自留dispatch/usage/money身份。

## G5-B：#37矩阵与计数

| 窗口 | Turn上限 | 必须交叉核对的结果 |
|---|---:|---|
| 同Workspace十轮 | 10 | 每轮新Turn/dispatch、真实保存、binding epoch递增；物理Project/Pi pair稳定；第6轮前换Session |
| 纯对话 | 1 | 真实无工具回复/保存；该Turn Project工具准备/恢复/冻结/启动0，项目预配置另计 |
| 冷对照 | 2 | 同nonce写读任务、冷配置、独立环境；仅合格任务比较阶段时间 |
| 闲置恢复 | 1 | >60秒真实alarm退休、双域释放后新pair从冻结archive/session恢复；无页面驱动要求 |
| 取消 | 3 | 排队取消零dispatch；活跃取消后迟到不重开；确认guard完成后显式继续 |
| 容器丢失 | 2 | 只故障注入owned容器，保留中断/未知记录；从权威保存版本显式继续，不重放未知变更 |
| 低容量公平性 | 2 | A闲置pair因B排队退休；两tenant、冷暖共享FIFO与双域guard，A不能插队 |
| 冷回退 | 1 | gate/version退休并释放后新冷Turn；旧精确binding仍可核对 |
| 合计 | 22 | 最多21执行、1排队取消；2新项目，task至少24；Verify/Native Research Run计划0 |

20工具Turn×3+1纯对话=61上游是规划中心值；8calls/Turn现有上限下21×8=168才是保守上界。不能拿61作为保证或以减到3call压缩合法行为。两窗口#46/#37的任务、成功率与账本分别记录，不复用一个结果算两次成功；共享云发布和实际容量窗口必须串行。

## 预算与批准清单

建议分别提议G5-A总额US$20、每Turn US$5、147上游/39Run；G5-B总额US$20、每Turn US$5、168上游/0研究Run，每个窗口实际首admission后2小时停止新任务。合计US$40仅为候选硬上限，未授权、不是费用预测。若两小时不能覆盖真实释放/恢复，记录partial并收尾，下一窗口另定；不缩短guard来赶进度。

实际价格尚未查询/选择，没有填假rate card。以每token向上取整nanodollars价r_in/r_out和冻结输入/输出上限I/O，C=(I*r_in+O*r_out)/1e9美元。G5-A要求147C≤20且8C≤5；G5-B要求168C≤20且8C≤5。若不满足，停止准入并提出降低token上限的评审或预算修订，不依赖G4实际US$0.1638495外推。现有validator还要求profile/privacy/runtime/无重试证据真实SHA和目标值；清单未填齐不运行execute。

待明确字段：#46实际生产账号/provider/model/gateway、rate card日期和原始官方来源、I/O上限、授权reference；#37第二tenant与两账号、复用overlay/实际镜像/runtimeVersion；窗口范围/金额/Turn/上游/Run/task限制、p95与合格任务费用目标；仅合成数据、脱敏诊断7天/验收30天建议单独确认。原始session/凭据/cap留本地最小权限，远端只白名单证据；本地副本不由R2生命周期自动清除，验收后按本轮明确归属清理。

执行前顺序：完成driver与观测缺口→定向验证→A/B/C非作者交叉审查→主控冻结manifest/源码/镜像/回退→用户批准具体配置→主控串行G4补测/G5-A/G5-B（可批准其子集）→核对UI/events/持久对象/上游账本/云库存→关闭门禁与释放→同步真实证据及issue关闭矩阵。未知charge、身份冲突、release不确定、凭据越界、预算/截止触发立即停止新任务，按原幂等身份只读收尾，不重置fence。

G6仍另行确定三模型审核发布范围和预算；本次无提交官方catalog、审核、发布、合并、推送或关闭issue。

## 本次准备验收

主控逐项核对固定任务/现有profile/复用readiness后，两名非作者subagent交叉审查通过；修正Service Stop计数、Browser协议字段、NPP事实要求及probe排程/task最低值边界。文档链接与diff检查通过；无产品代码修改，未运行容器或全套runtime测试。
