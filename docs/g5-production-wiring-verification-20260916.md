# G5 接线发布前验证（2026-09-16）

主控独立验证的代码候选包含 `5903cb0` provider接线、`6c821e4`/`3db5497` 私有authority、`4a8df0e`/`5e008da` Workspace与真实Run提交后bind、`d7c77a8` 原子Project/outbox route、`3433139`闭门overlay、`0ef01ac`/`ff3be9a` Turn提交ACK丢失缺route拒绝。源码与两窗口privatepolicy由实际字节摘要冻结，不以subagent报告代替主控检查。

本候选完整 `npm run check` 成功：2053项，2042通过、11跳过、0失败；包括UI syntax、typecheck、M0/M1/M2/M3及Browser runtime/execution、phase1/model脚本。额外 `node --test scripts/m2/g5-*.test.mjs` 23项全部通过。11跳过是环境/opt-in集成项，没有冒称真实Docker/Linux/nativeVM验收。前两轮check曾因新增0010未进入preflight精确列表及历史test硬编码9失败，已修名单和期望后完整重跑；不沿用历史G4的2002项结果。

非作者独立复核并重跑真实本地Workerd：生产Workspace、G5ControlledWindow、G5 token/ProductionMoney/ToolBridge三DO和D1/outbox联合3/3通过，覆盖真实三账本闭合、Cold及Warm/lazy配置下实际journal.sync提交后丢ACK并重启。缺route同时阻断capacity与runtime；无resourceWait/dispatch/nativeaccept。native边界明确为receipt fixture、outbound禁用，不是云原生运行证据。私有authority另验证两个合法Call、reference/policy/domain/identity/计数校验、真实Turn闭账、reserve重放保留money引用、原始fixture receipt RPC不存在及关闭gate不启动window。

Run实际事务与sync之后才bind；事务失败、commit ACK丢失或bind ACK不确定保持保守阻断，独立读取已存实体可核对但不重新创建。Start grant原子生成、调用方持久化后确认；丢ACK不能重新领grant。队列取消不refund；实际三账本关闭是Turn解锁来源，单Call终态不解锁下一Turn。旧G4使用原namespace、policy与fence；未配G5环境的历史行为保留，在G5配置下无持久route不能作为legacy继续推理。

现有Cloudflare operator只读核对两不同active user/tenant/owner membership。Gateway token此前verify HTTP200/active；本次原生OpenAI `/models` HTTP403 `unsupported_country_region_territory`，0推理，通道可用性未通过。不可将密钥/provider列表或fixture冒称#46验收。

发布前实际云核验：5个现有container app各自max_instances=1，实际镜像均为digest固定；分页完备读取259实例、nonInactive=0。基线infra有3个陈旧镜像引用，实际闭门overlay使用现有app已部署digest，避免回退它们。既有15个DO class/name已读回，接线只追加3个sqlite DO，不rename/delete/reset。当前实际源/镜像不是本地Linux内核观测实现已发布的证明。

新增D1 migration `0010_project_budget_routes.sql`实际apply成功；独立只读SELECT确认migration/table/不可变trigger各1，route_count=0、rows_written=0，未新增Project。R2专属G5诊断7天、证据30天规则实际PUT与独立GET一致、原G4/multipart规则保留。密钥仅使用现有本地`.dev.vars`，任何原始凭据/session/control数据不进公共证据。

本记录仅为关闭门禁的接线发布前事实及数据/费用评审入口；profile.acceptance.evidenceSha256指向本文实际字节，不是付费benchmark、安全/科学、普通用户成功率或#46/#37关闭证明。首次模型/Project/Run admission为0，2小时未开始；上游地区阻断解决并重新核验之前不打开任何gate。
