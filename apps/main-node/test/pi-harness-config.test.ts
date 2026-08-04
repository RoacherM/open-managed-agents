import { describe, expect, it } from "vitest";
import {
  resolveNodeHarness,
  routePiToolsThroughOpenMa,
  toPiModelCardConfig,
} from "../src/lib/pi-harness-driver";
import type { HarnessV1, HarnessV1StreamPart } from "@ai-sdk/harness";

describe("Pi harness configuration", () => {
  it("selects only the Node harnesses implemented by this runtime", () => {
    expect(resolveNodeHarness(undefined)).toBe("default");
    expect(resolveNodeHarness("default")).toBe("default");
    expect(resolveNodeHarness("pi")).toBe("pi");
    expect(() => resolveNodeHarness("does-not-exist")).toThrow(
      'Unsupported Node harness "does-not-exist"',
    );
  });

  it("maps an OpenAI-compatible Model Card without persisting its API key", () => {
    const apiKey = "secret-deepseek-key";
    const config = toPiModelCardConfig(
      {
        model: "deepseek-v4-pro[1m]",
        provider: "oai-compatible",
        base_url: "https://api.deepseek.com/v1",
        custom_headers: { "x-tenant": "local" },
      },
      apiKey,
    );

    expect(config.settings.model).toBe("deepseek-v4-pro[1m]");
    expect(config.settings.auth?.customEnv).toEqual({
      OPENAI_API_KEY: apiKey,
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
    });
    expect(config.models.providers.openai).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com/v1",
      authHeader: true,
      headers: { "x-tenant": "local" },
      models: [{ id: "deepseek-v4-pro[1m]" }],
    });
    expect(JSON.stringify(config.models)).not.toContain(apiKey);
  });

  it("uses bearer auth for an Anthropic-compatible proxy", () => {
    const config = toPiModelCardConfig(
      {
        model: "deepseek-v4-pro[1m]",
        provider: "ant-compatible",
        base_url: "https://api.deepseek.com/anthropic",
      },
      "secret-anthropic-compatible-key",
    );

    expect(config.settings.auth?.customEnv).toMatchObject({
      ANTHROPIC_API_KEY: "secret-anthropic-compatible-key",
      ANTHROPIC_AUTH_TOKEN: "secret-anthropic-compatible-key",
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    });
    expect(config.models.providers.anthropic.api).toBe("anthropic-messages");
    expect(JSON.stringify(config.models)).not.toContain(
      "secret-anthropic-compatible-key",
    );
  });

  it("disables Pi builtins and reclassifies the remaining calls as OpenMA host tools", async () => {
    let filtering: unknown;
    const pi = {
      specificationVersion: "harness-v1",
      harnessId: "pi",
      builtinTools: { write: {} },
      doStart: async (options) => {
        filtering = options.builtinToolFiltering;
        return {
          sessionId: options.sessionId,
          isResume: false,
          doPromptTurn: async ({ emit }) => {
            emit({
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "write",
              input: "{}",
              providerExecuted: true,
            });
            return { done: Promise.resolve(), submitToolResult: async () => {} };
          },
          doContinueTurn: async () => ({ done: Promise.resolve(), submitToolResult: async () => {} }),
          doCompact: async () => {},
          doSuspendTurn: async () => ({} as never),
          doDetach: async () => ({} as never),
          doStop: async () => ({} as never),
          doDestroy: async () => {},
        };
      },
    } as HarnessV1;
    const routed = routePiToolsThroughOpenMa(pi);
    const session = await routed.doStart({ sessionId: "sess", } as never);
    const parts: HarnessV1StreamPart[] = [];
    await session.doPromptTurn({
      prompt: "hello",
      emit: (part) => parts.push(part),
    }).then((control) => control.done);

    expect(routed.builtinTools).toEqual({});
    expect(filtering).toEqual({ mode: "allow", toolNames: [] });
    expect(parts).toEqual([{
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "write",
      input: "{}",
    }]);
  });
});
