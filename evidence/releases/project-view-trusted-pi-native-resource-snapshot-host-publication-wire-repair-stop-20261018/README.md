# c263 wire-repair publication stopped — 2026-10-18

[实际结果](result.json) · [独审](sources/actual-stop-independent-review.json) · [本地原终态](sources/local-terminal.json) · [远端原终态](remote-records/terminal.json) · [独立停止观察](sources/stop-observation.json) · [完整语义绑定](sources/semantic-binding.json) · [清单](inventory.json) · [一页结果](../../../docs/project-view-trusted-pi-native-resource-snapshot-host-publication-wire-repair-stop-result-20261018.md)。

用户明确批准e521修复包后，仍按原c263/0bb源/目录/tag执行。单行grant与76df操作件已核对，**一次export/一次完整图验证/一次push**已经发生；前次12:20失败的本机once和本次repair-once都保留，没有补推或新目录规避。

- 一次原归档为407,961,600B/SHA `deddc21059715d3d63fc9c652e84e510be7117cda315102c3b1fd0f0bcf2f6d8`，53实际raw blobs、49 runnable layer slots的哈希/diffID全验证。0bb/index856导出链派生platform `ec8dbe9e…` /9,585B与config `cea60e39…` /19,067B；完整[原验证记录](remote-records/raw-verification.json)保留。不能把0bb index当成runnable manifest。
- 正常同六scope token检索/身份核对成功；唯一Registry credential POST在12:36:19.373717Z发起，HTTP201/success被接受、凭据stdin已发送；body/token未存公开。JWT为15分钟账户级push/pull，不声称repo级。
- 原push CLI于 **12:36:38.892650Z** exit0/reaped，stdout15,371B的SHA匹配，白名单仅提取唯一 `ec8d…` /9,585 digest行；原流不公开。它证明**命令报告成功**，不证明当前Registry完整状态。
- 远端publisher于 **12:45:16.036354Z** 结束为unknown-stopped / publication-local-error；本机SSH于 **12:48:39.599189Z** 以255结束，已reaped/无stopErrors，final ACK=false。两个不同层次和时间保持原样，不能用后来的诊断SSH exit0覆盖失败。

**`registry-readback.json`明确缺席**，没有完整52槽位（2manifest+config+49layer，含可能重复layer）的可验证原记录。不能由缺文件反推从未执行过任何GET，也不能确定哪些部分GET曾成功或具体错误原因；未查询当前Registry、不推断欠费/权限原因。完整发布条件未满足，PR253合并条件也未满足。

独立停止观察在12:52:22.784525Z按原身份读取18件安全JSON，共15,457B，核实六个原CLI及supervisor原PID/ticks均不存在、CLI已reaped，temporary-auth目录/config都不存在、7897监听0且连接errno111。归档只stat匹配407,961,600B，**没有独立重读整个归档/blob**。本机两原PID35240/35359在12:49:39.329298Z已另行确认不存在。观察传输12:52:27.841394Z exit0/reaped，无新Docker/Registry/远端写；它是失败收尾，不是成功reader。

最初停止observer只核部分绑定；本次结果验收另要求两项完整JSON等值：采回remote terminal等于本地原remoteFinal、采回raw verification等于本地原Ready.verification。两项均在原18件上本地通过，独审再次确认；没有改已执行observer或新增远端读取。[静态审阅](sources/observer-static-review.json)与[追加语义绑定](sources/semantic-binding.json)均保留。

公开目录原样保留18件remote-records与16份安全来源；3份授权/preflight/CLI-intent投影仅删问题标识或替换本机私有路径并保原bytes/SHA。没有grant/人类回复正文、OAuth/Registry凭据、raw config/Env、原push/SSH/token流、整归档或base64传输正文。`authorization.realExecutionNotYetStarted`及preflight零调用是原执行前快照，不能代表后来未执行。原driver stdout10,508B与pretty local终态13,814B语义相同、字节哈希不同。

临时文件/路由清理不等于服务端JWT已撤销/过期，持久OAuth权限也不撤销；费用usage未核不记0。本批没有merge253、应用/Gateway/gate发布、真实模型/Turn/Run/项目或原12:42:46Z真实验收窗口延长。695e成功mock、前次c263wire失败、原T1失败/释放及全部历史/归档/锁/预留保持原样。JHG-46仍未完成。后续readback-only提案、新授权及执行必须另列，当前没有发生。
