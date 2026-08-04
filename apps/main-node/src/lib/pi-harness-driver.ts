import {
  HarnessAgent,
  type HarnessAgentResumeSessionState,
  type HarnessAgentSession,
} from "@ai-sdk/harness/agent";
import type {
  HarnessV1,
  HarnessV1SandboxProvider,
  HarnessV1Session,
  HarnessV1Skill,
  HarnessV1StreamPart,
} from "@ai-sdk/harness";
import type { PiHarnessSettings } from "@ai-sdk/harness-pi";
import type { HarnessRuntime } from "@open-managed-agents/agent/harness/interface";
import {
  emitToolCallEvent,
  emitToolResultEvent,
} from "@open-managed-agents/agent/harness/default-loop";
import type { SessionEvent, UserMessageEvent } from "@open-managed-agents/shared";
import { generateEventId } from "@open-managed-agents/shared";

export type NodeHarness = "default" | "pi";

const PI_RESUME_STATE_PATH = "/workspace/.openma/pi-resume.json";
const PI_SESSION_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl?$/;

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function toOpenMaToolInput(value: unknown, harnessRoot: string, key?: string): unknown {
  if (typeof value === "string") {
    if (key === "command") return value.replaceAll(harnessRoot, "/workspace");
    return value === harnessRoot || value.startsWith(`${harnessRoot}/`)
      ? `/workspace${value.slice(harnessRoot.length)}`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toOpenMaToolInput(item, harnessRoot));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        toOpenMaToolInput(item, harnessRoot, name),
      ]),
    );
  }
  return value;
}

/** Make Pi expose only the host tools supplied by OpenMA.
 *
 * ponytail: harness-pi currently resets its translator builtin set on every
 * turn, even when filtering disabled all builtins. Remove the emit wrapper
 * once upstream preserves the filtered set in runTurn(). */
export function routePiToolsThroughOpenMa(pi: HarnessV1): HarnessV1 {
  const wrapSession = (session: HarnessV1Session): HarnessV1Session => {
    const hostEmit = (emit: (part: HarnessV1StreamPart) => void) =>
      (part: HarnessV1StreamPart) => {
        if (part.type !== "tool-call") {
          emit(part);
          return;
        }
        const { providerExecuted: _providerExecuted, ...hostToolCall } = part;
        emit(hostToolCall as HarnessV1StreamPart);
      };
    return {
      ...session,
      doPromptTurn: (options) =>
        session.doPromptTurn({ ...options, emit: hostEmit(options.emit) }),
      doContinueTurn: (options) =>
        session.doContinueTurn({ ...options, emit: hostEmit(options.emit) }),
    };
  };

  return {
    ...pi,
    builtinTools: {},
    doStart: async (options) => wrapSession(await pi.doStart({
      ...options,
      builtinToolFiltering: { mode: "allow", toolNames: [] },
    })),
  };
}

export function resolveNodeHarness(harness: string | undefined): NodeHarness {
  const selected = harness ?? "default";
  if (selected === "default" || selected === "pi") return selected;
  throw new Error(
    `Unsupported Node harness "${selected}". Supported harnesses: default, pi`,
  );
}

interface PiModelCardInput {
  model: string;
  provider: string;
  base_url?: string | null;
  custom_headers?: Record<string, string> | null;
}

interface PiModelsJson {
  providers: Record<
    string,
    {
      baseUrl: string;
      api: "anthropic-messages" | "openai-completions";
      authHeader: boolean;
      headers?: Record<string, string>;
      models: Array<{ id: string }>;
    }
  >;
}

interface AiSdkHarnessDriverOptions {
  harness: HarnessV1;
  sandbox: HarnessV1SandboxProvider;
  workDir: string;
  sessionId: string;
  runtime: HarnessRuntime;
  tools: Record<string, any>;
  instructions: string;
  modelId?: string;
  skills?: ReadonlyArray<HarnessV1Skill>;
}

function toTextPrompt(message: UserMessageEvent): string {
  if (message.content.some((part) => part.type !== "text")) {
    throw new Error("Pi harness currently supports text-only user messages");
  }
  return message.content.map((part) => part.type === "text" ? part.text : "").join("\n");
}

/** Stateful bridge from one OpenMA session to one official HarnessV1 session. */
export class AiSdkHarnessDriver {
  private agent?: HarnessAgent<any, any>;
  private session?: HarnessAgentSession;
  private activeAbort?: AbortController;
  private resumeState?: HarnessAgentResumeSessionState;
  private resumeStateLoaded = false;

  constructor(private options: AiSdkHarnessDriverOptions) {}

  async run(message: UserMessageEvent): Promise<void> {
    const prompt = toTextPrompt(message);
    if (this.activeAbort) throw new Error("Harness turn is already running");

    const abort = new AbortController();
    this.activeAbort = abort;

    const text = new Map<string, string>();
    const reasoning = new Map<string, string>();
    const liveToolInput = new Set<string>();
    let stepStartId: string | undefined;
    const modelId = this.options.modelId ?? "unknown";

    const abortLiveStreams = async () => {
      for (const id of text.keys()) {
        await this.options.runtime.broadcastStreamEnd(id, "aborted");
      }
      for (const id of reasoning.keys()) {
        await this.options.runtime.broadcastThinkingEnd(id, "aborted");
      }
      for (const id of liveToolInput) {
        await this.options.runtime.broadcastToolInputEnd(id, "aborted");
      }
      text.clear();
      reasoning.clear();
      liveToolInput.clear();
    };

    try {
      const agent = this.getAgent();
      const session = await this.getSession(abort.signal);
      const result = await agent.stream({
        session,
        prompt,
        abortSignal: abort.signal,
      });
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "start":
            break;
          case "start-step":
            stepStartId = generateEventId();
            this.options.runtime.broadcast({
              type: "span.model_request_start",
              id: stepStartId,
              model: modelId,
            });
            break;
          case "text-start":
            text.set(part.id, "");
            await this.options.runtime.broadcastStreamStart(part.id);
            break;
          case "text-delta":
            text.set(part.id, `${text.get(part.id) ?? ""}${part.text}`);
            await this.options.runtime.broadcastChunk(part.id, part.text);
            break;
          case "text-end": {
            const value = text.get(part.id) ?? "";
            text.delete(part.id);
            await this.options.runtime.broadcastStreamEnd(part.id, "completed");
            this.options.runtime.broadcast({
              type: "agent.message",
              message_id: part.id,
              content: [{ type: "text", text: value.replace(/\s+$/, "") }],
            });
            break;
          }
          case "reasoning-start":
            reasoning.set(part.id, "");
            await this.options.runtime.broadcastThinkingStart(part.id);
            break;
          case "reasoning-delta":
            reasoning.set(part.id, `${reasoning.get(part.id) ?? ""}${part.text}`);
            await this.options.runtime.broadcastThinkingChunk(part.id, part.text);
            break;
          case "reasoning-end": {
            const value = reasoning.get(part.id) ?? "";
            reasoning.delete(part.id);
            await this.options.runtime.broadcastThinkingEnd(part.id, "completed");
            this.options.runtime.broadcast({
              type: "agent.thinking",
              text: value,
              thinking_id: part.id,
            } as SessionEvent);
            break;
          }
          case "tool-input-start":
            liveToolInput.add(part.id);
            await this.options.runtime.broadcastToolInputStart(part.id, part.toolName);
            break;
          case "tool-input-delta":
            if (!liveToolInput.has(part.id)) {
              liveToolInput.add(part.id);
              await this.options.runtime.broadcastToolInputStart(part.id);
            }
            await this.options.runtime.broadcastToolInputChunk(part.id, part.delta);
            break;
          case "tool-input-end":
            if (liveToolInput.delete(part.id)) {
              await this.options.runtime.broadcastToolInputEnd(part.id, "completed");
            }
            break;
          case "tool-call":
            emitToolCallEvent(
              this.options.runtime,
              this.options.tools,
              part as never,
            );
            break;
          case "tool-result":
          case "tool-error":
            emitToolResultEvent(this.options.runtime, part as never);
            break;
          case "finish-step":
            this.options.runtime.broadcast({
              type: "span.model_request_end",
              model: modelId,
              model_request_start_id: stepStartId,
              model_usage: {
                input_tokens: part.usage.inputTokens ?? 0,
                output_tokens: part.usage.outputTokens ?? 0,
                cache_read_input_tokens: part.usage.inputTokenDetails?.cacheReadTokens ?? 0,
                cache_creation_input_tokens: part.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
              },
              finish_reason: part.finishReason,
              final_text_length: 0,
              is_error: false,
            });
            stepStartId = undefined;
            break;
          case "finish":
            await this.options.runtime.reportUsage?.(
              part.totalUsage.inputTokens ?? 0,
              part.totalUsage.outputTokens ?? 0,
            );
            break;
          case "abort":
            await abortLiveStreams();
            break;
          case "error":
            throw part.error;
        }
      }
      await this.options.runtime.flush?.();
      await this.checkpointSession();
    } catch (error) {
      await abortLiveStreams();
      if (stepStartId) {
        this.options.runtime.broadcast({
          type: "span.model_request_end",
          model: modelId,
          model_request_start_id: stepStartId,
          finish_reason: "error",
          final_text_length: 0,
          is_error: true,
          error_message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        });
      }
      await this.options.runtime.flush?.();
      throw error;
    } finally {
      if (this.activeAbort === abort) this.activeAbort = undefined;
    }
  }

  interrupt(): void {
    this.activeAbort?.abort(new Error("Harness turn interrupted"));
  }

  async close(): Promise<void> {
    this.interrupt();
    await this.session?.destroy();
    this.session = undefined;
  }

  private getAgent(): HarnessAgent<any, any> {
    const pendingClientTools = Object.entries(this.options.tools)
      .filter(([, tool]) => typeof tool?.execute !== "function")
      .map(([name]) => name);
    if (pendingClientTools.length > 0) {
      throw new Error(
        `Pi harness currently requires executable OpenMA tools: ${pendingClientTools.join(", ")}`,
      );
    }
    const harnessRoot = `/${this.options.workDir.replace(/^\/+/, "")}`;
    const tools = Object.fromEntries(
      Object.entries(this.options.tools).map(([name, tool]) => [
        name,
        {
          ...tool,
          execute: (input: unknown, options: unknown) =>
            tool.execute(toOpenMaToolInput(input, harnessRoot), options),
        },
      ]),
    );
    return this.agent ??= new HarnessAgent({
      harness: this.options.harness,
      sandbox: this.options.sandbox,
      sandboxConfig: { workDir: this.options.workDir },
      tools,
      activeTools: Object.keys(tools),
      instructions: this.options.instructions,
      skills: this.options.skills,
      permissionMode: "allow-all",
    } as any);
  }

  private async getSession(abortSignal: AbortSignal): Promise<HarnessAgentSession> {
    if (this.session) return this.session;
    if (!this.resumeStateLoaded) {
      try {
        const resumeState = JSON.parse(
          await this.options.runtime.sandbox.readFile(PI_RESUME_STATE_PATH),
        ) as HarnessAgentResumeSessionState;
        await this.verifyPiResumeState(resumeState);
        this.resumeState = resumeState;
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code !== "ENOENT" && !String(error).includes("ENOENT")) throw error;
      }
      this.resumeStateLoaded = true;
    }
    this.session = await this.getAgent().createSession({
      sessionId: this.options.sessionId,
      ...(this.resumeState ? { resumeFrom: this.resumeState } : {}),
      abortSignal,
    });
    return this.session;
  }

  private async checkpointSession(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const previousJournal = this.resumeState
      ? await this.verifyPiResumeState(this.resumeState)
      : undefined;
    let state: HarnessAgentResumeSessionState;
    try {
      state = await session.stop();
    } finally {
      this.session = undefined;
    }
    const journal = await this.verifyPiResumeState(state);
    if (previousJournal && journal && bytesEqual(previousJournal, journal)) {
      throw new Error("Pi resume journal was not updated for the completed turn");
    }
    const checkpointSandbox = await this.options.sandbox.createSession({
      sessionId: this.options.sessionId,
    });
    await checkpointSandbox.restricted().writeTextFile({
      path: PI_RESUME_STATE_PATH,
      content: JSON.stringify(state),
    });
    this.resumeState = state;
    this.resumeStateLoaded = true;
  }

  private async verifyPiResumeState(
    state: HarnessAgentResumeSessionState,
  ): Promise<Uint8Array | undefined> {
    if (this.options.harness.harnessId !== "pi") return undefined;
    const data = state && typeof state === "object" && state.data && typeof state.data === "object"
      ? state.data as { sessionFileName?: unknown }
      : {};
    const sessionFileName = data.sessionFileName;
    if (typeof sessionFileName !== "string" || !PI_SESSION_FILE_NAME.test(sessionFileName)) {
      throw new Error("Pi resume checkpoint has no valid sessionFileName");
    }
    const path = `/workspace/.pi-sessions/${sessionFileName}`;
    try {
      const content = this.options.runtime.sandbox.readFileBytes
        ? await this.options.runtime.sandbox.readFileBytes(path)
        : new TextEncoder().encode(await this.options.runtime.sandbox.readFile(path));
      if (content.byteLength === 0) throw new Error("journal is empty");
      return content;
    } catch (error) {
      throw new Error(`Pi resume journal is missing or empty: ${path}`, { cause: error });
    }
  }
}

export function toPiModelCardConfig(
  card: PiModelCardInput,
  apiKey: string,
): { settings: PiHarnessSettings; models: PiModelsJson } {
  const anthropic = card.provider === "ant" || card.provider === "ant-compatible";
  const openai = card.provider === "oai" || card.provider === "oai-compatible";
  if (!anthropic && !openai) {
    throw new Error(`Pi harness does not support Model Card provider "${card.provider}"`);
  }
  if (card.provider.endsWith("-compatible") && !card.base_url) {
    throw new Error(`Pi harness requires base_url for provider "${card.provider}"`);
  }

  const provider = anthropic ? "anthropic" : "openai";
  const baseUrl = card.base_url ??
    (anthropic ? "https://api.anthropic.com" : "https://api.openai.com/v1");
  const customEnv: Record<string, string> = anthropic
    ? {
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_BASE_URL: baseUrl,
        ...(card.provider === "ant-compatible"
          ? { ANTHROPIC_AUTH_TOKEN: apiKey }
          : {}),
      }
    : {
        OPENAI_API_KEY: apiKey,
        OPENAI_BASE_URL: baseUrl,
      };

  return {
    settings: {
      model: card.model,
      auth: { customEnv },
    },
    models: {
      providers: {
        [provider]: {
          baseUrl,
          api: anthropic ? "anthropic-messages" : "openai-completions",
          authHeader: openai,
          ...(card.custom_headers ? { headers: card.custom_headers } : {}),
          models: [{ id: card.model }],
        },
      },
    },
  };
}
