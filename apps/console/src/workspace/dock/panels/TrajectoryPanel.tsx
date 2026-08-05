import { Button } from "@/components/ui/button";

import { rewardHeadline } from "../../../lib/trajectory";
import { useWorkspaceData } from "../../context";
import { TrajectoryIcon } from "../icons";

/**
 * Trajectory — the Trajectory v1 envelope as a resident panel.
 *
 * Content is the former `TrajectoryViewerModal` body (pretty-printed JSON
 * plus a download). The modal stays exported for any caller still opening
 * it, but this tab is the primary entry point now, so the summary strip
 * the modal put in its dialog subtitle moves inline here.
 */
export function TrajectoryPanel({ sessionId }: { sessionId: string }) {
  const { trajectory } = useWorkspaceData();
  const ready = trajectory && trajectory !== "loading" && trajectory !== "error";
  const json = ready ? JSON.stringify(trajectory, null, 2) : "";

  function download() {
    if (!ready) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trajectory-${sessionId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (!ready) {
    return (
      <div className="flex-1 min-h-0 grid place-items-center px-6 text-center">
        <div className="flex flex-col items-center gap-3 max-w-80">
          <div className="grid place-items-center size-12 rounded-xl bg-bg-surface border border-border">
            <TrajectoryIcon className="size-6 text-fg-subtle" />
          </div>
          {trajectory === "loading" && (
            <div className="text-sm text-fg-muted">Loading trajectory…</div>
          )}
          {trajectory === "error" && (
            <div className="text-sm text-danger leading-relaxed">
              Trajectory unavailable. The session may not have any events yet, or the sandbox
              worker is unreachable. Reload the page to retry.
            </div>
          )}
          {trajectory === undefined && (
            <div className="text-sm text-fg-muted">No trajectory loaded yet.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-8.5 shrink-0 flex items-center gap-2 pl-3.5 pr-3 border-b border-border">
        <span className="font-mono text-xs text-fg truncate">{trajectory.trajectory_id}</span>
        <span className="font-mono text-[10.5px] text-fg-subtle shrink-0">
          outcome: {trajectory.outcome}
          {trajectory.reward ? ` · reward: ${rewardHeadline(trajectory.reward)}` : ""}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={download}>
          Download JSON
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <pre className="font-mono text-[11px] bg-bg-surface rounded-lg px-3 py-2 text-fg whitespace-pre">
          {json}
        </pre>
      </div>
    </div>
  );
}
