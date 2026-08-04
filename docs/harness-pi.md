# Node self-host：Pi Harness

OpenMA 的 Node/Docker runtime 支持把 Agent 的 backend 设为 `pi`。实现使用官方
`@ai-sdk/harness` / `@ai-sdk/harness-pi`，但仍复用 OpenMA 的 Model Card、tools、
Session sandbox、event log 和 interrupt/cleanup lifecycle。

```text
user.message
    │
    ▼
SessionStateMachine.prepareTurn
    │ agent._oma.harness = pi
    ▼
HarnessAgent + harness-pi ───────> Model Card provider
    │ host tool call
    ▼
OpenMA tools ──> SandboxExecutor ──> session /workspace
    │
    └──────────> canonical agent.* / span.* events
```

## 配置

1. 在 Console 的 **Model Cards** 页面配置 provider、wire model、Base URL 和 API Key。
   Pi 不读取新的 provider `.env`；它使用 Agent 选择的同一张 Model Card。
2. 在新建 Agent 的 **Basic → Harness** 选择 `Pi`。Console 连接 Node self-host
   runtime 时该选项可用；切换到 YAML/JSON 后会保留为 `_oma.harness: pi`。也可以直接
   使用下面的配置：

```yaml
name: Pi Coding Agent
model: deepseek-v4-pro[1m]
system: You are a careful coding assistant.
_oma:
  harness: pi
tools:
  - type: agent_toolset_20260401
    default_config:
      enabled: false
    configs:
      - name: bash
        enabled: true
      - name: read
        enabled: true
      - name: write
        enabled: true
      - name: edit
        enabled: true
      - name: glob
        enabled: true
      - name: grep
        enabled: true
```

支持的 Node harness 名称只有 `default` 和 `pi`。未知名称会在调用模型 Provider
之前产生 `session.error`，不会静默回退到另一个 backend。

## Model Card 映射

| OpenMA provider | Pi API | Base URL |
| --- | --- | --- |
| `oai` | `openai-completions` | 默认 `https://api.openai.com/v1` |
| `oai-compatible` | `openai-completions` | 必须来自 Model Card |
| `ant` | `anthropic-messages` | 默认 `https://api.anthropic.com` |
| `ant-compatible` | `anthropic-messages` | 必须来自 Model Card |

Model Card API Key 只交给 main-node 内的 Pi host auth 配置，不写入 Pi `models.json`、
Session sandbox 或 canonical event log。临时 Pi agent 目录权限为 `0600`，Session
销毁时删除。

## 为什么禁用 Pi 自带文件工具

Pi 的原生 `read/write/bash/...` 有自己的 host VFS 和事件语义。若直接启用，会绕开
OpenMA 已有的 tool permission、`agent.tool_use/result` 映射和 Session sandbox 约束。
当前实现因此禁用 Pi builtins，只把 OpenMA 已启用的、可执行 tools 交给
`HarnessAgent`。

OpenMA 对外的 canonical 工作目录仍是 `/workspace`；HarnessV1/Pi 内部为每个
Session 分配唯一的 `/.openma-harness/<encoded-session-id>` 逻辑 VFS mount。
[`ai-sdk-harness-sandbox.ts`](../apps/main-node/src/lib/ai-sdk-harness-sandbox.ts)
把每个 mount 映射回对应 Session sandbox root。这个唯一挂载点用来隔离 Pi
process-global `fs` patch，避免并发 Session 互相截获文件操作。

## 恢复与 checkpoint

每个成功 turn 在 canonical events flush 后调用 `session.stop()`，校验
`/workspace/.pi-sessions/<sessionFileName>` journal 存在且非空。除首个 checkpoint
外，还会与上一个 checkpoint 比较，要求 journal 内容确实发生变化；否则
turn 失败，不会接受上游吞掉的 journal 写入错误。校验通过后才将不透明
resume state 写入 `/workspace/.openma/pi-resume.json`。新 main-node 进程会从
sandbox 读取这两份状态，通过 `createSession({ resumeFrom })` 恢复 Pi 上下文。

这个语义只保证恢复到**上一个已完成 turn**；若进程在 turn 中途崩溃，
未完成的模型或工具执行不会精确续跑。

## 当前边界

- 仅 Node/Docker self-host；Cloudflare Agent Worker 未注册 `pi`。
- 仅文本 `user.message`；图片和文档会 fail-fast，避免静默丢附件。
- 只支持有 `execute` 的 OpenMA tools。`always_ask` 和 client-result custom tools
  暂未接入 HarnessV1 continuation，会在开始模型调用前 fail-fast。
- Pi checkpoint/resume 已用 `local-subprocess` 验证进程重启；远程 sandbox
  provider 的 snapshot/restore 尚未验证。
- Pi 自己可以 auto-compact；`compaction` stream part 暂未投影为 OpenMA 的
  `agent.thread_context_compacted` 事件。
- `harness-pi` 当前会在 system context 中包含其宿主 package 文档路径；模型没有对应
  的 OpenMA sandbox 访问权限，但 Provider 请求仍能看到这类 host path。
- `local-subprocess` 不是安全隔离边界；运行不可信 Agent 时选择 E2B、Daytona、
  BoxRun/LiteBox 等隔离 provider。

## 验证

```bash
pnpm --filter @open-managed-agents/main-node typecheck

cd apps/main-node
pnpm exec vitest run \
  test/ai-sdk-harness-sandbox.test.ts \
  test/pi-harness-config.test.ts \
  test/ai-sdk-harness-driver.test.ts \
  test/harness-routing.test.ts \
  --config vitest.config.ts
```

`harness-routing.test.ts` 会启动真实 main-node 和本地假 Provider，经公开 Session API
验证：Pi tool call 写入当前 Session sandbox、第二次模型调用完成、Session 回到
`idle`、main-node 重启后从上一个 checkpoint 继续，并且 API Key 不出现在
sandbox 或 event log。
