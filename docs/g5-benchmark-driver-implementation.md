# G5 #46 离线调度driver准备

状态：准备实现，未批准线上执行。基线a4098c0，独立分支codex/g5-benchmark-driver。没有模型调用、云写、部署或secret读取。此模块是调度/准入方案编译器，不是普通用户浏览器自动化runner，也不构成生产验收。

`scripts/model/g5-benchmark-schedule.mjs`调用既有`benchmarkPlan`及ProductionProfile校验，不修改profile契约、不填真实账号/隐私/费率证明。运行方式：`node scripts/model/g5-benchmark-schedule.mjs proposal.json`。输入为productionManifest（沿用既有模板全部字段），另加groupIntentTasks、extraTurns、taskCap、dispatchCap、runCap。当前冻结方案要求maxCallsPerTask=8、concurrency=1、fixture hash精确匹配、extraTurns=0、dispatchCap=147、runCap=39。

输出三项目各六依赖任务的repetition-major顺序，固定三组seed；18任务、39显式Run、144正常上游加最多3终端probe。最小task完整计数为3project+18Turn+39Run+3probeTurn=63。若三个group intent也独立计入准入task，groupIntentTasks=3，则66；若不计入，显式填写0。分类必须按实际服务端契约核对，不能用未填值默认为零。额外多Turn拒绝当前方案，须先修订冻结manifest/计数。

预算重新用冻结profile的token ceiling和向上取整nanodollar费率计算147*C；既有validator检查8*C的Turn上限，新增检查probe-inclusive全局上限与整数安全。没有真实费率不生成美元预测。测试profile仅为本地合成值，不能复制成执行配置。参考hash与authorizationReference字符串仅验证形状，绝不证明账号授权或证据真实性。

`nextAdmission`纯函数核对终态顺序、单任务8/单probe1 dispatch界限，失败/取消立即blocked并保留记录，禁止后继依赖和probe；仅正常任务全部accepted之后才提出probe。首次unknown或显式stopReason阻断任何其后新准入，reservation保持占用，无清零/重试/replay接口。其结果标记proposal-only：实际driver仍需验证依赖的真实保存状态、source/Revision/工具证据、deadline/caps/stop开关及实际账本，不能把此函数当云端预算权威，也failed/cancelled没有恢复绕过参数，恢复须另行审查真实依赖检查点及修订方案。三个probe可能未全部执行；unknown时真实执行必须收尾停止。

`--execute`无条件拒绝，即便manifest内authorizationReference非空；本阶段不存在可审阅且批准的线上runner/账号配置。模块只读用户指定JSON文件，不读取env/凭据、不建立网络连接、不启动工具/Run。未来线上实现须另行独立审查和具体授权，不能解除该拒绝后就宣布已具完整执行能力。

验证：`node --test scripts/model/g5-benchmark-schedule.test.mjs`，3测试通过，覆盖依赖顺序/Run及task完整计数、旧144C预算不足以容纳probe、unknown停止且禁止后续准入、单任务dispatch超限、未填profile与execute拒绝。本地测试不提供上游invoice、Gateway单次实际attempt或普通用户benchmark成功分子。
