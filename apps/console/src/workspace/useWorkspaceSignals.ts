import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useApi } from "../lib/api";
import type { Event } from "../lib/events";
import type { SessionOutputFile } from "./dock/panels/file-tree";
import type { WorkspaceSignals } from "./dock/registry";

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
  const [files, setFiles] = useState<SessionOutputFile[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [unseenFiles, setUnseenFiles] = useState(0);
  const [freshFilePaths, setFreshFilePaths] = useState<ReadonlySet<string>>(new Set());
  const knownPaths = useRef<Set<string> | null>(null);

  const refreshFiles = useCallback(() => {
    if (!sessionId) return;
    api<{ data: SessionOutputFile[]; has_more: boolean }>(`/v1/sessions/${sessionId}/outputs`)
      .then((res) => {
        const next = res.data ?? [];
        setFiles(next);
        setFilesError(null);

        const paths = new Set(next.map((f) => f.filename));
        const previous = knownPaths.current;
        knownPaths.current = paths;
        // The first listing establishes the baseline — everything already
        // in the sandbox when the operator opened the page is "existing",
        // not "just produced", so it must not badge.
        if (previous === null) return;
        const added = [...paths].filter((p) => !previous.has(p));
        if (added.length === 0) return;
        setUnseenFiles((n) => n + added.length);
        setFreshFilePaths((prev) => new Set([...prev, ...added]));
      })
      .catch((e) => setFilesError(e instanceof Error ? e.message : String(e)));
  }, [api, sessionId]);

  // Reset everything when the route switches sessions — same component
  // instance serves /sessions/A and /sessions/B.
  useEffect(() => {
    knownPaths.current = null;
    setFiles(null);
    setFilesError(null);
    setUnseenFiles(0);
    setFreshFilePaths(new Set());
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
    setUnseenFiles(0);
    setFreshFilePaths(new Set());
  }, []);

  const signals = useMemo<WorkspaceSignals>(
    () => ({
      unseen: { files: unseenFiles },
      totals: { files: files?.length ?? 0 },
    }),
    [files, unseenFiles],
  );

  return { signals, files, filesError, refreshFiles, freshFilePaths, acknowledge };
}
