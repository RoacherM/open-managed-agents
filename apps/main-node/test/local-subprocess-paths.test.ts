// Path-resolution contract of LocalSubprocessSandbox.
//
// Regression suite for the sess-lfm5qnnh3nfjertm trace (2026-08-06). The
// file tools expose a workdir-rooted view (the jail @ai-sdk/harness-pi's
// VFS relies on), but the old resolvePath also re-rooted the workdir's OWN
// absolute path when an agent echoed it back from bash output, producing
// <workdir>/<workdir>/... double-prefix ENOENTs. Also locks the
// concurrency rule that outputs mounts stay per-session (no shared global
// /mnt symlink) and the $OMA_OUTPUTS_DIR bash contract.

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

  it("re-roots foreign absolute paths under the workdir (the jail contract pi VFS relies on)", async () => {
    const { base, workdir, sandbox } = await makeSandbox();
    // Writes land inside the jail, symmetric with reads —
    // @ai-sdk/harness-pi feeds guest paths (/home/user/.skills/...)
    // straight into the executor and depends on this mapping.
    await sandbox.writeFile("/home/user/.skills/s.md", "skill");
    expect(await readFile(join(workdir, "home", "user", ".skills", "s.md"), "utf8")).toBe("skill");
    expect(await sandbox.readFile("/home/user/.skills/s.md")).toBe("skill");
    // The jail also means a real host file outside the workdir is NOT
    // reachable through the file tools.
    const outside = join(base, "outside.txt");
    await fsWriteFile(outside, "leak?");
    await expect(sandbox.readFile(outside)).rejects.toThrow(/ENOENT/);
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
