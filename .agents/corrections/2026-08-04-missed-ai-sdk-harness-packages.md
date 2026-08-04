# 漏查 Vercel AI SDK 官方 HarnessV1 packages

- 日期 / agent：2026-08-04 / codex
- 我原来的理解：AI SDK 只提供 `LanguageModel`、`ToolLoopAgent` 和把 Codex/OpenCode 包装成模型的 Community Providers，Pi 需要 OpenMA 自己直接接 SDK。
- 用户实际要的：评估 Vercel AI 仓库 `main` 中已经存在并发布的 `@ai-sdk/harness`、`harness-pi`、`harness-codex`、`harness-opencode`、`harness-claude-code` 统一 HarnessV1 方案。
- 分歧根源：环境假设；只查了官网常规 Agent/Community Provider 文档和 npm 搜索，没有先检查用户给出的当前源码入口及仓库 package tree。
- 以后如何避免：判断快速演进库的“当前支持能力”时，先检查用户指定链接、上游仓库 `main` 的 package tree 和 npm 最新元数据，再用官网文档补充语义。
