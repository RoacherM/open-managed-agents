import { useEffect, useRef, useState } from "react";

import { useApi } from "../../lib/api";
import type { Event } from "../../lib/events";
import type { Trajectory } from "../../lib/trajectory";

/**
 * Session event-stream state.
 *
 * Everything that arrives over `GET /v1/sessions/:id/events` (history) and
 * the SSE tail lands here: the committed event log, the three in-flight
 * stream maps, live status, the server-mirrored pending outbox, the thread
 * roster, session metadata, and the lazily-fetched trajectory envelope.
 *
 * Extracted out of `SessionDetail` during the workspace refactor — the page
 * had grown to the point where the wire-protocol handling and the layout
 * orchestration were interleaved in one 1600-line component.
 */

/** A user.* event sitting in the server-side pending_events queue.
 *  Maintained client-side via system.user_message_pending / _promoted /
 *  _cancelled SSE frames. Server is authoritative on what's pending;
 *  the client mirrors the row for outbox rendering only. */
export interface PendingEntry {
  event_id: string;
  pending_seq: number;
  enqueued_at: number;
  session_thread_id: string;
  /** The full canonical user.* event the server enqueued. */
  event: Event;
}

export interface SessionMeta {
  environmentId?: string;
  vaultIds?: string[];
  vaults?: Array<{ id: string; display_name?: string }>;
  createdAt?: string;
  agentSnapshot?: {
    id?: string;
    name?: string;
    model?: string | { id: string };
    description?: string;
    version?: number;
  };
  envSnapshot?: { id?: string; name?: string; description?: string };
}

export interface LinearContext {
  issueId?: string;
  issueIdentifier?: string;
  workspaceId?: string;
}

export interface SlackContext {
  channelId?: string;
  threadTs?: string;
  workspaceId?: string;
  eventKind?: string;
  publicationId?: string;
}

export interface SessionEventsState {
  events: Event[];
  /** In-flight assistant text streams keyed by message_id. */
  messageStreams: Map<string, string>;
  /** In-flight reasoning streams keyed by thinking_id. */
  thinkingStreams: Map<string, string>;
  /** In-flight tool-input streams keyed by tool_use_id. The accumulated
   *  string is partial JSON — render as a code block, not Markdown. */
  toolInputStreams: Map<string, { name?: string; partial: string }>;
  status: string;
  agentId: string;
  sessionMeta: SessionMeta;
  linear: LinearContext | null;
  slack: SlackContext | null;
  trajectory: Trajectory | "loading" | "error" | undefined;
  /** Sub-agent threads only — primary is implicit, so an empty array means
   *  "single-threaded session, hide the selector entirely". */
  threads: Array<{ id: string; agent_name?: string; parent_thread_id?: string | null }>;
  pendingByEventId: Map<string, PendingEntry>;
  /** Optimistic outbox slot — what the user typed between hitting Send and
   *  the server's pending broadcast arriving. */
  localPending: string | null;
  setLocalPending: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useSessionEvents(id: string | undefined): SessionEventsState {
  const { api, streamEvents } = useApi();
  const [events, setEvents] = useState<Event[]>([]);
  const [messageStreams, setMessageStreams] = useState<Map<string, string>>(new Map());
  const [thinkingStreams, setThinkingStreams] = useState<Map<string, string>>(new Map());
  const [toolInputStreams, setToolInputStreams] = useState<
    Map<string, { name?: string; partial: string }>
  >(new Map());
  const [localPending, setLocalPending] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [sessionMeta, setSessionMeta] = useState<SessionMeta>({});
  const [linear, setLinear] = useState<LinearContext | null>(null);
  const [slack, setSlack] = useState<SlackContext | null>(null);
  const [status, setStatus] = useState("idle");
  const [trajectory, setTrajectory] = useState<Trajectory | "loading" | "error" | undefined>(
    undefined,
  );
  const [threads, setThreads] = useState<
    Array<{ id: string; agent_name?: string; parent_thread_id?: string | null }>
  >([]);
  const [pendingByEventId, setPendingByEventId] = useState<Map<string, PendingEntry>>(new Map());
  const seenKeys = useRef(new Set<string>());

  useEffect(() => {
    if (!id) return;
    // Full per-session state reset before loading the new id. The
    // canonical bug this fixes: clicking from /sessions/A to /sessions/B
    // re-runs this effect with a new id, but `events` (and everything
    // else below) was retained from session A. React only re-runs the
    // effect, it doesn't unmount/remount, so without an explicit reset
    // the user sees session A's content under session B's URL until the
    // SSE refill catches up. Reported 2026-05-13.
    seenKeys.current.clear();
    setEvents([]);
    setMessageStreams(new Map());
    setThinkingStreams(new Map());
    setToolInputStreams(new Map());
    setAgentId("");
    setSessionMeta({});
    setLinear(null);
    setSlack(null);
    setStatus("idle");
    setTrajectory(undefined);
    setThreads([]);
    setPendingByEventId(new Map());
    setLocalPending(null);

    // Dedup key for SSE re-delivery + initial-fetch overlap. `id` is
    // stamped on every event by the server (sevt-* for tool_results /
    // stream events; toolCallId for tool_use overrides) so it's a
    // uniqueness guarantee across the wire. The previous content-based
    // key dropped legitimate distinct events whose payloads happened to
    // be byte-identical (two back-to-back `gh repo list` calls both
    // timing out with the same 401 stderr was the repro). The fallback
    // only kicks in for legacy events that pre-date stamping.
    const eventKey = (e: Event) =>
      (e as { id?: string }).id
      ?? `${e.type}:${JSON.stringify(e.content || e.tool_use_id || e.error || "").slice(0, 120)}`;

    const addEvent = (raw: Record<string, unknown>) => {
      const ev = raw as Event;
      if (consumeStreamFrame(ev, { setMessageStreams, setThinkingStreams, setToolInputStreams })) {
        return;
      }

      const key = eventKey(ev);
      if (seenKeys.current.has(key)) return;
      seenKeys.current.add(key);

      if (ev.type === "session.status_running") setStatus("running");
      if (ev.type === "session.status_idle") setStatus("idle");
      // session.error → idle: defense-in-depth for the catch-all
      // status_idle emit (processUserMessage finally) in case a future
      // code path forgets to pair status_running with status_idle. Note:
      // do NOT also map status_rescheduled — that's a transient
      // retry-pending state, not a terminal one. Mapping it caused
      // observed pill flicker running→idle→running→idle×3 during
      // exponential-backoff retries (sess-y2bfxm1de4e1zqxm 2026-05-11).
      if (ev.type === "session.error") {
        setStatus("idle");
        // session.error implies the active turn is dead; the harness
        // won't pick anything else off the queue until the next
        // user.message, so drop the outbox rather than showing ghosts.
        setPendingByEventId(new Map());
      }

      // AMA-spec pending-queue notifications. The server is authoritative
      // on what's queued; mirror its state so the outbox renders without
      // polling /pending.
      if (ev.type === "system.user_message_pending") {
        const p = ev as unknown as PendingEntry & { event: Event };
        const innerText = (p.event as { content?: Array<{ type?: string; text?: string }> })
          .content?.find((c) => c.type === "text")?.text;
        // Server claimed our optimistic slot — drop the client-only
        // mirror so the same user message isn't rendered twice.
        if (innerText) setLocalPending((cur) => (cur === innerText ? null : cur));
        if (p.event_id) {
          setPendingByEventId((prev) => {
            const next = new Map(prev);
            next.set(p.event_id, {
              event_id: p.event_id,
              pending_seq: p.pending_seq,
              enqueued_at: p.enqueued_at,
              session_thread_id: p.session_thread_id ?? "sthr_primary",
              event: p.event,
            });
            return next;
          });
        }
        // System frame — don't add to the events list. The canonical
        // user.* event arrives separately at drain time.
        return;
      }
      if (ev.type === "system.user_message_promoted" || ev.type === "system.user_message_cancelled") {
        const eventId = (ev as { event_id?: string }).event_id;
        if (eventId) {
          setPendingByEventId((prev) => {
            if (!prev.has(eventId)) return prev;
            const next = new Map(prev);
            next.delete(eventId);
            return next;
          });
        }
        return;
      }
      // user.interrupt also clears the outbox client-side (the server
      // emits _cancelled per row above; this is defensive for the case
      // where the SDK posts user.interrupt without a thread filter).
      if (ev.type === "user.interrupt") {
        const tid = (ev as { session_thread_id?: string }).session_thread_id ?? "sthr_primary";
        setPendingByEventId((prev) => {
          if (prev.size === 0) return prev;
          const next = new Map(prev);
          for (const [k, v] of prev) {
            if (v.session_thread_id === tid) next.delete(k);
          }
          return next;
        });
      }
      // Live-update the thread selector when a sub-agent spawns. We don't
      // auto-switch the operator's view — they stay on whatever they're
      // watching; the new tab just appears alongside.
      if (ev.type === "session.thread_created") {
        const tc = ev as {
          session_thread_id?: string;
          agent_name?: string;
          parent_thread_id?: string | null;
        };
        if (tc.session_thread_id && tc.session_thread_id !== "sthr_primary") {
          setThreads((prev) =>
            prev.some((t) => t.id === tc.session_thread_id)
              ? prev
              : [
                  ...prev,
                  {
                    id: tc.session_thread_id!,
                    agent_name: tc.agent_name,
                    // SessionDO emits thread_created with parent_thread_id;
                    // older sessions (pre-Phase 1) may not — fall back to
                    // primary so the tree stays well-formed.
                    parent_thread_id: tc.parent_thread_id ?? "sthr_primary",
                  },
                ],
          );
        }
      }
      // Everything else falls through into `events`: Timeline uses span.*
      // and agent.thinking as turn boundaries, and the chat renderer
      // silently skips types it doesn't know, so keeping them costs the
      // conversation nothing and gives Timeline the full trajectory.

      // Tag streamed events with arrival time so the timeline has a usable
      // ts even before the server-side stored copy round-trips.
      if (!ev.ts) ev.ts = new Date().toISOString();
      setEvents((prev) => [...prev, ev]);
    };

    void loadSessionMeta(api, id, { setAgentId, setSessionMeta, setLinear, setSlack });
    void loadEventHistory(api, id, addEvent);

    const abort = new AbortController();
    streamEvents(id, addEvent, abort.signal);

    // Lazy-fetch the Trajectory envelope for the header chip and the
    // Trajectory panel. Decoupled from the session/events fetches —
    // trajectory builds on demand off the events log, so a 5xx here is
    // independent of session metadata loading. Live sessions intentionally
    // don't poll: outcome === "running" is fine, StatusPill already shows
    // the live status.
    setTrajectory("loading");
    api<Trajectory>(`/v1/sessions/${id}/trajectory`)
      .then(setTrajectory)
      .catch(() => setTrajectory("error"));

    // Threads list (primary + sub-agent). Primary is always present
    // (seeded by SessionDO on /init); filter it out so the selector only
    // renders when there's something to switch between.
    api<{ data: Array<{ id: string; agent_name?: string; parent_thread_id?: string | null }> }>(
      `/v1/sessions/${id}/threads`,
    )
      .then((res) => setThreads((res.data ?? []).filter((t) => t.id !== "sthr_primary")))
      .catch(() => setThreads([]));

    // Initial pending-queue snapshot. The SSE bridge picks up live changes;
    // this seeds the map so a reload mid-queue still shows the outbox.
    api<{ data: Array<PendingEntry & { data: Event }> }>(`/v1/sessions/${id}/pending`)
      .then((res) => {
        const next = new Map<string, PendingEntry>();
        for (const r of res.data ?? []) {
          if (!r.event_id) continue;
          next.set(r.event_id, {
            event_id: r.event_id,
            pending_seq: r.pending_seq,
            enqueued_at: r.enqueued_at,
            session_thread_id: r.session_thread_id,
            event: r.data,
          });
        }
        if (next.size > 0) setPendingByEventId(next);
      })
      .catch(() => {/* leave empty */});

    return () => abort.abort();
  }, [api, id, streamEvents]);

  return {
    events,
    messageStreams,
    thinkingStreams,
    toolInputStreams,
    status,
    agentId,
    sessionMeta,
    linear,
    slack,
    trajectory,
    threads,
    pendingByEventId,
    localPending,
    setLocalPending,
  };
}

/**
 * Handle the token-level streaming frames.
 *
 * None of these belong in the committed events list — they'd duplicate the
 * canonical event that follows. Instead they drive the three in-flight maps
 * the renderer overlays after committed events, and the matching canonical
 * event (same message_id / thinking_id / tool_use_id) drains the entry.
 *
 * Returns true when the frame was fully consumed and the caller should stop.
 */
function consumeStreamFrame(
  ev: Event,
  setters: {
    setMessageStreams: React.Dispatch<React.SetStateAction<Map<string, string>>>;
    setThinkingStreams: React.Dispatch<React.SetStateAction<Map<string, string>>>;
    setToolInputStreams: React.Dispatch<
      React.SetStateAction<Map<string, { name?: string; partial: string }>>
    >;
  },
): boolean {
  const { setMessageStreams, setThinkingStreams, setToolInputStreams } = setters;

  if (ev.type === "agent.message_stream_start" && ev.message_id) {
    openEntry<string>(setMessageStreams, ev.message_id, "");
    return true;
  }
  if (ev.type === "agent.message_chunk" && ev.message_id && typeof ev.delta === "string") {
    const mid = ev.message_id;
    const delta = ev.delta;
    setMessageStreams((prev) => new Map(prev).set(mid, (prev.get(mid) ?? "") + delta));
    return true;
  }
  // Hold the in-flight render until the canonical agent.message arrives —
  // keeps the UI stable through the gap between SSE stream_end and the
  // events-log commit. Aborted runs clean up the same way via recovery.
  if (ev.type === "agent.message_stream_end") return true;

  if (ev.type === "agent.thinking_stream_start" && typeof ev.thinking_id === "string") {
    openEntry<string>(setThinkingStreams, ev.thinking_id, "");
    return true;
  }
  if (ev.type === "agent.thinking_chunk"
    && typeof ev.thinking_id === "string"
    && typeof ev.delta === "string") {
    const tid = ev.thinking_id;
    const delta = ev.delta;
    setThinkingStreams((prev) => new Map(prev).set(tid, (prev.get(tid) ?? "") + delta));
    return true;
  }
  if (ev.type === "agent.thinking_stream_end") return true;

  if (ev.type === "agent.tool_use_input_stream_start" && ev.tool_use_id) {
    openEntry<{ name?: string; partial: string }>(setToolInputStreams, ev.tool_use_id, {
      name: (ev as { tool_name?: string }).tool_name,
      partial: "",
    });
    return true;
  }
  if (ev.type === "agent.tool_use_input_chunk" && ev.tool_use_id && typeof ev.delta === "string") {
    const tid = ev.tool_use_id;
    const delta = ev.delta;
    setToolInputStreams((prev) => {
      const cur = prev.get(tid);
      if (!cur) return prev;
      return new Map(prev).set(tid, { ...cur, partial: cur.partial + delta });
    });
    return true;
  }
  if (ev.type === "agent.tool_use_input_stream_end") return true;

  // Canonical events drain their in-flight counterpart but still belong in
  // the events list, so these fall through with `false`.
  if (ev.type === "agent.message" && ev.message_id) {
    closeEntry(setMessageStreams, ev.message_id);
  }
  if (ev.type === "agent.thinking") {
    const tid = typeof ev.thinking_id === "string" ? ev.thinking_id : undefined;
    setThinkingStreams((prev) => {
      if (prev.size === 0) return prev;
      if (tid && !prev.has(tid)) return prev;
      const next = new Map(prev);
      // Without a thinking_id we clear every live stream —
      // multi-stream-per-step is rare and it's safer to close them all
      // than to leave an orphan spinning forever.
      if (tid) next.delete(tid);
      else next.clear();
      return next;
    });
  }
  if ((ev.type === "agent.tool_use"
    || ev.type === "agent.mcp_tool_use"
    || ev.type === "agent.custom_tool_use") && ev.id) {
    closeEntry(setToolInputStreams, ev.id);
  }
  return false;
}

function openEntry<T>(
  setter: React.Dispatch<React.SetStateAction<Map<string, T>>>,
  key: string,
  value: T,
): void {
  setter((prev) => (prev.has(key) ? prev : new Map(prev).set(key, value)));
}

function closeEntry<T>(
  setter: React.Dispatch<React.SetStateAction<Map<string, T>>>,
  key: string,
): void {
  setter((prev) => {
    if (!prev.has(key)) return prev;
    const next = new Map(prev);
    next.delete(key);
    return next;
  });
}

type ApiFn = <T>(path: string, init?: RequestInit) => Promise<T>;

async function loadSessionMeta(
  api: ApiFn,
  id: string,
  setters: {
    setAgentId: (v: string) => void;
    setSessionMeta: React.Dispatch<React.SetStateAction<SessionMeta>>;
    setLinear: (v: LinearContext) => void;
    setSlack: (v: SlackContext) => void;
  },
): Promise<void> {
  const { setAgentId, setSessionMeta, setLinear, setSlack } = setters;
  let s: {
    environment_id?: string;
    vault_ids?: string[];
    created_at?: string;
    agent?: SessionMeta["agentSnapshot"];
    metadata?: Record<string, unknown>;
  };
  try {
    s = await api(`/v1/sessions/${id}`);
  } catch {
    return;
  }
  setAgentId(s.agent?.id || "");
  setSessionMeta({
    environmentId: s.environment_id,
    vaultIds: s.vault_ids,
    createdAt: s.created_at,
    agentSnapshot: s.agent,
  });

  // Live-resolve env + vault names by id. Per the id-only ref decision
  // (memory: session-resource-refs) the session API does not pre-bake
  // display data — clients fetch resources on demand. Names appear a tick
  // later; until then the resource cluster falls back to the short id.
  if (s.environment_id) {
    api<{ id: string; name?: string; description?: string }>(`/v1/environments/${s.environment_id}`)
      .then((env) => setSessionMeta((prev) => ({ ...prev, envSnapshot: env })))
      .catch(() => {});
  }
  if (s.vault_ids?.length) {
    Promise.all(
      s.vault_ids.map((vid) =>
        api<{ id: string; display_name?: string }>(`/v1/vaults/${vid}`)
          .then((v) => ({ id: v.id, display_name: v.display_name }))
          .catch(() => ({ id: vid })),
      ),
    ).then((vaults) => setSessionMeta((prev) => ({ ...prev, vaults })));
  }

  const linearMeta = s.metadata?.linear as LinearContext | undefined;
  if (linearMeta && (linearMeta.issueId || linearMeta.issueIdentifier)) setLinear(linearMeta);
  const slackMeta = s.metadata?.slack as SlackContext | undefined;
  if (slackMeta && (slackMeta.channelId || slackMeta.threadTs)) setSlack(slackMeta);
}

/**
 * Paginate the stored history ASC from seq 0 in pages of 200. Long sessions
 * stream older events progressively rather than blocking the UI on a single
 * 1000-row payload (which also silently truncated at the hard ceiling for
 * ultra-long histories). Each page is added as it arrives.
 */
async function loadEventHistory(
  api: ApiFn,
  id: string,
  addEvent: (e: Record<string, unknown>) => void,
): Promise<void> {
  let afterSeq = 0;
  // Bound the loop so a malformed `next_page` can never spin forever. Even
  // at 200/page this covers 100k events, well past what the sandbox SQL
  // store retains in practice.
  for (let i = 0; i < 500; i++) {
    try {
      const res = await api<{
        data: Array<{ seq?: number; type: string; ts?: string; data: Event }>;
        has_more?: boolean;
        next_page?: string | null;
      }>(`/v1/sessions/${id}/events?limit=200&order=asc&after_seq=${afterSeq}`);
      for (const e of res.data) {
        const inner = e.data || (e as unknown as Event);
        if (e.ts && !inner.ts) inner.ts = e.ts;
        if (e.seq !== undefined && inner.seq === undefined) inner.seq = e.seq;
        addEvent(inner);
      }
      if (!res.has_more || !res.next_page) break;
      // next_page is "seq_<n>" per session-do.ts:1568.
      const m = /^seq_(\d+)$/.exec(res.next_page);
      if (!m) break;
      const nextAfter = parseInt(m[1], 10);
      if (!Number.isFinite(nextAfter) || nextAfter <= afterSeq) break;
      afterSeq = nextAfter;
    } catch {
      break;
    }
  }
}
