# Architecture: Meta-Harness Design

> This document defines the design contract; interface snippets below are
> conceptual. For the current code topology, Cloudflare/Node runtime split,
> and known implementation gaps, see
> [architecture-overview.md](./architecture-overview.md).

> "We're opinionated about the shape of these interfaces, not about what runs behind them."
> — [Scaling Managed Agents: Decoupling the brain from the hands](https://www.anthropic.com/engineering/managed-agents)

## What is a Meta-Harness

Managed Agents is itself a **meta-harness** — not a specific agent implementation, but a platform that defines stable interfaces for any agent to use. It's unopinionated about _which_ harness Claude needs, but opinionated about the primitives every harness requires:

1. **Session** — an append-only event log for durable state
2. **Sandbox** — a compute environment where tools execute
3. **Vault** — secure credential storage and injection on controlled outbound paths

A harness is pluggable. The platform provides capabilities; the harness provides strategy.

## Three Layers

```
┌─────────────────────────────────────────────────────────┐
│  Harness (pluggable agent loop)                         │
│  - Reads events, builds context, calls a model provider │
│  - Decides HOW to use tools, skills, cache, compaction  │
│  - Rebuilds durable context after runtime recovery      │
├─────────────────────────────────────────────────────────┤
│  Meta-Harness / Platform (Session runtime)              │
│  - Defines interfaces: session, sandbox, vault          │
│  - Prepares WHAT is available: tools, skills, history   │
│  - Manages lifecycle: sandbox warmup, event persistence │
├─────────────────────────────────────────────────────────┤
│  Infrastructure adapters                               │
│  - Cloudflare: DO / D1 / KV / R2 / Containers           │
│  - Self-host: SQLite or Postgres / FS or S3 / sandboxes │
└─────────────────────────────────────────────────────────┘
```

## Platform vs. Harness Responsibilities

The dividing line: **the platform prepares _what is available_, the harness decides _how to deliver it_ to the model.**

### Platform (session runtime) prepares:

| Responsibility                       | Interface                                      |
| ------------------------------------ | ---------------------------------------------- |
| Register tools from agent config     | `buildTools(agent, sandbox) → tools`           |
| Mount skill files into sandbox       | `sandbox.writeFile('/home/user/.skills/...')`  |
| Mount memory stores                  | `sandbox.mountMemoryStore(...)`                |
| Resolve model and base system prompt | `model`, `systemPrompt` in `HarnessContext`    |
| Manage sandbox lifecycle             | `getOrCreateSandbox()`, `warmUpSandbox()`      |
| Persist events durably               | `history.append(event)`                        |
| Broadcast to live stream clients     | `broadcastEvent(event)`                        |
| Track session status                 | `idle → running → idle`                        |
| Handle harness crash recovery        | catch error → `session.error` → return to idle |

### Harness (agent loop) decides:

| Responsibility      | Why it's a harness concern                                        |
| ------------------- | ----------------------------------------------------------------- |
| Prompt strategy     | Whether to use or replace the platform-prepared base prompt       |
| Cache strategy      | Where to put `cache_control: ephemeral` breakpoints               |
| Compaction strategy | When to compress, what to keep (summarize vs. sliding window)     |
| Context engineering | How to transform events into messages, ordering, filtering        |
| Retry strategy      | How many retries, what counts as transient, backoff curve         |
| Tool delivery       | All tools at once vs. progressive disclosure                      |
| Step handling       | What to broadcast on each step (thinking, tool_use, message)      |
| Stop conditions     | When the agent is "done" (max steps, user.message_required, etc.) |

## Key Interfaces

### Session Interface

```typescript
interface HistoryStore {
  getMessages(): ModelMessage[]; // Events → AI SDK message format
  append(event: SessionEvent): void; // Durable write to SQLite
  getEvents(afterSeq?: number): SessionEvent[]; // Positional slicing
}
```

The event log enables:

- **Crash recovery**: `wake(sessionId)` → `getEvents()` → rebuild context → resume
- **Replay**: New WebSocket clients receive full event history
- **Flexibility**: Harness can rewind, skip, or transform events before passing to Claude

### Sandbox Interface

```typescript
interface SandboxExecutor {
  exec(command: string, timeout?: number): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<string>;
}
```

A tool call maps to a sandbox or platform service capability and may return text
or structured media content. The harness does not need to know whether the
sandbox is a Cloudflare Container, an isolated remote provider, or a trusted
local subprocess.

### HarnessContext (what the platform gives to the harness)

```typescript
interface HarnessContext {
  agent: AgentConfig; // Model, system prompt, tool config
  userMessage: UserMessageEvent; // The trigger message
  model: LanguageModel; // Resolved by the platform
  tools: Record<string, Tool>; // Built by the platform
  systemPrompt: string; // Platform-augmented base prompt
  runtime: {
    history: HistoryStore; // Read/write the event log
    sandbox: SandboxExecutor; // Execute commands, read/write files
    broadcast: (event: SessionEvent) => void; // Push to WebSocket clients
    reportUsage?: (input: number, output: number) => Promise<void>;
    abortSignal?: AbortSignal; // User interruption
  };
}
```

## The Brain is Stateless

A harness holds no state. Everything it needs comes from:

1. The **event log** (conversation history)
2. The **agent config** (model, tools, system prompt)
3. The **sandbox** (file system, running processes)

When a harness crashes, the runtime reconciles the orphan turn from durable
events, returns the session to `idle`, and lets the next turn rebuild model
context. This is recoverable execution, not instruction-level or exactly-once
resume; interrupted streams and tools may require partial or placeholder events.

## The Hands are Cattle

Containers are interchangeable. A failed container can be replaced with `provision({resources})` — same packages installed, same files mounted, fresh state.

Key design decisions:

- **Lazy provisioning**: Containers are created on first tool call, not at session start. Sessions that don't need code execution skip the container cost entirely.
- **Parallel start**: Inference begins immediately from the event log. Container provisioning happens in background. By the time Claude makes its first tool call, the container is usually ready.
- **Vault credentials stay outside the sandbox**: sandbox outbound traffic goes through a credential proxy that injects matching authentication. This guarantee applies to Vault-managed credentials; it does not sanitize arbitrary host environment variables, and the self-host `local-subprocess` adapter is not a security boundary. Full details + threat model are in [mcp-credential-architecture.md](./mcp-credential-architecture.md).

## Implications for Custom Harnesses

Because the platform handles infrastructure, an in-process custom harness is simple:

```typescript
class ResearchHarness implements HarnessInterface {
  async run(ctx: HarnessContext): Promise<void> {
    // Platform already prepared: tools, skills, sandbox, history
    // I just decide HOW to use them

    const messages = ctx.runtime.history.getMessages();
    // My custom context engineering: keep all web_search results
    // but summarize tool_result blocks aggressively

    const result = await generateText({
      model: ctx.model,
      messages: myCustomTransform(messages),
      tools: ctx.tools, // Already built by platform
      maxSteps: 50, // Research needs more steps
    });
  }
}
```

A coding harness might use plan-then-execute with aggressive caching.
A data analysis harness might use streaming with custom compaction that preserves DataFrames.
A research harness might use web search with citation tracking.

These in-process harnesses get the same platform capabilities and differ in strategy. The Node runtime currently dispatches `default` and the official HarnessV1-backed `pi` implementation; this is an explicit allowlist, not arbitrary runtime plugin loading. External-agent bridges such as `acp-proxy` remain a separate path and own their model, context, and tools.

## Current Implementation Notes

Current implementation details, package layering, runtime differences, and
known gaps are maintained in
[architecture-overview.md](./architecture-overview.md). Keep this document
focused on the stable design contract.

## References

- [Scaling Managed Agents: Decoupling the brain from the hands](https://www.anthropic.com/engineering/managed-agents) — Anthropic engineering blog
- [Claude Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview) — API documentation
- [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — Skills architecture
