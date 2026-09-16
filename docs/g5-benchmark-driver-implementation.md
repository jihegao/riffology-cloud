# G5 #46 离线调度driver准备

状态：准备实现，未批准线上执行。基线a4098c0，独立分支codex/g5-benchmark-driver。没有模型调用、云写、部署或secret读取。此模块是调度/准入方案编译器，不是普通用户浏览器自动化runner，也不构成生产验收。

`scripts/model/g5-benchmark-schedule.mjs`调用既有`benchmarkPlan`及ProductionProfile校验，不修改profile契约、不填真实账号/隐私/费率证明。运行方式：`node scripts/model/g5-benchmark-schedule.mjs proposal.json`。输入为productionManifest（沿用既有模板全部字段），另加groupIntentTasks、extraTurns、taskCap、dispatchCap、runCap。当前冻结方案要求maxCallsPerTask=8、concurrency=1、fixture hash精确匹配、extraTurns=0、dispatchCap=147、runCap=39。

输出三项目各六依赖任务的repetition-major顺序，固定三组seed；18任务、39显式Run、144正常上游加最多3终端probe。冻结计数明确为`normalAdmissionTasks=3 Project+18 Turn+39 child Run+3 group intent=63`、`probeTasks=3`、`maximumAdmissionTasks=63+3=66`。`groupIntentTasks`必须显式为3，零值会被拒绝。额外多Turn拒绝当前方案，须先修订冻结manifest/计数。

预算重新用冻结profile的token ceiling和向上取整nanodollar费率计算147*C；既有validator检查8*C的Turn上限，新增检查probe-inclusive全局上限与整数安全。没有真实费率不生成美元预测。测试profile仅为本地合成值，不能复制成执行配置。参考hash与authorizationReference字符串仅验证形状，绝不证明账号授权或证据真实性。

`nextAdmission`纯函数核对终态顺序、单任务8/单probe1 dispatch界限，失败/取消立即blocked并保留记录，禁止后继依赖和probe；仅正常任务全部accepted之后才提出probe。首次unknown或显式stopReason阻断任何其后新准入，reservation保持占用，无清零/重试/replay接口。其结果标记proposal-only：实际driver仍需验证依赖的真实保存状态、source/Revision/工具证据、deadline/caps/stop开关及实际账本，不能把此函数当云端预算权威，也failed/cancelled没有恢复绕过参数，恢复须另行审查真实依赖检查点及修订方案。三个probe可能未全部执行；unknown时真实执行必须收尾停止。

`--execute`无条件拒绝，即便manifest内authorizationReference非空；本阶段不存在可审阅且批准的线上runner/账号配置。模块只读用户指定JSON文件，不读取env/凭据、不建立网络连接、不启动工具/Run。未来线上实现须另行独立审查和具体授权，不能解除该拒绝后就宣布已具完整执行能力。

验证：`node --test scripts/model/g5-benchmark-schedule.test.mjs`，3测试通过，覆盖依赖顺序/Run及task完整计数、旧144C预算不足以容纳probe、unknown停止且禁止后续准入、单任务dispatch超限、未填profile与execute拒绝。本地测试不提供上游invoice、Gateway单次实际attempt或普通用户benchmark成功分子。

## 普通HTTP创建/核对切片

新增`g5-benchmark-live-runner.mjs`导出OrdinaryTransport与DurableOrdinaryRunner，无自动execute CLI。调用方须明确提供ordinary cookie，不读secret/env；固定应用HTTPS origin，禁止redirect，响应流累计最多1MiB并30秒超时。只走实际产品project/session/Turn与workspace/files GET，无验证RPC、直接D1或隐藏grant。

init要求完整现有ProductionProfile manifest、具体create/reconcile作用域批准和带外配置SHA、独立受信release preflight实现；没有preflight拒绝。preflight必须由主控实际operator工具核对active源码/profile/window/gate并关联证据，不能填caller布尔；本模块不具通过普通API验证这些云事实的能力，未提供生产preflight实现，故当前没有完整线上执行入口。cookie不落intent文件。

先以0600、wx持久intent并file和目录fsync，再检查截止并POST。write-once ACK使重开只读复用既有响应；未知ACK全窗口阻断任何新mutation，不重发同key、不同key或新project。并发/crash admission lock存在即blocked；崩溃遗留锁不得自动按时间清除。旧intent或已落盘但未发送亦保守阻断，恢复需要具体审阅，不提供泛化unlock/retry。

切片可创建指定重复的project/session/首create-model Turn，再用schema3精确scope及workspace/files实际读取重开核对。session支持真实201，project/Turn支持202/200。首task完成也不记accepted：返回manual-evidence-checkpoint-required，并列出真实Python工具、五源与SHA/Revision、独立Run/claim/UI、上游usage/money账本待审。没有自动触发39Run，没有权威源码/Run/claim合格校验、其余五task自动工作流、工具注入或第二账号审查；该边界不能称完整#46runner。完整18task/39Run计划仍以compiler为准。

追加测试4项：未知ACK跨重开不重发且阻断另一project；ACK复用/201/固定endpoint；实际schema3首task切片不冒称accepted；并发/过期/路径拒绝。连同compiler共7测试通过。测试只mock transport与临时本地journal，不执行实际模型/云操作；其中直接设置ready仅用于隔离journal测试，非live授权证明。
