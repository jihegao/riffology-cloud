# G5共享接线与queued设计边界

状态：只读设计，未实现shared接线、queued放宽或infra；本次仅实现Call/Turn core分层。

现有入口：Gateway Project POST按admitProject→catalog.create→provision；Workspace submitTurn→engine.enqueue持久queued；SimulationHost admitRun在Run持久化前，Group每childRun单独调用；Service有两个submit入口。当前callback返回值可能被忽略，真正接线必须检查单次准入permit并在持久对象创建后绑定实际ID。

开始执行必须另检查guard，位于Turn dispatcher申请新capacity/native副作用之前及Simulation native start之前。到期后的queued任务不能靠之前登记额度开始执行；历史已有执行只observe、Stop、退出与释放。Project provisioning的outbox/alarm同样必须包含实际start fence，不能只检查HTTP POST。

模型链：服务端固定G5路由，token reserve→global reserve→production money admission/dispatch→global claim→token dispatch→一次provider；未知ACK不重发。G4旧namespace/env/fence保持，不能以configuration-removed清零旧singleton；新Turn持久记录G5路由，历史Turn收尾必须取持久身份路由，不能仅凭当前env选择另一本账。

Call来源：token.lookup(tenantId,identity,callId)、money.lookup(reference)返回单Call持久terminal；精确toolBridgeActorName的turnSettlement(identity)用于quiescent检查，Call阶段允许closed=false。Turn来源：现有Workspace closeWorkspaceRuntime调用token/money/tool closeTurnAdmission不可逆关闭整个Turn；三个identity一致且closed/active0/pending0/unknown0后才放开global Turn hold。Private adapter必须自行从binding读取，核心规范化JSON不等同来源authority。

queued/FIFO尚未实现：未来建议QueuedPermit（先计task额度、无外部创建尝试）→CreateClaimed（窗口内单次创建fence，ACK未知全局held）→BoundQueued（真实ID，不授权执行）→StartAdmitted（现有FIFO选中，重新检查deadline/unknown与预算）→实际执行。预登记与创建不确定必须分开；有限已登记队列可以在已运行任务期间形成真实queued，但绝不让unknown或截止触发后新建/新执行。第二Session必须是真实新sessionId；跨tenant低容量观察必须用现有共享FIFO权威记录，不能由driver模拟排队。

当前core仍保守拦截所有新task直到已open Turn三账本closed，所以B真实排队/公平性验收未具备；不能开启G5 execute。下一切片须主控先批准queued语义与真实adapter，再修改gateway/app.ts、gateway/index.ts、workspace/durable.ts、workspace/turns.ts、turn/dispatcher.ts、simulation/host.ts、model-proxy/http.ts及对应测试。测试需穿透真实本地Workerd Project outbox、Turn alarm和Group childRun，而非只mock callback；具体生产权限/namespace/profile/账号仍另验收。
