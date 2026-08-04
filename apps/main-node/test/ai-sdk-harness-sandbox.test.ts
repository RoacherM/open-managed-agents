import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSubprocessSandbox } from "@open-managed-agents/sandbox/adapters/local-subprocess";
import type { SandboxExecutor } from "@open-managed-agents/sandbox";
import { createOpenMaHarnessSandbox } from "../src/lib/ai-sdk-harness-sandbox";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("AI SDK harness sandbox adapter", () => {
  it("keeps HarnessV1 file and shell operations inside the OpenMA session sandbox", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "openma-harness-sandbox-"));
    const sandbox = new LocalSubprocessSandbox({ workdir });
    cleanups.push(async () => {
      await sandbox.destroy();
      await rm(workdir, { recursive: true, force: true });
    });

    const adapted = await createOpenMaHarnessSandbox({
      sandbox,
      sessionId: "sess_test",
    });
    const second = await createOpenMaHarnessSandbox({
      sandbox,
      sessionId: "sess_other",
    });
    const session = await adapted.provider.createSession({
      sessionId: "sess_test",
    });
    const restricted = session.restricted();
    const target = join(workdir, "nested", "marker.txt");

    await restricted.writeTextFile({
      path: "/workspace/nested/marker.txt",
      content: "sandbox-only",
    });
    expect(await restricted.readTextFile({ path: "/workspace/nested/marker.txt" })).toBe(
      "sandbox-only",
    );
    expect(await readFile(target, "utf8")).toBe("sandbox-only");

    const shellWrite = await restricted.run({
      command: "printf shell > shell-marker.txt",
      workingDirectory: "/workspace",
    });
    expect(shellWrite.exitCode).toBe(0);
    expect(await readFile(join(workdir, "shell-marker.txt"), "utf8")).toBe("shell");
    expect(session.defaultWorkingDirectory).toBe("/");
    expect(adapted.workDir).not.toBe(second.workDir);
  });

  it("does not pass host auth values into sandbox commands", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "openma-harness-auth-"));
    const sandbox = new LocalSubprocessSandbox({ workdir });
    cleanups.push(async () => {
      await sandbox.destroy();
      await rm(workdir, { recursive: true, force: true });
    });

    const adapted = await createOpenMaHarnessSandbox({
      sandbox,
      sessionId: "sess_auth",
    });
    const session = await adapted.provider.createSession();
    const result = await session.restricted().run({
      command: "printf '%s' \"${OPENMA_TEST_MODEL_KEY-unset}\"",
    });

    expect(result.stdout).toBe("unset");
  });

  it("keeps the previous journal when a replacement write is interrupted", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "openma-harness-atomic-"));
    const sandbox = new LocalSubprocessSandbox({ workdir });
    cleanups.push(async () => {
      await sandbox.destroy();
      await rm(workdir, { recursive: true, force: true });
    });
    await sandbox.writeFile(".pi-sessions/checkpoint.jsonl", "previous-checkpoint");
    await sandbox.writeFile(".openma/pi-resume.json", "previous-resume-state");
    const interrupted = {
      exec: (command: string, timeout?: number) => sandbox.exec(command, timeout),
      readFile: (path: string) => sandbox.readFile(path),
      readFileBytes: (path: string) => sandbox.readFileBytes(path),
      writeFile: async (path: string, content: string) => {
        await sandbox.writeFile(path, content.slice(0, 3));
        throw new Error("simulated interrupted write");
      },
      writeFileBytes: async (path: string, bytes: Uint8Array) => {
        await sandbox.writeFileBytes(path, bytes.subarray(0, 3));
        throw new Error("simulated interrupted write");
      },
    } satisfies SandboxExecutor;
    const adapted = await createOpenMaHarnessSandbox({
      sandbox: interrupted,
      sessionId: "sess_atomic",
    });
    const session = await adapted.provider.createSession();

    await expect(session.restricted().writeBinaryFile({
      path: `${adapted.workDir.startsWith("/") ? "" : "/"}${adapted.workDir}/.pi-sessions/checkpoint.jsonl`,
      content: new TextEncoder().encode("next-checkpoint"),
    })).rejects.toThrow("simulated interrupted write");
    expect(await sandbox.readFile(".pi-sessions/checkpoint.jsonl")).toBe(
      "previous-checkpoint",
    );
    await expect(session.restricted().writeTextFile({
      path: "/workspace/.openma/pi-resume.json",
      content: "next-resume-state",
    })).rejects.toThrow("simulated interrupted write");
    expect(await sandbox.readFile(".openma/pi-resume.json")).toBe(
      "previous-resume-state",
    );
  });
});
