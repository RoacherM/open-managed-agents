import { describe, expect, it } from "vitest";

import {
  acknowledgeFiles,
  foldListing,
  initialFileSignalState,
  resetFileSignals,
  type FileSignalState,
} from "./file-signals";
import type { SessionOutputFile } from "./dock/panels/file-tree";

const file = (filename: string): SessionOutputFile => ({
  filename,
  size_bytes: 1,
  uploaded_at: "2026-08-05T00:00:00.000Z",
  media_type: "application/octet-stream",
});

const listing = (...names: string[]) => names.map(file);

/** State with a baseline already established at generation 1. */
function baselined(...names: string[]): FileSignalState {
  return foldListing(initialFileSignalState, 1, listing(...names));
}

describe("foldListing", () => {
  it("treats the first listing as the baseline, not as new arrivals", () => {
    const state = baselined("a.txt", "b.txt");
    expect(state.files).toHaveLength(2);
    expect(state.unseen).toBe(0);
    expect(state.fresh.size).toBe(0);
  });

  it("counts paths absent from the previous listing", () => {
    const next = foldListing(baselined("a.txt"), 2, listing("a.txt", "b.txt", "c.txt"));
    expect(next.unseen).toBe(2);
    expect([...next.fresh]).toEqual(["b.txt", "c.txt"]);
  });

  it("accumulates across listings until acknowledged", () => {
    let state = baselined("a.txt");
    state = foldListing(state, 2, listing("a.txt", "b.txt"));
    state = foldListing(state, 3, listing("a.txt", "b.txt", "c.txt"));
    expect(state.unseen).toBe(2);
    expect([...state.fresh]).toEqual(["b.txt", "c.txt"]);
  });

  it("does not badge a file that merely got overwritten", () => {
    const next = foldListing(baselined("a.txt"), 2, listing("a.txt"));
    expect(next.unseen).toBe(0);
    expect(next.files).toHaveLength(1);
  });
});

describe("out-of-order responses", () => {
  it("drops a response older than the one already applied", () => {
    const state = foldListing(baselined("a.txt"), 3, listing("a.txt", "c.txt"));
    // Generation 2 was issued first but resolved last.
    const late = foldListing(state, 2, listing("a.txt", "b.txt"));
    expect(late).toBe(state);
    expect(late.files?.map((f) => f.filename)).toEqual(["a.txt", "c.txt"]);
  });

  it("does not let a late response re-baseline and swallow new paths", () => {
    // Without the guard the stale listing would overwrite knownPaths with
    // its own shorter set, and the next listing would report already-seen
    // files as fresh.
    let state = baselined("a.txt");
    state = foldListing(state, 3, listing("a.txt", "b.txt"));
    state = foldListing(state, 2, listing("a.txt"));
    const next = foldListing(state, 4, listing("a.txt", "b.txt"));
    expect(next.unseen).toBe(1);
    expect([...next.fresh]).toEqual(["b.txt"]);
  });

  it("ignores a response that raced a session switch", () => {
    const previousSession = foldListing(baselined("a.txt"), 2, listing("a.txt", "b.txt"));
    // Switching sessions re-baselines at a generation above anything in
    // flight, so the old session's pending listing can't land.
    const reset = resetFileSignals(9);
    const stray = foldListing(reset, 3, listing("old-session.txt"));
    expect(stray).toBe(reset);
    expect(stray.files).toBeNull();
    expect(stray.unseen).toBe(0);
    expect(previousSession.unseen).toBe(1);
  });

  it("accepts the next listing issued after the reset", () => {
    const state = foldListing(resetFileSignals(9), 10, listing("new.txt"));
    expect(state.files?.map((f) => f.filename)).toEqual(["new.txt"]);
    expect(state.unseen).toBe(0);
  });
});

describe("acknowledgeFiles", () => {
  it("clears the counters when the panel is opened", () => {
    const state = foldListing(baselined("a.txt"), 2, listing("a.txt", "b.txt"));
    const acked = acknowledgeFiles(state);
    expect(acked.unseen).toBe(0);
    expect(acked.fresh.size).toBe(0);
    // The listing itself survives — only the "new since you looked" markers go.
    expect(acked.files).toHaveLength(2);
    expect(acked.knownPaths?.has("b.txt")).toBe(true);
  });

  it("is a no-op when there is nothing to clear", () => {
    const state = baselined("a.txt");
    expect(acknowledgeFiles(state)).toBe(state);
  });

  it("still reports paths that arrive after the acknowledgement", () => {
    const acked = acknowledgeFiles(foldListing(baselined("a.txt"), 2, listing("a.txt", "b.txt")));
    const next = foldListing(acked, 3, listing("a.txt", "b.txt", "c.txt"));
    expect(next.unseen).toBe(1);
    expect([...next.fresh]).toEqual(["c.txt"]);
  });
});
