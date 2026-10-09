# riffoid 用户公钥准备补充（2026-10-09）

用户00:26UTC提供公开ring并报告本人已生成/保存私钥、向新Worker保存Secret。本轮只完成公开导入校验、旧侧现网只读漂移比较、候选及前向回退配置完善；**生产写入0、transport绑定0、replay分配0、入口启用0**。已有精确批准继续有效，不再要求用户重新生成私钥或再次批准同一包。

[机器证据](evidence/riffoid-public-pin-preparation-20261009.json)和[严格公开ring](../infra/riffoid-entry-public-keys.json)可审阅。代理没有生成、读取、传输或注入私钥；仓库仅保存用户已提供的四字段公开JWK，不包含d。

## 公开ring校验与新侧边界

key ID **riffoid-entry-20261008-a**；`kty=EC, crv=P-256`，仅 `{kty,crv,x,y}`，x/y各32字节且为规范base64url。Node WebCrypto成功导入ECDSA P-256非extractable public key，仅有verify用途。RFC7638 thumbprint：

```text
FauX-M6dHO_kyhCvVXB4ubgZoDVSBKH2xwYOSzYaFr8
```

公开ring文件SHA256 **a1bb7476581887d50c2ffb441946e6672b1aca1135c735a0dc2b7111daccf1ff**；用于plain_text binding的紧凑JSON SHA256 **57fa641fec5d9525005d5550e4ea33b25e06b1f1ebcba49dac34123c431f7f2a**。实际Gateway verifier用该ring导入公钥后拒绝离线无效签名，未进入replay，未调用业务/网络。

父线程新账号连接器00:27UTC回读：`riffoid-entry` 的 `ENTRY_SIGNING_PRIVATE_JWK` 存在、类型secret_text，未读值；date **2026-09-06**、flags `[global_fetch_strictly_public,enable_request_signal]`、mode **disabled**保持。本任务不重复新側操作。**Secret名称/类型存在、公钥导入成功均不证明私钥内容与公钥匹配**；这只能由之后获准的实际签名/验签确认，不读取Secret或让用户发送私钥来证明。

## Google追加批准与新侧公开配置最新状态

用户 **2026-10-09 00:44:41UTC** 原话：“Google callback 已保存. 同意补授权域名”。新增 `https://app.riffoid.com/api/auth/callback/google` 的保存状态来自用户确认，**未独立读取Google，也不是OAuth实际登录验收**。

原固定批准包只保留Branding `gaojihe.cn`，遗漏了新callback域的必需前置。[Google官方Branding说明](https://support.google.com/cloud/answer/15549049?hl=en)要求Branding及client配置使用的域名预先列入Authorized domains。现按用户此次精确追加批准：**保留gaojihe.cn，仅新增riffoid.com**；主页/隐私/条款、JS origins、原callbacks、scopes、client及secret不改。父线程已指导用户本人操作。用户随后 **00:45:56UTC** 明确回复“授权域名已保存”（Sentinel_035f7cd63b2c81918eb469da77469ff0）；据此记录为**用户确认已保存、未独立读取Google**，不再列保存pending，也不把该确认当成实际OAuth验收。不改写原a0ab4881固定批准包的历史，也不自动发起Branding发布/其他认证修改。

父线程新账号连接器 **00:38UTC** 已PATCH并独立GET核验 `ENTRY_SIGNING_KEY_ID=riffoid-entry-20261008-a`、类型plain_text；原4bindings通过inherit保留，共5bindings。Secret仍secret_text、值未读；mode disabled、date09-06和双flags不变。公开key ID缺项已解除，不需要用户额外手工操作，本任务不重复生产操作。Secret及key ID存在仍不证明私钥/公钥匹配。

追加批准、应用确认与回读来源分列在[Google授权域名补充证据](evidence/riffoid-google-domain-supplement-20261009.json)。

## 旧侧本次只读刷新

第一次Wrangler SDK读取遇到连接层fetch failed，未取得快照；原失败保留。一次受限、同隔离授权、同scope重试成功，未重新登录、扩权限或重试此前被拒绝的zone DNS/routes/WAF。

00:28–00:29UTC新快照中，Gateway **aeddf112-a2be-45da-868c-ed576c55d5ec** / deployment **c6ff55e4-2364-4920-94e0-b8784a1824b5**、Execution **c94df077-02a1-460f-8158-e47a338e68af** / deployment **a6fdeb9f-d885-4c72-9e02-968315351edb**均100%。完整非秘密version/settings/activeDeployment与昨日快照逐项一致；原93/4bindings、旧APP_ORIGIN、dates/原2flags、assets config、5容器class链接、22namespace IDs、两旧domains未变。重新下载现网两模块hash与原冻结完全一致；service、namespace metadata、domains快照hash也一致。

昨日23/23 web和71/71 runtime当前索引资产hash证据保留，**本轮未重下这94项、未声称新做了全资产枚举或平台验收**。实际部署前仍须重读base，任何漂移先停止并重建候选，禁止覆盖同期发布。

## 已完善的候选与回退

执行 `node scripts/m1/prepare-riffoid-live-candidates.mjs` 消费 `.local/riffoid-live-freeze-20261009/` 新快照和固定公开ring（也可用唯一位置参数指定同型 `.local/riffoid-live-freeze-YYYYMMDD` 目录）。脚本只执行本地读取/公钥import/build/写文件，不含网络、部署或私钥输入。

Gateway stage和forward rollback申请件现在都包含实际 `ENTRY_SIGNING_PUBLIC_KEYS_JSON` plain_text，共 **95 bindings（原93继承 + replay + 公钥）**。同一公钥进入manifest，原APP_ORIGIN仍旧域，不配置transport/mode/recovery半组vars。继续保留原22现代exports，仅预备新EntryReplayGuard SQLite export；不使用legacy migrations。实际replay namespace ID仍null，所有申请件标 **NON_EXECUTABLE_REPLAY_NAMESPACE_AND_SECURITY_READBACK_PENDING**，不能把95条候选当成现网已应用。

输出在 `.local/riffoid-live-freeze-20261009/candidates/`。Gateway SHA256 **0e882e02295d9e8630593f93e1fada65dd7d3a04a3361b8a2f20c70d2dae8290**，forward rollback **319121c411ed2c45e5f952784adbc4823e0e36dabe3d0ee7298b4db8befbce5a**，Execution保留现网原字节 **b76b05f96d345a0ecf280cdb4414c1dd0c56bf71041dc3c72199db8e8c6c07c1**；代码hash没有因公钥配置而改变。构建、三模块syntax check、95绑定与两候选公开ring一致断言、JSON解析及git diff --check通过。没有重跑完整M1/M3历史测试，没有签名私钥、真实双账号验收或付费provider/model/tool/Turn/Run。

## 剩余具体门槛

1. **旧zone现状**：用户既有授权控制台确认当前DNS冲突/覆盖wildcard、全部routes、WAF规则及Skip顺序、request-header Transforms；然后按既有批准应用唯一transport精确WAF并回报非秘密规则ID/表达式/顺序。先前DNS/WAF读取code10000、routes错误code未知继续保留，代理不扩大权限。

2. **安全阶段与完整回退**：上述前置补齐并重新核对base后，才沿批准单域阶段发布实际公钥和一次创建replay；读取真实namespace ID、现代23exports、完整post-resource配置/版本/assets，冻结前向回退。**本轮明确不发布、不分配**，当前仍不是完整生产回退包。
3. **transport域/TLS及真实验收**：callback和授权域名保存均已由用户确认，但实际OAuth登录/主体/回调验收仍未执行。按批准顺序接线唯一原账号Custom Domain；实际验证入口Secret对应签名与本公钥匹配、来源/WAF/原生IP、伪造proof/同zonepeer/重放及replay故障失败关闭、原Google主体/限流/Catalog/CSRF/Cookie/Location、SSE和隔离Execution。不伪造Origin或放宽Host；不跑付费执行。
4. **协调切流**：验收满足后才切Gateway canonical、Execution唯一ancestor、entry signed；成功T之后才设置成对T+48h恢复vars。当前旧APP_ORIGIN/Execution不改，没有T或48h计时，原8h session、身份/历史/pins/ledger、12月31trial及上海10月20M1不变。

具体回退顺序沿[原冻结说明](riffoid-original-account-live-freeze-20261008.md)和[更新后的回退申请](../infra/riffoid-forward-rollback.request.jsonc)：停入口admission、前向恢复旧origin并整组移除topology vars、Execution恢复旧唯一ancestor，保留实际replay ID与全部23exports及资产资源，不raw rollback跨DO生命周期、不清数据或顺手删Secret。
