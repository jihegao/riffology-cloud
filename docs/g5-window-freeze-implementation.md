# G5双窗口离线冻结compiler

本地准备，不创建window、首准入、云资源或模型请求。`compileG5Freeze(input)`只处理显式profile/principals/windowIds/authorizationReference/rateCardSha256/sourceSha256/targets；未知输入字段（含任何openflag/key值）拒绝。ProductionProfile必须完整契约且实际模型Luna、input250/output1200 nanodollars、I262144/O4096；placeholder重复hash及缺字段拒绝。SHA形状只能排除明显占位符，不能证明证据真实性，账号/价格/授权原证据由主控独立核对。

两不同tenant和user的真实UUID必须显式提供，不能由邮箱推算。A第一主体：20USD/5Turn/147upstream/39Simulation/0Service/66task；B双主体：20/5/168/0/0/24；各7200000ms，串行A/B。shared money全局固定actor原契约，一个共同period/version覆盖两phase，global/user/tenant40USD、Turn5；输出money.enabled=false。Token固定version g5-openai-luna-20260916-v1、8reservation/8dispatch/262144in/4096out/2129920 reserved tokens，独立G5token JSON，不覆盖旧MODEL_BUDGET字段。

闭门patch明确M2_TURNS_ENABLED/M2_MODEL_PROVIDER_ENABLED/M4_SIMULATION_ENABLED/PRODUCTION_MODEL_ENABLED=false及G5_ADMISSION_ENABLED=false；提供两phase policy patch，均同profile/moneyperiod/tokenpolicy。不输出密钥值或引用文件内容，不含binding/migration/部署指令。冻结patch不能直接作为已部署release证明。

保守percall70451200 nanodollars，A10356326400/B11835801600，总额各20与Turn5检查；cost-per-accepted-task目标须足以覆盖A最大费用/16合格任务门槛，p95目标必填。目标值是执行前目标，不是实测SLO或成功率承诺。

CLI：`node scripts/model/g5-window-freeze.mjs private-config.json private-output-directory`。输入必须真实常规文件0600且非符号链接；输出directory0700、manifest/private-policies两个0600 wx文件，file/dir fsync。已有完全相同文件可恢复继续，不覆盖不同字节、损坏部分文件或宽权限文件。sanitized manifest只source/profile/rate/bundle hashes与金额/计数，不包含principal UUID、authorizationReference、Gateway账号、window privatepolicy；stdout仅脱敏manifest。privatepolicy不能提交进公共docs/repo。

3针对性测试通过：两窗口共享epoch/预算/closed-first/身份排除；缺授权、假hash、同tenant/user、openflag、费率或费用目标漂移拒绝；持久输出同字节恢复与冲突不覆盖。测试profile/主体/授权为合成fixture，不能作为实际批准配置。本模块不读取.dev.vars、执行部署或启动普通用户任务。
