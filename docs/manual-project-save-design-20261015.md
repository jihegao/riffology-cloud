# 普通用户手工保存与产物语义（设计候选）

状态：本地实现候选，尚未完成真实受邀端到端验收。关联 #221、#214、#85、JHG-46。用户已选择新增手工保存能力，页面 broker 保持只读。本设计不扩大部署或执行授权；productionEligible: false。

## 用户行为与接口

普通项目成员在主工作台选择文件、编辑或导入，查看新增/修改/删除摘要，再保存。项目页面中的任意 JavaScript 不能触发保存、取得写权限或访问凭据。保存不启动 Turn、模型、构建、容器或工具执行。

候选新增 `POST /api/workspaces/:id/manual-saves`，要求原登录会话、Origin/CSRF 校验、普通项目写权限及 `Idempotency-Key`。请求包含：

```json
{
  "schema": "project.manual-save/v1",
  "base": {"revisionId": "current-revision", "filesSha256": "sha256", "workspaceGeneration": 1},
  "changes": [{"path": "app/dashboard.html", "encoding": "utf8", "content": "..."}],
  "deletes": [],
  "artifacts": [{"path": "docs/data.json", "title": "Uploaded data"}]
}
```

`base` 由当前工作台文件响应提供；初始项目使用 `revisionId: null` 加经过验证的 initial archive 摘要，不接受无 base 的覆盖。scope、actor、时间与新 revision ID 全部由服务端生成。`artifacts` 为新 Revision 的完整手工产物声明集，指向结果文件集合；不能引用 URL、对象存储 key、工具回执或其他项目。

首次候选建议限制单文件256KiB、单次变更原始内容2MiB、最多64个变更、16个手工产物；JSON请求上限4MiB，base64严格解码。总归档仍遵守原存储上限。这些是可验证的本地初始限制，不是生产容量承诺。路径复用归档规范：拒绝绝对路径、越界、重复规范化路径、符号链接、系统状态/凭据路径。页面声明沿原 `project.views/v1` 校验；无声明的普通项目文件也可保存，不要求仿真模型。

成功返回 `operationId, status, revisionId, filesSha256, source: manual-save`。同 key 同输入回读原结果；同 key 异输入409；base冲突返回绑定原请求的 rejected，不自动合并覆盖。只读 `GET /api/workspaces/:id/manual-saves/:operationId` 查询原操作，未知状态不自动新建操作重试。无内容或产物声明变化返回 unchanged，不制造空 Revision。

## 一个 canonical head，两种真实来源

原 `RevisionStore.prepareCommit/commitPrepared` 接收 TurnRuntimeIdentity。候选增加独立 manual provenance 和显式 `PreviewSource` 分支；不使用随机 sessionId/turnId 冒充执行。

新增显式 `manual-save` 来源及来源验证，复用现有不可变文件归档、内容摘要和 RevisionStore 写入/核对机制。Workspace 内的 canonical head 必须成为所有 Turn 与手工保存共同读取、共同 CAS 更新的唯一权威；不得增加手工保存专用 head。现有 Turn head 通过明确兼容解析升级，不改写历史工具/模型回执。

提交顺序：授权并冻结 base/输入摘要 → Workspace 持久化操作意图并占用该项目写锁 → RevisionStore 写入并核验不可变内容 → 再检查授权/版本与 base → 原子发布 head 和操作终态 → 通知页面旧 generation 失效。未发布字节不可读；发布后 ACK 丢失按原 operation 查询，不重复提交。撤权和发布的线性化必须由原 Catalog authVersion/项目授权 fencing 与 Workspace 串行提交协议定义，不能把一次远端授权检查宣称为跨存储原子事务。

活动 Turn、手工保存或未决恢复占用同一项目写锁，返回409/明确忙状态；不排队无限等、不取消别人运行。失败保留原操作身份；未确认提交/释放时不得开启第二个写操作。重启先核对原操作，禁止凭超时判断失败。GC/purge 必须识别手工 Revision 和 pending 引用。

首次空项目基于 verified initial archive 生成第一份手工 Revision。之后启动的 Turn 冻结最新手工 head 作为 base，保留真实 session 历史，不将手工保存插入模型对话。页面、文件索引、恢复、导出以及读取 source 的调用点必须支持新来源；尚不支持的执行功能明确拒绝，不误落入 initial-workspace 分支。此次不开发 Preview/Observer/WebGL 功能。

## 手工产物与工具产物

手工上传首先是 Revision 文件。用户可将文件标记为产物；声明与正文进入同一不可变 Revision、同一摘要和提交事务。标记不执行内容，也不验证计算正确性。

只读 artifacts 响应升级为带来源的联合类型：

- `source: user-upload`：`revisionId, path, sha256, bytes, mediaType, title`，ID 使用独立 `manual-artifact-` 命名；读取绑定当前 package/revision；无 Turn/tool/执行时间或可信计算指标。
- `source: tool-output`：继续要求原 ToolArtifactReceipt 和已提交 `tool.completed` 事件，保持原 ID 与授权检查，不能由上传请求创建。

列表游标绑定当前 package identity、手工声明摘要和原工具 journal version，切版后旧游标拒绝；两类来源分别验证，不能通过新增类型绕过原工具回执约束。手工产物从该 Revision 归档按范围读取，不另建 blob 权威。取消标记只影响新 Revision，历史保留遵循原生命周期。

UI 显示“用户上传 / 未验证”或“工具输出”；任何来源都不自动成为 Verified Evidence。broker 继续仅 list/read/subscribe/navigate，扩大的是可读来源类型，不增加写消息。

## 实现拆分与验收

1. Revision来源和单一head：显式manual provenance、CAS/幂等、原操作恢复、Turn读取新base、GC引用。
2. 普通用户保存API与主工作台编辑/导入：真实会话授权、初始项目、差异确认、冲突及撤权。
3. 手工产物声明与只读列表/读取：联合类型、独立ID、同Revision摘要、旧工具回执检查保持。
4. AMD128与真实受邀身份：手工保存两页及JSON产物 → canonical包和MessagePort读取 → 修改保存/刷新/冷恢复 → 切页 → 跨项目拒绝 → 撤权旧broker拒绝及原容器清理 → 九种外发失败与前后正对照。

故障检查覆盖：同key同/异输入、陈旧base、并发Turn、写对象/发布head前后中断、撤权竞争、迟到回执、重启恢复、跨项目操作查询、路径穿越/超限、伪工具产物、旧游标、手工head后Turn基线。fixture只证明协议行为；真实OAuth、普通用户保存和浏览器链路独立留证。

本地 OAuth 已在独立 Catalog 完成指定 Gmail operator 账号的真实 Google 登录（token/JWKS 200），等待邀请激活；普通受邀账号、项目初始化、保存及撤权链路仍待验收。凭据与会话不进入仓库。本设计不以添加fixture、管理员上传或复制生产Cookie代替普通用户流程。

## 本地候选的具体实现与剩余边界

保存 UI 和 Gateway 服务仍要求双 loopback，新增 migration 不代表部署。主工作台增加编辑/导入、变更确认与完整手工产物声明；页面只读协议未增加写方法。

Workspace 先持久化原操作，再取得 D1 授权 fence，之后才写不可变 Revision。migration 0013 的条件写与数据库 trigger 将有效 pending fence 与用户撤权串行化：先取得 fence 的保存须核对原操作终态并释放后，撤权才可成功；未知状态没有超时释放。撤权先成功时，保存不得写入或发布。reserve 后尚无 fence 的中断，通过原 identity 的 released/aborted tombstone 封住迟到 acquire，再清理原 reservation。此机制不是 D1 与 Durable Object 的跨库事务。

前置拒绝持久化原 key、请求摘要和原因，不持久化请求正文；base 冲突返回绑定原 key/摘要的 rejected 终态。丢失响应后 GET 可以确认拒绝。已有 immutable receipt 的 pending 操作可在 GET 核对后发布；只有用户明确用原 key、原正文 POST 才允许继续尚未写入的操作。刷新仅保留操作编号和请求摘要；用户可重新提供原请求 JSON，摘要不匹配时不发送保存请求。schema 升级保留旧 Turn/Session；只读恢复 RPC 不隐式改写历史 journal。

手工内容使用 `manual-revisions-v1` / `manual-blobs-v1` 独立前缀，现有 Turn GC 不扫描它们，因此保守保留。完整 GC/purge 尚未交付，后续 #212 必须覆盖这些前缀、journal 拒绝记录和 Catalog fence；当前保留机制不能计作删除验收。

以上是候选实现语义。测试、真实身份和环境证据分别记录；当前 `productionEligible` / `productionEnabled` / `deployed` 均为 false。
