# G5-A unknown 后续窗口阻断审计（2026-09-16）

状态：**NO-GO；仅创建新windowId不能继续G5-A。** 本文是只读设计审计，不授权代码变更、云发布、门禁开启或模型调用。

首个G5-A Turn留下一个unknown Call和对应open Turn。`G5ControlledWindow`使用唯一全局actor，并在任何新admission前扫描所有历史窗口；只要存在unknown Call、open Turn或未确认task，新窗口就会以`charge-unsettled`拒绝。单元测试和真实Workerd测试都明确覆盖旧窗口unknown阻断新窗口且重启后继续阻断。因此，换windowId不能绕过当前fence。

上一轮建议的残余上限算术本身正确：旧窗口已占2 tasks、1 dispatch、0 Simulation、0 Service和9,910,450 nanodollars；合并上限不变时，剩余为64 tasks、146 dispatch、39/0 Run和19,990,089,550 nanodollars，每Turn仍为5,000,000,000 nanodollars。但当前schema和工具链不接受这组残余policy：A policy、freeze compiler、overlay、operator、cloud host、driver和schedule固定要求66 tasks、147 dispatch及20,000,000,000 nanodollars。手工改配置会破坏canonical bundle和证据链。

Production money ledger同样使用唯一全局actor。旧unknown无论money period如何变化都会继续占用；更换period不能释放它，还会使同一授权周期的recorded费用核对变得不完整。不得新建namespace、actor或period来规避旧记录。

在保持现有实现不变时，唯一允许解除本次已dispatch调用阻断的路径是取得该调用的权威provider usage终态和provider request标识，按既有三账本协议完成原调用结算。当前持久记录没有这些字段，Gateway未保存payload日志，现有OpenAI key不能读取组织usage/cost，因此该路径目前没有足够证据。

若用户决定在保留旧unknown的前提下继续，则必须另行批准改变“任何unknown全局阻断后续窗口”的既有安全语义。可评审方案是在同一全局Guard中增加原子持久化、并与权威收据摘要绑定的一次性rollover记录：精确绑定旧关闭窗口、唯一unknown Call及其open Turn、旧计数与保守占用、新windowId和残余上限；旧记录继续保持unknown且不退款，只对该目标窗口豁免这一个已结转阻断。任何额外unknown、状态漂移、重复rollover或actor/namespace/period变化仍应fail closed。

该方案尚未实现。实现范围至少包括policy parser、Guard、admission contract、authority/operator、freeze compiler与overlay、cloud host、串行driver和schedule，并需要单元及真实Workerd证明：rollover前阻断；一次性登记和ACK丢失幂等；重启不丢失；旧unknown仍可读；残余64/146/39/0/19,990,089,550边界逐项加一即拒绝；新增unknown再次全局阻断；新两小时时钟从新窗口首次真实Guard admission开始且不可重置。

任何执行授权还须明确包含：新windowId和全新Project/Session/Turn/intent ID；禁止重放旧intent；旧9,910,450 nanodollars永久计入原US$20；残余上限和每Turn US$5；新的两小时时钟；同一普通用户、模型、Gateway、profile、仅合成数据及7/30天保留；closed release和精确云回读通过后才可开启门禁。G5-B/G6仍不包含。
