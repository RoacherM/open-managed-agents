import { toast } from "sonner";

import { Markdown } from "../components/Markdown";
import { CanonicalSessionTurn } from "../components/session/CanonicalSessionTurn";
import { CodeBlock } from "../components/ai-elements/code-block";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../components/ai-elements/conversation";
import { Message, MessageContent } from "../components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "../components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader } from "../components/ai-elements/tool";
import type { CanonicalChatTurn } from "@openma/common/session-events/managed";
import type { Event } from "../lib/events";
import { EventRender } from "./EventRender";

/**
 * Conversation column — the message stream plus the composer.
 *
 * Everything session-scoped (fetching, SSE, send) stays in SessionDetail;
 * this component is a pure render of what it was handed, so the workspace
 * shell can resize / collapse / hide it without the data layer noticing.
 */
export interface ChatColumnProps {
  turns: CanonicalChatTurn[];
  /** Optimistic outbox slot — what the user typed before the server's
   *  system.user_message_pending broadcast lands. */
  localPending: string | null;
  /** Server-mirrored pending queue rows for the active thread, in order. */
  pendingEvents: Array<{ eventId: string; event: Event }>;
  thinkingStreams: Map<string, string>;
  toolInputStreams: Map<string, { name?: string; partial: string }>;
  messageStreams: Map<string, string>;
  status: string;
  sending: boolean;
  /** Rendered above the composer — the mobile "new content" chip. */
  notice?: React.ReactNode;
  /** Strip above the stream: thread selector, view switch, and the Linear /
   *  Slack context bars for webhook-triggered sessions. */
  banner?: React.ReactNode;
  /** Replaces the message stream while keeping the composer — used by the
   *  Timeline view, which reads the same events through a different lens. */
  streamOverride?: React.ReactNode;
  /** Wider reading measure when the conversation has the surface to itself. */
  solo: boolean;
  onSend: (text: string, files: File[]) => Promise<void>;
}

export function ChatColumn({
  turns,
  localPending,
  pendingEvents,
  thinkingStreams,
  toolInputStreams,
  messageStreams,
  status,
  sending,
  notice,
  banner,
  streamOverride,
  solo,
  onSend,
}: ChatColumnProps) {
  // 760px when the conversation is alone on the surface, unconstrained once
  // the workspace takes the other half — at a 420px column an extra measure
  // cap would leave the text hugging one edge.
  const measure = solo ? "max-w-190 mx-auto w-full" : "";

  if (streamOverride) {
    return (
      <>
        {banner}
        {streamOverride}
        <Composer sending={sending} measure={measure} notice={notice} onSend={onSend} />
      </>
    );
  }

  return (
    <>
      {banner}
      {/* Conversation surface. ai-elements <Conversation> wraps
          StickToBottom, which auto-pins to the latest message while the
          user is at the bottom and surfaces a "jump to latest" affordance
          the moment they scroll up.

          Render order intentionally mirrors the pre-workspace layout:
            1) canonical turns
            2) optimistic outbox slot (instant feedback on Send)
            3) server-mirrored pending outbox (queued user.* events)
            4) in-flight thinking streams
            5) in-flight tool-input streams
            6) in-flight assistant text streams
            7) typing dots when only the agent is "thinking" with nothing
               else streaming yet */}
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className={`px-3.5 py-6 gap-4 ${measure}`}>
          {/* turn.id alone is NOT unique on the Node runtime: user.message
              events carry no id, so the projection falls back to the
              literal "user-message" for every turn. Duplicate React keys
              made reconciliation swallow whole turns on re-render (13 of
              22 rendered in sess-1wo4h2scx1ht3ttl). The first raw event's
              seq is stable and unique per turn; index is the last-ditch
              fallback for id-less AND seq-less legacy turns. */}
          {turns.map((turn, i) => (
            <CanonicalSessionTurn
              key={`${turn.id}:${(turn.rawEvents[0] as { seq?: number } | undefined)?.seq ?? i}`}
              turn={turn}
            />
          ))}
          {localPending && (
            <EventRender
              key="local-pending"
              event={{ type: "user.message", content: [{ type: "text", text: localPending }] } as Event}
              livePending
            />
          )}
          {pendingEvents.map((p) => (
            <EventRender key={`pending-${p.eventId}`} event={p.event} livePending />
          ))}
          {Array.from(thinkingStreams.entries()).map(([tid, text]) => (
            <Reasoning key={`think-${tid}`} isStreaming defaultOpen>
              <ReasoningTrigger />
              <ReasoningContent>{text}</ReasoningContent>
            </Reasoning>
          ))}
          {Array.from(toolInputStreams.entries()).map(([tid, { name, partial }]) => (
            <Tool key={`tin-${tid}`} defaultOpen>
              <ToolHeader type="dynamic-tool" toolName={name ?? "tool"} state="input-streaming" />
              <ToolContent>
                {partial && (
                  <div className="space-y-2 overflow-hidden">
                    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                      Streaming input
                    </h4>
                    <div className="rounded-md bg-muted/50">
                      <CodeBlock code={partial} language="json" />
                    </div>
                  </div>
                )}
              </ToolContent>
            </Tool>
          ))}
          {Array.from(messageStreams.entries()).map(([mid, text]) => (
            <Message key={`stream-${mid}`} from="assistant">
              <MessageContent>
                <Markdown>{text}</Markdown>
                <span className="inline-block w-1.5 h-3.5 bg-fg-subtle/50 align-middle ml-0.5 animate-pulse" />
              </MessageContent>
            </Message>
          ))}
          {status === "running"
            && messageStreams.size === 0
            && thinkingStreams.size === 0
            && toolInputStreams.size === 0 && (
            <div className="flex gap-1 py-2">
              <span className="w-1.5 h-1.5 bg-fg-subtle rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 bg-fg-subtle rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 bg-fg-subtle rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <Composer sending={sending} measure={measure} notice={notice} onSend={onSend} />
    </>
  );
}

/**
 * Composer. ai-elements <PromptInput> wraps a <form> with an InputGroup-
 * based textarea + attachment lifecycle; onSubmit hands back to the
 * caller's send() so POST /events stays the source of truth. The + button
 * only accepts images — they go inline to the model as vision inputs.
 */
function Composer({
  sending,
  measure,
  notice,
  onSend,
}: {
  sending: boolean;
  measure: string;
  notice?: React.ReactNode;
  onSend: (text: string, files: File[]) => Promise<void>;
}) {
  return (
    <div className="relative shrink-0 px-3.5 pb-4 bg-bg">
      {notice}
      <div className={measure}>
        <PromptInput
          accept="image/*"
          multiple
          maxFiles={10}
          maxFileSize={25 * 1024 * 1024}
          onError={(err) => toast.error(err.message)}
          globalDrop
          onSubmit={async ({ text, files }) => {
            const rawFiles = files
              .map((f) => (f as { file?: File }).file)
              .filter((f): f is File => f instanceof File);
            await onSend(text, rawFiles);
          }}
        >
          <PromptInputTextarea
            placeholder="Send a message…  (drag an image in or click ＋)"
            disabled={sending}
          />
          <PromptInputFooter>
            <PromptInputTools>
              <AttachButton />
            </PromptInputTools>
            <PromptInputSubmit status={sending ? "submitted" : undefined} disabled={sending} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

/**
 * Plain "+" button that opens the PromptInput file picker for images.
 * The stock `PromptInputActionAddAttachments` from ai-elements is a
 * DropdownMenuItem — meant to live inside an action-menu — so dropping it
 * directly into PromptInputTools threw "MenuItem must be used within Menu"
 * at render. This button reads the attachments controller from context and
 * calls `openFileDialog()` directly, no menu required.
 */
function AttachButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      type="button"
      onClick={() => attachments.openFileDialog()}
      aria-label="Add image"
      title="Add image"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </PromptInputButton>
  );
}
