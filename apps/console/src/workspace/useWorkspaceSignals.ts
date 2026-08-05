import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useApi } from "../lib/api";
import type { Event } from "../lib/events";
import type { SessionOutputFile } from "./dock/panels/file-tree";
import type { WorkspaceSignals } from "./dock/registry";
import {
  acknowledgeFiles,
  foldListing,
  initialFileSignalState,
  resetFileSignals,
  type FileSignalState,
} from "./file-signals";

/**
 * Artifact signals for the workspace dock.
 *
 * There is no "the agent wrote a file" event on the wire — the session
 * event schema covers messages, thinking, tool calls and spans, and adding
 * an artifact event to it is a backend change this milestone doesn't own.
 * So the trigger is derived in the presentation layer: whenever a tool call
 * settles (or the session goes idle) we re-list the session outputs and
 * diff the paths against the previous listing. New paths are what "the
 * agent produced something" means here.
 *
 * The diff drives three things: the Files tab badge, the amber flash on
 * fresh tree rows, and the auto-reveal decision in WorkspaceShell.
 *
 * This hook owns the fetching and the triggers; the diff itself and the
 * ordering rules for concurrent listings live in ./file-signals.
 */

/** Event types that mean "a tool just finished, artifacts may exist now". */
const SETTLE_EVENT_TYPES = new Set([
  "agent.tool_result",
  "agent.mcp_tool_result",
  "agent.custom_tool_result",
  "session.status_idle",
]);

/** Debounce for the re-list. A single agent turn can close a dozen tool
 *  calls in a burst; one listing after the burst is enough. */
const REFRESH_DEBOUNCE_MS = 1200;

export interface WorkspaceSignalsApi {
  signals: WorkspaceSignals;
  files: SessionOutputFile[] | null;
  filesError: string | null;
  refreshFiles: () => void;
  /** Paths first seen since the Files panel was last acknowledged. */
  freshFilePaths: ReadonlySet<string>;
  /** Clear the unseen counter for a panel — called when it's opened. */
  acknowledge: (panelId: string) => void;
}

export function useWorkspaceSignals(
  sessionId: string | undefined,
  events: Event[],
): WorkspaceSignalsApi {
  const { api } = useApi();
  const [state, setState] = useState<FileSignalState>(initialFileSignalState);
  const [filesError, setFilesError] = useState<string | null>(null);
  // Monotonic ticket handed to each request. Responses fold in under their
  // own ticket so a slow one can't clobber a listing issued after it.
  const issued = useRef(0);

  const refreshFiles = useCallback(() => {
    if (!sessionId) return;
    const generation = ++issued.current;
    api<{ data: SessionOutputFile[]; has_more: boolean }>(`/v1/sessions/${sessionId}/outputs`)
      .then((res) => {
        setState((prev) => foldListing(prev, generation, res.data ?? []));
        if (generation === issued.current) setFilesError(null);
      })
      .catch((e) => {
        // Only the newest request may report failure — a stale rejection
        // would show an error over a listing that actually loaded.
        if (generation !== issued.current) return;
        setFilesError(e instanceof Error ? e.message : String(e));
      });
  }, [api, sessionId]);

  // Reset everything when the route switches sessions — same component
  // instance serves /sessions/A and /sessions/B. Re-baselining above every
  // ticket in flight is what stops session A's pending listing from landing
  // in session B and badging its files as new.
  useEffect(() => {
    setState(resetFileSignals(++issued.current));
    setFilesError(null);
    refreshFiles();
  }, [refreshFiles]);

  // Watch the tail of the event array for settle markers. Comparing
  // lengths rather than deep-diffing is enough: events is append-only.
  const settleTick = useMemo(() => {
    let tick = 0;
    for (const e of events) {
      if (SETTLE_EVENT_TYPES.has(e.type)) tick += 1;
    }
    return tick;
  }, [events]);

  const firstTick = useRef(true);
  useEffect(() => {
    if (firstTick.current) {
      // The initial history replay fires this once with the full backlog;
      // the mount effect above already listed the outputs.
      firstTick.current = false;
      return;
    }
    const t = setTimeout(refreshFiles, REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [settleTick, refreshFiles]);

  const acknowledge = useCallback((panelId: string) => {
    if (panelId !== "files") return;
    setState(acknowledgeFiles);
  }, []);

  const signals = useMemo<WorkspaceSignals>(
    () => ({
      unseen: { files: state.unseen },
      totals: { files: state.files?.length ?? 0 },
    }),
    [state.files, state.unseen],
  );

  return {
    signals,
    files: state.files,
    filesError,
    refreshFiles,
    freshFilePaths: state.fresh,
    acknowledge,
  };
}
