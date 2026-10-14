# riffoid 精确生产变更与用户操作包

本轮只准备文档，未改线上。普通部署已有授权，不重复请求笼统部署许可。下面新增持久凭据/资源及 flag、WAF、OAuth、origin/CSP 差异须行动时一次确认；资料收齐不是修改批准。代码基线为独立草稿 PR173，品牌 PR170 不混入。此前Google/旧zone公开资料已收齐，最新自定义请求头规则“无”为用户2026-10-08 11:45:38 UTC报告（Sentinel_2a89fa6fdc84819185c0160147d76fd3），不是独立API/截图证明。

## 一次确认的范围

| 目标 | 精确变更 | 保留项 |
| --- | --- | --- |
| 新账号 `3232ebc7e9bb0199b92e3d70b07825af` / riffoid.com zone `b0b0079990e13eb20a17a2d3c41403b8` | 单一 Worker **`riffoid-entry`**，Custom Domain **`app.riffoid.com`**；date **2026-09-06**，flags `[global_fetch_strictly_public,enable_request_signal]`；workers.dev/preview aliases关闭 | 不新增应用D1/R2/DO/container/service-binding；不复制原auth/provider秘密 |
| 新入口 vars/Secret | `APP_ORIGIN=https://app.riffoid.com`，`APP_TRANSPORT_ORIGIN=https://riffoid-transport.gaojihe.cn`；公开key ID拟 **`riffoid-entry-20261008-a`**；入口唯一 Secret **`ENTRY_SIGNING_PRIVATE_JWK`**由用户安全生成/录入；来源/IP边界真实成立后才设 `ENTRY_NATIVE_IP_BOUNDARY=cloudflare-direct-visitor-waf-v1`；候选先 `TWO_ACCOUNT_AUTH_MODE=disabled` | 实际私钥不由代理生成/查看/传输；实际公钥值现在不存在，不捏造 |
| 原账号 `8b0d70250211aa10d89e20605a1c7e5e` / Gateway **`riffology-m1-gateway-staging`** | 保持live date **2026-09-09**；原 `[nodejs_compat,nodejs_compat_do_not_populate_process_env]` 仅追加 **`enable_request_signal`**；添加公开 **`ENTRY_SIGNING_PUBLIC_KEYS_JSON`**，只接受上述用户生成key对应四字段 `{kty,crv,x,y}` ring，无 `d` | 原93条完整配置/绑定逐项保留；新增vars和DO另计，不把“93+1”当准确最终总数。Google/BETTER_AUTH Secret不读、不替换 |
| 同原Gateway / 独立安全DO | 新 **`ENTRY_REPLAY` → `EntryReplayGuard`**，SQLite；拟追加migration **`entry-replay-v1` / new_sqlite_classes:[EntryReplayGuard]**，动作前核对完整已有history及tag不冲突；实际namespace ID由该获准创建动作分配并回读，当前未知 | 全部原DO class/namespace/actor/history不迁移、不重建。固定64 security actors和原有资源门禁不改 |
| 原 gaojihe.cn zone `c97b548800561fada1a912c234696db1` | 现Gateway增唯一 transport Custom Domain **`riffoid-transport.gaojihe.cn`**，新增下列精确WAF规则；不执行备用hostname | 原两个Gateway domains及四条既有routes保留；无跨账号CNAME，不假定跨账号service binding；两zone SSL Full/PseudoIPv4Off保持，不启用付费功能 |
| Google用户提供的既有client | **仅新增** `https://app.riffoid.com/api/auth/callback/google` | 原三redirect、两JS origins、Branding `gaojihe.cn`、三项空白主页/隐私/条款全部保持；不换client/secret/scopes，不填造法律链接 |
| 原 Gateway切流配置 | `APP_ORIGIN` 原 `https://m1.riff-demo.gaojihe.cn` → **`https://app.riffoid.com`**；新增 `APP_TRANSPORT_ORIGIN=https://riffoid-transport.gaojihe.cn`；两侧完整准备且获准启用时 `TWO_ACCOUNT_AUTH_MODE=signed-entry-v1` | BetterAuth canonical/trustedOrigins仍仅APP_ORIGIN；真实浏览器Origin不改写、Host精确校验、Cookie host-only、Location manual；WS继续拒绝 |
| 原 **`riffology-browser-execution`** | `APP_ORIGIN`原旧App → **`https://app.riffoid.com`**，响应CSP唯一 `frame-ancestors` 同步变为新App；Gateway CSP引用原固定Execution origin | date **2026-09-05**及原两nodejs flags不变；`EXECUTION_ORIGIN=https://riffology-browser-execution.jihe-gao.workers.dev`、4完整bindings/assets/hash及隔离/ALLOW_LOCALHOST_HTTP=false保持；无新migration/双ancestor/额外Secret |
| 旧域48h只读恢复 | 真正成功切流后记录 `T`；成对设置 `LEGACY_RECOVERY_ORIGIN=https://m1.riff-demo.gaojihe.cn`、`LEGACY_RECOVERY_UNTIL=T+48h` | 当前T/until为空，不编造时间；原8h session不延长；到期server API410，旧静态指南/本机原字节Runs导出继续保留 |

两条WAF均为对应zone的 custom rule，phase `http_request_firewall_custom`，action **Block**，放在能绕过门禁的Skip之前；旧zone“当前无规则”是用户报告。表达式支持、规则生效及实际平台来源字段仍待真实验收，WAF zone来源不是指定script身份，签名/nonce仍必须验证。

新 riffoid.com zone（`app.riffoid.com`仅直接访客）：

```text
http.host eq "app.riffoid.com" and cf.worker.upstream_zone ne ""
```

原 gaojihe.cn zone（唯一transport来源为riffoid.com，仍需入口签名）：

```text
http.host eq "riffoid-transport.gaojihe.cn" and cf.worker.upstream_zone ne "riffoid.com"
```

## 最少用户操作：已登录控制台，不创建token/扩权限

1. **只确认一个公开值**：当前旧Gateway实际使用的 `client_id` 是否为 `316292203808-3s6ijnugpiq6hk25vmkj0hgokt2diq86.apps.googleusercontent.com`。之前11:30:24UTC只读metadata显示绑定是secret_text，未读值。源码现有sign-in POST会创建OAuth state/PKCE/数据库状态，没有可用的不创建状态的只读授权跳转；本轮不发起登录。若你手边已有授权页URL，只核对其 `client_id`，不发送整条URL/state/code/cookie；否则从你本人既有部署记录确认此公开标识即可，不索要Secret或重复Google清单。
2. **本人安全接管私钥**：确认本包后，在你控制、非代理共享、非云同步的可信本机生成一对ECDSA P-256 key。下面仅为你本人执行的离线生成步骤，代理不运行；要求本机已有Node，不安装依赖。不要在本任务共享Mac-mini或Codex终端执行；创建独占0700目录与0600文件、拒绝覆写，只打印key ID及公开ring，绝不打印私钥。把私钥存入你既有安全保管方式，再由你直接录入新Worker的Secret字段；不发聊天/PR/日志、不放Codex工作区、不让代理接管传输。后续仅可把公开key ID与public ring（无d）交给代理核对/配置原Gateway。

   ```sh
   node --input-type=module <<'NODE'
   import {webcrypto} from 'node:crypto';
   import {mkdir,writeFile} from 'node:fs/promises';
   import {homedir} from 'node:os';
   import {join} from 'node:path';
   const keyId='riffoid-entry-20261008-a';
   const directory=join(homedir(),'.riffoid-entry-20261008-a');
   await mkdir(directory,{mode:0o700}); // existing directory => stop, no overwrite
   const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
   const privateExport=await webcrypto.subtle.exportKey('jwk',pair.privateKey);
   const publicExport=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
   const privateJwk=Object.fromEntries(['kty','crv','x','y','d'].map(k=>[k,privateExport[k]]));
   const publicJwk=Object.fromEntries(['kty','crv','x','y'].map(k=>[k,publicExport[k]]));
   const ring={[keyId]:publicJwk};
   await writeFile(join(directory,'private.jwk.json'),JSON.stringify(privateJwk),{mode:0o600,flag:'wx'});
   await writeFile(join(directory,'public-ring.json'),JSON.stringify(ring),{mode:0o600,flag:'wx'});
   console.log(JSON.stringify({keyId,publicKeys:ring},null,2)); // public only
   NODE
   ```

3. **新账号发布通道由本人操作**：打开已登录[新账号Workers & Pages](https://dash.cloudflare.com/3232ebc7e9bb0199b92e3d70b07825af/workers-and-pages)，确认账号ID后创建/选择 **riffoid-entry**，部署代理在获准后从本PR提供、经hash核对的完整入口bundle（不能贴多文件TS或精简配置当完整包）。先保持disabled，不测试登录。Settings配置上述date/flags与公开vars；Settings → Variables and Secrets新增Type **Secret** 的 `ENTRY_SIGNING_PRIVATE_JWK`，仅你本人把私有JWK录入该字段，保存/部署均属本次精确凭据批准范围。然后按获准顺序在Domains & Routes加 **app.riffoid.com**，关闭workers.dev/preview aliases，在riffoid.com zone按上述表达式加Block。不要新login/grant/token或导入应用数据。流程以[Cloudflare Secret控制台说明](https://developers.cloudflare.com/workers/configuration/secrets/)为准；无既有控制台能力时停止在缺项，不扩权限。
4. **Google/旧zone控制台动作**：确认client关联及本包后，在既有[Google客户端](https://console.cloud.google.com/auth/clients?pli=1&project=gen-lang-client-0139341395)只向该client追加新callback，原三条不删。原zone新增上面的transport Block规则；当前DNS导出只证明当时两候选无同名/覆盖wildcard，动作前核对当前冲突，Custom Domain/TLS由原Gateway获准完整发布步骤接线。不加JS origin/Branding域；若实际出现必须项，停在具体差异再确认。
5. **只回报非秘密结果**：Worker/name/domain、两规则ID与表达式、公开key ID/public ring、Google公开client ID已匹配/新callback已添加、候选仍disabled。私钥值/Secret截图/全部导出或OAuth整URL不回报。代理沿已有旧账号发布通道完成获准的完整Gateway/Execution/public pin/replay migration包，无需为新账号另给token；若旧通道实际写权限不足则停止，不自动授予。新replay实际namespace ID、migration history、完整bindings/config、code/assets hash与version必须回读，再冻结前向回退包。

## 发布顺序、实际待完成产物与回退

先固定当前原93配置/绑定、Execution4绑定和所有code/assets/version/迁移历史快照；发布新的Gateway代码/公钥/replay资源时先保留原单域APP_ORIGIN并不加入半组topology，原app服务继续。新入口候选disabled、来源/域名/Google差异按批准完成后，才协调原Gateway新canonical/transport、Execution单ancestor与入口signed mode切流。恢复两vars在真正成功切流T确定后成对更新；没有T时两项均不设置，不编造期限。实际新入口bundle/完整Gateway+Execution包、公钥值、replay namespace ID及完整migration、冻结生产前向回退artifact/hash尚未产生/冻结，这是明确产物待完成项，不是要用户再次提供旧公开资料。本轮不执行这些动作，不宣称已具备完整生产artifact。

新class迁移后不跨生命周期raw rollback旧Gateway version。使用既有 `services/gateway/forward-rollback.ts`：date09-09及三flags保持，全部原DO exports/资源与新EntryReplayGuard/ENTRY_REPLAY **同一namespace ID及migration history**保留；恢复APP_ORIGIN旧域，**整组删除**APP_TRANSPORT_ORIGIN/TWO_ACCOUNT_AUTH_MODE/LEGACY_RECOVERY_ORIGIN/LEGACY_RECOVERY_UNTIL；入口disabled，Execution恢复旧唯一ancestor/origin，旧Google三callbacks保留。不得deleteAll/重建namespace/恢复旧DB快照/清账；Secret撤回/删除不是普通回退顺手动作。已做local build/test的包仍标LOCAL_BUILD_NOT_PRODUCTION_FROZEN，实际生产namespace/history/config/assets/hash回读后才能冻结。参见[DO迁移说明](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)与[已有回退申请](../infra/riffoid-forward-rollback.request.jsonc)。

## 真实平台验收单列，尚未执行

须覆盖两条WAF实际字段/规则及新zone原生IP/Transform、真实公开HTTPS双账号hop/header稳定性、直接transport/同zonepeer/外部Worker/伪造IP-proof失败关闭、两访客IP原auth限流与原Google主体/Catalog撤权/CSRF/Cookie/Location、replay故障/重放和SSE cursor/取消、Execution独立站点/唯一ancestor、原G5只读proof及恢复截止/本机导出。只限获准范围，不运行模型/工具/Turn/Run或付费验收。CI未运行、本地fixture及用户/附件资料都不替代这些验证。

取消承诺仅为平台abort到达时停止尚未进入业务的验证和流观察；无回执结果未知按原key核，已提交操作走原业务cancel，不承诺TCP FIN撤销，FIN不是禁止所有部署的独立阻断。原身份/历史/全部namespace/actor/资产/pins/ledger/meter-only、12月31trial/10月20M1不变；48h恢复不是延长原8h session或删除旧域授权。

一次确认时可直接引用本包版本，并确认上述公开client ID关联和“由本人生成/保管/仅向指定新Worker注入私钥、仅回传公开ring”。这项确认覆盖这里列出的精确安全/资源差异及有条件激活，不覆盖新增权限、付费运行、额外域/规则/client/Secret或自动修改新的JS origin/Branding/法律链接。
