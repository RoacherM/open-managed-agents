// eventKey dedup contract. Shapes below are lifted from real Node-runtime
// sessions (sess-lfm5qnnh3nfjertm / sess-1wo4h2scx1ht3ttl, 2026-08-06)
// where the old id-or-content key swallowed 188 of 189 thinking events.

import { describe, expect, it } from "vitest";
import { eventKey, type Event } from "./events";

const ev = (o: Record<string, unknown>) => o as unknown as Event;

describe("eventKey", () => {
  it("prefers the server-stamped id when present", () => {
    expect(eventKey(ev({ type: "agent.tool_use", id: "sevt-1", seq: 7 }))).toBe("sevt-1");
  });

  it("keeps distinct no-id thinking events distinct via thread:seq", () => {
    // Node runtime: thinking text lives in `text`, not `content` — the
    // old content fallback keyed every one of these to `agent.thinking:""`.
    const a = ev({ type: "agent.thinking", text: "first thought", seq: 3, session_thread_id: "sthr_primary" });
    const b = ev({ type: "agent.thinking", text: "second thought", seq: 9, session_thread_id: "sthr_primary" });
    expect(eventKey(a)).not.toBe(eventKey(b));
  });

  it("keeps byte-identical tool_results with different seq distinct", () => {
    const mk = (seq: number) =>
      ev({ type: "agent.tool_result", content: "Error: ENOENT: same output", tool_use_id: `call_${seq}`, seq });
    expect(eventKey(mk(102))).not.toBe(eventKey(mk(118)));
  });

  it("dedups SSE re-delivery of the same event (same thread + seq)", () => {
    const frame = { type: "agent.tool_result", content: "exit=0", seq: 5, session_thread_id: "sthr_primary" };
    expect(eventKey(ev(frame))).toBe(eventKey(ev({ ...frame })));
  });

  it("scopes seq keys by thread so parallel threads don't collide", () => {
    const a = ev({ type: "agent.message", seq: 4, session_thread_id: "sthr_primary" });
    const b = ev({ type: "agent.message", seq: 4, session_thread_id: "sthr_sub1" });
    expect(eventKey(a)).not.toBe(eventKey(b));
  });

  it("falls back to a content key for legacy events with neither id nor seq", () => {
    const a = ev({ type: "agent.message", content: [{ type: "text", text: "hi" }] });
    const b = ev({ type: "agent.message", content: [{ type: "text", text: "different" }] });
    expect(eventKey(a)).not.toBe(eventKey(b));
    expect(eventKey(a)).toBe(eventKey(ev({ type: "agent.message", content: [{ type: "text", text: "hi" }] })));
  });
});
