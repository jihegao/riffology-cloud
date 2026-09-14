# Queue Priority B

已由 FCFS 更新为非抢占优先级队列。顾客按固定 `seed` 生成 high/regular 优先级；等待集合中 high 先服务，同级按到达顺序。已开始的服务不会被打断，多服务器共享同一等待集合。到达间隔和服务时长为指数分布。

新增参数 `high_priority_fraction`：number，默认 0.3，范围 0..1。保留原参数和指标，并新增 `mean_wait_high`、`mean_wait_regular`。`model/run.py` 生成输出旁的 `customers.csv`，含 priority、arrival、start、completion、wait 等列，并在最终 JSON 中声明 `outputs:["customers.csv"]`，使平台能够保存候选输出。依赖仍为空，使用标准库。

历史实际实验摘要（平台提供）：servers=1 的 Run `bfe772aa-0a30-4795-8a8f-ba62d3c4b0c2`，seed=99、customers=40、arrival_rate=1、service_rate=1，completed=40，mean_wait=2.4932877193363012，max_wait=8.081178189502857，mean_sojourn=3.3153717180277837；servers=2 的 Run `2ab1f808-0e58-4a89-ac66-2a5784d00c0e`，相同参数，mean_wait=0.36016908269074116，max_wait=2.7744723310529484，mean_sojourn=1.1822530813822227。两台服务器降低了该次有限样本的等待和逗留时间；这是旧 FCFS 版本的真实 Run 结果，不是本优先级版本结果。

限制：有限随机样本不是稳态分析，也未校准现实系统；高优先级可能增加普通顾客等待并存在饥饿风险，指数分布和二元优先级可能不适用具体业务。Preview 标题为 Queue Priority B checked，只解释机制，不提供示意指标；实验结果以平台 Run 面板为准。已修正两个调度错误：保存的 Run `73da2349-23b7-4a1f-bd43-0e348e2cc848` 曾在服务器空闲时错误延迟已到达顾客；随后版本又只逐个吸收下一位到达者，导致到达窗口内的高优先级顾客可能被普通顾客越过。之前 `dc1a...` 版本只是在特定双服务器样本下过关，不是完整验证。当前每次分配前都会吸收所有 arrival <= now 的顾客，再按高优先级、同级到达顺序选择。两组旧错误模型 Run 均保留，不能据此推断政策效果。`docs/validate_priority.py` 提供标准库有限验证。复现需记录完整参数、平台 seed、Python 版本和依赖锁。
