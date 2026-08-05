/**
 * Artifact signal state — pure reducer for the session outputs listing.
 *
 * Listings are re-fetched from several places at once: once on mount, again
 * on every tool-settle marker, and on demand from the panel's refresh button.
 * Those responses can land out of order, and a late response carrying an
 * older listing must not overwrite a newer one — it would resurrect deleted
 * paths, and worse, re-baseline `knownPaths` so the next diff reports files
 * the operator has already seen (or, across a session switch, files from the
 * previous session entirely).
 *
 * Every request is therefore issued with a monotonic generation and folded
 * in here, where anything that lost the race is dropped.
 *
 * Kept free of React so the ordering can be unit-tested directly
 * (see file-signals.test.ts).
 */

import type { SessionOutputFile } from "./dock/panels/file-tree";

export interface FileSignalState {
  /** Generation of the listing currently reflected below. */
  generation: number;
  files: SessionOutputFile[] | null;
  /** Paths from the last accepted listing, or null before the baseline is
   *  established. Null means "nothing is `new` yet". */
  knownPaths: ReadonlySet<string> | null;
  /** Paths first seen since the Files panel was last acknowledged. */
  fresh: ReadonlySet<string>;
  unseen: number;
}

export const initialFileSignalState: FileSignalState = {
  generation: 0,
  files: null,
  knownPaths: null,
  fresh: new Set(),
  unseen: 0,
};

/** Drop everything and re-baseline. `generation` must be at least as high as
 *  any request already in flight, so their responses are ignored. */
export function resetFileSignals(generation: number): FileSignalState {
  return { ...initialFileSignalState, generation };
}

/**
 * Fold a listing response into the state.
 *
 * Returns the previous state unchanged when the response lost the race, so
 * callers can rely on referential equality to skip a re-render.
 */
export function foldListing(
  state: FileSignalState,
  generation: number,
  files: SessionOutputFile[],
): FileSignalState {
  if (generation <= state.generation) return state;

  const paths = new Set(files.map((f) => f.filename));
  const previous = state.knownPaths;

  // The first listing establishes the baseline — everything already in the
  // sandbox when the operator opened the page is "existing", not "just
  // produced", so it must not badge.
  if (previous === null) {
    return { ...state, generation, files, knownPaths: paths };
  }

  const added = [...paths].filter((p) => !previous.has(p));
  if (added.length === 0) {
    return { ...state, generation, files, knownPaths: paths };
  }
  return {
    generation,
    files,
    knownPaths: paths,
    fresh: new Set([...state.fresh, ...added]),
    unseen: state.unseen + added.length,
  };
}

/** Clear the "new since you last looked" markers — the panel is open now. */
export function acknowledgeFiles(state: FileSignalState): FileSignalState {
  if (state.unseen === 0 && state.fresh.size === 0) return state;
  return { ...state, fresh: new Set(), unseen: 0 };
}
