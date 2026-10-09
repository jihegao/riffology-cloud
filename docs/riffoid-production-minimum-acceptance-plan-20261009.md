# 当前可执行检查与真实双账号验收边界

## 2026-10-09 04:35UTC 已完成的本轮范围

用户04:29:51UTC明确允许精确transport绑定后，同一工具调用获准执行。04:33:49UTC仅发出一次受控PUT，04:33:51UTC成功；04:34完整domains和domain ID独立GET确认绑定，域名总数11→12、原11条完整对象未变。domain ID `9f0e5e9924f4c95948932d5fab37621a1075ddb5`，certificate ID `7c91ea00-d3d8-41f3-9cdb-7e6071170066`；原账号、原zone、原Gateway。PUT deprecated environment为空，GET为production，其他身份/证书字段一致。Gateway写后active部署仍为冻结 `57ea9670-0fef-420b-8bd2-cd044c89fd2d`，version `6edef49b-ca5c-4c97-bcec-5c141b079bb1`。

五次真实匿名HTTPS GET均正常TLS校验通过、不跟随跳转、不改写Origin/Host/IP、无Cookie发送/设置：

| 地址 | 结果 | 证据边界 |
| --- | --- | --- |
| transport 首页 / get-session | 各403，Cloudflare拦截页 | 外部匿名直接访问被拒绝；未独立核实具体WAF rule ID命中 |
| 旧首页 | 200 | 静态首页可达，旧CSP仍在 |
| 旧 get-session | 200/null | 匿名session，非真实登录验收 |
| 新 app.riffoid.com 首页 | 503/two_account_auth_disabled | 入口保持关闭 |

[本轮绑定与公开检查完整证据](evidence/riffoid-transport-bound-public-checks-20261009.json)保留一次受控重试、前次未知回执及审批拒绝历史。此次域名动作按相关性核对全domains、Gateway active/latest；未重读整个DO/config/code资源集，不能将之前完整安全快照当作本轮重新读取。没有代码/vars/bindings/namespace/普通DNS写操作，没有配置切流、登录、私钥接触或付费业务执行。下方正向签名、真实IP、OAuth/CSRF/SSE/Execution及其他身份验收仍待后续协调范围和批准；48小时恢复计时未启动。

当前本任务只接线既有批准的 transport Custom Domain，保持旧 canonical、入口 disabled、Execution 和 native-IP-boundary 不变。所有请求都使用实际 HTTPS URL；不覆写 Host、Origin、cf-worker 或访客IP，不用跨账号CNAME/service binding，不新建测试Worker、peer或身份。

## 无需配置窗口的最小检查

1. 独立GET账号全部CustomDomains及transport domain ID；确认仅新增该host，旧两域和其他账号域名对象保留，Gateway/Execution/23namespace/settings/code与已冻结安全阶段完全相同。
2. 从实际外部客户端对 `https://riffoid-transport.gaojihe.cn/` 和 `/api/auth/get-session` 各发一次无Cookie匿名GET；正常验证TLS，不跟随跳转、不重试请求。预期旧zone WAF拒绝外部访问403；若只收到应用origin_denied，必须明确这只证明应用拒绝，不能说WAF已命中。网络失败只记未验证，200/302/认证可达立即停止后续验收并报告，不放宽规则。
3. 旧首页和get-session各一次匿名GET应保持200/null且不设置Cookie；`app.riffoid.com`实际HTTPS GET若可达应仍503/two_account_auth_disabled。TLS失败不推断应用故障。
4. 这些检查证明域名/TLS、直接客户端门禁和未切流状态；不证明跨账号来源、私钥匹配、原生IP真实性或nonce重放拒绝。GET可触发安全控制但不登录、创建用户、调用模型/工具/Turn/Run或修改账号状态。

## 当前代码的具体耦合与不可替代的批准点

生产 `services/entry/index.ts` 在 mode disabled时先返回503；`signEntry`要求已核实的ENTRY_NATIVE_IP_BOUNDARY marker及Secret。`verifyEntry`在验签之前先比较proof audience与Gateway APP_ORIGIN。新入口proof audience固定app.riffoid.com，旧Gateway APP_ORIGIN仍旧站。因此仅加transport domain不能完成正向验签；临时仅开入口，或只向Gateway加transport var，都不构成安全可用的最小接线。

可运行真实正向验签的下一步实际上需要协调的配置切流窗口：Gateway canonical+transport+signed、Execution唯一ancestor/origin以及entry signed必须按批准包一致；native-IP-boundary只有在实际来源/IP前置成立并获准后才能设置。当前指令明确禁止这些修改，本任务只交计划。禁止为满足“先验签后切canonical”伪造Origin/audience、扩大trustedOrigins、临时共享Secret、开放任意Host或给已有代码添加未经评审的debug路由。若要求在切canonical前独立验签，现有代码不提供该路径；须另行评审一个保留业务门禁的验证设计及其精确批准范围，当前没有实现/上线。

## 配置窗口满足后最小正向检查

先完成两zone实际规则/顺序、managed/request-header transforms、PseudoIPv4与真实native来源/IP边界核验，冻结新入口完整非秘密配置和原网关/Execution前向回退。现有截图及无变更确认已保存，不重复索要；没有权限的API不扩scope、不新grant。

在新的无并发发布窗口内核对latest=active=冻结base，按精确批准协调配置并完整回读。成功切流T与T+48h只能在真正完成切流时记录；不提前编造，不延长原8h session。首次只从真实直接客户端对新入口首页发一次匿名GET；预期200及严格Cookie/Location/CSP合同，实际Gateway签名校验+一次replay claim成功才可作为密钥匹配和公开跨账号hop证据。失败/超时不自动重放。仅该静态请求不证明OAuth、权限、IP限流或SSE。

## 无法冒充完成的负向覆盖

| 场景 | 当前合法最小路径 | 证据边界 |
| --- | --- | --- |
| 直接transport客户端 | 当前匿名真实HTTPS GET | 可验证TLS+WAF拒绝；请求被WAF阻断不能算Gateway验签负测 |
| disabled入口 | 当前真实HTTPS GET | 可验证503；不证明私钥对应公钥 |
| 缺失/无效proof、错误audience或路径 | 后续已有、获准的真实同zone请求通道 | 不能伪造来源绕WAF。无既有通道则保持平台覆盖pending |
| 精确nonce重放、过期签名 | 后续已有通道能重复同一原signed请求且获准处理最少非秘密测试元数据 | 浏览器重复访问会产生新nonce，不能当replay测试；不记录Cookie/私钥/完整生产proof，不新建peer |
| 同zone其他Worker/外部Worker | 仅在既有已授权脚本和范围确实存在时做 | 当前禁止新建测试Worker；不存在则明确未覆盖，不用客户端伪造cf-worker替代 |
| 两访客IP与限流 | 两个真实获准网络客户端、保持平台IP字段和真实Origin | 不伪造IP；无需模型调用，但可能写auth rate/security state，需明确真实验收范围 |
| 原Google主体、CSRF、权限撤回、SSE | 后续获准真实身份与只读既有资源、明确可产生的OAuth/session/security状态 | 当前禁止账号状态写且无登录范围，本任务不发sign-in/POST；不得新建身份或Run替代 |
| Execution隔离 | 协调后合法真实浏览器访问/iframe及原唯一ancestor核对 | 匿名配置/CSP检查不等于真实浏览器隔离、跨身份或付费执行验收 |

回退使用已冻结原代码+replay包及同一实际namespace，不raw rollback跨DO生命周期、不删/重建namespace。任何Gate/资源/来源未知停止新准入，按已知回执仅只读核查；回退执行需要独立批准及新发布窗口。原身份/历史/ledger、12月31trial和上海10月20M1不变。
