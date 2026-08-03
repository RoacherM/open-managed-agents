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
