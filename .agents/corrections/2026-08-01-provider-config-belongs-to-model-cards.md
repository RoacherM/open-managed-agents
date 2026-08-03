# Provider 配置属于 Model Cards 而不是默认 Compose 环境变量
- 日期 / agent：2026-08-01 / codex
- 我原来的理解：一键启动可以从 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL` 等环境变量自动建立默认 Model Card。
- 用户实际要的：Compose 只负责启动平台；Provider 由用户启动后在 OpenMA 的 Model Cards 页面配置，不要求在 `.env` 重复配置。
- 分歧根源：配置路径假设，把后端兼容性 fallback 当成了产品主配置入口。
- 以后如何避免：以控制台支持的 Model Card 流程作为 self-host 默认契约；环境变量 Provider 仅标为 headless/legacy fallback，不纳入一键启动必填项。
