# Trusted Pi：仅修复探针输入可读性的下一批包 — 2026-10-17

本包属于同一 JHG-46 Goal，承接 [#242](https://github.com/jihegao/riffology-cloud/issues/242)。它准备下一次离线验证，尚未获本次实际传输或容器运行授权。[操作源码、输入与本地检查](../evidence/releases/project-view-trusted-pi-readable-probe-inputs-20261017/README.md) · [固定输入清单](../evidence/releases/project-view-trusted-pi-readable-probe-inputs-20261017/payload-summary.json)。

上一批请求 `a21af2c8-44ff-4f67-a07f-c364bcd6d295` 已完成一次断网构建，得到 local Engine/descriptor index `sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593`。其唯一 mock 因宿主探针为 uid1000/0600、mock 用户为10002，在打开 `/compat-input/probe/compatibility-probe.mjs` 时 EACCES；入口代码、12目标及SDK检查均未执行。原CID已独立确认NotFound、正确label空列表，原CLI均回收并确认原进程不存在。[实际结果和历史边界](project-view-trusted-pi-package-mode-result-20261017.md)。这尚不能评估镜像内package权限修复是否通过。

本批仅将两份字节未变的公开输入明确设为0444，并补齐传输成功ACK与安全读取、异常终态记录；不含新的产品源码或镜像构建。两行package COPY0444仍在未合并的 [PR #239](https://github.com/jihegao/riffology-cloud/pull/239)，范围不变。

| 固定项 | 身份 |
| --- | --- |
| 新请求 | `b0933502-20df-480a-9a91-d833f5c4358c` |
| 接收位置 | 已有 AMD128，`/tmp/riffoid-jhg46-image-20261017.AU613w/pi-probe-readable-v1` |
| 压缩包 | `jhg46-pi-probe-readable-v1-20261017.tar.gz`，6,195 B，SHA256 `5817ecf49cf2e3128a9695c9fb6d75182d8cd6958b815e553f571a13167e89dc` |
| 原始tar | 30,720 B，SHA256 `38d1866b85d372876de243ce7e3fa429dd014876937195d56c3c607cf5f10d47` |
| input-manifest.json | 6,884 B，SHA256 `f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4` |
| probe/compatibility-probe.mjs | 12,020 B，SHA256 `bded581766c4656b05b72c6fce39fcb43461a44cbe407c0d1e9ab4a23edf2097` |
| 八项操作件清单 | 1,495 B，SHA256 `ae0614dafe7067367703ad41a9e0ff19f25de3ab7c788b85f01c1ff5c6b4fffd` |
| 复用镜像 | `sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593`；本机Engine/index身份，不是Registry digest或config ID |

拟批准的顺序为：先核对新授权与固定摘要，单次发送两份输入和八项操作件；只将这两份公开文件fchmod0444并回读字节、摘要、属主和mode；其余操作件、授权、日志及脚本写入的记录为0600，目录0700；Docker生成的CID元数据允许0600/0644/0664，仍要求0700私有父目录、安全regular-file及exact-ID校验。启动前要求原传输ACK完整匹配请求、包、操作清单和授权，unknown不得启动。传输、启动与独立回读的SSH均禁止agent forwarding及新路由，bootstrap在安全fd读取后核摘要。

任何create前，新鲜核对a946的linux/amd64、856B local index descriptor、完整RootFS及原User/Entrypoint/Cmd/WorkingDir/Env，与hash固定的a21记录一致；保留root supervisor启动合同。先只读确认原a21 CID仍NotFound且原label为空。只读本机Engine身份不能替代OCI原始blob或Registry证明，不会导出镜像。

随后仅一次原严格mock：UID/GID10002、network-none、readonly root、cap-drop ALL、no-new-privileges、pids128、768MiB、CPU1、64MiB tmpfs、两份readonly文件挂载、PATH-only环境、原20秒内层/30秒外层探针时限。原12目标、15项命名检查、owner/mode/hash/active-alias断言全部保留；模型3次与research1次均为合成调用，project tool/ambient fetch/真实provider请求均为0。保留独占一次锁；未知沿原请求核对，不重放create/start。只允许按原CID/image/label清理一次；rm ACK未知只读核对，必须原ID NotFound及label全量列表为空。

独立终态回读使用另一个只读会话，绑定本请求的固定目录、原CID、label和原CLI PID/startTicks。只输出已知安全字段及文件摘要；不会回传Env、完整inspect、任意stderr或授权正文。其冻结源码为17,363 B／SHA256 `bf86993670c344e264e2b3dff915051fee2ef2f0db5a54404aafcff8bc482a91`；4/4最小本地fixture通过，回执857 B／SHA256 `bc173d685f27dddcaaf1c68afa18fcaa1310d16a3aba4017ae09cef38f7bf28c`。见同一证据目录的 [independent-readonly/](../evidence/releases/project-view-trusted-pi-readable-probe-inputs-20261017/independent-readonly/README.md)，不作为新增传输操作件。[独立回读器复核回执](../evidence/releases/project-view-trusted-pi-readable-probe-inputs-20261017/review/readonly-reader-review-bf86.json)确认无must-fix。

范围不含build、pull/push、save/export、OAuth/Registry/provider凭据读取或生成、代理或新SSH路由、PR合并、Cloudflare写入或门禁改变、项目创建以及真实模型/Turn/Run。保留旧57a/a21输入、失败、锁及历史；无费用预算上限、欠费通知和已知CI额度豁免沿用，不改订阅或自动付款。

八项操作件完成15/15必要本地fake检查；独立复核确认三项缺陷已修复，无must-fix。先前1d清单/12fake、两个fixture失败及首失败缺少原始时刻/stream的局限均保留。该结果仅证明本地准备，无真实SSH/Docker/auth/API执行，不能当作兼容性、线上用户验收或费用为零的证据。[本地检查回执](../evidence/releases/project-view-trusted-pi-readable-probe-inputs-20261017/offline-checks.json) · [独审回执](../evidence/releases/project-view-trusted-pi-readable-probe-inputs-20261017/review/result-review-final-ae0614.json)。

需要新的精确授权，因为上一批明确限定的一次mock已经消耗。本批通过且原CID清理独立确认后，才准备后续Registry发布、原应用更新及普通受邀用户skill→页面/保存/刷新/冷恢复的各自批次。#238完整mock条件、#214/JHG-46和完整JHG-56均未完成。
