# M0 T04 tenancy 原语探针

这是独立的 staging 原语探针，不修改现有 Boundary/Storage/Files Worker。它使用 DO SQLite 保存 alpha/bravo 两个 Workspace 与 Artifact 的 revision/digest 元数据，并使用现有私有 R2 bucket 的独立 `m0-tenancy/<run>/` 前缀保存真实合成对象。没有 Container、镜像或模型绑定。

`POST /bootstrap/<run>` 和 `POST /cleanup/<run>` 只接受 operator Bearer，body 必须为空 JSON 对象。bootstrap 固定创建四个对象，并在内存响应中提供各自 capability 以及一个固定过期 capability；客户端请求只使用对应 resource capability，不携带 operator secret。能力同时绑定 run、tenant、kind、object ID 和完整服务路径，过期能力不接受任何调用方时钟。

云驱动应在内存中保存 bootstrap 响应，先并发对 alpha/bravo 的 Workspace 和 Artifact 做固定正向 read/write，再把每个 capability 交换到另一 tenant、run、kind、object ID、服务路径和 Artifact ID，并使用过期能力请求。每次拒绝后，使用仍有效的所属 capability 独立 read 回原对象，确认 revision/digest 无副作用；客户端只发送固定 `{"action":"write"}`，不能提供任意内容、路径、命令或 URL。驱动不得把 capability 明文写入证据；最后由 operator cleanup 删除本 run 的四个 R2 key 和 DO SQLite 状态。

当前不包含云驱动或 T04 gate 结论。`gate_decision` 应由主控在真实云运行、并发正向读写、交换矩阵、过期能力、拒绝原因、独立回读和 cleanup 全部取证后决定。
