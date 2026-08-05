import { Link } from "react-router";

import type { LinearContext, SlackContext } from "./useSessionEvents";

export type SessionView = "chat" | "timeline";

/**
 * Strip above the conversation stream.
 *
 * Carries the parts of the pre-workspace page header that the new session
 * header band has no room for and that the interaction prototype doesn't
 * cover: the sub-agent thread tree, the Conversation/Timeline switch, the
 * Stop button, and the Linear / Slack context bars for webhook-triggered
 * sessions. Everything here collapses to a single ~34px row for the common
 * case (single-threaded session, no integration context).
 */
export function ChatBanner({
  threads,
  activeThreadId,
  onSelectThread,
  view,
  onSelectView,
  eventCount,
  status,
  interrupting,
  onInterrupt,
  linear,
  slack,
}: {
  threads: Array<{ id: string; agent_name?: string; parent_thread_id?: string | null }>;
  activeThreadId: string;
  onSelectThread: (id: string) => void;
  view: SessionView;
  onSelectView: (view: SessionView) => void;
  eventCount: number;
  status: string;
  interrupting: boolean;
  onInterrupt: () => void;
  linear: LinearContext | null;
  slack: SlackContext | null;
}) {
  return (
    <div className="shrink-0">
      {threads.length > 0 && (
        <ThreadTree threads={threads} activeThreadId={activeThreadId} onSelect={onSelectThread} />
      )}
      <div className="px-3.5 flex items-center gap-1">
        <ViewTab label="Conversation" active={view === "chat"} onClick={() => onSelectView("chat")} />
        <ViewTab label="Timeline" active={view === "timeline"} onClick={() => onSelectView("timeline")} />
        {view === "timeline" && (
          <span className="ml-2 text-xs text-fg-subtle font-mono">{eventCount} events</span>
        )}
        {/* Stop / Interrupt — only while the session is actively running.
            Posts user.interrupt scoped to the active thread; the server
            fires the thread AbortController, flushes pending events, and
            emits status_idle. Recovery path for stuck-Running sessions
            where a DO eviction killed the stream. */}
        {status === "running" && (
          <button
            onClick={onInterrupt}
            disabled={interrupting}
            className="ml-auto inline-flex items-center justify-center px-2.5 py-1 min-h-11 sm:min-h-0 rounded-md text-xs font-medium bg-bg-surface/60 text-fg-muted hover:bg-bg-surface hover:text-fg disabled:opacity-50 transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
            title="Interrupt the active turn on this thread"
          >
            {interrupting ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>

      {linear && (
        <div className="px-3.5 py-2 bg-info-subtle text-xs flex items-center gap-2 text-info">
          <span>🔗</span>
          <span className="font-medium">Linear</span>
          <span className="opacity-60">·</span>
          <span>
            issue <span className="font-mono">{linear.issueIdentifier ?? linear.issueId}</span>
          </span>
          {linear.workspaceId && (
            <a href="https://linear.app" target="_blank" rel="noreferrer" className="ml-auto hover:underline">
              Open in Linear ↗
            </a>
          )}
        </div>
      )}

      {slack && (
        <div className="px-3.5 py-2 bg-accent-violet-subtle text-xs flex items-center gap-2 text-accent-violet flex-wrap">
          <span>💬</span>
          <span className="font-medium">Slack</span>
          <span className="opacity-60">·</span>
          <span>
            {slack.channelId ? (
              slack.workspaceId ? (
                <a
                  href={`slack://channel?team=${slack.workspaceId}&id=${slack.channelId}`}
                  className="font-mono underline hover:no-underline"
                  title="Open in Slack desktop"
                >
                  channel {slack.channelId} ↗
                </a>
              ) : (
                <>
                  channel <span className="font-mono">{slack.channelId}</span>
                </>
              )
            ) : (
              "—"
            )}
            {slack.threadTs && (
              <>
                {" "}thread <span className="font-mono">{slack.threadTs}</span>
              </>
            )}
          </span>
          {slack.eventKind && (
            <span className="opacity-60 font-mono uppercase tracking-wider text-[10px]">
              {slack.eventKind}
            </span>
          )}
          {slack.publicationId && (
            <>
              <span className="opacity-60">·</span>
              <Link
                to={`/integrations/slack/publish?pub=${slack.publicationId}`}
                className="underline hover:no-underline"
                title="Open the Slack publication this session is bound to"
              >
                publication →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ViewTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  // Ghost pill rather than an underline: the session header a few pixels
  // above already owns a sliding underline for the workspace tabs, and a
  // second one here reads as two competing tab rows.
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={`inline-flex items-center justify-center px-2.5 py-1 min-h-11 sm:min-h-0 text-xs rounded-md my-1.5 transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] ${
        active
          ? "bg-bg-surface text-brand font-semibold"
          : "text-fg-subtle hover:text-fg-muted hover:bg-bg-surface/60"
      }`}
    >
      {label}
    </button>
  );
}

/** Tighter visual than ViewTab — sub-agent tabs typically need to fit more
 *  than the 2-3 view options. Smaller padding + horizontal scroll in the
 *  parent keeps long sub-agent rosters readable. */
function ThreadTab({
  label,
  active,
  onClick,
  depth = 0,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  depth?: number;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={`py-1 min-h-11 sm:min-h-0 text-xs whitespace-nowrap rounded-md my-1 transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] flex items-center gap-1 ${
        active
          ? "bg-bg-surface text-info font-semibold"
          : "text-fg-subtle hover:text-fg-muted hover:bg-bg-surface/60"
      }`}
      style={{ paddingLeft: `${0.75 + depth * 0.75}rem`, paddingRight: "0.75rem" }}
    >
      {/* Tree branch glyph for depth>0 — visual cue that this thread was
          spawned by another rather than being a sibling of Main. */}
      {depth > 0 && <span className="text-fg-subtle">└</span>}
      <span>{label}</span>
    </button>
  );
}

/**
 * Depth-indented thread tree. Root = sthr_primary (rendered as "Main");
 * children indented by parent_thread_id. DFS pre-order so the tree reads
 * top-to-bottom like a stack trace: parents above their children.
 *
 * Orphans (parent_thread_id pointing at a thread we don't know about —
 * possible mid-spawn race or stale snapshot) get re-parented to
 * sthr_primary so they stay visible instead of hiding in a dangling
 * subtree.
 */
function ThreadTree({
  threads,
  activeThreadId,
  onSelect,
}: {
  threads: Array<{ id: string; agent_name?: string; parent_thread_id?: string | null }>;
  activeThreadId: string;
  onSelect: (id: string) => void;
}) {
  const knownIds = new Set<string>(["sthr_primary", ...threads.map((t) => t.id)]);
  const childrenOf = new Map<string, typeof threads>();
  for (const t of threads) {
    const parent =
      t.parent_thread_id && knownIds.has(t.parent_thread_id) ? t.parent_thread_id : "sthr_primary";
    const arr = childrenOf.get(parent) ?? [];
    arr.push(t);
    childrenOf.set(parent, arr);
  }
  const flat: Array<{ id: string; label: string; depth: number }> = [
    { id: "sthr_primary", label: "Main", depth: 0 },
  ];
  const walk = (parentId: string, depth: number) => {
    for (const k of childrenOf.get(parentId) ?? []) {
      flat.push({ id: k.id, label: k.agent_name ?? k.id.slice(0, 12), depth });
      walk(k.id, depth + 1);
    }
  };
  walk("sthr_primary", 1);
  const maxDepth = flat.reduce((m, n) => Math.max(m, n.depth), 0);
  // Shallow trees (one layer of workers under Main) keep the horizontal
  // row; deeper trees switch to a vertical stack so the indentation is
  // actually readable.
  const isFlat = maxDepth <= 1;
  return (
    <div
      role="tablist"
      aria-label="Threads"
      className={
        isFlat
          ? "px-3.5 flex items-center gap-1 shrink-0 overflow-x-auto"
          : "px-3.5 py-1 flex flex-col items-stretch shrink-0 overflow-y-auto max-h-40"
      }
    >
      {flat.map((n) => (
        <ThreadTab
          key={n.id}
          label={n.label}
          depth={isFlat ? 0 : n.depth}
          active={activeThreadId === n.id}
          onClick={() => onSelect(n.id)}
        />
      ))}
    </div>
  );
}
