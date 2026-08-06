// Event delivery contract of NodeSessionRouter — regression suite for the
// two composing bugs that made the console swallow the tail of long
// sessions (sess-1wo4h2scx1ht3ttl, 1387 events, 2026-08-06):
//   1. getEvents returned has_more without next_page, stranding the
//      console's cursor pagination on page one.
//   2. streamEvents' replay path enqueued the whole history into the
//      flow-control buffer before the consumer's first pull, so the
//      1024-frame cap silently discarded everything past seq 1024.

import { describe, expect, it } from "vitest";
import { NodeSessionRouter } from "../src/lib/node-session-router";
import type { SqlEventLog } from "@open-managed-agents/event-log/sql";
import type { EventStreamHub } from "../src/lib/event-stream-hub";

function makeRouter(totalEvents: number) {
  const events = Array.from({ length: totalEvents }, (_, i) => ({
    type: "agent.thinking",
    text: `thought ${i + 1}`,
    seq: i + 1,
    ts: 1_785_000_000_000 + i,
    session_thread_id: "sthr_primary",
  }));
  const log = {
    getEventsAsync: async (afterSeq?: number) =>
      events.filter((e) => e.seq > (afterSeq ?? 0)),
  } as unknown as SqlEventLog;
  const hub: EventStreamHub = {
    attach: () => () => {},
    publish: () => {},
  } as unknown as EventStreamHub;
  return new NodeSessionRouter({
    sql: null as never,
    hub,
    registry: null as never,
    newEventLog: () => log,
  });
}

describe("NodeSessionRouter.getEvents", () => {
  it("returns a seq_<n> next_page cursor while more pages remain", async () => {
    const router = makeRouter(450);
    const p1 = await router.getEvents("sess_x", { limit: 200 });
    expect(p1.data).toHaveLength(200);
    expect(p1.has_more).toBe(true);
    expect(p1.next_page).toBe("seq_200");

    const p2 = await router.getEvents("sess_x", { limit: 200, afterSeq: 200 });
    expect(p2.next_page).toBe("seq_400");

    const p3 = await router.getEvents("sess_x", { limit: 200, afterSeq: 400 });
    expect(p3.data).toHaveLength(50);
    expect(p3.has_more).toBe(false);
    expect(p3.next_page).toBeUndefined();
  });
});

describe("NodeSessionRouter.streamEvents replay", () => {
  it("replays histories longer than the live flow-control cap without dropping frames", async () => {
    const total = 1500; // > the 1024 live-frame cap
    const router = makeRouter(total);
    const handle = await router.streamEvents("sess_x", {
      replay: true,
      include: ["chunks"],
    });
    const seqs: number[] = [];
    for await (const frame of handle) {
      const ev = JSON.parse(frame.data) as { seq: number };
      seqs.push(ev.seq);
      if (ev.seq === total) break; // tail reached — live stream stays open
    }
    handle.close();
    expect(seqs).toHaveLength(total);
    expect(seqs[0]).toBe(1);
    expect(seqs[seqs.length - 1]).toBe(total);
  });
});
