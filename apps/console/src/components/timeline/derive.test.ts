import { describe, expect, it } from "vitest";
import type { Event } from "../../lib/events";
import { bucketIntoTurns, deriveSpans } from "./derive";

describe("timeline timestamp normalization", () => {
  it("keeps Node millisecond timestamps in milliseconds", () => {
    const events: Event[] = [
      { type: "user.message", ts: 1_785_737_999_855 },
      { type: "session.status_idle", ts: 1_785_738_151_286 },
    ];

    expect(deriveSpans(events).totalMs).toBe(151_431);
    expect(bucketIntoTurns(events)[0]).toMatchObject({
      triggerTs: 1_785_737_999_855,
      endedAt: 1_785_738_151_286,
      status: "completed",
    });
  });

  it("still converts Cloudflare second timestamps to milliseconds", () => {
    expect(
      deriveSpans([
        { type: "user.message", ts: 1_785_737_999 },
        { type: "session.status_idle", ts: 1_785_738_001 },
      ]).totalMs,
    ).toBe(2_000);
  });
});
