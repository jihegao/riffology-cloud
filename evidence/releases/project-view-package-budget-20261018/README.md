# 项目页面包交付预算修复 — 2026-10-18

这是同一 JHG-46 Goal 内 [#245](https://github.com/jihegao/riffology-cloud/issues/245) 的本地实现和评审证据，父验收为 [#214](https://github.com/jihegao/riffology-cloud/issues/214)。基线为 main `638a366d31a37f7bc1d7dcd124e0b5ba753d6401`；本修复尚未合并、部署或做普通受邀用户验收。

相对 import 改写为绝对项目 URL 后，资产会增大。原共享构包器只核对源资产总大小，真实客户端却检查交付后总大小。实际修前[复现](before-builder-client.stdout.log)中，230,620 B 源资产变为2,240,220 B，低于3MiB的 JSON body 仍被服务端/Managed候选接受，但真实客户端 verifier 返回 `project-view-asset-digest`。对应 candidate253,312 B、cold253,362 B，均在已有入口边界内；每个模块源文件7,200 B、改写70,000 B，路径/文件数/单文件大小均合法。

生产只改 [package.ts](../../../services/project-views/package.ts)：共享归档验证同时保留源预算并核改写后总2MiB；构包时对最终同一 JSON body 的 UTF-8 字节核3MiB，再用该字节计算原 packageIdentity。没有改客户端、有效包格式、来源/Revision身份或依赖。恰为2MiB的合法交付包仍通过真实客户端 verifier，原 packageIdentity `9665b73e0bf80e0246c94b75f3f1cfd841d568d5057061c146d856e94d204a0a` 保持。

验证按实际轮次记录：

- [修前3项回归](before-regression.receipt.json)真实 exit1，3fail；[原失败输出](before-regression.stdout.log)保留。
- [9文件相关检查](focused-first.receipt.json)首轮67/67、0skip/0fail，包括包、Managed、手工保存、Workerd和broker。此轮新测试字节为 `f88b3f5b…`。
- 随后仅将新手工保存测试的R2观测从keys加强为key/size/etag；[最终4项复核](focused-final-budget.receipt.json)4/4通过，绑定最终test `6822ea58…`，生产和helper字节未变。不合称一次最终67项运行。
- [typecheck](typecheck.receipt.json)及diff检查通过。[源码与测试](../../../tests/m3/project-view-package-budget.test.mjs)和[fixture](../../../tests/m3/project-view-package-budget-fixture.mjs)可复查。
- [独立源码评审](independent-source-review.json)核对3份最终源码、各轮回执与日志，无must-fix；审阅者未重跑测试或访问真实服务。[完整安全汇总](implementation-check-receipt.json)和[inventory](inventory.json)保留字节、SHA、命令和UTC时间；[环境观察](environment.json)为本机Node26.10.0，不称hosted CI同版本成功。typecheck原始stdout含尾部空行，公开为[base64容器](typecheck-stdout.json)；解码后仍是原29B/SHA，原收据和输出不改，收据中的 `stdoutFile: typecheck.stdout.log` 由该容器无损解码提供。

保存证据的边界：实际Gateway/Workspace/D1/R2测试使用已有双loopback fixture的localLimits；同一7,200 B patch另通过真实生产smallText body validator（8KiB/file、24KiB/request），这不是生产policy端到端或在线用户保存。拒绝后canonical Revision/package与R2对象key/size/etag不推进、原fence释放；journal/fence审计写入仍允许，不宣称全部持久写为零。旧较大baseline只在本地合成fixture中保存，不声称可由一次生产smallText请求提交。

3MiB body栅栏是当前有界合法metadata上的防御性保证，未用非法超长scope伪造其回归。此次没有full npm run check、CI重跑、真实浏览器渲染/身份验收、云端provider/容器、SSH/Docker/OAuth、订阅或付款动作。Registry恢复仍以[原14d冻结包](https://github.com/jihegao/riffology-cloud/blob/14d2a2a5e03166ddba5167523127aeae0edd8832/docs/project-view-trusted-pi-registry-recovery-packet-20261018.md)及其尚待答复的新授权为准；本修复不修改该输入或 #239。JHG-46及完整JHG-56仍未完成。
