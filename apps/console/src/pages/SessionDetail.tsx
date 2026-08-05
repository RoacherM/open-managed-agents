import { useMemo, useState } from "react";
import { useParams } from "react-router";

import { TimelineView } from "../components/timeline/TimelineView";
import { useApi } from "../lib/api";
import { eventTimestampMs, type Event } from "../lib/events";
import { ChatBanner, type SessionView } from "./session-detail/ChatBanner";
import { useSessionEvents } from "./session-detail/useSessionEvents";
import type { SessionResources } from "../workspace/ResourceCluster";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import {
  projectCanonicalChatTurns,
  type WireSessionEvent,
} from "@openma/common/session-events/managed";

/**
 * Session detail — orchestration only.
 *
 * The wire protocol lives in `useSessionEvents` (history + SSE + pending
 * outbox + metadata), and the whole visual surface lives under
 * `src/workspace/`: `WorkspaceShell` lays out the header, conversation
 * column, divider and panel dock, `ChatColumn` renders the stream and
 * composer. What's left here is the glue: thread selection, sending,
 * interrupting, and shaping state into the props those two want.
 */
export function SessionDetail() {
  const { id } = useParams();
  const { api } = useApi();
  const session = useSessionEvents(id);

  const [view, setView] = useState<SessionView>("chat");
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  /** Currently-active thread. Filters the events array at render time.
   *  SSE-driven new threads don't auto-switch — the operator stays on
   *  whatever they're watching. */
  const [activeThreadId, setActiveThreadId] = useState("sthr_primary");

  const send = async (text: string, files: File[]) => {
    const body = text.trim();
    if ((!body && files.length === 0) || !id) return;
    // Optimistic outbox slot so the typed text appears instantly rather
    // than after the 100-500ms POST → SSE roundtrip.
    session.setLocalPending(
      body || (files.length === 1 ? "🖼️ Image" : `🖼️ ${files.length} images`),
    );
    setSending(true);
    try {
      // Upload attachments first so the user.message can reference them by
      // file_id. Each file is scoped to this session via scope_id so it
      // appears in the Files panel and the agent's mount. Per-file failures
      // don't block the others — the text still goes out.
      const uploaded: Array<{ id: string; media_type: string }> = [];
      for (const file of files) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("scope_id", id);
          fd.append("downloadable", "true");
          const r = await api<{ id: string; media_type: string }>("/v1/files", {
            method: "POST",
            body: fd,
          });
          uploaded.push({ id: r.id, media_type: r.media_type });
        } catch (e) {
          console.error("file upload failed", file.name, e);
        }
      }

      // The + button is image-only — vision inputs go inline to the model.
      // Non-vision attachments belong on the env-mounted resources path and
      // aren't reachable from this button, so only `image` blocks are
      // emitted; anything that slipped past the accept filter is dropped
      // rather than sent as a document block the model may not handle.
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; source: { type: "file"; file_id: string } }
      > = [];
      if (body) content.push({ type: "text", text: body });
      for (const u of uploaded) {
        if (u.media_type.startsWith("image/")) {
          content.push({ type: "image", source: { type: "file", file_id: u.id } });
        }
      }
      if (!body && uploaded.length > 0) {
        content.unshift({
          type: "text",
          text: uploaded.length === 1 ? "Attached image." : "Attached images.",
        });
      }

      await api(`/v1/sessions/${id}/events`, {
        method: "POST",
        body: JSON.stringify({ events: [{ type: "user.message", content }] }),
      });
      // The server already inserted the row and broadcast
      // system.user_message_pending; clear our slot unless the SSE handler
      // already claimed it.
      session.setLocalPending((cur) => (cur === body ? null : cur));
    } catch {
      // api() already toasted; drop the optimistic slot so the user isn't
      // left with a pending row that will never run.
      session.setLocalPending(null);
    }
    setSending(false);
  };

  // Posts user.interrupt to abort whatever turn(s) are running on the
  // active thread. Server-side this fires the thread AbortController,
  // marks pending events cancelled, and emits status_idle — the recovery
  // path for a stuck-Running session whose stream a DO eviction killed.
  const interrupt = async () => {
    if (!id) return;
    setInterrupting(true);
    try {
      await api(`/v1/sessions/${id}/events`, {
        method: "POST",
        body: JSON.stringify({
          events: [{
            type: "user.interrupt",
            ...(activeThreadId !== "sthr_primary" ? { session_thread_id: activeThreadId } : {}),
          }],
        }),
      });
    } catch (e) {
      console.error("interrupt failed", e);
    }
    setInterrupting(false);
  };

  const { events } = session;

  const canonicalTurns = useMemo(
    () => projectCanonicalChatTurns(events as WireSessionEvent[], { threadId: activeThreadId }),
    [activeThreadId, events],
  );

  // Untagged events (legacy rows, spans that haven't been thread-stamped)
  // are treated as primary — matches the bridge filter in handleSSEStream.
  const threadEvents = useMemo(
    () =>
      events.filter(
        (e) => ((e as { session_thread_id?: string }).session_thread_id ?? "sthr_primary")
          === activeThreadId,
      ),
    [events, activeThreadId],
  );

  const pendingEvents = useMemo(
    () =>
      Array.from(session.pendingByEventId.values())
        .filter((p) => p.session_thread_id === activeThreadId)
        .sort((a, b) => a.pending_seq - b.pending_seq)
        .map((p) => ({ eventId: p.event_id, event: p.event })),
    [session.pendingByEventId, activeThreadId],
  );

  const resources = useMemo<SessionResources>(() => {
    const { agentSnapshot, environmentId, envSnapshot, vaults, vaultIds } = session.sessionMeta;
    const agentIdent = agentSnapshot?.id || session.agentId;
    const model = agentSnapshot?.model;
    return {
      agent: agentIdent
        ? {
            id: agentIdent,
            name: agentSnapshot?.name,
            model: typeof model === "string" ? model : model?.id,
            version: agentSnapshot?.version,
          }
        : undefined,
      environment: environmentId
        ? { id: environmentId, name: envSnapshot?.name, description: envSnapshot?.description }
        : undefined,
      vaults: vaults ?? vaultIds?.map((v) => ({ id: v })) ?? [],
    };
  }, [session.agentId, session.sessionMeta]);

  const durationMs = useMemo(() => sessionWallClock(events), [events]);

  if (!id) return null;

  return (
    <WorkspaceShell
      sessionId={id}
      status={session.status}
      durationMs={durationMs}
      resources={resources}
      trajectory={session.trajectory}
      events={events}
      chat={{
        turns: canonicalTurns,
        localPending: activeThreadId === "sthr_primary" ? session.localPending : null,
        pendingEvents,
        thinkingStreams: session.thinkingStreams,
        toolInputStreams: session.toolInputStreams,
        messageStreams: session.messageStreams,
        status: session.status,
        sending,
        onSend: send,
        streamOverride: view === "timeline" ? <TimelineView events={threadEvents} /> : undefined,
        banner: (
          <ChatBanner
            threads={session.threads}
            activeThreadId={activeThreadId}
            onSelectThread={setActiveThreadId}
            view={view}
            onSelectView={setView}
            eventCount={threadEvents.length}
            status={session.status}
            interrupting={interrupting}
            onInterrupt={() => void interrupt()}
            linear={session.linear}
            slack={session.slack}
          />
        ),
      }}
    />
  );
}

/** Wall-clock from the first to the last processed event. Null until at
 *  least two timestamped events have landed. */
function sessionWallClock(events: Event[]): number | null {
  let first = Infinity;
  let last = -Infinity;
  for (const e of events) {
    const t = eventTimestampMs(e);
    if (t === null) continue;
    if (t < first) first = t;
    if (t > last) last = t;
  }
  if (!Number.isFinite(first) || last <= first) return null;
  return last - first;
}
