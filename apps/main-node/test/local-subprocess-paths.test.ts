// Path-resolution contract of LocalSubprocessSandbox.
//
// Regression suite for the sess-lfm5qnnh3nfjertm trace (2026-08-06) where
// bash (unjailed) and the file tools (jailed) saw different filesystems:
// the old resolvePath silently re-rooted every foreign absolute path under
// the workdir, so reading a real host path bash had just written produced
// ENOENT — including the double-prefix form where the agent passed the
// workdir's own absolute path back in. Also locks the concurrency rule
// that outputs mounts stay per-session (no shared global /mnt symlink).

import { mkdtemp, readFile, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSubprocessSandbox } from "@open-managed-agents/sandbox/adapters/local-subprocess";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function makeSandbox(opts: { outputsRoot?: string } = {}) {
  const base = await mkdtemp(join(tmpdir(), "openma-subprocess-paths-"));
  const workdir = join(base, "sess_test");
  const sandbox = new LocalSubprocessSandbox({ workdir, ...opts });
  cleanups.push(async () => {
    await sandbox.destroy();
    await rm(base, { recursive: true, force: true });
  });
  return { base, workdir, sandbox };
}

describe("LocalSubprocessSandbox path resolution", () => {
  it("accepts absolute paths that already point inside the workdir verbatim", async () => {
    const { workdir, sandbox } = await makeSandbox();
    await sandbox.writeFile("report.txt", "hello");
    // The double-prefix regression: the agent reads back the real host
    // path bash printed. Old code produced <workdir>/<workdir>/report.txt.
    expect(await sandbox.readFile(join(workdir, "report.txt"))).toBe("hello");
  });

  it("rejects absolute paths outside the sandbox with a clear error instead of silently re-rooting", async () => {
    const { base, sandbox } = await makeSandbox();
    // A real file outside the workdir — old code would NOT read it but
    // also not fail clearly: it re-rooted to <workdir>/... and threw
    // ENOENT, gaslighting the agent about a file bash could see.
    const outside = join(base, "outside.txt");
    await fsWriteFile(outside, "leak?");
    await expect(sandbox.readFile(outside)).rejects.toThrow(/outside the session sandbox/);
    await expect(sandbox.writeFile("/home/nobody/x.txt", "x")).rejects.toThrow(
      /outside the session sandbox/,
    );
  });

  it("maps /workspace and relative paths into the workdir", async () => {
    const { workdir, sandbox } = await makeSandbox();
    await sandbox.writeFile("/workspace/nested/a.txt", "A");
    expect(await readFile(join(workdir, "nested", "a.txt"), "utf8")).toBe("A");
    expect(await sandbox.readFile("nested/a.txt")).toBe("A");
  });

  it("maps /mnt/session/outputs into the per-session outputs dir for tools AND bash env", async () => {
    const { base, workdir, sandbox } = await makeSandbox({
      outputsRoot: join((await mkdtemp(join(tmpdir(), "openma-outputs-root-"))), "outputs"),
    });
    void base;
    await sandbox.mountSessionOutputs({ tenantId: "t1", sessionId: "sess_test" });

    // File-tool side: virtual path lands in the outputs store.
    await sandbox.writeFile("/mnt/session/outputs/final.txt", "done");
    expect(await sandbox.readFile("/mnt/session/outputs/final.txt")).toBe("done");

    // Bash side: $OMA_OUTPUTS_DIR names the same directory. This is the
    // documented bash contract — there is intentionally no global
    // /mnt/session/outputs on a shared host (concurrent sessions would
    // clobber a single symlink and leak writes across sessions).
    const echoed = (await sandbox.exec('echo "$OMA_OUTPUTS_DIR"', 5000)).trim();
    expect(echoed).toBe(join(workdir, ".mnt", "session", "outputs"));
    await sandbox.exec('printf bash-side > "$OMA_OUTPUTS_DIR/from-bash.txt"', 5000);
    expect(await sandbox.readFile("/mnt/session/outputs/from-bash.txt")).toBe("bash-side");
  });
});
