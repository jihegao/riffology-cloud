# GaoAgent 模型入口

GaoAgentModel 是 gaojihe.cn 个人助手的命名 Worker 服务入口，仅通过 Service Binding 调用。默认关闭，GAOAGENT_MODEL_ENABLED 必须为字符串 true 才执行模型请求。原 Gateway 的公共路由不增加匿名推理接口。

入口固定 gpt-6-luna、Responses、low、stream=true、store=false 和 max_output_tokens=2048，只接受 knowledge_search/knowledge_get 函数工具。请求采用 UTF-8 字节加4096的保守输入上界12000；使用 prompt_cache_options explicit 模式，不转发旧 prompt_cache_retention，也没有自动 retry/provider fallback。

此入口读取原有 PRODUCTION_OPENAI_API_KEY 和 PRODUCTION_AI_GATEWAY_TOKEN，以现有 production profile 的 gateway 身份构造固定 OpenAI endpoint。凭据不导出给 GaoAgent Worker、Pi 容器或浏览器。原仿真 Pi 的模型、profile、容量 actor 和历史账本不修改；本项独立于 #209。

调用端由网站仓库的 GaoQuota 原子执行每日100轮、同键去重、单会话/全站并发与每轮3次模型调用上限，并将实际 token usage 单独持久化。部署前必须验证新服务绑定及调用端准入；该入口不是可供其他公开路由直接使用的通用模型代理。

验证：精确 payload 策略的2项离线测试在网站实现环境通过；Gateway 重新打包、原仓库类型和相关回归、实际服务绑定、账户权限、usage及取消仍须在目标基线验证。代码添加不授予线上启用或付费执行权限。

关联：#260 · [网站实现 PR](https://github.com/jihegao/gaojihe-cn/pull/1)。站点配置和部署顺序见该 PR 的 agent/README.md。
