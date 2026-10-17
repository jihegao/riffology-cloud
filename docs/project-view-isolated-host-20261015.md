# 通用页面本地隔离宿主（2026-10-15）

PR #221 的本地通用页面现在通过独立 Chromium 执行项目 HTML/JS；主应用只接收 PNG 画面及有界 broker 消息。原通用 iframe 路径在本地返回410，生产/混合来源仍拒绝。不是生产发布：Gateway 双 loopback 门禁保留，没有部署、模型或付费计算调用。

## 实际接线

1. Gateway 按原认证 scope 取得 canonical `project.view-package/v1`，仅在 APP_ORIGIN 与 execution origin 都是不同 loopback origin 时返回 `transport: isolated-browser/v1`。
2. 前端保留包身份、asset摘要、scope/generation验证及原 `createProjectViewBroker`。新的 canvas 客户端通过本地执行 origin 建立 session，拿到随机 session token；不发送 Cookie 或平台凭据。
3. Node宿主只绑定loopback，校验Host/Origin/方法/大小，重新核对包摘要和资产；以固定镜像、审阅的seccomp创建无网络容器。原操作身份先持久化；实际容器配置核对通过才启动。
4. 容器中运行已有页面bootstrap和真实MessageChannel。页面消息通过Playwright pipe、NDJSON、本地HTTP和前端MessageChannel到达原broker；文件及产物读取仍走原授权路径，导航/撤权/更新仍受当前generation约束。
5. 项目DOM不进入主应用。主应用对PNG字节、尺寸做边界检查并使用浏览器图片解码器解码，然后绘制canvas；点击、键盘和滚动经有界命令返回容器。任意页面导航无法越过容器网络命名空间。

## 启动（仅已准备的 AMD128 / 同级 Linux）

```bash
# 在repo根目录，使用已存在的固定镜像。没有自动pull或provider fallback。
node services/project-views/local-host.mjs \
  http://127.0.0.1:8795 http://localhost:8821 \
  sha256:658fe76b5935c54d9b078fa4223867cd3aa2524bc8880db1d5274df42df73871
```

两个origin与本地Gateway配置一致；该端口用于新宿主，不同时启动旧execution worker。宿主要求当前机器有CPU0、1，镜像准备及seccomp来源见 [离线策略说明](../scripts/m3/offline-view/README.md)。Linux本地镜像使用既有Playwright1.63、Chromium1243和枚举系统库，不是可直接发布的生产镜像。

本地单会话容量：非root10001、cap-drop ALL、no-new-privileges、read-only、network none、无宿主mount/port、768MiB、128 PIDs、1 CPU quota及两核亲和性。画面500ms采样且最多一项待完成；输入/输出/队列有上限。10秒无poll或5分钟绝对期限关闭会话。切页先确认原会话清理，再创建下一会话；这些是离线候选边界，不是生产容量承诺。

所有关闭按原label/name/image/immutable ID核对，未知创建或清理保留隔离状态和容量。用户对同session再次close可重新观察原ID；已确认不存在时不重复执行，不因丢失rm ACK创建新容器。已清理会话的token哈希回执允许原token查询清理终态。启动发现未处理原记录或遗留容器则拒绝新的容量。状态目录属于本地实验数据，不包含项目包正文；不要删除pending记录来绕过隔离。

## 验证与边界

`scripts/m3/project-view-host-acceptance.mjs IMAGE NEW_OUTPUT_DIR` 创建本地应用、真实宿主、canonical包与浏览器：真实页面经MessagePort读取文件和产物、显示画面、输入和切页；再用九个真实项目包执行href/assign/replace/fetch/beacon/image/form/window.open/WebSocket。接收端前后正对照、浏览器失败事件和每个原容器清理共同构成证据，不只依据接收端没有请求。

客户端fixtures验证PNG解码、异步取消、旧generation、切换/恢复、错误与scope拒绝；原broker和Gateway测试覆盖权限与迟到响应。fixture不是Docker验收，Docker也不是生产认证验收。精确源码身份、检查结果和AMD记录由本次发布证据索引提供。

未覆盖生产镜像供应链、真实普通受邀身份、云端调度/费用/容量、可访问性、完整多媒体/拖拽/剪贴板、长期会话体验，以及浏览器/内核漏洞抵抗。生产入口仍关闭；不因本地链路通过将 #214/JHG-46 整体标Done。

实际验收与源码摘要见 [发布证据](../evidence/releases/project-view-isolated-host-20261015.json)。AMD128 最终运行通过九种外发、真实文件/产物读取、点击/键盘/小数滚动、切页和撤权清理。
