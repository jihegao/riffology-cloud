# G5账号与Gateway核验（2026-09-16）

最新状态：生产接线已闭门发布，两个production secret引用已上传并独立读回名字；两个真实user/tenant/owner membership已目录只读核对，不代替普通登录。A/B范围及20+20USD预算已冻结，原生Gateway models实测403 `unsupported_country_region_territory`，0推理、未开跑。下文“待接线/未上传/未冻结”为先前准备状态，当前以[冻结回执](g5-scope-budget-freeze-20260916.md)和[生产readback](g5-closed-production-readback-20260916.json)为准。

用户已创建OpenAI密钥Codex并保存到原项目`.dev.vars`的`OPENAI_API_KEY`。主控核对文件权限0600；从该引用只读调用`GET /v1/models`，HTTP200且账号返回`gpt-5.6-luna`。没有打印、上传或写入文档密钥值，也没有修改原变量。此结果证明只读鉴权和模型可见性，不证明推理余额、账单或完整Responses工具循环。

沿用Luna模型身份准备OpenAI Responses/platform-BYOK配置；它是不同于G4 OpenCode的生产通道，不能据G4结果提前签收#46。部署时固定secret引用`PRODUCTION_OPENAI_API_KEY`应从用户已有`OPENAI_API_KEY`安全映射，当前尚未上传Worker。Provider真实请求与工具循环仍需新窗口验收。

## 专属Gateway实际操作

既有Cloudflare operator先GET确认账号没有Gateway，再创建`riffology-g5-20260916`，POST成功后独立GET逐项一致：authentication=true、byok_only=true、collect_logs=false、cache_ttl=0、retry_max_attempts=1、fixed rate limit32/60秒、logpush=false。没有模型推理流量；这是本轮一个云资源创建，不是Worker部署或新用户任务。旧G4 Worker仍关闭。

参考[Cloudflare认证文档](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)和[请求重试文档](https://developers.cloudflare.com/ai-gateway/configuration/request-handling/)。Gateway配置/请求头最多一次只是配置证据，实际失败时单次上游证明尚未取得。

此前缺少`PRODUCTION_AI_GATEWAY_TOKEN`。现有operator对账号Token权限组GET返回9109 Unauthorized，主控未创建或借用/复制全局operator凭据。随后主控独立确认用户已在原`.dev.vars`加入该变量，文件仍为0600；使用新token只读调用`GET /user/tokens/verify`，HTTP200、success=true、status=active（2026-09-15T22:49:27Z）。没有打印或上传token值。这证明token有效，尚不证明AI Gateway Run权限范围或provider代理调用成功。Cloudflare Run token是账号级，不是单Gateway范围；本账号目前只有这个专属Gateway。

用户随后明确授权第二个普通测试用户`jihe.gao@theidsa.org`。邮箱授权已取得；实际登录后的userId/tenantId及与第一账号的独立性仍需从普通用户会话核对，不能由邮箱推算或伪造tenant。该授权没有启动模型请求或预算时窗。

## 有日期的保守预算

依据主控实际获取的[OpenAI API价格页](https://developers.openai.com/api/docs/pricing)及[Luna模型页](https://developers.openai.com/api/docs/models/gpt-5.6-luna)：标准短上下文输入US$0.20/百万token、cache-write US$0.25/百万、输出US$1.20/百万。采用更保守的输入250/output1200 nanodollars每token，I=262144、O=4096；输入上限低于272K长上下文阈值，不启用Fast、地区处理或托管工具。若实际配置不满足这一价格适用条件必须重新冻结profile，不能直接套算。

| 项目 | 最坏规划预留额（USD） |
|---|---:|
| 一次上游 | 0.0704512 |
| 一个8请求Turn | 0.5636096 |
| G5-A最多147请求 | 10.3563264 |
| G5-B最多168请求 | 11.8358016 |

因此这组模型/token/费率候选满足各窗口US$20及每TurnUS$5的预算公式。不是实测费用、invoice核验或实际账号费率协议确认；profile、授权引用、真实源/镜像/gate和不可重置server window尚未完整冻结，不能仅凭此表执行。

[OpenAI数据控制](https://developers.openai.com/api/docs/guides/your-data)说明默认滥用监测可能保留内容最多30天；`store:false`和in-memory缓存不等于全链ZDR，本账号ZDR未核验。提案的脱敏诊断7天/验收30天作用专属平台副本，不冒称可更改OpenAI上游默认保留。Gateway关闭日志，平台保留白名单测量与摘要，原始session/凭据不上传。

## 服务端窗口仍需实现

原G4 guard把OpenCode/32调用/16Run及已开始singleton政策固定在旧TenantModelBudget；不能换windowId、清零或删配置绕过旧fence。G5需要独立token budget namespace及全局不可重置window guard，按新政策对跨tenant总额、Turn金额、task/各类Run/upstream、首准入后2小时、unknown及三账本结算实施权威门禁。该最小切片已本地实现并集成，见[G5窗口守卫](g5-window-guard-implementation.md)；共享生产接线及部署尚未完成，没有新model dispatch或Run。

共享接线审查发现必须区分单次模型Call和整个Turn的结算：现有三账本closeTurnAdmission会不可逆关闭Turn，不能在工具循环每次Call后调用。单Call的token/money实际record和tools静止观测只能放行同一已准入Turn的后续Call；跨任务/窗口释放必须等待Turn真实终态与三账本关闭且无未决。核心分层修订已集成194a06e并通过独立本地验证，真实私有来源adapter及queued/Create/start穿透仍需随后完成。邮箱、token或本地receipt均不能取代这些门禁。详见[共享接线与排队设计](g5-shared-wiring-and-queued-design.md)。

本地准备最新验证：typecheck通过；窗口guard13项（含2真实本地Workerd）及journal/collector/runner23项通过，合计36项相关用例，0失败/跳过；非作者交叉审查通过。没有复用历史完整check作为本候选结果，也没有Worker部署/模型推理/新Run；G5两小时窗口未启动。G5-A/B范围与新窗口预算仍是具体待冻结候选，沿用用户原先“G5/G6另行确定范围和预算”的边界。
