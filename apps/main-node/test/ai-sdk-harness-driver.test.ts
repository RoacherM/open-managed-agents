import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessV1, HarnessV1StreamPart } from "@ai-sdk/harness";
import type { HarnessRuntime } from "@open-managed-agents/agent/harness/interface";
import type { SessionEvent, UserMessageEvent } from "@open-managed-agents/shared";
import { LocalSubprocessSandbox } from "@open-managed-agents/sandbox/adapters/local-subprocess";
import { createOpenMaHarnessSandbox } from "../src/lib/ai-sdk-harness-sandbox";
import { AiSdkHarnessDriver } from "../src/lib/pi-harness-driver";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function textMessage(text: string): UserMessageEvent {
  return { type: "user.message", content: [{ type: "text", text }] };
}

describe("AI SDK HarnessV1 driver", () => {
  it("checkpoints each completed turn and resumes it across driver instances", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "openma-harness-driver-"));
    const sandbox = new LocalSubprocessSandbox({ workdir });
    cleanups.push(async () => {
      await sandbox.destroy();
      await rm(workdir, { recursive: true, force: true });
    });
    const adapted = await createOpenMaHarnessSandbox({
      sandbox,
      sessionId: "sess_driver",
    });

    const starts: Array<{ sessionId: string; resumeFrom: unknown }> = [];
    const prompts: string[] = [];
    const lifecycle: string[] = [];
    let checkpoint = 0;
    const harness: HarnessV1 = {
      specificationVersion: "harness-v1",
      harnessId: "fake",
      builtinTools: {},
      doStart: async ({ sessionId, resumeFrom }) => {
        starts.push({ sessionId, resumeFrom });
        return {
          sessionId,
          isResume: resumeFrom !== undefined,
          doPromptTurn: async ({ prompt, emit }) => {
            const text = typeof prompt === "string" ? prompt : "non-text";
            prompts.push(text);
            const parts: HarnessV1StreamPart[] = [
              { type: "stream-start", modelId: "fake-model" },
              { type: "text-start", id: `text-${prompts.length}` },
              { type: "text-delta", id: `text-${prompts.length}`, delta: `reply:${text}` },
              { type: "text-end", id: `text-${prompts.length}` },
              { type: "finish-step", finishReason: { unified: "stop" }, usage },
              { type: "finish", finishReason: { unified: "stop" }, totalUsage: usage },
            ];
            for (const part of parts) emit(part);
            return {
              done: Promise.resolve(),
              submitToolResult: async () => {},
            };
          },
          doContinueTurn: async () => ({
            done: Promise.resolve(),
            submitToolResult: async () => {},
          }),
          doCompact: async () => {},
          doSuspendTurn: async () => ({
            type: "continue-turn",
            harnessId: "fake",
            specificationVersion: "harness-v1",
            data: {},
          }),
          doDetach: async () => ({
            type: "resume-session",
            harnessId: "fake",
            specificationVersion: "harness-v1",
            data: {},
          }),
          doStop: async () => {
            lifecycle.push("stop");
            return {
              type: "resume-session",
              harnessId: "fake",
              specificationVersion: "harness-v1",
              data: { checkpoint: ++checkpoint },
            };
          },
          doDestroy: async () => {},
        };
      },
    };

    const events: SessionEvent[] = [];
    const runtime = {
      broadcast: (event: SessionEvent) => events.push(event),
      broadcastStreamStart: vi.fn(async () => {}),
      broadcastChunk: vi.fn(async () => {}),
      broadcastStreamEnd: vi.fn(async () => {}),
      broadcastThinkingStart: vi.fn(async () => {}),
      broadcastThinkingChunk: vi.fn(async () => {}),
      broadcastThinkingEnd: vi.fn(async () => {}),
      broadcastToolInputStart: vi.fn(async () => {}),
      broadcastToolInputChunk: vi.fn(async () => {}),
      broadcastToolInputEnd: vi.fn(async () => {}),
      history: {} as HarnessRuntime["history"],
      sandbox,
      flush: vi.fn(async () => { lifecycle.push("flush"); }),
    } as HarnessRuntime & { flush(): Promise<void> };

    const driver = new AiSdkHarnessDriver({
      harness,
      sandbox: adapted.provider,
      workDir: adapted.workDir,
      sessionId: "sess_driver",
      runtime,
      tools: {},
      instructions: "test system",
    });

    await driver.run(textMessage("one"));
    await driver.run(textMessage("two"));

    const resumedDriver = new AiSdkHarnessDriver({
      harness,
      sandbox: adapted.provider,
      workDir: adapted.workDir,
      sessionId: "sess_driver",
      runtime,
      tools: {},
      instructions: "test system",
    });
    await resumedDriver.run(textMessage("three"));

    expect(starts).toEqual([
      { sessionId: "sess_driver", resumeFrom: undefined },
      {
        sessionId: "sess_driver",
        resumeFrom: expect.objectContaining({ data: { checkpoint: 1 } }),
      },
      {
        sessionId: "sess_driver",
        resumeFrom: expect.objectContaining({ data: { checkpoint: 2 } }),
      },
    ]);
    expect(prompts).toEqual(["one", "two", "three"]);
    expect(
      events
        .filter((event) => event.type === "agent.message")
        .map((event) => event.content),
    ).toEqual([
      [{ type: "text", text: "reply:one" }],
      [{ type: "text", text: "reply:two" }],
      [{ type: "text", text: "reply:three" }],
    ]);
    expect(runtime.flush).toHaveBeenCalledTimes(3);
    expect(lifecycle).toEqual(["flush", "stop", "flush", "stop", "flush", "stop"]);
  });

  it("rejects non-text OpenMA messages instead of dropping attachments", async () => {
    const driver = new AiSdkHarnessDriver({
      harness: {} as HarnessV1,
      sandbox: {} as never,
      workDir: "unused",
      sessionId: "sess_non_text",
      runtime: {} as HarnessRuntime,
      tools: {},
      instructions: "",
    });

    await expect(
      driver.run({
        type: "user.message",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "AA==" },
          },
        ],
      }),
    ).rejects.toThrow("Pi harness currently supports text-only user messages");
  });

  it("rejects tools that require client-side results instead of silently losing the pause", async () => {
    const driver = new AiSdkHarnessDriver({
      harness: {} as HarnessV1,
      sandbox: {} as never,
      workDir: "unused",
      sessionId: "sess_client_tool",
      runtime: {} as HarnessRuntime,
      tools: { send_email: { description: "client tool" } },
      instructions: "",
    });

    await expect(driver.run(textMessage("send it"))).rejects.toThrow(
      "Pi harness currently requires executable OpenMA tools: send_email",
    );
  });

  it("refuses a Pi resume state whose sandbox journal is missing", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "openma-harness-missing-journal-"));
    const sandbox = new LocalSubprocessSandbox({ workdir });
    cleanups.push(async () => {
      await sandbox.destroy();
      await rm(workdir, { recursive: true, force: true });
    });
    await sandbox.writeFile(
      "/workspace/.openma/pi-resume.json",
      JSON.stringify({
        type: "resume-session",
        harnessId: "pi",
        specificationVersion: "harness-v1",
        data: { sessionFileName: "missing.jsonl" },
      }),
    );
    const adapted = await createOpenMaHarnessSandbox({ sandbox, sessionId: "sess_missing" });
    const doStart = vi.fn();
    const driver = new AiSdkHarnessDriver({
      harness: {
        specificationVersion: "harness-v1",
        harnessId: "pi",
        builtinTools: {},
        doStart,
      } as HarnessV1,
      sandbox: adapted.provider,
      workDir: adapted.workDir,
      sessionId: "sess_missing",
      runtime: { sandbox } as HarnessRuntime,
      tools: {},
      instructions: "",
    });

    await expect(driver.run(textMessage("resume"))).rejects.toThrow(
      "Pi resume journal is missing or empty",
    );
    expect(doStart).not.toHaveBeenCalled();
  });

  it("rejects a completed Pi turn when stop leaves the previous journal unchanged", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "openma-harness-stale-journal-"));
    const sandbox = new LocalSubprocessSandbox({ workdir });
    cleanups.push(async () => {
      await sandbox.destroy();
      await rm(workdir, { recursive: true, force: true });
    });
    const resumeState = {
      type: "resume-session" as const,
      harnessId: "pi",
      specificationVersion: "harness-v1" as const,
      data: { sessionFileName: "stale.jsonl" },
    };
    await sandbox.writeFile("/workspace/.openma/pi-resume.json", JSON.stringify(resumeState));
    await sandbox.writeFile("/workspace/.pi-sessions/stale.jsonl", "previous-turn");
    const adapted = await createOpenMaHarnessSandbox({ sandbox, sessionId: "sess_stale" });
    const harness: HarnessV1 = {
      specificationVersion: "harness-v1",
      harnessId: "pi",
      builtinTools: {},
      doStart: async ({ sessionId }) => ({
        sessionId,
        isResume: true,
        doPromptTurn: async ({ emit }) => {
          for (const part of [
            { type: "stream-start", modelId: "fake-model" },
            { type: "text-start", id: "stale-text" },
            { type: "text-delta", id: "stale-text", delta: "reply" },
            { type: "text-end", id: "stale-text" },
            { type: "finish-step", finishReason: { unified: "stop" }, usage },
            { type: "finish", finishReason: { unified: "stop" }, totalUsage: usage },
          ] as HarnessV1StreamPart[]) emit(part);
          return { done: Promise.resolve(), submitToolResult: async () => {} };
        },
        doContinueTurn: async () => ({
          done: Promise.resolve(),
          submitToolResult: async () => {},
        }),
        doCompact: async () => {},
        doSuspendTurn: async () => ({
          type: "continue-turn",
          harnessId: "pi",
          specificationVersion: "harness-v1",
          data: resumeState.data,
        }),
        doDetach: async () => resumeState,
        doStop: async () => resumeState,
        doDestroy: async () => {},
      }),
    };
    const driver = new AiSdkHarnessDriver({
      harness,
      sandbox: adapted.provider,
      workDir: adapted.workDir,
      sessionId: "sess_stale",
      runtime: {
        sandbox,
        broadcast: () => {},
        broadcastStreamStart: async () => {},
        broadcastChunk: async () => {},
        broadcastStreamEnd: async () => {},
        history: {} as HarnessRuntime["history"],
      } as HarnessRuntime,
      tools: {},
      instructions: "",
    });

    await expect(driver.run(textMessage("new turn"))).rejects.toThrow(
      "Pi resume journal was not updated for the completed turn",
    );
  });
});
