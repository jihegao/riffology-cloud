# Trusted Pi：原镜像导出通过，凭据 HTTP 403 后停止 — 2026-10-17

用户批准[fc807579 固定发布包](https://github.com/jihegao/riffology-cloud/blob/fc807579e44745119014048d152fafccd6c946f5/docs/project-view-trusted-pi-image-publication-packet-20261017.md)后，原请求 `c3e04c41-72da-409b-a2b1-f924e6cc67fa`完成一次原始导出和完整校验。唯一 Registry 凭据 POST 返回 **HTTP 403**，未发送可用凭据、未打新tag、未push或回读Registry镜像，也未合并 #239。按原请求停止，没有第二次POST、导出、push或自动回滚。[完整结果](../evidence/releases/project-view-trusted-pi-image-publication-execution-20261017/result.json) · [安全来源、源码与独审](../evidence/releases/project-view-trusted-pi-image-publication-execution-20261017/README.md)。

## 实际导出与认证边界

新鲜只读前置确认Docker client/server29.8.1、API1.56、platform push参数可用、目标目录尚不存在、磁盘空间充足。原a946 local Engine/index856B、linux/amd64、48层RootFS和root Sandbox launch身份匹配。原五项OAuth已在本机通过既有Wrangler正常续期；磁盘debug日志关闭，stdout只在内存处理，无新登录/扩权/OAuth外传。

唯一原始导出保存在AMD128原任务目录的`pi-image-publication-v1/original.oci.tar`，**407,955,456 B**，SHA256 `83b81e553a9c4e885299650c31cd179e126168c4da50b2dfd3ed1d8ffe5e0b51`。52个原始blob的SHA/大小/可达性与48层解压diffID均通过；source-before/after的RootFS与Config一致，独立读回再次核对归档当前字节/SHA及原始metadata链。

| 原始导出身份 | 固定实际值 |
| --- | --- |
| local Engine/index | `sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593`，856 B |
| linux/amd64 manifest | `sha256:f18a826d40b2fd60e2cf8c49d7f7b8f595fa609fe2be4c28593479ae846960ea`，9,396 B |
| config | `sha256:07c199e17490cc4fdf3e8027770f8a7413090d4e7c3a1f44aa9064e115641059`，18,775 B |

这些是原始本地导出身份，**不是已经发布的Registry digest**。没有build、转换或重打包，也没有启动容器执行原生root supervisor。

唯一凭据POST在本机获得403；安全回执只保存响应105B及SHA256 `6979949596e21188252f2394e828a8d535daec89ca894ea4aa85179c83e27e00`，没有保留正文，具体错误原因无法恢复。不能据403推断欠费、凭据已发行/撤销/到期或确定缺少`containers:write`。原入口在POST之后才append ready事件，因此本地safeRemoteEvents为空；独立原记录证明导出通过，不拿8937B观察流hash冒充完整ready事件。

## 独立失败收尾

本机原入口于23:32:51 Asia/Shanghai结束，SSH255但已reaped、localStopErrors为空；独立读回于23:40:41结束通过。远端保留的原terminal仍是`unknown-stopped / credential-stdin-bound`，export1、push0，不改写为发布成功。两台机器时钟未证明同步，保留原UTC时间，不推断跨机精确顺序。

固定success-only reader不适用这条失败路径；另行独审的最小只读reader只核原请求：3个原CLI均exit0/reaped且原PID/startTicks不存在，原supervisor不存在；19个有界来源含原始归档hash与raw index→manifest/config/layer链匹配，18个后续tag/push/readback记录均不存在。临时auth目录/config缺席，7897无IPv4/IPv6监听且loopback连接为ECONNREFUSED111；本机原SSH PID也独立缺席。该读回0远端写、0Docker、0provider操作，不能与原export写入混称全批零写。

## 合并与剩余阻塞

[#239](https://github.com/jihegao/riffology-cloud/pull/239)仍OPEN、head `0d23a12d869abccb9515a8e7f8196b0266258226`，只含两行canonical COPY0444。新鲜GitHub核对发现[原run39034206923/job117400649151](https://github.com/jihegao/riffology-cloud/actions/runs/39034206923/job/117400649151)实际执行后失败：M3主suite1203项，1188pass/3fail/12skip。3个断言均在已有异步waiter耗尽30/40次setImmediate后未观察到预期计数；相关测试、runtime、workflow和package与base29da字节一致，使用合成接口、未build/执行Docker镜像。没有证据证明两行Dockerfile导致，也不能宣称无害flake；没有重跑CI或伪造通过，不能套用“额度导致未执行”的豁免。

当前两个独立阻塞是：Registry凭据403的确切授权条件尚不清楚，及#239已有CI技术断言未解决。官方精确POST文档没有找到明确OAuth scope/API-token权限组映射；CLI `containers:write`、相邻API的Accepted Permissions和schema通用403描述不能替代本次原因。HTML成功示例200与resolved schema201差异保留，本次403也不由该差异解释。没有发现该POST的授权预测GET/dry-run。下一安全动作限于原身份只读权限核对、取得明确权限合同及本地最小CI诊断/修复；新登录/扩权/credential POST或push均需要新的具体范围，不能复用已消费的c3e尝试。

原归档、请求锁、镜像、资源、历史费用及57a/a21/b093证据全部保留。没有应用rollout、Gateway/assets/门禁写入、容器或真实项目/模型/Turn/Run、订阅/自动付款改动。#238保持In review，#214/JHG-46保持Acceptance/blocked，#242仅离线范围Done、Issue仍open；普通受邀skill→页面/保存/刷新/冷恢复与完整JHG-56仍待验收。
