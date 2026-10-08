# riffoid 原账号现网冻结与最小剩余步骤（2026-10-08）

本轮完成原账号只读冻结、候选构建与配置申请修订，**没有生产写入或真实双账号验收**。用户12:33:01UTC已批准固定版本[精确生产包](https://github.com/jihegao/riffology-cloud/blob/a0ab4881d585831d0b0d7e220d69632c681a8c46/docs/riffoid-production-approval-packet.md)，12:39:44UTC已确认旧Google公开client关联；不重复请求笼统批准或公开清单。该已批准文件保留原样，本补充纠正行动时发现的DO生命周期差异，未扩大账号、资源数量、安全表达式或切流范围。

[机器可读证据](evidence/riffoid-original-account-live-freeze-20261008.json)记录hash、实际版本、读取失败、构建结果和缺项。原93绑定的非秘密值、Secret名称/类型、下载模块和资产保存在本机忽略目录 `.local/riffoid-live-freeze-20261008/`，不向PR披露完整内部策略/身份清单，不读取Secret值。只读快照不是现网变更锁：将来每次写入前须重读并逐项比较，漂移即停止、重建候选，不能覆盖近期发布。

## 已冻结内容与边界

原账号 **8b0d70250211aa10d89e20605a1c7e5e** 的官方Wrangler授权已恢复，隔离XDG目录内whoami成功，实际仅 `offline_access, account:read, workers_scripts:write`。没有扩scope或改变全局认证；没有user:read，因此只按返回账号ID/name核对，不宣称独立读取了用户邮箱。

| 对象 | 当前生产版本 / 发布 | 核验结果 |
| --- | --- | --- |
| Gateway `riffology-m1-gateway-staging` | `aeddf112-a2be-45da-868c-ed576c55d5ec` / `c6ff55e4-2364-4920-94e0-b8784a1824b5`（100%） | 原93绑定与先前快照一致；date09-09、原2flags；22 SQLite DO namespaces、5容器class链接均保留 |
| Execution `riffology-browser-execution` | `c94df077-02a1-460f-8158-e47a338e68af` / `a6fdeb9f-d885-4c72-9e02-968315351edb`（100%） | 原4绑定、date09-05、原2flags一致；现网单模块49,003字节原样保存 |
| 现网Gateway代码 | SHA256 `6c058d14c7ba114152ba62682768e61c835307e16e2fa75795c2b71fce5fb98b` | 与最近PR172发布记录一致，不覆盖该变更 |
| 现网Execution代码 | SHA256 `b76b05f96d345a0ecf280cdb4414c1dd0c56bf71041dc3c72199db8e8c6c07c1` | 后续origin候选使用这些字节，不采用本地重新编译版本 |
| 静态资产 | 23/23 web；71/71 runtime，53,306,908字节（68 app、3 frame） | 按固定当前发布清单逐项GET，全部hash一致；末项14MB包30s超时后仅一次120s定项补读成功 |
| Gateway domains | 旧两域仍在；transport未绑定 | account-level domain GET成功；旧域不删除 |

资产核验覆盖当前源代码索引和发布记录中的服务集合，**不是对平台资产namespace所有存量对象的枚举**。发布须保留现有资产namespace与完整现网assets config，使用经平台核验的 `keep_assets`；不能以本地多出的旧文件或该清单替换整库。容器仅核验当前Worker runtime的5个class链接，不宣称重新读取了所有容器应用镜像/设置。

main仍为 `25609953f5c3b69dcb44e520d7e7ed1253d18fe4`，原PR173 remote head `cb148e702007ecc638ef47b1eb78c03b5132f9ad`；草稿未合并、未混入品牌PR170。原APP_ORIGIN和Execution APP_ORIGIN都仍是旧域，原8h会话、内部身份/历史/namespace/pins/ledger、trial **2026-12-31T15:59:59.999Z**、上海10月20日M1均未改；没有切流T或48h恢复期限。

## DO创建必须使用现代exports

现网runtime明确返回22个 `exports`，每项 `type: durable-object, storage: sqlite`；service没有legacy migration tag。namespace metadata逐一匹配原22绑定的class和ID，没有EntryReplayGuard。这里的空legacy tag是现代配置状态，**不是缺失历史待补，也不能捏造tag**。

根据[Cloudflare DO class exports文档](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)，现代exports与legacy migrations互斥，采用exports后不能退回legacy。本次单一新SQLite security class范围保持不变，但旧模板 `entry-replay-v1 / new_sqlite_classes` 已被本补充取代，**不可应用到现网**。应保留原22项exports及其ID，仅添加：

```json
{"EntryReplayGuard":{"type":"durable-object","storage":"sqlite"}}
```

并增加 `ENTRY_REPLAY → EntryReplayGuard` 绑定，一次分配后回读实际namespace ID。不能用 `versions upload` 试探DO生命周期，不能raw rollback跨越此次class创建；回退必须前向发布，保留23项exports及原22+新1的确切namespace身份，不删、不清空、不重建。

## 可审阅的本地候选

运行 `node scripts/m1/prepare-riffoid-live-candidates.mjs` 只读取上述本机快照、执行esbuild和保存文件，没有网络/部署命令。输入断言绑定数量、指定版本、原origin、22namespace/class/SQLite ID与原flags，metadata继承原93绑定，保留Secret引用、assets和5容器链接。输出 `.local/riffoid-live-freeze-20261008/candidates/`：

| 候选 | 字节 | SHA256 |
| --- | ---: | --- |
| gateway.worker.mjs | 5,497,752 | `0e882e02295d9e8630593f93e1fada65dd7d3a04a3361b8a2f20c70d2dae8290` |
| forward-rollback.worker.mjs | 5,498,336 | `319121c411ed2c45e5f952784adbc4823e0e36dabe3d0ee7298b4db8befbce5a` |
| execution-preserved.worker.mjs | 49,003 | `b76b05f96d345a0ecf280cdb4414c1dd0c56bf71041dc3c72199db8e8c6c07c1` |

三个代码模块syntax check通过，构建和 `git diff --check` 成功。既有M1 **350/350**、M3 **1070通过/12跳过/0失败**、针对性 **10/10**为历史证据，本轮没有重跑或声称CI通过；没有调用模型/provider/tool/Turn/Run。

`gateway-stage.request.json`、`forward-rollback.request.json` 和 `execution-origin-only.request.json` 明确为 **NON_EXECUTABLE**：公钥pending字段在metadata之外，publicPin和实际replay ID均为null。阶段Gateway保留原APP_ORIGIN，不加入transport/mode/recovery半组vars；Execution候选不执行。原93条 + replay + 公钥将是阶段95条，后续topology另计。代码28个exports含WorkerEntrypoints/default，不能误算成28个DO；runtime DO是原22加新1。

## 本次缺少的最小读取权限（仅列明，不授予）

以下能力必须限定原 **gaojihe.cn / c97b548800561fada1a912c234696db1**；当前OAuth没有这些zone读取能力。用户可用既有控制台完成，不需要新增token或scope。

| 读取 | 本轮结果 | API最低读取能力 |
| --- | --- | --- |
| DNS records | code10000；未重试 | [DNS Read](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/) |
| Workers routes | 读取失败，SDK code为空；未断言HTTP403 | [Workers Routes Read](https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/) |
| custom WAF entrypoint | code10000；未重试 | [Zone WAF Read](https://developers.cloudflare.com/waf/custom-rules/custom-rulesets/)；后续获准新增精确规则需Zone WAF Write，是独立写能力 |

请求头Transform现状也仍需既有控制台回读；相关规则API读取能力是Transform Rules Read，本轮没有另发探测请求。Custom Domain与普通zone routes不同：前者可使用已具备的Workers Scripts Write，不能从routes读取失败推导Custom Domain一定缺DNS/Routes Write。没有扩权限、重新授权或绕过任一拒绝。

## 真正剩余的用户操作与平台前置

1. **用户本人接管私钥**：在独立可信、非代理共享、非云同步、已安装Node的设备上执行已批准包第2步离线生成器。代理不执行、不读取、不传输、不代注入。拟key ID `riffoid-entry-20261008-a`；保管严格五字段私有JWK `{kty,crv,x,y,d}`，由本人直接录入新账号 **3232ebc7e9bb0199b92e3d70b07825af → riffoid-entry → Settings → Variables and Secrets → Secret: ENTRY_SIGNING_PRIVATE_JWK**。保持entry disabled。只回传key ID和严格四字段public ring `{kty,crv,x,y}`，不能含d或私钥截图。代理仅检查Secret名称/类型/存在，不检查值。
2. **旧zone现状与精确WAF**：本轮DNS读取及WAF entrypoint读取被拒绝 **10000**；routes读取失败（SDK未返回具体code）。每项一次后停止，未绕过或扩scope。需要通过用户既有旧账号控制台确认当前transport同名/覆盖wildcard冲突、全部routes和能Skip的规则/Transforms，再按已批准表达式加transport Block，回报规则ID/表达式/顺序。不能把先前“无规则”的用户报告当行动时API证明，不能覆盖未读取的规则集。原两域和其他routes保留。
3. **安全阶段与回退冻结**：有用户public ring后，先重新核对全部base，准备单域阶段公钥+独立SQLite replay创建；回读实际ID和完整现代exports/config/assets，再冻结完整前向回退包。Custom Domain接口[接受Workers Scripts Write](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/)，因此不把transport绑定误说成必然需要DNS Write；但当前DNS/WAF不可读，且公钥/完整回退缺项，**本轮不尝试绑定或发布**。直接DNS API权限另计，不新建token。
4. **既有Google client add-only**：client已由用户确认，不再索要。用户在既有client仅追加 `https://app.riffoid.com/api/auth/callback/google` 并回报非秘密清单；原三callbacks、两JS origins、Branding及Secret/scopes保持。没有独立Google API回读，不将“已批准”写成“已应用”。
5. **真实无付费验收后才协调切流**：实际TLS/公网HTTPS hop、两精确WAF来源字段及原生IP/Transform、直接transport/同zonepeer/外部Worker/伪造headers和replay故障失败关闭、两访客原auth限流、Google原主体/Catalog撤权/CSRF/Cookie/Location、SSE cursor/取消、Execution独立origin与唯一ancestor须验证。任何半准备或未知结果都保持entry disabled；不伪造Origin或放宽Host、不自动重试未知业务。验收后才按已批准包协调Gateway canonical、Execution唯一ancestor、entry signed。成功时才记录T和成对T+48h恢复vars。

新侧entry/domain/WAF/aliases/flags的完成情况是父线程连接器报告，本轮没有重复读取/修改；其Secret/public pin尚未完成。旧账号Wrangler的读权限不等于旧zone WAF权限；不通过扩大scope来消除拒绝。

## 验收失败与前向回退

先停止新入口admission，保持disabled；使用已冻结前向Gateway包恢复旧APP_ORIGIN，并整组删除 `APP_TRANSPORT_ORIGIN/TWO_ACCOUNT_AUTH_MODE/LEGACY_RECOVERY_ORIGIN/LEGACY_RECOVERY_UNTIL`；Execution保留下载的现网代码和原4绑定，只恢复旧APP_ORIGIN/唯一frame ancestor。保留原22及新replay的实际namespace IDs、23项现代exports、public pin/Secret引用和完整assets/container绑定，不清数据/账本、不跨生命周期raw rollback。Google保留原callbacks；Secret删除/轮换不是顺手回退动作。没有实际replay ID的当前模板不是完整生产回退包。

本次没有上线、transport绑定、旧DNS/WAF/OAuth/CSP修改、私钥处理、付费执行或48h计时；真实双账号验收仍待上述前置完成并沿既有批准范围协调。
