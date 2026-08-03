# 最低部署范围必须包含三项管理能力
- 日期 / agent：2026-07-31 / codex
- 我原来的理解：先部署 Agents、Sessions 和模型调用核心链路，其他控制台页面为空可以后续处理。
- 用户实际要的：最低可用部署必须同时包含 Environments、Model Cards、Skills 管理，不能接受空占位页面。
- 分歧根源：范围假设，把“核心接口可运行”误当成“满足用户的最低产品体验”。
- 以后如何避免：部署验收必须逐项验证 Environments、Model Cards、Skills 的创建、列表回读及 Agent/Session 引用，空列表占位不算完成。
