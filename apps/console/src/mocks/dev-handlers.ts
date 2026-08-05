import { HttpResponse, delay, http } from "msw";

/**
 * Dev-only fixtures.
 *
 * `pnpm dev` proxies /v1 to a wrangler stack that needs a container image
 * to run a session end-to-end, which is more than you want standing up to
 * look at a layout change. Setting `VITE_MSW=1` swaps in this fixture set
 * so the console boots signed-in with one fully-populated session:
 * multi-turn conversation, an artifact tree with real playable media, a
 * trajectory envelope, and a live SSE stream that writes a new file a few
 * seconds after connect (which is what exercises the badge bump and the
 * auto-reveal).
 *
 * Never loaded in a production build — `main.tsx` gates the import behind
 * `import.meta.env.DEV`.
 */

const SESSION_ID = "sess-tnk1pf1zfgmu2485";

const USER = {
  id: "usr_dev",
  name: "Dev Operator",
  email: "dev@openma.local",
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Committed events. Timestamps are spread so the header's wall-clock
 *  duration renders something plausible. */
const EVENTS = [
  {
    id: "sevt-1",
    type: "user.message",
    ts: "2026-08-05T01:00:00.000Z",
    processed_at: "2026-08-05T01:00:00.000Z",
    content: [{ type: "text", text: "先研究一下把 canvas 作为 session 视图挂进 OMA 的可行性" }],
  },
  {
    id: "sevt-2",
    type: "agent.message",
    ts: "2026-08-05T01:00:12.000Z",
    processed_at: "2026-08-05T01:00:12.000Z",
    message_id: "msg-1",
    content: [
      {
        type: "text",
        text:
          "我把 canvas 的实现和 OMA 现有的 session / resource 模型对了一遍，结论是可行，"
          + "而且比预想的省事——不需要新起一个服务。\n\n"
          + "### 几个必须提前定的架构决策\n\n"
          + "1. **session = 项目，canvas = session 的视图。** 不要做独立的 canvas 服务。\n"
          + "2. **异步生成闭环复用 queue。** `packages/queue` + scheduler 已经够用。\n"
          + "3. **存储要 tenant 隔离**，资源 key 里带 `org_id`。\n",
      },
    ],
  },
  {
    id: "sevt-3",
    type: "agent.tool_use",
    ts: "2026-08-05T01:02:30.000Z",
    processed_at: "2026-08-05T01:02:30.000Z",
    name: "generate_image",
    input: { shot: "sh005", ref: "sh005-sb" },
  },
  {
    id: "sevt-4",
    type: "agent.tool_result",
    ts: "2026-08-05T01:04:48.000Z",
    processed_at: "2026-08-05T01:04:48.000Z",
    tool_use_id: "sevt-3",
    content: "wrote /mnt/session/outputs/shots/sh005b-v1.mp4",
  },
  {
    id: "sevt-5",
    type: "user.message",
    ts: "2026-08-05T08:00:00.000Z",
    processed_at: "2026-08-05T08:00:00.000Z",
    content: [{ type: "text", text: "界面布局也需要重新设计，我想要一个云端 workspace 的形态" }],
  },
  {
    id: "sevt-6",
    type: "agent.message",
    ts: "2026-08-05T08:17:49.000Z",
    processed_at: "2026-08-05T08:17:49.000Z",
    message_id: "msg-2",
    content: [
      {
        type: "text",
        text:
          "明白——右侧已按 workspace 形态渲染：Canvas / Files / Terminal / Trajectory "
          + "四个面板都在 dock 里。Canvas 是核心 surface，agent 在 session 里构建的 webui "
          + "会挂到那里。",
      },
    ],
  },
];

/** Artifact tree. `filename` carries separators exactly as the R2 adapter
 *  returns them, so the client-side tree builder is exercised for real. */
const OUTPUTS = [
  { filename: "script.md", size_bytes: 4300, media_type: "text/markdown" },
  { filename: "production-log.json", size_bytes: 812, media_type: "application/json" },
  { filename: "shots/sh001-v3.mp4", size_bytes: 184320, media_type: "video/mp4" },
  { filename: "shots/sh002-v3.mp4", size_bytes: 190112, media_type: "video/mp4" },
  { filename: "shots/sh005b-v1.mp4", size_bytes: 201444, media_type: "video/mp4" },
  { filename: "storyboards/sh001-sb.png", size_bytes: 22040, media_type: "image/png" },
  { filename: "storyboards/sh005-sb.png", size_bytes: 23110, media_type: "image/png" },
  { filename: "audio/narration-v1.wav", size_bytes: 96044, media_type: "audio/wav" },
  // Over the preview ceiling on purpose — the kind of build log an agent
  // leaves behind, and the case that used to hang the tab.
  { filename: "render.log", size_bytes: 3_200_000, media_type: "text/plain" },
].map((f) => ({ ...f, uploaded_at: "2026-08-05T08:00:00.000Z" }));

/** File the simulated agent writes ~6s after the SSE stream opens. */
const LATE_OUTPUT = {
  filename: "shots/sh006-v1.mp4",
  size_bytes: 205331,
  uploaded_at: "2026-08-05T08:20:00.000Z",
  media_type: "video/mp4",
};

let lateOutputVisible = false;

const FILE_BODIES: Record<string, string> = {
  "script.md":
    "# SH005 · 骑楼 / 外 / 雨夜\n\n"
    + "雨水顺着骑楼的檐口连成一条细线，砸在积水的青石板上。阿明把凉茶铺的木门半掩上，"
    + "屋里那盏钨丝灯把他的影子拉得很长，一直铺到街心。\n\n"
    + "> 镜头由地面积水的倒影缓慢上摇。\n\n"
    + "## SH005B · 凉茶铺内 / 内 / 同一时间\n\n"
    + "炉火压得很低，铜壶盖轻轻跳动。阿明用抹布擦了擦柜台，抬头看向门外——"
    + "街对面那把黑伞停在原地，已经停了三分钟。\n",
  "production-log.json": JSON.stringify(
    [
      { event: "generate.start", shot: "sh003", ts: 1754301182 },
      { event: "generate.done", shot: "sh003", version: "v4", dur: "0:10" },
      { event: "persist.ok", asset: "ast-9f2c", status: "success" },
      { event: "task.timeout", task: "task-7c04", limit: 900 },
    ],
    null,
    2,
  ),
};

/** 1×1 PNG — enough to prove the image branch renders inline. */
const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/** A real, playable 1-second 440Hz WAV so the native <audio controls>
 *  element has something to scrub — a zero-byte stub renders the control
 *  in an error state and proves nothing. */
function wavBytes(seconds = 1, freq = 440): Uint8Array {
  const rate = 8000;
  const samples = rate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: string | number, text?: string) => {
    if (typeof offset === "string") return;
    for (let i = 0; i < (text ?? "").length; i++) view.setUint8(offset + i, text!.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * 12000, true);
  }
  return new Uint8Array(buffer);
}

export const devHandlers = [
  // ── auth ────────────────────────────────────────────────────────────
  http.get("/auth/get-session", () =>
    HttpResponse.json({
      session: { id: "ses_dev", userId: USER.id, expiresAt: "2099-01-01T00:00:00.000Z" },
      user: USER,
    }),
  ),
  http.get("/auth-info", () => HttpResponse.json({ authenticated: true, user: USER })),
  http.get("/v1/me", () =>
    HttpResponse.json({ ...USER, tenants: [{ id: "org_dev", name: "Dev Workspace", role: "owner" }] }),
  ),
  http.get("/v1/tenants", () =>
    HttpResponse.json({ data: [{ id: "org_dev", name: "Dev Workspace", role: "owner" }] }),
  ),

  // ── session ─────────────────────────────────────────────────────────
  http.get("/v1/sessions/:id", ({ params }) =>
    HttpResponse.json({
      id: params.id,
      environment_id: "env-default",
      vault_ids: ["vlt-o7jl1l8"],
      created_at: "2026-08-05T01:00:00.000Z",
      agent: {
        id: "agt-4kd29wq",
        name: "Support agent",
        model: "claude-fable-5",
        version: 3,
      },
      metadata: {},
    }),
  ),
  http.get("/v1/environments/:id", ({ params }) =>
    HttpResponse.json({ id: params.id, name: "Default Env", description: "ubuntu-24.04 · 4 vCPU / 8G" }),
  ),
  http.get("/v1/vaults/:id", ({ params }) =>
    HttpResponse.json({ id: params.id, display_name: "Production keys" }),
  ),
  http.get("/v1/sessions/:id/events", ({ request }) => {
    const after = Number(new URL(request.url).searchParams.get("after_seq") ?? 0);
    if (after > 0) return HttpResponse.json({ data: [], has_more: false, next_page: null });
    return HttpResponse.json({
      data: EVENTS.map((e, i) => ({ seq: i + 1, type: e.type, ts: e.ts, data: e })),
      has_more: false,
      next_page: null,
    });
  }),
  http.get("/v1/sessions/:id/threads", () => HttpResponse.json({ data: [] })),
  http.get("/v1/sessions/:id/pending", () => HttpResponse.json({ data: [] })),
  http.get("/v1/sessions/:id/trajectory", ({ params }) =>
    HttpResponse.json({
      trajectory_id: "traj-9f2c4b",
      session_id: params.id,
      outcome: "failure",
      reward: { final_reward: 0.42, verifier_id: "vrf-consistency", computed_at: "2026-08-05T08:18:00.000Z" },
      steps: [
        { index: 0, type: "run.started", ts: "2026-08-05T01:00:00.000Z" },
        { index: 1, type: "tool.generate_image", ts: "2026-08-05T01:02:30.000Z", duration_ms: 12400 },
        { index: 2, type: "run.finished", ts: "2026-08-05T08:17:49.000Z", error: "TaskTimeout: task-7c04 exceeded 900s" },
      ],
    }),
  ),

  // ── outputs ─────────────────────────────────────────────────────────
  http.get("/v1/sessions/:id/outputs", () =>
    HttpResponse.json({
      data: lateOutputVisible ? [...OUTPUTS, LATE_OUTPUT] : OUTPUTS,
      has_more: false,
    }),
  ),
  http.get("/v1/sessions/:id/outputs/*", ({ request }) => {
    const path = decodeURIComponent(new URL(request.url).pathname.split("/outputs/")[1] ?? "");
    const body = FILE_BODIES[path];
    if (body !== undefined) {
      return new HttpResponse(body, {
        headers: {
          "Content-Type": path.endsWith(".json") ? "application/json" : "text/markdown",
        },
      });
    }
    if (path.endsWith(".png")) {
      return new HttpResponse(PNG_BYTES, { headers: { "Content-Type": "image/png" } });
    }
    if (path.endsWith(".wav")) {
      return new HttpResponse(wavBytes(), { headers: { "Content-Type": "audio/wav" } });
    }
    // No mp4 fixture: an <video> pointed at a non-video body renders its
    // native controls in an error state, which is still the real element
    // and still proves the branch mounts.
    return new HttpResponse(new Uint8Array(), { headers: { "Content-Type": "video/mp4" } });
  }),

  // ── live stream ─────────────────────────────────────────────────────
  // Idle, then a tool result ~6s in. useWorkspaceSignals re-lists the
  // outputs on that settle marker, sees a path it hasn't seen before, and
  // that is what drives the badge bump / auto-reveal / mobile chip.
  http.get("/v1/sessions/:id/events/stream", async () => {
    // Rewind on every subscribe so the reveal is replayable — once the
    // late file is listed it looks pre-existing to the signal baseline,
    // and the badge/auto-reveal path can't be walked a second time.
    lateOutputVisible = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        send({ id: "sevt-live-0", type: "session.status_idle" });
        await delay(6000);
        lateOutputVisible = true;
        send({
          id: "sevt-live-1",
          type: "agent.tool_result",
          tool_use_id: "sevt-live-tool",
          content: `wrote /mnt/session/outputs/${LATE_OUTPUT.filename}`,
        });
        // Hold the connection open — closing would trip the reconnect
        // backoff and replay the whole thing on a loop.
      },
    });
    return new HttpResponse(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  }),

  // ── writes ──────────────────────────────────────────────────────────
  http.post("/v1/sessions/:id/events", () => HttpResponse.json({ ok: true })),
  http.post("/v1/files", () =>
    HttpResponse.json({ id: "file_dev", filename: "upload.png", media_type: "image/png" }),
  ),
];
