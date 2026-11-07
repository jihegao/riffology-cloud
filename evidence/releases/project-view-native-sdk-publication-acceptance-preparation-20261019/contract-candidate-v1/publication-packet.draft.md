# JHG-46 下一批候选：固定 SDK 默认关闭发布与全新项目验收

本稿仅本地准备，未执行、未获本批新授权，也不是原a25f续跑。新批请求 `fb07e239-2cb4-4379-9581-5711d86a0f30`；Gateway发布请求 `1feadf24-3eb8-58be-abd7-872c68ab45e6`、有限门禁请求 `95b9b8c6-8d52-566d-8476-dfa3e02f6b79` 只是规划身份。真实grant、开始/结束时刻、所有可发送body、sender seal和实际ACK均为null；已加入本地build v2的固定bundle/assets/graph，最终sourcebinding与独审仍待。必须先完成具体构建/操作件绑定和独审，才能形成可批准发布包；不能用本稿发送任何请求。

当前[#257](https://github.com/jihegao/riffology-cloud/pull/257)已公开并处In review，本稿固定head `fca66cb0e1024b4e86bbbeb9a6d955b137599efa`。拟仅按既有保护、review及用户已批准的CI额度豁免正常合并此固定head，不强制绕过保护，也不把真实技术失败当额度问题。普通合并后需实际merge/parent/source-tree证明与冻结新构建相同；本稿不合并、不更新Issue为Done，不声称新SDK已部署。

固定源码中的时限是HTTP10s、broker30s、child SDK35s、script40s、startup45s，新frame源码身份为 `63ebcd050b0ccf5019265070890bee69d99902120f2252c376678aff299d374b`。这些是#257固定源码及本地证据，不是已部署或浏览器已验收；新Gateway build v2已本地成功，固定bundle5774988B/SHA `304373a50d7a9ca8a99cdfbda0dcae261aa34d53727b757dfeb099c88efb5e0b`；96assets中94项不变、2项web更新、68项immutable字节不变，总53784755B，1124 module graph=303Git+821deps/477source。最终sourcebinding和独审待补，未部署。#252自身host范围已由root原API回填Done、Issue保持OPEN；#255/PR257处In review且未部署，父#214仍Acceptance/blocked。旧a25f的T1/T2执行终态与原释放已可信，V1是UI阶段失败并已owned清理；未来新项目是新明确授权下的验收，不是为了绕过旧执行unknown。

范围有两段。第一段仅向既有 `riffology-m1-gateway-staging` 发布一次固定新Gateway及其精确asset manifest，页面准入保持关闭；bundle304373a5…和96项精确asset manifest已绑定本地build v2，最终sourcebinding/构建独审及sender seal仍待；不会把待填版本或ACK伪造成成功。保留原Worker/106bindings、11secret条目、25exports、6容器关联、50namespace、16app及配置/版本/镜像和历史；仅新固定源码/资产及其确切上传/版本元数据按实际ACK变化。保留ec8/v13，不再Registry/JWT/AMD/SSH/Docker/代理，也不再维护hold或image rollout。发送前所有未seal或null输入必须在凭据读取前拒绝，未知结果保留原锁和intent/ACK，仅按原身份只读对账，不自动重复PUT/回滚。正式finalize仍须可信原ACK。

当前旧批已知closed Worker `4f887d24-7874-4fb3-b3ac-caf6d74ab461`、source9c8与默认关闭只是dated baseline。未来必须fresh核source/sole version、全控制面与资源、原a25f两Turn终态/hold-clear/capacity及全部逻辑/物理scope，再把实际新merge/build/source/asset/metadata/sender输入逐字节封印。旧before/open/after getter中硬编码的9c8/5a840/v12等不可盲重放为新SDKwitness。旧raw stable64d4不等于2b886；c36只证明那个版本对的精确annotation/upload→secret桥，不是未来任意metadata归一化许可，不读secret明文。

第二段沿已批准普通受邀owner、OpenAI/gpt-5.6-luna原profile与全部硬限，在**一个全新blank项目、两Session、计划三个显式Turn**完成分阶段验收。不能复用旧项目、旧请求/锁、旧窗口或原未执行T3；旧项目保持一Session两saved Turn和首次V1失败历史。普通身份仍以fresh me bracket与既有单条只读SELECT核accepted invitation/authVersion2/personal owner/非operator，必要正常Safari切换只沿已批准两个账号；不新增账户/登录授权/scope/cookie导出。既有Personal连接器或预先选择的同用户exact六scope OAuth只正常取token/必要续期，无无条件login/consent、无权限失败后的身份fallback。既有持久OAuth不会因新窗口结束或本地临时配置清理而撤销。

本次采用[已独审内容候选](../content-candidate-v1/manifest.json)：18件hash固定、8个synthetic fake-SDK案例；新skill6056B/SHA `8ef3375d58464b2a74cc57031771f5f7bad21b15f09991fb3838620e9f3ae6d7` 精确嵌入T1。T1仍先一次普通project_bash mkdir（timeout30000）成功再写skill，正常保存R1并核原产品资源释放；T2同Session真实从R1 slash loader读新skill，保存固定manifest/两页/moduleCSS/V1[2,3,5]，生成一次17408B合成文本并用普通project_read得到**该新Turn实际**artifactId/receipt，保存R2。不得沿用旧17567/1f1934回执作新期望身份。

新helper只用原`listArtifacts(cursor)`/`readArtifact(id,offset)`：原游标分页、receipt绑定、连续offset/16384B chunk/累计范围，连接原Uint8Array先独立SHA核receipt，再JSON.parse并核**envelope.content**的原前缀。JSON body SHA不同于源文本SHA；8页/1114112B/最多68chunk是本地参考循环界限，不是新增产品权限。缺失、异常或不符立即停，无retry/fetch/备用SDK方法。合成测试只证明参考片段，不替代实际artifact GET、SDK超时修复验收或付费执行。

仅R2 canonical checkpoint/Session head和原runtime/tool/capacity产品authority释放可信、全physical scope符合已接受baseline后，才用新create/R2/me/identity的实际owner/scope/generation派生**一条有限browser policy**，同新窗口一次PUT。不是普通保存即开门，也不要求公开所有内部raw stop/lease字段；已有原source/cold chain与当前联合证据继续适用，saved/elapsed/available/Dash空任一单项均不够。V1通过实际包/资产/SDK/native DOM，两页V1 factor2→20、factor5→50、Pause/Resume、snapshot订阅、实际artifact完整chunk/body SHA、刷新/离开重入。首个阶段失败立即停止后续，不重试页面或追加repair Turn。

**只有V1验收完成**且原R2释放可信，才在唯一Session2发送T3，冷加载R2 skill，只把docs/series.json改为V2/[2,3,7]，保留原artifactId及其它字节，正常保存R3与释放；新浏览器上下文显示24/60并核冷恢复。原生DOM运行及已授权项目数据可外发的用户既有合同保持，不新增网络/模型/Run API。功能参数变化是浏览器local/unverified，不升级Verified Evidence。

成功或首阶段失败后均按**同一可信原open ACK/request/version/bodySHA**关闭原owned policy，只DELETE一次；未知owner/ACK不盲删。随后fresh GET核gate absent/defaultclosed、实际新source/assets和全部资源保全，原用户scope最终canonical/hold-clear/capacity、完整physical、原frame/port/listeners退出。UI退出是AX观察，不替代HTTP/物理证据。不得清除旧失败/unknown/费用历史、强行归零或把某个空Dash当全历史VM释放。

两项既有平台差异继续明示：容器版本列表保留当前13/12的滚动表示及更老原历史，本批不触rollout，未解释版本漂移不自动吸收；全目标当前最多那一个已知d03b/8ef5、v13/ec8、basic/max1空闲VM可running、container stopped，仍可能计费。此例外不扩大到新/unknown placement，也不授权为“清理”删除/重启VM。普通新Turn仍须其原身份资源/释放证据；不能靠新项目/窗口绕unknown。

新窗口只在本批明确授权后开始，最多4h，且不晚于2026-10-20T15:59:59.999Z（#104用户截止优先现行Dec31配置）；当前startsAt/endsAt/grant全null。费用沿无上限、原计量/预留/usage/history保留，只在有明确欠费证据时通知，不新增订阅/自动付款或把403/费用未知记为零。不恢复旧项目，不扩G5/M3/M4/Run门禁，不增加第四Turn。

具体[顺序/写入上限](operations.json)、[新窗口](window.pending.json)、[普通输入](ordinary-input.json)、[认证复用](authentication-contract.json)、[fresh证据合同](fresh-read-contract.json)、[待填发布输入](publication/inputs.pending.json)、[有限gate待填计划](browser-gate/plan.pending.json)和[原输入provenance](source-bindings.safe.json)均可审。构建/metadata/真实merge/授权/原ACK待填是本候选尚未ready的事实，不是已发生或授权成功。

#257当前CI仍IN_PROGRESS，本稿不声称通过。上述build v2仅本地esbuild，没有CLI/auth/cloud；旧未绑定构建版合同完整保存在本地e8970e2a历史，原P/content/实际执行证据未改。
