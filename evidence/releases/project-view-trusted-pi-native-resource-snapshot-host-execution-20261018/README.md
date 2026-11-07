# Native host resource-snapshot offline execution — 2026-10-18

原请求 `695e8875-459a-41b3-a148-2e228f2c3727` 在人类明确批准 `0900f191…` / `91b42a14…` / `fe1ab539…` 后，完成一次固定缓存构建和一次断网镜像探针。runner 于 **11:47:11.166794Z** 返回通过；随后冻结独立 reader 核对原记录并只作两项新的 Docker 读取，确认原 CID 不存在及同 operation label 的全状态列表为空。

[结果](result.json) · [独立实际结果审阅](sources/actual-result-independent-review.json) · [原八件采集索引](sources/original-records-inventory.json) · [文件清单](inventory.json) · [一页结果](../../../docs/project-view-trusted-pi-native-resource-snapshot-host-offline-result-20261018.md) · [原冻结发布包](../../../docs/project-view-trusted-pi-native-resource-snapshot-host-offline-packet-20261018.md)

- 原八件安全 JSON 共 **11,802 B**，按采集索引逐字节保留；它们覆盖 transfer、原输入 guard、base raw chain、derived identity、完整 probe report、runner 清理/结果及独立清理结果。
- base 为原 a946/index → f18 platform manifest →07c1 config，48diffID 与闭合 Config 合同匹配。派生 RootFS 保留原48层前缀并为49层；Engine Id、build IID 和 descriptor 均为 `0bb9af7a…`，其类型为 **OCI index、856 B**。config digest 为 null，本批未取新平台 manifest/config、未 export/push，不能把 index 当作 runnable 或 Registry 发布摘要。
- 真正的 `mode=image` 探针使用 Node22.23.2、UID/GID10002；12目标文件字节/hash/权限、1个 host overlay、14检查均通过。`env -i` 加探针检查确认 Node 进程只收到 PATH。原 supervisor/root 镜像配置保留，mock 通过命令覆盖为10002；这不是原 supervisor 执行验收。
- 同一断网容器中调用实际 baked host 和 ControlledPi facade，合成 model3/research3、创建3/销毁3；原报告内 projectToolExecutions/ambientFetch/realProviderRequests 均0。它们是本地 fixture 回调，不是3个真实 Turn，不证明 `project_write` 修好。
- runner 原 CID 清理和独立两GET均通过；17份原 Docker CLI 记录为 reaped/原 startTicks 当前不存在。两个预期 exit1 对应“派生tag原先不存在”和“原CID已不存在”，其余原CLI exit0。[原独立回读](sources/independent-readback-result.json)。

`probe-report.json` 为3,706B pretty原件；独立 reader 原stdout为2,360B，采集的pretty独立结果为2,964B。后两者JSON语义相同、字节哈希不同，分开归档。采集器仅另读8固定JSON，0Docker命令；没有把全部base64传输正文、Config/Env、原命令流或凭据放入公开目录。

`preflight-local-only.json` 的 sshStarted/dockerStarted=false 是 **11:46:27 执行前快照**；后续实际transfer/build/mock另有原回执，不能把前置快照误读为没有执行。授权仅保留安全事实和哈希，原人类回复与grant正文私下保留。冻结probe原limitations中的“future”文本按原字节保留，actual image模式/时间及本结果记录此次已执行事实。

本批没有合并PR253、发布Registry镜像、更新应用/Gateway/gate、重放失败T1或执行T2/T3。旧Gateway9c8e、应用f18和原maintenance end历史保留；此新本地镜像未部署。原真实验收截止 **2026-10-18T12:42:46Z** 未延长。费用/usage未核，不记0；原57a/a21失败、b093成功探针、c3e/9ec各自停止、fb99成功发布、T1失败/释放及锁/归档/预留全部保留。JHG-46未完成。

本目录供PR236审阅，实际结果与后续准备分开记录。未因整理证据重跑测试、CI或远端探针。
