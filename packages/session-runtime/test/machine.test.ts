import { describe, expect, it } from "vitest";
import { SessionStateMachine } from "../src/machine";
import type { RuntimeAdapter } from "../src/ports";
import type { SandboxExecutor } from "@open-managed-agents/sandbox";
import type { AgentConfig, UserMessageEvent } from "@open-managed-agents/shared";

const agent: AgentConfig = {
  id: "agent_pi",
  name: "Pi agent",
  model: "deepseek-v4-pro[1m]",
  system: "Be helpful.",
  tools: [],
  harness: "pi",
};

const message: UserMessageEvent = {
  type: "user.message",
  content: [{ type: "text", text: "hello" }],
};

describe("SessionStateMachine harness preparation", () => {
  it("lets the runtime prepare a turn for the selected harness without assuming an AI SDK model", async () => {
    const calls: string[] = [];
    const adapter = {
      beginTurn: async () => {
        calls.push("begin");
      },
      endTurn: async (_sessionId: string, _turnId: string, status: string) => {
        calls.push(`end:${status}`);
      },
      listOrphanTurns: async () => [],
    } as unknown as RuntimeAdapter;
    const sandbox = {} as SandboxExecutor;

    const machine = new SessionStateMachine({
      sessionId: "sess_pi",
      tenantId: "default",
      adapter,
      sandbox,
      loadAgent: async () => agent,
      prepareTurn: async ({ agent: selectedAgent, userMessage, sandbox: selectedSandbox }) => {
        expect(selectedAgent).toBe(agent);
        expect(userMessage).toBe(message);
        expect(selectedSandbox).toBe(sandbox);
        calls.push(`prepare:${selectedAgent.harness}`);
        return {
          run: async () => {
            calls.push("run");
          },
        };
      },
      publish: () => {},
    });

    await machine.runHarnessTurn(agent.id, message);

    expect(calls).toEqual(["begin", "prepare:pi", "run", "end:idle"]);
  });

  it("runs accepted messages in FIFO order instead of dropping a concurrent turn", async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve; });
    const adapter = {
      beginTurn: async () => { calls.push("begin"); },
      endTurn: async (_sessionId: string, _turnId: string, status: string) => {
        calls.push(`end:${status}`);
      },
      listOrphanTurns: async () => [],
    } as unknown as RuntimeAdapter;
    const machine = new SessionStateMachine({
      sessionId: "sess_fifo",
      tenantId: "default",
      adapter,
      sandbox: {} as SandboxExecutor,
      loadAgent: async () => agent,
      prepareTurn: async ({ userMessage }) => {
        const text = userMessage.content[0]?.type === "text"
          ? userMessage.content[0].text
          : "";
        calls.push(`prepare:${text}`);
        return {
          run: async () => {
            calls.push(`run:${text}`);
            if (text === "one") {
              markFirstStarted();
              await firstGate;
            } else {
              markSecondStarted();
              await secondGate;
            }
          },
        };
      },
      publish: () => {},
    });
    const first = machine.runHarnessTurn(agent.id, {
      type: "user.message",
      content: [{ type: "text", text: "one" }],
    });
    await firstStarted;
    const second = machine.runHarnessTurn(agent.id, {
      type: "user.message",
      content: [{ type: "text", text: "two" }],
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).not.toContain("run:two");

    releaseFirst();
    await secondStarted;
    expect(machine.hasInflightTurn()).toBe(true);
    expect(calls).toEqual([
      "begin",
      "prepare:one",
      "run:one",
      "end:idle",
      "begin",
      "prepare:two",
      "run:two",
    ]);

    releaseSecond();
    await Promise.all([first, second]);
    expect(machine.hasInflightTurn()).toBe(false);
    expect(calls.at(-1)).toBe("end:idle");
  });
});
