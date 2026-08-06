/**
 * Generic shape of any wire event coming over the session events stream.
 * Covers all current and future event types via the catch-all index
 * signature — render code must defensively check `type` before
 * accessing kind-specific fields.
 *
 * Lives in lib/ rather than the timeline folder because both the
 * Conversation view and the Timeline view consume events.
 */
export interface Event {
  type: string;
  content?: Array<{ type: string; text: string }> | string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  mcp_tool_use_id?: string;
  mcp_server_name?: string;
  error?: string;
  source?: string;
  message?: string;
  stop_reason?: { type: string };
  /** Canonical id for streamed assistant messages — set on
   *  agent.message_stream_start / _chunk / _stream_end and on the
   *  matching final agent.message. Lets the renderer correlate
   *  in-flight chunks with the eventually-committed message. */
  message_id?: string;
  delta?: string;
  /** Stored events use numeric epoch timestamps (seconds on Cloudflare,
   *  milliseconds on Node); live-only events use an ISO arrival time. */
  ts?: string | number;
  /** Server-side monotonic seq. Only set for events fetched from /events. */
  seq?: number;
  [key: string]: unknown;
}

/**
 * Dedup key for SSE re-delivery + initial-fetch overlap.
 *
 * Preference order:
 * 1. `id` — the CF runtime stamps sevt-* / toolCallId ids on every event.
 * 2. `session_thread_id:seq` — the Node runtime stamps ids on almost
 *    nothing (only tool_use / model_request_start / custom_tool_use), but
 *    every event it persists or broadcasts carries the per-session
 *    monotonic `seq`. Without this tier the content fallback swallowed
 *    real events wholesale: agent.thinking keeps its text in `text` (not
 *    `content`), so every thinking event keyed to `agent.thinking:""` and
 *    a session with 189 thinking blocks rendered exactly one
 *    (sess-1wo4h2scx1ht3ttl, 2026-08-06). Byte-identical tool_results and
 *    repeated session.errors were dropped the same way.
 * 3. Content hash — legacy events from before either stamping scheme.
 *
 * A Node-runtime edge: the seq broadcast over SSE is tentative and can in
 * rare recovery races differ from the persisted seq. That direction of
 * error duplicates a render instead of dropping one — acceptable.
 */
export function eventKey(e: Event): string {
  const id = (e as { id?: string }).id;
  if (id) return id;
  const seq = (e as { seq?: number }).seq;
  if (typeof seq === "number") {
    return `${(e as { session_thread_id?: string }).session_thread_id ?? "sthr_primary"}:${seq}`;
  }
  const body =
    e.content ||
    (e as { text?: string }).text ||
    e.tool_use_id ||
    (e as { message_id?: string }).message_id ||
    e.error ||
    "";
  return `${e.type}:${JSON.stringify(body).slice(0, 120)}`;
}

/** Normalize every event timestamp shape used by the two runtimes. */
export function eventTimestampMs(event: Event): number | null {
  const processedAt =
    (event.data as { processed_at?: string } | undefined)?.processed_at ??
    (event as { processed_at?: string }).processed_at;
  if (typeof processedAt === "string") {
    const parsed = Date.parse(processedAt);
    if (Number.isFinite(parsed)) return parsed;
  }

  const processedAtMs = (event as { processed_at_ms?: number }).processed_at_ms;
  if (typeof processedAtMs === "number" && Number.isFinite(processedAtMs)) {
    return processedAtMs;
  }

  if (typeof event.ts === "number" && Number.isFinite(event.ts)) {
    return event.ts < 1_000_000_000_000 ? event.ts * 1000 : event.ts;
  }
  if (typeof event.ts === "string") {
    const parsed = Date.parse(event.ts);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
