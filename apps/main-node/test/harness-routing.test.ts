import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface MainNodeHandle {
  child: ChildProcess;
  port: number;
  logs: string[];
}

interface ProviderHandle {
  server: Server;
  port: number;
  requests: Array<{ url: string; authorization?: string; body: unknown }>;
}

const REPO_ROOT = resolve(__dirname, "../../..");
const MAIN_NODE_ENTRY = join(REPO_ROOT, "apps/main-node/src/index.ts");
const TSX_BIN = join(REPO_ROOT, "apps/main-node/node_modules/.bin/tsx");

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function pickPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        reject(new Error("could not pick port"));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function startMainNode(dataDir: string): Promise<MainNodeHandle> {
  const port = await pickPort();
  const child = spawn(TSX_BIN, [MAIN_NODE_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: join(dataDir, "oma.db"),
      AUTH_DATABASE_PATH: join(dataDir, "auth.db"),
      SANDBOX_WORKDIR: join(dataDir, "sandboxes"),
      MEMORY_BLOB_DIR: join(dataDir, "memory-blobs"),
      FILES_BLOB_DIR: join(dataDir, "files-blobs"),
      SESSION_OUTPUTS_DIR: join(dataDir, "outputs"),
      AUTH_DISABLED: "1",
      BETTER_AUTH_SECRET: "test-secret-only-for-vitest",
      PLATFORM_ROOT_SECRET: "",
      PLATFORM_ROOT_SECRET_FILE: join(dataDir, "platform-root-secret"),
      NODE_ENV: "test",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (buffer: Buffer) => logs.push(buffer.toString()));
  child.stderr?.on("data", (buffer: Buffer) => logs.push(buffer.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
        await sleep(200);
        return { child, port, logs };
      }
    } catch {
      // not ready
    }
    await sleep(150);
  }
  child.kill("SIGKILL");
  throw new Error(`main-node did not start:\n${logs.join("")}`);
}

async function stopMainNode(handle: MainNodeHandle): Promise<void> {
  if (handle.child.exitCode !== null) return;
  await new Promise<void>((resolveStop) => {
    handle.child.once("exit", () => resolveStop());
    try {
      process.kill(-handle.child.pid!, "SIGKILL");
    } catch {
      handle.child.kill("SIGKILL");
    }
  });
}

async function startFakeProvider(): Promise<ProviderHandle> {
  const requests: ProviderHandle["requests"] = [];
  const server = createHttpServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) as {
      stream?: boolean;
      tools?: Array<{ function?: { name?: string } }>;
      messages?: Array<{ role?: string }>;
    } : {};
    requests.push({
      url: req.url ?? "",
      authorization: req.headers.authorization,
      body,
    });

    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "probe",
        object: "chat.completion",
        created: 1,
        model: "openma-pi-test-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "probe-ok" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const shouldCallWrite = body.tools?.some((tool) => tool.function?.name === "write") &&
      !body.messages?.some((message) => message.role === "tool");
    const piWorkDir = JSON.stringify(body.messages ?? []).match(
      /\/\.openma-harness\/[A-Za-z0-9._%:-]+/,
    )?.[0];
    const events = shouldCallWrite
      ? [
          {
            id: "pi-turn",
            object: "chat.completion.chunk",
            created: 1,
            model: "openma-pi-test-model",
            choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
          },
          {
            id: "pi-turn",
            object: "chat.completion.chunk",
            created: 1,
            model: "openma-pi-test-model",
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "call_openma_write",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({
                      file_path: `${piWorkDir ?? "/workspace"}/pi-marker.txt`,
                      content: "written-by-openma",
                    }),
                  },
                }],
              },
              finish_reason: null,
            }],
          },
          {
            id: "pi-turn",
            object: "chat.completion.chunk",
            created: 1,
            model: "openma-pi-test-model",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          },
        ]
      : [
      {
        id: "pi-turn",
        object: "chat.completion.chunk",
        created: 1,
        model: "openma-pi-test-model",
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      },
      {
        id: "pi-turn",
        object: "chat.completion.chunk",
        created: 1,
        model: "openma-pi-test-model",
        choices: [{ index: 0, delta: { content: "PI_HARNESS_OK" }, finish_reason: null }],
      },
      {
        id: "pi-turn",
        object: "chat.completion.chunk",
        created: 1,
        model: "openma-pi-test-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      },
    ];
    for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  const port = await pickPort();
  await new Promise<void>((resolveListen) => server.listen(port, "127.0.0.1", resolveListen));
  return { server, port, requests };
}

async function createSessionFixture(input: {
  base: string;
  providerPort: number;
  harness: string;
  modelId: string;
  tools?: unknown[];
}): Promise<string> {
  const card = await fetch(`${input.base}/model_cards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "oai-compatible",
      model_id: input.modelId,
      model: "openma-pi-test-model",
      api_key: "pi-test-key",
      base_url: `http://127.0.0.1:${input.providerPort}/v1`,
    }),
  });
  expect(card.status).toBe(201);

  const agentResponse = await fetch(`${input.base}/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `agent-${input.harness}`,
      model: input.modelId,
      _oma: { harness: input.harness },
      tools: input.tools ?? [],
    }),
  });
  expect(agentResponse.status).toBe(201);
  const agent = await agentResponse.json() as { id: string };

  const environmentResponse = await fetch(`${input.base}/environments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `environment-${input.harness}`,
      config: { type: "cloud" },
    }),
  });
  expect(environmentResponse.status).toBe(201);
  const environment = await environmentResponse.json() as { id: string };

  const sessionResponse = await fetch(`${input.base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: agent.id, environment: environment.id }),
  });
  expect(sessionResponse.status).toBe(201);
  return ((await sessionResponse.json()) as { id: string }).id;
}

async function waitForTerminalEvent(base: string, sessionId: string, afterSeq = 0) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/sessions/${sessionId}/events`);
    const page = await response.json() as { data: Array<Record<string, any>> };
    const terminal = page.data.find(
      (event) => Number(event.seq ?? 0) > afterSeq &&
        (event.type === "agent.message" || event.type === "session.error"),
    );
    if (terminal) return { terminal, events: page.data };
    await sleep(100);
  }
  throw new Error(`session ${sessionId} produced no terminal event`);
}

async function waitForSessionIdle(base: string, sessionId: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const session = await (await fetch(`${base}/sessions/${sessionId}`)).json() as {
      status: string;
    };
    if (session.status === "idle") return;
    await sleep(100);
  }
  throw new Error(`session ${sessionId} did not return to idle`);
}

describe("main-node harness routing", () => {
  let dataDir: string;
  let main: MainNodeHandle | undefined;
  let provider: ProviderHandle | undefined;

  beforeEach(async () => {
    dataDir = join(tmpdir(), `oma-harness-routing-${randomBytes(6).toString("hex")}`);
    mkdirSync(dataDir, { recursive: true });
    provider = await startFakeProvider();
    main = await startMainNode(dataDir);
  });

  afterEach(async () => {
    if (main) await stopMainNode(main).catch(() => {});
    if (provider) {
      provider.server.closeAllConnections();
      await new Promise<void>((resolveClose) => provider!.server.close(() => resolveClose()));
    }
    rmSync(dataDir, { recursive: true, force: true });
    main = undefined;
    provider = undefined;
  });

  it("fails an unknown harness before contacting the model provider", async () => {
    const base = `http://127.0.0.1:${main!.port}/v1`;
    const sessionId = await createSessionFixture({
      base,
      providerPort: provider!.port,
      harness: "does-not-exist",
      modelId: "unknown-harness-model",
    });
    provider!.requests.length = 0; // ignore Model Card's creation probe

    const response = await fetch(`${base}/sessions/${sessionId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [{ type: "user.message", content: [{ type: "text", text: "hello" }] }],
      }),
    });
    expect(response.status).toBe(202);

    const { terminal } = await waitForTerminalEvent(base, sessionId);
    expect(terminal.type).toBe("session.error");
    expect(terminal.message).toContain('Unsupported Node harness "does-not-exist"');
    expect(provider!.requests).toHaveLength(0);
  });

  it("runs Pi through the public API, isolates tools, and resumes after a process restart", async () => {
    const base = `http://127.0.0.1:${main!.port}/v1`;
    const sessionId = await createSessionFixture({
      base,
      providerPort: provider!.port,
      harness: "pi",
      modelId: "pi-harness-model",
      tools: [{
        type: "agent_toolset_20260401",
        default_config: { enabled: false },
        configs: [{ name: "write", enabled: true }],
      }],
    });
    provider!.requests.length = 0;

    const response = await fetch(`${base}/sessions/${sessionId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [{ type: "user.message", content: [{ type: "text", text: "hello pi" }] }],
      }),
    });
    expect(response.status).toBe(202);

    let result: Awaited<ReturnType<typeof waitForTerminalEvent>>;
    try {
      result = await waitForTerminalEvent(base, sessionId);
    } catch (error) {
      const page = await (await fetch(`${base}/sessions/${sessionId}/events`)).json();
      throw new Error(JSON.stringify({ error: String(error), page, requests: provider!.requests, logs: main!.logs }, null, 2));
    }
    const { terminal, events } = result;
    if (terminal.type === "session.error") {
      throw new Error(`Pi turn failed: ${terminal.message}\nmain-node logs:\n${main!.logs.join("")}`);
    }
    expect(terminal.content).toEqual([{ type: "text", text: "PI_HARNESS_OK" }]);
    expect(events.some((event) => event.type === "span.model_request_start")).toBe(true);
    expect(events.some((event) => event.type === "span.model_request_end")).toBe(true);
    expect(provider!.requests).toHaveLength(2);
    expect(provider!.requests[0]).toMatchObject({
      url: "/v1/chat/completions",
      authorization: "Bearer pi-test-key",
    });
    expect(JSON.stringify(provider!.requests[0]?.body)).toContain("/.openma-harness/");

    await waitForSessionIdle(base, sessionId);

    const marker = await fetch(`${base}/sessions/${sessionId}/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "cat pi-marker.txt" }),
    });
    expect(marker.status).toBe(200);
    const markerBody = (await marker.json()) as { output: string };
    expect(markerBody).toMatchObject({
      output: "written-by-openma",
    });
    expect(JSON.stringify(events)).not.toContain("pi-test-key");

    const leakedKey = await fetch(`${base}/sessions/${sessionId}/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "grep -R -l 'pi-test-key' . >/dev/null 2>&1 && printf leaked || printf clean",
      }),
    });
    expect((await leakedKey.json()) as { output: string }).toMatchObject({ output: "clean" });

    const lastSeq = Math.max(...events.map((event) => Number(event.seq ?? 0)));
    await stopMainNode(main!);
    main = await startMainNode(dataDir);
    const resumedBase = `http://127.0.0.1:${main.port}/v1`;
    const requestCount = provider!.requests.length;
    const resumed = await fetch(`${resumedBase}/sessions/${sessionId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [{ type: "user.message", content: [{ type: "text", text: "after restart" }] }],
      }),
    });
    expect(resumed.status).toBe(202);
    const resumedResult = await waitForTerminalEvent(resumedBase, sessionId, lastSeq);
    expect(resumedResult.terminal).toMatchObject({
      type: "agent.message",
      content: [{ type: "text", text: "PI_HARNESS_OK" }],
    });
    await waitForSessionIdle(resumedBase, sessionId);
    expect(provider!.requests).toHaveLength(requestCount + 1);
    const resumedRequest = JSON.stringify(provider!.requests.at(-1)?.body);
    expect(resumedRequest).toContain("hello pi");
    expect(resumedRequest).toContain("PI_HARNESS_OK");
  });
});
