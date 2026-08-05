import { Markdown } from "../components/Markdown";
import { Message, MessageContent } from "../components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "../components/ai-elements/tool";
import type { Event } from "../lib/events";

/**
 * Renders a single canonical event using ai-elements primitives.
 *
 * Lifted verbatim out of SessionDetail during the workspace refactor — the
 * orchestrator now only wires data, and both the chat column and any future
 * consumer of the event log reach for this.
 *
 * Type mapping:
 *   user.message              → <Message from="user|system">  (system for wakeups)
 *   agent.message             → <Message from="assistant"> + <Markdown>
 *   agent.thinking            → <Reasoning> + <ReasoningContent>
 *   agent.{tool_use,custom_tool_use,mcp_tool_use}
 *                             → <Tool> + <ToolHeader> + <ToolInput> + <ToolOutput>
 *   agent.tool_result (orphan only, paired ones folded into use above)
 *                             → <Tool state="output-available"> with only ToolOutput
 *   session.error             → red alert div  (no ai-elements equivalent)
 *   session.warning           → amber alert div  (same)
 *   anything else             → null  (timeline-only events that shouldn't appear in chat)
 */
export function EventRender({
  event,
  livePending = false,
  pairedResult,
  modelErrorCause,
}: {
  event: Event;
  /**
   * Caller-derived "no agent.* event has followed this user.* event
   * yet on the same thread" hint. The wire-level processed_at_ms
   * doesn't update live (no SSE re-broadcast on server UPDATE), so
   * we combine: pending iff (livePending AND wire-level says NULL)
   * OR (livePending true and we have no wire info yet). When livePending
   * is false we KNOW the agent has responded — drop the hourglass
   * regardless of wire state, otherwise the bubble would stay pending
   * for the entire turn even while the agent is mid-stream.
   */
  livePending?: boolean;
  /**
   * The matching `agent.tool_result` (or `agent.mcp_tool_result`) for
   * an `agent.tool_use` (or `custom_tool_use` / `mcp_tool_use`) event,
   * when present in the same filtered list. Caller pre-pairs by id and
   * suppresses the orphan tool_result render. Lets the Tool card show
   * input + output in one collapsible block instead of two disconnected
   * bubbles.
   */
  pairedResult?: Event;
  /**
   * Upstream model error context for `session.error` events. The
   * SSE-delivered session.error payload only carries a generic
   * "No output generated. Check the stream for errors." message; the
   * actionable cause (rate limit, billing, model 4xx, etc.) lives on
   * the preceding `span.model_request_end` with `is_error=true`. Caller
   * walks the events array and pairs them, passing the looked-up cause
   * here so operators see the real reason inline without diving into
   * the timeline tab. Only meaningful when `event.type === "session.error"`.
   */
  modelErrorCause?: { error: string; model?: string };
}) {
  // AMA pending lifecycle (set by event-log adapter from row.processed_at /
  // row.cancelled_at). Cancelled events stay in the log for audit but
  // the LLM never sees them (eventsToMessages skips); show them with
  // strikethrough so operators know the user retracted them.
  const meta = event as { processed_at_ms?: number | null; cancelled_at_ms?: number | null };
  // The hourglass shows when BOTH conditions hold:
  //   1. Caller says no later non-user event has arrived (livePending)
  //   2. Wire-level processed_at_ms agrees (still null)
  // Either condition flipping → no longer pending.
  const isPending =
    livePending &&
    meta.processed_at_ms == null &&
    meta.cancelled_at_ms == null;
  const isCancelled = meta.cancelled_at_ms != null;

  switch (event.type) {
    case "user.message": {
      // Wakeups synthesized by the schedule tool's onScheduledWakeup callback
      // also wire-type as user.message (per EventBase metadata convention),
      // but the user did NOT send them — visually distinguish so operators
      // don't get confused. metadata.harness === "schedule" + kind === "wakeup"
      // is the contract: see apps/agent/src/runtime/session-do.ts:onScheduledWakeup.
      const metadata = (event as { metadata?: { harness?: string; kind?: string; scheduled_at?: string } }).metadata;
      const isWakeup = metadata?.harness === "schedule" && metadata?.kind === "wakeup";
      const text = Array.isArray(event.content) ? event.content[0]?.text ?? "" : "";

      if (isWakeup) {
        // System-origin: left-aligned via from="system" (Message only
        // applies its right-aligned brand bubble for from="user"; anything
        // else lays out as plain assistant text). Layered on top is a
        // small info chip identifying the wakeup + the scheduled time
        // tooltip for traceability.
        const scheduledAt = metadata?.scheduled_at;
        return (
          <Message from="system">
            <div className="flex items-center gap-1.5 text-xs text-fg-subtle mb-1">
              <span
                className="inline-flex items-center gap-1 rounded-full bg-info-subtle text-info px-2 py-0.5 font-medium text-[11px]"
                title={scheduledAt ? `Scheduled at ${scheduledAt}` : undefined}
              >
                <span aria-hidden>🕒</span>
                Scheduled wakeup
              </span>
            </div>
            <MessageContent className="rounded-2xl rounded-bl-sm px-4 py-3 bg-info-subtle text-info">
              {text}
            </MessageContent>
          </Message>
        );
      }

      // Cancelled: render strikethrough + muted so the audit trail is
      // visible without competing with live messages. Pending: dotted
      // border + hourglass label since drainEventQueue hasn't picked it
      // up yet. Live: default ai-elements user bubble (right-aligned,
      // bg-secondary which we've aliased to OMA's bg-surface).
      const cancelledOverride = "line-through opacity-70";
      const pendingOverride = "opacity-80";
      return (
        <Message from="user">
          {(isPending || isCancelled) && (
            <div className="text-xs text-fg-subtle text-right flex items-center justify-end gap-1">
              {isPending && <span aria-hidden>⏳</span>}
              {isCancelled && <span aria-hidden>✗</span>}
              <span>{isCancelled ? "Retracted" : "Pending…"}</span>
            </div>
          )}
          <MessageContent
            className={isCancelled ? cancelledOverride : isPending ? pendingOverride : undefined}
          >
            {text}
          </MessageContent>
        </Message>
      );
    }

    case "agent.message": {
      const text = (Array.isArray(event.content) ? event.content : [])
        .map((b) => b.text)
        .join("");
      return (
        <Message from="assistant">
          <MessageContent>
            <Markdown>{text}</Markdown>
          </MessageContent>
        </Message>
      );
    }

    case "agent.thinking": {
      // Canonical reasoning block — keep it visible after streaming
      // finishes. <Reasoning> defaults closed unless isStreaming; we
      // pass defaultOpen={false} so committed thoughts don't push the
      // active conversation off-screen but stay one click away.
      const text = (event as { text?: string }).text ?? "";
      if (!text) return null;
      return (
        <Reasoning isStreaming={false} defaultOpen={false}>
          <ReasoningTrigger />
          <ReasoningContent>{text}</ReasoningContent>
        </Reasoning>
      );
    }

    case "agent.tool_use":
    case "agent.custom_tool_use":
    case "agent.mcp_tool_use": {
      // All three use-types share the same shape (id + name + input);
      // MCP additionally carries mcp_server_name which we append to
      // the title so operators can tell built-in vs MCP at a glance.
      const mcpServerName =
        event.type === "agent.mcp_tool_use"
          ? (event as { mcp_server_name?: string }).mcp_server_name
          : undefined;
      const baseName = event.name ?? "tool";
      const title = mcpServerName ? `${baseName} (mcp · ${mcpServerName})` : baseName;
      // Result text — Tool's <ToolOutput> takes the raw value and will
      // either CodeBlock-stringify an object or render a string in a
      // CodeBlock. We pre-stringify content arrays since they're an
      // OMA-specific shape, not a JSON-friendly object.
      const rawContent = pairedResult
        ? (pairedResult as { content?: unknown }).content
        : undefined;
      const output: unknown = rawContent === undefined
        ? undefined
        : typeof rawContent === "string"
          ? rawContent
          : JSON.stringify(rawContent, null, 2);
      // is_error is set by the agent runtime when a tool call failed
      // (bash non-zero exit + stderr surfaced, mcp tool returned an
      // error envelope, _finalizeStaleTurns injected an abort placeholder
      // for DO-eviction recovery, etc.). When present we route the same
      // payload through ToolOutput.errorText so the Tool block renders
      // in destructive styling, and badge to 'output-error' so the
      // header pill shows Failed instead of Completed. Without this,
      // bash returning "Sandbox container failed to start after 10
      // attempts..." looked identical to a successful run.
      const isError = pairedResult
        ? Boolean((pairedResult as { is_error?: boolean }).is_error)
        : false;
      const errorText = isError
        ? (typeof output === "string" ? output : JSON.stringify(output ?? null))
        : undefined;
      const state = pairedResult
        ? (isError ? "output-error" : "output-available")
        : "input-available";
      return (
        <Tool>
          <ToolHeader type="dynamic-tool" toolName={title} state={state} />
          <ToolContent>
            <ToolInput input={event.input ?? {}} />
            <ToolOutput
              output={isError ? undefined : output}
              errorText={errorText}
            />
          </ToolContent>
        </Tool>
      );
    }

    case "agent.tool_result":
    case "agent.mcp_tool_result": {
      // Orphan tool_result — caller couldn't pair it with a tool_use
      // (race / out-of-order delivery, or recovery-injected placeholder).
      // Render a degenerate Tool with output-only so the visual is still
      // a "tool" card (matching the rest of the timeline) but the header
      // signals it stands alone.
      const rawContent = (event as { content?: unknown }).content;
      const output: unknown = rawContent === undefined
        ? undefined
        : typeof rawContent === "string"
          ? rawContent
          : JSON.stringify(rawContent, null, 2);
      return (
        <Tool>
          <ToolHeader
            type="dynamic-tool"
            toolName="tool result (unpaired)"
            state="output-available"
          />
          <ToolContent>
            <ToolOutput output={output} errorText={undefined} />
          </ToolContent>
        </Tool>
      );
    }

    case "session.error":
      return (
        <div className="max-w-2xl bg-danger-subtle rounded-lg px-4 py-2.5 text-sm text-danger">
          <div>Error: {event.error}</div>
          {modelErrorCause && (
            <div className="mt-1.5 pt-1.5 text-[12px] opacity-90">
              <span className="font-medium">Cause</span>
              {modelErrorCause.model && (
                <span className="ml-1 font-mono opacity-75">({modelErrorCause.model})</span>
              )}
              : {modelErrorCause.error}
            </div>
          )}
        </div>
      );

    case "session.warning":
      return (
        <div className="max-w-2xl bg-warning-subtle rounded-lg px-4 py-2.5 text-sm text-warning">
          <div className="font-medium mb-0.5">Warning ({String(event.source ?? "")})</div>
          <div>{String(event.message ?? "")}</div>
        </div>
      );

    default:
      return null;
  }
}
