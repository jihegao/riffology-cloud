# #214 TrustedPi 离线构建实际结果 — 2026-10-17

本批已完成一次镜像构建，但**首次 image mock 未通过**，不能进入镜像发布。原容器已按原 ID 清理，并经独立 Docker GET 确认 NotFound、同一操作 label 列表为空。默认关闭的 Gateway 发布保持原状，普通受邀用户验收仍待完成；#214 / JHG-46 不 Done。

完整逐阶段事实、时间、输入身份、操作件及安全回执见 [实际结果 JSON](../evidence/releases/project-view-trusted-pi-offline-execution-20261017/result.json)。原[冻结包](project-view-trusted-pi-offline-build-packet-20261017.md)的9份 payload、30,515B / `c92e672c…` 归档与 `05100f4a…` pull 操作清单均未改。此次沿用用户明确的离线授权；不包含 Registry push、Cloudflare app/policy 更新或真实模型 / Turn / Run。

## 原身份及实际过程

所有阶段关联原操作 `57a70587-2b21-4a56-aed1-09c8a32d868a`，原目录、失败记录、锁和历史均保留。

- 11:45 UTC 的首次解包因检查器漏识别固定 tar 顶层 prefix，已知失败后在同目录复用原 archive 有界恢复；9份文件核验通过，没有第二次包传输。
- 11:49:54 UTC 的一次15分钟 / pull-only 凭据 POST 未取得可判定回执。没有可用凭据返回或发送至 AMD，没有执行 pull。原 receiver、auth 目录、7897监听和本机 SSH 进程均已清理，并独立回读。原 POST 仍 unknown；后续 Registry GET 的403／10000、身份 GET200及空审计结果均不能替代它，也不能证明未 mint 或费用为0。未再次请求凭据、续建转发或增加 OAuth scope。
- 12:00:50–12:00:51 UTC 的只读 image inspect 确认 AMD 已有精确 `9b76…` base：完整 RepoDigest / Descriptor / Engine Id 一致、linux/amd64，40个 RootFS diffIDs。因此直接沿原授权从缓存继续独立 build/mock，无需重做 pull。
- 首个构建前检查错误使用不支持的 `buildx inspect --format`，exit125；独立投影确认没有 build/create 意图、CID、iid 或 metadata。修复只读检查后，新续行脚本硬绑定原14份文件摘要、两个目录及原57a，保留原结果，以唯一 phase 继续首次构建；未删除锁或更换请求身份。修复版14项本地 fake 检查及独立静态审阅通过，不代替实际验收。

## 构建与首次 mock

一次 `--network=none --pull=false --platform=linux/amd64` 构建成功，实际本机 Engine image Id 为：

```text
sha256:b2c2f93eff23011fe7863545e2b62b3b3d0d6fd4da161371afae399c0ce59c27
```

已审执行器通过 metadata / actual Descriptor / iid 身份绑定和原 base RootFS 前缀核对，确认 base/derived 的 User、Entrypoint、Cmd、WorkingDir、Env 保留。这是本机 image 身份，不是已推送的 Registry digest，也不宣称独立 raw OCI / 签名验身。原身份合同为 root Sandbox / supervisor，再将 Pi 子进程降到10002；mock 显式10002只检查 SDK 层。

首个 mock 仅 create/start 各一次，原 CID 为 `b088b79e10cea6ea12bd39995e5410e89e48994cf86fb6814879b2a829011da1`。实际 Node22.23.2 在冻结 probe 的 line17:439 触发 `ERR_ASSERTION / image-source-must-be-root-owned-and-not-writable`，stdout0B、stderr362B，发生在 SDK imports 之前。尚未确定12个目标中的具体文件，不将源码/Git 一致或构建成功提升为镜像兼容通过，不放宽断言。

执行器清理和独立只读检查均确认原 CID 不存在、同 label 空。首次 mock 已消费，未重跑；当前下一安全动作是只读检查固定镜像层的目标文件属主/权限，定位后准备最小修复与明确的后续验证范围。原始正文/整 JSON 回传曾在执行前被自动审批拒绝，已以获准的字段白名单和固定错误分类完成替代，未留下审批阻塞。

所有本机时间与 AMD 时间分别保存，观察到跨主机时钟差，不能仅凭 UTC 文本比较推断原 receiver 和凭据 POST 的因果顺序。没有新容器/真实 SDK 通过、Cloudflare 运行、普通身份项目保存、Browser Preview、容量释放或账单结算的验收声明。
