# 自托管 Agent 表单要求 Model Card
- 日期 / agent：2026-07-31 / codex
- 我原来的理解：配置好 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_BASE_URL` 后，可以直接从控制台创建 Agent，不需要 Model Card。
- 用户实际要的：使用当前控制台的 Form 创建流程；该流程明确要求至少存在一个 Model Card。
- 分歧根源：范围假设，把 JSON/YAML/API 可绕过 Model Card 的能力误当成 Form 表单也支持环境变量回退。
- 以后如何避免：回答控制台操作前，必须实际走对应 UI 路径，并区分 Form、JSON/YAML/API 与后端路由支持情况。
