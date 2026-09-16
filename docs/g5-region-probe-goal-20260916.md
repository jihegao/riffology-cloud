# G5 Goal 新区域隔离探针（2026-09-16）

本次受控 Goal 先部署全新的隔离 Worker `riffology-g5-region-probe-us-east-20260916` 和独立 Gateway `riffology-g5-region-probe-20260916`。Worker 使用 Cloudflare `placement.region=aws:us-east-1`；Cloudflare service API回读为 `placement_mode=targeted`、target region `aws:us-east-1`。调用从SJC ingress进入，响应头为 `cf-placement: remote-`，说明请求被远程放置，但Cloudflare没有在该header返回执行机场后缀，因此证据只声明目标区域和remote placement，不臆测具体执行colo。

精确 Worker version为 `67634122-64cd-4468-9a42-a61349c8f94c`；活跃模块9004字节，SHA256 `a9d0880fcd3b5e963681bf68aacc2021d0bb90226de7243dd29b19ca90f01579`。它只有三项secret binding和 `global_fetch_strictly_public`，仅允许operator鉴权的空body `POST /probe`，出站只执行固定 `GET /openai/models`。

实际结果为HTTP 200、`gpt-5.6-luna`存在、`inferenceCalls=0`。验证期间主Worker六项门禁均为false，没有付费Responses或G5 admission。验证成功后已删除区域探针Worker和独立Gateway，分别独立回读不存在`10090`和`7002`；本地上传secret文件已删除。

该结果满足“先用新区域隔离通道验证”的前置条件，只证明目标区域放置、Worker出口、双层鉴权和模型可见。G5-A必须通过主Worker普通用户产品链和既有A预算/账本执行，不能从探针直接POST Responses或绕过guard。Cloudflare关于区域放置与 `cf-placement` 的定义见[Placement Hints](https://developers.cloudflare.com/workers/configuration/placement/)。

[脱敏机器证据](g5-region-probe-goal-20260916.json)用于7天诊断及30天验收副本。两个R2对象均已独立GET回读为1827字节，SHA256均为 `9c169552af52f1ad2887ff65f3a7425a56e1c834d70be33b0193cd20855eb1ac`，与仓库文件一致。G5-A正式执行入口、关门和三账本收尾仍须通过独立代码评审；在这些入口完成前不得打开主Worker门禁。
