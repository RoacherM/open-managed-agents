# 纯 Docker 只补三项管理能力
- 日期 / agent：2026-07-31 / codex
- 我原来的理解：要切换到完整 Cloudflare 本地运行时，连同 Local Runtimes、Browser、Queue/Cron/Billing 一起补齐。
- 用户实际要的：保留纯 Docker 自托管，只部署 Environments、Model Cards、Skills 三项；明确不要 Local Runtimes、Browser、Queue/Cron/Billing。
- 分歧根源：范围假设，把“补齐控制台关键能力”扩大成了“部署全部 Cloudflare 专属能力”。
- 以后如何避免：自托管补能力时先列出精确功能白名单，只实现白名单及其真实运行依赖，不顺带迁移其他平台模块。
