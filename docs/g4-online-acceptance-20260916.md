# G4 受控线上验收记录（2026-09-16）

状态：本次受控执行已结束、计算已释放、证据已归档。#64普通用户主链通过；#65及全部线上负向场景未完整覆盖，issue保持未关闭，G5/G6未启动。此前运行日志保留历史，当前发布和结果以本记录后续收尾条目为准。

授权使用既有普通 Google 测试用户及 Cloudflare operator，opencode-go/gpt-5.6-luna；模型总额 US$20，每 Turn US$5，上游32次，服务端 Run16个。权威窗口为2026-09-15T14:57:10.322Z至16:57:10.322Z，不可重置，仅合成数据。专属脱敏诊断7天、验收副本30天；G5/G6另定范围预算。

## 固定发布与检查

生产源码 `924803b36d587b95f92d6b252d87a8a0aa567a7d`。应用唯一100%版本 `c89121d2-d381-4900-a784-e6aee86f1a83`；独立执行站点唯一100%版本 `10a5428b-34d1-494c-9ff8-e775849a94e4`，均为该 source tag。正式检查2002项、1991通过、11条件跳过、0失败，日志 SHA256 `7e4e43f90c8ae3b2af1b09d4f4185570805c35e2769000ca5430329bcd3d30a7`。随后仅修改本地 operator：独立元数据读取并行但不延长15/30秒界限；实际普通用户新页面先正常缓存完成初始化，再安装精确POST最终guard。未改变生产预算、Run时限、runtime/模型代码或镜像；operator最终全量检查另记。

慢资源问题通过生产GET资产body读取120秒处理，metadata仍15秒、runtime execute仍30秒。38个固定SDK资产独立真实GET的长度/SHA核对通过；容器image未滚动。Simulation应用为basic/cap1、租户quota为2，真实镜像采用已验收锁定profile；执行站点无DB、R2、DO、服务或容器binding。

## 实际模型与本地浏览器窗口

| 模型 | 冻结Revision | 实际包身份 | 结果 |
|---|---|---|---|
| 真Mesa Schelling | ccd28c4261894c676be368af49e088fecd2ae12277548f3206856c3e26e3f861 | 83b2379d80c90f7e7d280dbe5f48c30a01024a067c199cea330cc3f7f0248376 | Mesa3.5.1 Model/Agent/SingleGrid；CPython3.14.2服务端profile |
| 旧Queue | 00d085b369acd38e1b853b595c893b88abfb48f5147dce05a984af4d6cc5f3d6 | 51b39580dcfecadea03151b54806b5d15aa77a2978ceee6592ae5704e295cba7 | 非Mesa，指数到达/服务，CPython3.11.14 |
| 修改机制后的Queue | 85c810452f0f1d1f485cf3c8b6dd8fd443e73b43d5e67343cf94ad970c1d81c9 | 0027321dd28d7cb280b0e00f53b64f12d606daaaadd7fc237f6694ed2d97d3bf | 用户修改服务为固定1/service_rate；customers上限166，兼容依赖恢复 |

三组均由普通Agent自动保存/生成包，不手工部署模型；Root实际R2源tar摘要及五文件字节与包核对。各自独立本地窗口实测3个完整轨迹（默认、修改参数/seed、刷新恢复）、播放/暂停/单步/重启及pending取消；刷新轨迹逐项等于默认。三视口1600×900、1000×850、390×844均无横向溢出。每窗口实际HTTP POST=0，六个执行计数delta=0；独立分页云库存五应用250个实例全部inactive，前后无新增ID。应用域Cookie存在，执行域Cookie为0。移动Queue另实际滚动到底部参数和Verify，控件可达、无POST，独立截图隐私审查通过；不据此外推Mesa底部和全部#65交互。

初始“Mesalock但stdlib模型”明确失败并保留，后续普通Turn生成真Mesa才签收。旧Queue首Turn失败但saved checkpoint有效，不把saved解释成Agent完成；后续机制修改和兼容恢复Turn均completed/saved。两个早期UI发送前失败保留实际key/body：Mesa修正原键API恢复；其他未生成UI key的尝试标记独立API意图，不虚称UI成功。最终两个Queue Verify均实际普通用户页面202。

## 真实Verify、版本与持久结果

| Run | 来源/方式 | 原版本绑定 | 完整轨迹 |
|---|---|---|---|
| 0b22dee1-28ed-489d-a93a-1785269e15cd | Mesa显式普通认证API Verify | ccd28…/同参数seed7 | Root真实R2 7帧、7179字节完整deepEqual浏览器 |
| ab46fde5-4d26-4207-a1c6-bc2e07b04a56 | 旧Queue普通页面Verify | 00d085…；新head后仍原版本 | Root真实R2 37帧、10869字节完整deepEqual浏览器 |
| d2971a8b-e18d-4fc0-993d-8e761dcba834 | 修改机制Queue普通页面Verify | 85c810…；README新head后仍原版本 | Root真实R2 37帧、12635字节完整deepEqual浏览器 |

三者真实结果envelope、summary、trace均独立R2 GET校验字节、摘要、Revision/源码/Spec、输入、seed、Python与image。旧Queue ZIP实际完整下载 SHA256 `207c2741324f233b1223866d4a43d74b61cf7d8f853b3e8fa9fd7b09cd9ede44`，禁网既有CPython3.11.14严格verify-only及指定旧Run重放成功，指标和summary/全traceSHA匹配，无版本豁免。

伪造浏览器metrics实际请求返回400 `browser-preview-input-invalid`，前后权威tasks及calls逐项不变，未新增Run/model。两包实际owner200、跨workspace404、独立无Cookie上下文401；未测试另一已认证principal，不外推覆盖。固定runtime与包不包含会话材料；真实本地流量证明隔离执行域无应用Cookie。负向静态/协议测试与实际云操作分别记录，不将测试fixture称作普通用户实测。

## 新旧包、unsupported与真实恢复

普通用户机制修改Revision cf196…声明未安装sympy1.13.3，真实构建unsupported/dependency-unsupported；随后普通Turn移除不支持依赖，Revision85c810…自动ready。固定wrapper和模型服务机制保持一致。

专属、固定actor/scope/version的120秒HOLD在README-only合成Turn d614e477…保存前实际ACK。新Revision612e303…、源tar56bf53…、40960字节：Root先准确备份并校验，仅删除该新owned tar，独立GET证明不存在；释放HOLD后产品按三次有界重试策略最终failed/source-unavailable（本次未逐条独立计数实际attempt）；Root恢复同原字节和key、独立读回完全一致。普通认证API按原失败Revision/profile/build identity c06a25…请求retry，202；同retryId GET accepted，仍绑定原失败请求。恢复有效源后新ready包身份为0b889d…（不是失败占位身份），12106字节 SHA256 dccef18fa1adc1acad5a6b651da255c985e9c74716a74f18343b1fc45195b3f8，实际HTTP完整读回校验通过。HOLD/故障注入/备份/恢复/retry工具本身未新增Go/Run调用；README合成Turn和同时存在的其他workspace实验分别计数；没有删除manifest、session或其他workspace。专属fault Worker已删除，Cloudflare10007及workers.dev404独立确认，生产Workspace namespace保留。

## 收尾前历史快照（不是最终状态）

Mesa实际Group f7c14855…为baseline/intervention×seeds7/8共四个真实Run；当前三次completed，两次released，第四次待串行调度。必须全部complete/released、count2/missing0后，经实际Evidence规则创建/核验，再下载新ZIP严格重放。

已部署独立固定七Run的只读release reader，仅TenantQuota snapshot/lookup（最多455lookup/20秒）；不得由RPC名字或物理inactive推断释放。初读已有六条历史lease但两条仍dispatched，一条未启动；尚未最终接受。最后须实际quota occupied0/unknown0、七条历史lease stop confirmation、完整五应用连续至少30秒inactive。读操作可能初始化已有quota SQL schema，不承诺零storage写入。

原生结果未输出NPP/RLIMIT_AS/uidgid/networkfence/pidfd/seal逐项事实；已绑定真实image及实际Python，源码审查与成功发布语义提供执行边界，不能把这些字段说成每Run独立观测。单Run可经既有规则保存为来源已核验的测量，不能据此声称科学有效性。#65真实错误保留/Stop/全部导航恢复仍不能凭三截图关闭。

最后费用、Run admission、停止门禁版本、脱敏R2上传/独立读回SHA256SUMS、operator正式检查与最终签收结论在下方追加。诊断/证据专属R2前缀已实际配置7/30天TTL；产品状态与不可重置预算/幂等fence不因保留副本TTL重置。

## 最终收尾与边界

- 四个Mesa Group Run全部completed/released，baseline与intervention各count2/missing0，无失败/排除。真实delta claim `37b88bb6eb16377405227a5dc6d2f6706df260adc7a6c52d29fe8a764ff92bfb` 独立GET `verified`，segregation基线均值0.830224865、干预均值0.83101852、差0.0007936550000000597。两seed效果方向不同，不作单调或实证科学结论。
- Mesa显式Verify Run0b22…的直接 `kind:run` claim `f6b130c68f9b886c33b06b0e9b3fdb29c01e8c3cc8272959375d808c778ce6bc`，count1/value0.11111111；恢复Queue Run d297…的直接claim独立GET核验mean_wait0.23300102。两者普通页面只读刷新/核验/展开来源，实际DOM版本和references、metric/value/count与API一致，HTTP POST0；科学有效性全部unassessed。旧Queue Verify ab46…仅签原版本Run/轨迹/replay，不冒称当前Queue claim引用它。
- Mesa完整实际ZIP SHA256 `74542bd0748961b3466724c2340a8e6d60703fdf704380f1f1e79b74850d50e7`，五指定Run在禁网、只读、既有CPython3.14.2/Mesa3.5.1镜像strict replay全部成功；summary与7帧fulltrace SHA逐项匹配。恢复Queue新ZIP SHA256 `ad779e8d8642853f61e7ba30edb703f2d0abe3c0b631f5ff93b80bb82be30d73`，CPython3.11.14指定d297…完整37帧严格重放成功。所有重放无版本豁免，未新增Cloud Run/model调用，临时Docker均已删除。
- 七个实际Run历史lease全部scope/generation/run/operation精确匹配、status stopped、具有runtime-stopped confirmation；quota occupied0/unknown0/available2。间隔超过30秒的两次完整分页Cloudflare库存均为259个inactive、ID不变（Simulation38、Service18、Pi125、Tools70、Project8），不是仅查active-filter，也不由物理inactive或RPC方法名称单独推断释放。未声称连续kernel进程监视。
- 主应用在UTC2026-09-15T16:39:45.352736Z唯一100%版本 `fc3c6a9d-2d9f-42b9-a94d-51e33a652235` 提前关闭六个新任务/provider/simulation/service/preview门禁并清空HOLD allowlist。source924803…和script etag087ec0…不变；原14项控制策略、首次接纳/截止、calls/tasks与生产namespace均保持，独立GET复核。固定预算与幂等fence没有重置。执行站点仍10a5428b…固定source。
- 专属fault Worker与只读release reader均已删除，Cloudflare10007和workers.dev404独立确认，生产Workspace/TenantQuota namespace保留。没有关闭issue、推送、合并、发布官方模型或进入G5/G6。

最终模型账本：上游30/32，服务端Run7/16；保守计费US$0.1638495/20，单Turn最大US$0.0329792/5，未结算0。非供应商invoice核验；Cloudflare费用未冒称模型账本费用。

本地operator提交 `a4f367c`，再次正式check2002/1991通过/11跳过/0失败，日志SHA256 `fd7e81b240e0b92158fcbc37c6e3dc3af64f91b7a97c57d39d9ae473f959480e`。此host runner提交不改称生产source tag。

### 脱敏保留与独立读回

专属MODEL_CONTENT bucket `riffology-m3-model-content-staging` 前缀 `g4-acceptance/g4-20260915-01a0a45d/`。生命周期原PUT及独立GET校验通过；本次三对象均真实PUT ACK、独立GET二进制完全相同，组合解包后94/94 SHA256SUMS项校验通过。此前SDK准备证据30天对象仍保留。

| 对象 | 字节 | SHA256 | 天数 |
|---|---:|---|---:|
| `g4-acceptance/g4-20260915-01a0a45d/evidence/g4-final-evidence.zip` | 1927644 | `552d6d0f2198e8bcb5544e47234a3be9d1ba6c1970e0061c204c9975e50931d0` | 30 |
| `g4-acceptance/g4-20260915-01a0a45d/diagnostics/g4-final-diagnostics.zip` | 1396 | `f22562bd7acf5f77f3729497f5783b2b8b0dd8cfb489db0fb08d330963bd5667` | 7 |
| `g4-acceptance/g4-20260915-01a0a45d/evidence/SHA256SUMS` | 10128 | `106f2f6b91b38f6e43a9d2093c2f3ef279c0eda47b2dd18ed58d174e981aa95f` | 30 |

验收副本只保留实际合成模型源码/包/轨迹、独立核验字段、截图及白名单测量/资源证明；诊断只阶段/timeout/exit/reasonSHA，不上传Cookie/cap/session/control私有配置/原始Pi签名数据。7/30天作用本次专属诊断与验收副本；产品业务对象与不可重置预算/幂等fence保留原生命周期。A/C本次实际源/模型/导出/重放临时副本已按归属清除；Root已删除owned auth副本，临时Worker删除使控制cap失效。B的46文件脱敏本地副本目录删除遭自动审批拒绝（shutil_rmtree被判高风险并要求明确许可），未执行、没有绕过。Root本次私有采集目录也保留等待明确目录清理许可，不冒称全部本地清理完成。远端脱敏副本7/30天TTL已生效；尚存本地集合不由R2生命周期自动删除，需后续目录清理。现有Google账号/Chrome profile与Cloudflare operator全局凭据不变。

阶段执行完成不等于issue完整关闭：另一已认证principal、全部敌意Python/network/postMessage线上触发、逐Run kernel事实未覆盖；#65错误不误清、Stop与完整旧导航恢复没有全部线上签收。下一次范围/预算仍需另定，G5/G6未获授权。

目录级清理待确认：`/Users/gaojihe/apps/riffology-cloud-issues-integration/.local/issues-20260915/g4` 与 `/Users/gaojihe/apps/riffology-cloud-g4-native-counts/.local/g4-accepted-sanitized`。范围仅本轮已归档临时采集/脱敏数据，不删除现有用户/Chrome profile/全局Cloudflare凭据、产品数据、原有脏文档、G0–G3或预算/幂等fence。自动审核实际只拒绝B目录递归删除；Root未尝试目录级删除，现单列同轮目录供明确批准。
