# G5 数据与保留冻结（2026-09-16）

仅使用合成建模数据及专属测试项目。两个已授权测试主体从现有目录只读核对：user、tenant、owner membership 均 active，且不同 user/tenant；这是目录映射，不代替两个普通用户的实际登录与权限验收。真实 UUID、账号配置及授权引用保存在本地 0700 目录/0600 文件，不进入公共 manifest。

平台白名单脱敏诊断保留 7 天，验收证据保留 30 天。凭据、Cookie、capability、原始 session 与非白名单响应不上传；本地副本需要明确归属及清理回执，R2 生命周期不自动清理本地。沿用已有诊断/验收前缀与生命周期前须再次核对实际规则。

Cloudflare Gateway 已实际创建并 GET 核对 authentication=true、byok_only=true、collect_logs=false、cache_ttl=0、retry_max_attempts=1、retry_delay=0、logpush=false。这些是 Gateway 设置，不是上游零保留证明。

OpenAI Responses 使用 `store:false`；官方[数据控制说明](https://developers.openai.com/api/docs/guides/your-data)中的滥用监测默认保留最长 30 天，账号 ZDR 未验证，缓存策略也不代表零保留。平台 7/30 天策略不能承诺缩短上游默认保留。任何非合成数据、上传原始诊断或上游数据策略变化须重新确定范围。

当前模型推理 0、新 Simulation/Service Run 0；关闭门禁的冻结不会启动两小时窗口。本文为具体配置的数据评审，不是付费验收结果。
