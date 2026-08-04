import { posix } from "node:path";
import type {
  HarnessV1NetworkSandboxSession,
  HarnessV1SandboxProvider,
} from "@ai-sdk/harness";
import type { SandboxExecutor } from "@open-managed-agents/sandbox";

export interface OpenMaHarnessSandbox {
  provider: HarnessV1SandboxProvider;
  /** Relative directory passed to HarnessAgent so Pi uses the existing
   * OpenMA session root instead of creating a second workspace. */
  workDir: string;
}

const PUBLIC_WORK_DIR = "/workspace";
const VIRTUAL_HARNESS_ROOT = "/.openma-harness";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isMissingFile(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "ENOENT" || String(error).includes("not found");
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Wrap the already-provisioned OpenMA sandbox in the official HarnessV1
 * sandbox contract. OpenMA remains the lifecycle owner; HarnessAgent stop /
 * destroy therefore only tears down the harness session, not the sandbox. */
export async function createOpenMaHarnessSandbox(input: {
  sandbox: SandboxExecutor;
  sessionId: string;
}): Promise<OpenMaHarnessSandbox> {
  const rawCwd = (await input.sandbox.exec("pwd", 5_000)).trim();
  if (!posix.isAbsolute(rawCwd)) {
    throw new Error(
      `OpenMA harness sandbox expected an absolute working directory, got ${JSON.stringify(rawCwd)}`,
    );
  }
  const nativeWorkDir = rawCwd.replace(/\/+$/, "") || "/";
  if (!input.sessionId) throw new Error("OpenMA harness sandbox requires a session id");
  // harness-pi patches Node fs process-wide, so every concurrent Pi session
  // must use a distinct logical mount even though each maps to its own
  // canonical OpenMA /workspace root.
  const virtualWorkDir = posix.join(VIRTUAL_HARNESS_ROOT, encodeURIComponent(input.sessionId));
  const workDir = virtualWorkDir.slice(1);

  const toExecutorPath = (path: string): string => {
    const normalized = posix.normalize(path);
    let relative = normalized;
    if (posix.isAbsolute(normalized)) {
      const root = normalized === virtualWorkDir || normalized.startsWith(`${virtualWorkDir}/`)
        ? virtualWorkDir
        : normalized === PUBLIC_WORK_DIR || normalized.startsWith(`${PUBLIC_WORK_DIR}/`)
          ? PUBLIC_WORK_DIR
          : undefined;
      if (!root) throw new Error(`Harness path escapes the OpenMA session sandbox: ${path}`);
      relative = posix.relative(root, normalized);
    }
    if (relative === "") return ".";
    if (posix.isAbsolute(relative) || relative === ".." || relative.startsWith("../")) {
      throw new Error(`Harness path escapes the OpenMA session sandbox: ${path}`);
    }
    return relative;
  };

  const toNativePath = (path: string): string =>
    posix.resolve(nativeWorkDir, toExecutorPath(path));

  const replaceFile = async (
    path: string,
    writeTemp: (path: string) => Promise<unknown>,
  ): Promise<void> => {
    const target = toExecutorPath(path);
    const temp = `${target}.tmp-${crypto.randomUUID()}`;
    await writeTemp(temp);
    const marker = `__OPENMA_ATOMIC_WRITE_${crypto.randomUUID()}__`;
    const output = await input.sandbox.exec(
      `mv -f -- ${shellQuote(temp)} ${shellQuote(target)} && printf %s ${shellQuote(marker)}`,
    );
    if (!output.trimEnd().endsWith(marker)) {
      throw new Error(`Harness atomic file replacement failed: ${output.slice(-200)}`);
    }
  };

  const run = async (options: {
    command: string;
    workingDirectory?: string;
    env?: Record<string, string>;
    abortSignal?: AbortSignal;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
    if (options.abortSignal?.aborted) {
      throw options.abortSignal.reason ?? new Error("Harness command aborted");
    }
    const marker = `__OPENMA_HARNESS_EXIT_${crypto.randomUUID()}__`;
    const env = {
      ...options.env,
      // Pi asks the sandbox for HOME when mounting skills. Keep it in this
      // session root so the host user's ~/.pi / ~/.agents are unreachable.
      HOME: `${virtualWorkDir}/.home`,
    };
    for (const name of Object.keys(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`Invalid harness environment variable name: ${name}`);
      }
    }
    const envPrefix = Object.entries(env)
      .map(([name, value]) => {
        const mapped = value === virtualWorkDir || value.startsWith(`${virtualWorkDir}/`) ||
            value === PUBLIC_WORK_DIR || value.startsWith(`${PUBLIC_WORK_DIR}/`)
          ? toNativePath(value)
          : value;
        return `${name}=${shellQuote(mapped)}`;
      })
      .join(" ");
    const cwd = options.workingDirectory
      ? toNativePath(options.workingDirectory)
      : nativeWorkDir;
    const mappedCommand = options.command
      .replaceAll(virtualWorkDir, nativeWorkDir)
      .replaceAll(PUBLIC_WORK_DIR, nativeWorkDir);
    const command = [
      `cd ${shellQuote(cwd)}`,
      `${envPrefix ? `${envPrefix} ` : ""}/bin/sh -c ${shellQuote(mappedCommand)}`,
      "code=$?",
      `printf '\\n${marker}%s\\n' \"$code\"`,
      "exit 0",
    ].join("; ");

    const execution = input.sandbox.exec(command);
    let output: string;
    if (options.abortSignal) {
      output = await Promise.race([
        execution,
        new Promise<never>((_, reject) => {
          options.abortSignal!.addEventListener(
            "abort",
            () => reject(options.abortSignal!.reason ?? new Error("Harness command aborted")),
            { once: true },
          );
        }),
      ]);
    } else {
      output = await execution;
    }
    const markerIndex = output.lastIndexOf(marker);
    if (markerIndex < 0) {
      throw new Error(`Harness command returned no exit marker: ${output.slice(-200)}`);
    }
    const exitCode = Number.parseInt(output.slice(markerIndex + marker.length).trim(), 10);
    const stdout = output.slice(0, markerIndex).replace(/\n$/, "");
    return {
      exitCode: Number.isFinite(exitCode) ? exitCode : 1,
      stdout,
      stderr: "",
    };
  };

  const restricted = {
    description: `OpenMA session sandbox rooted at ${PUBLIC_WORK_DIR}`,
    readFile: async ({ path }: { path: string }) => {
      try {
        const bytes = input.sandbox.readFileBytes
          ? await input.sandbox.readFileBytes(toExecutorPath(path))
          : new TextEncoder().encode(await input.sandbox.readFile(toExecutorPath(path)));
        return new Blob([bytes]).stream();
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
    readBinaryFile: async ({ path }: { path: string }) => {
      try {
        return input.sandbox.readFileBytes
          ? await input.sandbox.readFileBytes(toExecutorPath(path))
          : new TextEncoder().encode(await input.sandbox.readFile(toExecutorPath(path)));
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
    readTextFile: async ({
      path,
      startLine = 1,
      endLine,
    }: {
      path: string;
      encoding?: string;
      startLine?: number;
      endLine?: number;
    }) => {
      try {
        const text = await input.sandbox.readFile(toExecutorPath(path));
        if (startLine === 1 && endLine === undefined) return text;
        return text.split("\n").slice(startLine - 1, endLine).join("\n");
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
    writeFile: async ({ path, content }: { path: string; content: ReadableStream<Uint8Array> }) => {
      const bytes = await collect(content);
      if (!input.sandbox.writeFileBytes) {
        throw new Error("OpenMA sandbox does not support binary file writes");
      }
      await replaceFile(path, (temp) => input.sandbox.writeFileBytes!(temp, bytes));
    },
    writeBinaryFile: async ({ path, content }: { path: string; content: Uint8Array }) => {
      if (!input.sandbox.writeFileBytes) {
        throw new Error("OpenMA sandbox does not support binary file writes");
      }
      await replaceFile(path, (temp) => input.sandbox.writeFileBytes!(temp, content));
    },
    writeTextFile: async ({ path, content }: { path: string; content: string }) => {
      await replaceFile(path, (temp) => input.sandbox.writeFile(temp, content));
    },
    run,
    spawn: async () => {
      throw new Error("OpenMA Pi harness does not require sandbox process spawning");
    },
  } satisfies ReturnType<HarnessV1NetworkSandboxSession["restricted"]>;

  const networkSession: HarnessV1NetworkSandboxSession = {
    ...restricted,
    id: input.sessionId,
    defaultWorkingDirectory: "/",
    ports: [],
    getPortUrl: async () => {
      throw new Error("OpenMA Pi harness does not expose bridge ports");
    },
    stop: async () => {},
    destroy: async () => {},
    restricted: () => restricted,
  };

  const provider: HarnessV1SandboxProvider = {
    specificationVersion: "harness-sandbox-v1",
    providerId: "openma-session",
    createSession: async (options) => {
      await options?.onFirstCreate?.(restricted, {
        abortSignal: options.abortSignal,
      });
      return networkSession;
    },
    resumeSession: async () => networkSession,
  };

  return { provider, workDir };
}
