# #252 native host 资源快照修复：离线候选

本目录仅为可审准备件，尚未执行 AMD transfer、Docker build/mock 或任何云操作。新请求 `695e8875-459a-41b3-a148-2e228f2c3727` 和新 sibling `pi-native-resource-snapshot-host-v1` 不复用旧一次锁。执行须先取得对此包和操作件的明确新授权；缺授权、身份漂移或未知终态均停止，不重放。

源固定为 [PR253](https://github.com/jihegao/riffology-cloud/pull/253) head `0a10da572264470aaac111e6f5da2bd20b2f2c45`。对应 [CI 39119659267 / job117652481483](https://github.com/jihegao/riffology-cloud/actions/runs/39119659267/job/117652481483) 于 2026-10-18 18:32:31–18:43:22 Asia/Shanghai 成功。CI与本地源码回归证明代码检查，不能替代镜像或普通用户验收。

唯一覆盖为 `/opt/riffology/trusted-pi/trusted-pi-turn-host.mjs`，16,239 B / `942333ecc87eb6c7545e0494fed501d9ffa5418468039845484e223b6dfa81d6`，root:root 0555。新 host 接受可选 resources 并调用既有 `validateResourceProvenance`；旧五字段快照继续兼容。validator、SHA模块、controlled facade、release、SDK与package输入不变。十二目标中只有 host 的 overlay=true；[source绑定](source-input-binding.json) 逐项绑定当前 Git bytes，不宣称是一次新镜像读回。

基础使用既有 Engine 本地 tag `riffology-jhg46-pi-package-permissions:a21af2c8-44ff-4f67-a07f-c364bcd6d295`，不是假定 f18 RepoDigest 已缓存。预检必须新鲜锁定 Engine/index a946、runnable f18、config07c、原三份小 raw 实体和全部48个 RootFS diffID。tag不存在、身份/配置漂移、未知格式或不支持命令立即停；不补 tag、不 pull、不转用其它基础。原大 OCI archive 不重读、不 save/export。跨表示配置比较按 [固定官方结构合同](operations/official-config-contract.json) 仅归一有明确类型依据的遗漏默认值，其余字段/类型/非默认差异拒绝；历史API1.56观察不是本次新鲜支持证明。

[五成员 archive receipt](archive-receipt.json) 固定 gzip12,364 B / `91b42a14a3c1c8caafb0b98230f156408bc39be065d408091055e91f7c724b81`；无 payload 前缀、仅普通文件、无私有身份/配置/历史/授权/凭据。tar 不作为 Git 附件；五份可审输入及全部 hash 在本目录。Dockerfile仅 FROM 与一次带 owner/mode 的 COPY，不安装依赖、不变更USER或entrypoint。

未来操作范围是一次 transfer/unpack、一次 network-none/pull-false 的离线 build、一次 UID10002 的 network-none mock、原CID清理及一次独立只读回证。mock保留readonly root、cap-drop ALL、no-new-privileges、pids128、768MiB、一CPU和64MiB /tmp。仅挂两个0444精确输入，`env -i` 后仅PATH，不挂任务/记录/认证目录。独立reader绑定原记录、原CLI PID/startTicks与终态，再对原CID/同label执行两个GET；不创建、启动、删除或重跑。详见 [scope](operations/scope.json)、[操作说明](operations/EXECUTION.md)、[操作件manifest](operations/operations-manifest.json)、[输入合同](EXECUTION-CONTRACT.md)。

2026-10-18 18:42:28 Asia/Shanghai 的唯一 source-equivalence 运行已通过真实 native host 与真实 controlled facade，模型和research各3次均在内存fake完成，projectTool/global fetch均0。覆盖 legacy、valid resources冻结输出、冷恢复元数据及3种输入拒绝；3个session均dispose，临时目录移除。[安全检查投影](checks/offline-checks.safe.json) 保留原stdout/receipt hash。此运行在macOS UID501，跳过image UID、root所有权、mode与Linux caps检查；报告的条件布尔不能提升为镜像权限已验收。未来image模式必须由独立容器inspect和实际probe重新证明。

这不修复原T1 project_write的未知效果，不生成R1，不重试原Turn，不恢复旧项目，不把原剩余T2/T3转为本修复调用。父目录mkdir recipe仅供未来另行批准的真实普通用户批次。Registry push/export、应用rollout、Gateway/gate写入、真实provider/Turn/Run及完整JHG-56均不在本包范围。所有旧失败、unknown、费用/预留与一次锁保持。未来成功镜像ID和容器ID只能从实际执行取得，不预填。

操作件最终 manifest 为 `fe1ab539e48c1a19d1b48e355b63c93a7c8c1c82bdcee319a385c7aac1ef78c5`（10份source）。[23项pure检查](checks/operations-checks.safe.json) 为17项操作fake和6项reader fixture，不是实际Docker读写或镜像验收。原中间版本失败/审阅历史保持在本地，不作为本版成功冒用。

本次仅离线批次，不延长旧真实验收截止2026-10-18T12:42:46Z（Asia/Shanghai20:42:46），不授权新Turn，也不能套用原剩余T2/T3次数。

[最终独立审阅](reviews/independent-final-preparation-review.json) 结论无 must-fix；审阅者未重跑测试或执行远端动作。
