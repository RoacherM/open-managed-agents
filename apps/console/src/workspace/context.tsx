import { createContext, useContext, useMemo } from "react";

import type { Trajectory } from "../lib/trajectory";
import type { SessionOutputFile } from "./dock/panels/file-tree";

/**
 * Session-scoped data shared by every workspace panel.
 *
 * `PanelProps` stays deliberately small (session id, display mode, signal
 * counters) so a plugin panel can be written without knowing anything about
 * the console's data layer. Panels that *do* want the session's already-
 * fetched artifacts reach for this context instead of re-fetching — the
 * outputs listing in particular is shared with the Files tab badge, and
 * duplicating the request would double the polling load on the sandbox.
 */
export interface WorkspaceData {
  sessionId: string;
  /** Lazy-fetched Trajectory v1 envelope, mirroring SessionDetail's own
   *  sentinels: `"loading"` in flight, `"error"` on failure. */
  trajectory: Trajectory | "loading" | "error" | undefined;
  /** Flat outputs listing; `null` while the first fetch is in flight. */
  files: SessionOutputFile[] | null;
  filesError: string | null;
  /** Re-fetch the outputs listing. The dock calls this when tool activity
   *  settles; the Files panel exposes it as a manual refresh. */
  refreshFiles: () => void;
  /** Paths that appeared since the Files panel was last opened. Drives the
   *  amber "just written" flash on tree rows. */
  freshFilePaths: ReadonlySet<string>;
}

const WorkspaceDataContext = createContext<WorkspaceData | null>(null);

export function WorkspaceDataProvider({
  value,
  children,
}: {
  value: WorkspaceData;
  children: React.ReactNode;
}) {
  // Identity is already stable from the caller's useMemo; this second memo
  // just keeps the provider honest if a caller passes an inline object.
  const stable = useMemo(() => value, [value]);
  return <WorkspaceDataContext.Provider value={stable}>{children}</WorkspaceDataContext.Provider>;
}

export function useWorkspaceData(): WorkspaceData {
  const ctx = useContext(WorkspaceDataContext);
  if (!ctx) {
    throw new Error("useWorkspaceData must be called inside a WorkspaceDataProvider");
  }
  return ctx;
}
