# TrustedPi Registry 参数顺序修复固定包 — 2026-10-18

本包属于同一 JHG-46 Goal，关联最小离线修复 [#247](https://github.com/jihegao/riffology-cloud/issues/247)。状态为准备完成、待更新固定输入授权，尚未执行。用户已授权的9ec/3779包实际单次启动后CLI exit1停止；原PID独立确认不存在，driver未到达auth-token/身份API/SSH/RegistryPOST/push。[实际结果](project-view-trusted-pi-registry-recovery-result-20261018.md)保留原锁、记录及CLI自身副作用未知的限制，不重放9ec。

唯一执行逻辑修复是把固定 `--env-file /dev/null` 放在命令参数末尾：旧pinned解析器把前置数组参数后的login或auth/token吞作文件名；修复后保留完整命令及唯一空env输入。没有删除空env约束、变更CLI、OAuth范围、目标账户/仓库/镜像或绕过权限。独立于真实执行，纯解析器提取验证只运行11个固定公开片段，VM没有process/require/fetch能力，文件/模块能力硬拒绝，未装载完整CLI入口、OAuth handler或全局dotenv。

## 固定身份和输入

| 项目 | 固定值 |
| --- | --- |
| 新请求 / 父请求 | `fb99c7e4-21a7-4215-8261-c17dd7c148aa` / `9ec39434-0856-4ee7-af30-adf3dd5b5df4` |
| AMD128新目录 | `/tmp/riffoid-jhg46-image-20261017.AU613w/pi-registry-arg-order-repair-v1` |
| 只读原归档 | 原c3e目录 `pi-image-publication-v1/original.oci.tar`，407955456B，SHA256 `83b81e553a9c4e885299650c31cd179e126168c4da50b2dfd3ed1d8ffe5e0b51` |
| 原Engine/index | `sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593`，856B |
| 唯一linux/amd64 manifest | `sha256:f18a826d40b2fd60e2cf8c49d7f7b8f595fa609fe2be4c28593479ae846960ea`，9396B |
| 原config | `sha256:07c199e17490cc4fdf3e8027770f8a7413090d4e7c3a1f44aa9064e115641059`，18775B |
| 唯一目的仓库 / 新tag | `registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi` / `jhg46-pi-resource-compat-20261017-a946b164` |
| 八份操作源码 | 73639B；[清单](../evidence/releases/project-view-trusted-pi-registry-argv-repair-preparation-20261018/operations-manifest.json)1313B / SHA256 `89f2f285f5f732a6f3c9b8705a47fde4b5f073970e585e779371fb20ac2680fa` |
| 独立只读reader | 9065B / SHA256 `2207c49844d8bfa4777510d6c60d4333f509dd1d7ab42fabf71e6188c77d6266` |

完整scope、源码、测试、实测回执及独审由[准备证据目录](../evidence/releases/project-view-trusted-pi-registry-argv-repair-preparation-20261018/README.md)和inventory绑定。它们不包含原OCI归档、真实OAuth/Registry凭据、私人grant或人类答复。原9ec/3779与c3e所有输入/锁/失败均不改写。

## 拟执行的同一合同

1. 校验新一次人类答复、清单和专用本地锁后，用原已安装Wrangler4.129.0（CLI SHA256 `0a7bc2107ca92b2cc6db58b6a36d38d44b549eebd7db7ec34c36db9da7a91264`）做一次正常同用户OAuth consent。功能scope为user:read、account:read、workers:write、workers_scripts:write、containers:write，固定客户端追加offline_access，最终必须恰为六项。两个CLI命令均在命令参数末尾附带 `--env-file /dev/null`；环境允许列表排除其它token/认证端点，`WRANGLER_WRITE_LOGS=false`，输出有界内存，不写原auth日志或授权URL。沿用系统浏览器和localhost:8976回调；不使用默认全scope、其它账号/API token/连接器fallback。
2. OAuth持续保存在本机，正常同六scope续期仍可延长；没有账户或仓库资源过滤，不随15分钟Registry凭据失效。只有执行器限制任务目标。固定/user哈希 `c8d5e2a134d99693a4585510f761b811d67b3e36c413eb3c9d34d060cccc986d` 与Personal账户 `8b0d70250211aa10d89e20605a1c7e5e` 均匹配才可继续。选择containers:write不证明旧403的原因、REST最小权限或本次必然成功。删除临时Docker配置不撤销OAuth或恢复五scope，后续减权仍需新同意。
3. 单条本批拥有的loopback SSH转发 `AMD127.0.0.1:7897→本机既有127.0.0.1:7892`，无agent转发/继承其它转发/共享控制连接。原归档只读打开，核对普通文件/无链接/owner/0600及稳定身份；完整验证52原blob、唯一amd64 manifest、48解压diffID和前后两次原image inspect。归档与解压运行层累计各上限4GiB。0export/build/pull/load/container，原c3e目录不写。
4. 可信ready记录先独占落盘，再做本批唯一15分钟Registry凭据POST：固定账户，push/pull权限。API不能限单仓库，凭据为账户Registry权限；执行器严格限制上述目的地。仅接受HTTP200/201、success=true及精确账户/host/四个有界字段；其它响应、拒绝或未知沿原新请求停止，不重试、不换token。仅凭据username/password经SSH stdin到AMD的本批0700目录/0600配置，OAuth不传AMD，不写argv/环境/日志。
5. 权威确认Registry与本地固定新tag不存在，未知或已存在即停止而不覆盖；一次tag、一次linux/amd64平台push，然后逐tag/digest manifest、config和所有layer原始body/hash/大小/必要digest header回读。一次push指一个Docker CLI，不保证控制daemon内部HTTP重试；原index/attestation只作本地证据，不宣称签名。
6. 唯一完整ACK必须绑定原归档/平台/config、0export、一次校验/一次push及临时认证清理。缺失/重复/冲突/截断即unknown，SSH exit0不能替代。冻结独立reader只读核对本批原supervisor/CLI PID/startTicks/记录链、auth目录与7897释放；仅完整成功或严格的已验证归档后、凭据输入前EOF零push停止路径可收尾，其它保持pending。root另核对本机原OAuth/SSH子进程。临时删除不证明服务端JWT撤销或过期。

## 验证与完成边界

16项操作fake、7项reader fixture及真实纯解析器的旧/新顺序对照已经离线通过；这些只证明准备输入和解析行为，不证明真实登录、scope变化、tag不存在、API权限、推送或清理成功。最终独审与清单见准备目录。没有运行修复后的真实OAuth或新入口，没有生成新的真实grant。

新授权仅更新本批固定输入和新的单次尝试；原9ec已实际启动的CLI不会重放。授权不包含PR239/246合并、应用rollout、Cloudflare应用/Gateway/assets/bindings/policy/门禁、真实项目/模型/Turn/Run或容器验收。源码普通合并、兼容镜像上线及普通受邀skill→双页/保存/刷新/离开/冷恢复须在实际发布结果后各按具体范围推进；完整JHG-56保持独立后置。

用户无费用预算上限、明确欠费时通知及既有CI额度豁免继续适用；不以CLI exit1或HTTP403推断欠费，不改订阅、付款方式、自动付款或平台额度。所有原资源/镜像/费用/历史保留。 [原授权合同](https://github.com/jihegao/riffology-cloud/blob/14d2a2a5e03166ddba5167523127aeae0edd8832/docs/project-view-trusted-pi-registry-recovery-packet-20261018.md)只作已停止批的历史，不能当新输入已获授权。
