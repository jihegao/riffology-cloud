# G4私有持久执行窗口

本实现只限定2026-09-15批准的G4：Go / `gpt-5.6-luna`、同一普通测试tenant/user、总模型US$20、每Turn US$5、32次上游dispatch、16个服务端Run、首次新Project/Turn/Run/provider任务起两小时停止新任务。G5/G6不获得执行授权。本文件描述代码；实际scope/账号/发布overlay与在线验收由主控维护，当前状态见末节。

主控在既有Gateway配置设置 `G4_CONTROLLED_WINDOW_JSON`，形状由 `G4WindowPolicy` 定义；schemaVersion=1、唯一windowId、已确认tenantId/userId、官方Go费率证据SHA256，以及固定数值：inputNanodollarsPerToken=500，outputNanodollarsPerToken=1800，totalNanodollars=20000000000，turnNanodollars=5000000000，maxUpstreamDispatches=32，maxServerRuns=16，durationMs=7200000。配置不允许客户端选择或修改。采用官方Go两档最高输入/缓存写入US$0.50和输出US$1.80每百万token；整个input按更贵档预留，缓存命中不用于降低预留。费率证据SHA由主控离线核验后冻结，运行时不抓远端价格。Go余额回落设置及账号entitlement仍须主控核验，不能从订阅推断零费用。

窗口复用指定tenant的私有TenantModelBudget SQLite actor，无新DO、D1迁移或公共转发接口。新Project、Turn、实验Run（包括Verify/group child/replay）与Service Run均以平台scope/user/原幂等intent派生key和输入digest。唯一新intent持久登记；跨DO失败可能保守占用Run槽位，绝不自动释放后重做。Service与Simulation共享16。首次intent的startedAt和policy文档共事务写入；相同key不重启计时。metadata存在后，移除配置或修改windowId/policy都拒绝新admission，不能通过重部署重置预算。当前角色/ready校验继续由原Catalog/Workspace执行，窗口不是ACL授权。

Go Model Proxy服务端核验输入界限至少为payload UTF-8字节数加4096，并要求既有bound版本。token reserve与美元reserve在同一SQLite事务中；真实provider调用前，token和窗口dispatch围栏原子提交并消费32中的一个槽位。仅一次handler取得dispatch permission。ACK丢失、重启、reserved/dispatched未确认、缺少usage/请求身份、非成功Provider响应及unknown均保留最坏费用并阻断本窗口新任务；不按timeout返还，也不补发同key。只有明确未dispatch proof能释放reserved费用；明确Provider usage+requestId才能按最高费率记保守已知费用。不能将终态unknown记成零。

dispatch回执提供冻结controlledWindowDeadlineAt，Model Proxy在最后await后与Go adapter真实fetch前核该新dispatch截止；持久flush跨截止时拒发，后续await跨截止时也拒发。窗口截止不改变已dispatch Provider调用原期限，不强杀已有Run/Task收尾。既有Provider/SDK deadline、取消与Stop逻辑保留。维护GET、读取历史Run/Verify、Stop和同identity观察不创造新费用/计数；新窗口snapshot仅查询sqlite_master和既有表，不CREATE、不启动timer。无历史G4 metadata且不配置G4的旧发布继续旧token行为。

当前证据：专属SQLite测试覆盖上限、幂等、删配置/换window拒绝、lost reserve/dispatch ACK、费用hold与磁盘重开；真实Workerd测试使用同production TenantModelBudget类，dispose/restart后保持startedAt、16Run、唯一dispatch和费用hold。上游出口在测试中关闭。测试里的任务/模型输入为合成数据，不是Provider执行证据。受保护GET `/api/workspaces/:ws/g4-compute-counts` 汇合窗口预算、所有Turn/Simulation/Service持久围栏和已登记nativeAttemptSnapshot。该GET维护ACL在各await前后核验，不admit任务、CREATE表或执行native health/observe。缺counter/旧actor为supported:false/null，不能当零；native是attempt-before-call而非成功Python/SDK执行次数。应与真实Agent之后完整ledger、前后稳定计数和Cloudflare库存共同证明本地运行零新增compute。

首次新项目之前，普通已认证 owner 可用 `GET /api/tenants/:tenantId/g4-window` 读取固定 tenant actor 的窗口；前后校验当前 owner/authVersion，拒绝 query 和写请求。未启动窗口返回持久 startedAt/deadlineAt null 与 configured policy，客户端不得伪造截止时钟。该 GET 不创建预算表或任务。

## 冻结候选与发布准备记录（2026-09-15）

主控冻结的最终候选源码为 `d780f09`。主控报告该候选 `npm run check` 退出0：共1990项，1979通过、11跳过、0失败；定向Chrome 5/5、Service/Guard 14/14通过。跳过项不作为在线通过证据。A的实现补丁为 `588f504`、`76d596b`、`668dcea` 和 `c73b35d`，已由主控集成、复核；无新增DO或D1迁移。

接受的服务端窗口为 `g4-20260915-01a0a45d`，固定官方费率证据SHA256 `967ba66f0c5983bea463506087df57cc205315d7a08f527a5f0dc29395a0aac6`，普通已确认tenant/user仅存私有配置。模型为Go / `gpt-5.6-luna`，总模型US$20、每Turn US$5、实际上游dispatch围栏32、Service与Simulation共16个accepted Run intent。首次实际普通新Project intent持久启动7200000ms窗口；新Turn/Run/provider是fallback，重部署和同key历史回放不重启计时。首次之前GET返回startedAt/deadlineAt null；客户端provisional due不替代服务器时钟。两小时后停止新任务与新provider dispatch，原已admitted任务可按自身deadline收尾，Stop/维护GET/同identity恢复允许。G4未启用workspace runtime热复用，不执行G5场景。

首次正式检查中的Chrome启动deadlock超时与Service历史重放回归保留为失败诊断，未改成通过记录。Service问题已修：新增Catalog复核仅在G4配置存在时运行，旧authVersion冲突及删auth session后既有Service重放契约保留；私有budget actor检查仍每次调用，因此删除已持久窗口配置不能绕过guard。deadline问题另有两层负向证据：预算sync/warm await跨截止和call截止恰等于窗口截止且Go同步telemetry跨截止，均在真正provider fetch前拒绝、持久unknown且费用不释放。修复后的最终检查与前次失败分开记录。

发布状态为 **PREPARING**：主控已开始独立execution Worker部署；截至本记录，普通app仍旧版本，未发起普通Task或真实native内容探针。本次A仅更新文档，未执行云命令、部署、模型或浏览器动作。候选本地通过不能替代paused发布身份核验、真实普通用户链路、native探针、后台计数/库存闭环或在线G4验收。

主控报告已回读G4限定范围的R2保留规则：脱敏诊断7天、验收证据30天，相应范围当前对象回读为0。规则只覆盖批准的G4脱敏收集范围，不对checkpoint、其它对象或整个bucket施加清理；0对象是当前范围回读结果，不是后续证据已经写入/到期删除的证明。普通账号cookie、密钥、原始session和未脱敏内容保持私有，不进入验收证据。该R2规则不改变Go上游自身30天保留策略。

G5/G6仍未获得执行授权；本条没有扩大授权，也没有声明G4在线验收完成。

### 后续候选修复：源文件故障恢复

`d780f09` paused上传期间另发现并修复：首次源R2读取失败产生的failed/profile=null占位行，会挡住恢复后另一profile的正常unsupported分类，导致Mesa不能恢复。修复只允许profile、modelSpec、receipt均null、状态failed或building且buildIdentity精确等于原平台discovery身份的占位行重新分类；有实际冻结profile或非原占位identity的行仍按原完整性失败处理，ready行不重算身份。该补丁是后续候选，需主控重新冻结、检查和paused更新；不静默改已冻结部署。

两个真实Workerd/SQLite/R2回归从RevisionStore.commit与TurnJournal保存生成discovery，暂删仅测试scope的files blob，三次受控Builder尝试产生双failed/null；dispose/restart、原字节恢复、显式同Revision retry后分别验证Queue和Mesa ready、另一profile unsupported、原filesSha256及Revision不变、create-only receipt与无剩余alarm。测试使用受控时钟推进Builder，未声称物理在线故障注入或真实native/model运行。既有冻结compatible转unsupported、旧runtime同identity补收据、ready保留及三次尝试上限回归继续覆盖。
