# GaoAgent 模型入口

GaoAgentModel 是 gaojihe.cn 个人助手的命名 Worker 服务入口，仅通过 Service Binding 调用。默认关闭，GAOAGENT_MODEL_ENABLED 必须为字符串 true 才执行模型请求。原 Gateway 的公共路由不增加匿名推理接口。

入口固定 gpt-6-luna、Responses、low、stream=true、store=false 和 max_output_tokens=2048，只接受 knowledge_search/knowledge_get 函数工具。请求采用 UTF-8 字节加4096的保守输入上界32000；使用 prompt_cache_options explicit 模式，不转发旧 prompt_cache_retention，也没有自动 retry/provider fallback。

此入口读取原有 PRODUCTION_OPENAI_API_KEY 和 PRODUCTION_AI_GATEWAY_TOKEN，以现有 production profile 的 gateway 身份构造固定 OpenAI endpoint。凭据不导出给 GaoAgent Worker、Pi 容器或浏览器。原仿真 Pi 的模型、profile、容量 actor 和历史账本不修改；本项独立于 #209。

调用端由网站仓库的 GaoQuota 原子执行每日100轮、同键去重、单会话/全站并发与每轮3次模型调用上限，并将实际 token usage 单独持久化。部署前必须验证新服务绑定及调用端准入；该入口不是可供其他公开路由直接使用的通用模型代理。

验证：PR #261 的 Gateway 原仓库回归、类型与打包已通过，入口现已由用户授权启用。2026-10-28 的输入预算修复通过2项策略测试，使用保留配置的源码替换发布为 `191e6d4a-b893-4490-ae37-e2751d9d08ba`；原 `index.js` 完全一致，107个绑定（含11个Secret）回读一致。正式站 gpt-6-luna 项目问答已返回 GitHub 来源引用。网站的工具收口与回归证据见 [修复 PR](https://github.com/jihegao/gaojihe-cn/pull/3)。

关联：#260 · [网站实现 PR](https://github.com/jihegao/gaojihe-cn/pull/1)。站点配置和部署顺序见该 PR 的 agent/README.md。
