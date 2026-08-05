import { useEffect, useMemo, useRef } from "react";

import type { Trajectory } from "../lib/trajectory";
import type { Event } from "../lib/events";
import { ChatColumn, type ChatColumnProps } from "./ChatColumn";
import { WorkspaceDataProvider, type WorkspaceData } from "./context";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceDock } from "./dock/WorkspaceDock";
import { BoltIcon, ChevronRightIcon } from "./dock/icons";
import { panelsForMode, workspacePanels } from "./dock/registry";
import type { SessionResources } from "./ResourceCluster";
import { CHAT_WIDTH_DEFAULT } from "./layout-state";
import { isChatStripped, useWorkspaceLayout } from "./useWorkspaceLayout";
import { useWorkspaceSignals } from "./useWorkspaceSignals";

/** Panel mounted when the user hits fullscreen straight from the solo
 *  shape — Files is the one panel that always has something to show. */
const DEFAULT_PANEL_ID = "files";

/**
 * Session workspace shell.
 *
 * Owns the adaptive layout only: the header band, the conversation column,
 * the divider, and the panel dock. Every piece of session data is passed in
 * by `SessionDetail`, which remains the single owner of fetching, the SSE
 * subscription, and sending.
 *
 *   ┌ header ─────────────────────────────────────────────┐
 *   │ crumb · status · outcome · resources ‖ tabs · ⤢     │
 *   ├──────────────────┬──────────────────────────────────┤
 *   │ ChatColumn       │ ⇔ │ WorkspaceDock                │
 *   └──────────────────┴──────────────────────────────────┘
 *
 * With no panel open the dock is translated off-screen and the chat column
 * fills the work area on a 760px reading measure. Below 768px the dock
 * becomes a bottom sheet layered over a full-width conversation.
 */
export function WorkspaceShell({
  sessionId,
  status,
  durationMs,
  resources,
  trajectory,
  events,
  chat,
}: {
  sessionId: string;
  status: string;
  durationMs: number | null;
  resources: SessionResources;
  trajectory: Trajectory | "loading" | "error" | undefined;
  events: Event[];
  /** Everything ChatColumn needs except the layout-derived `solo` flag and
   *  the auto-reveal notice, both of which the shell supplies. */
  chat: Omit<ChatColumnProps, "solo" | "notice">;
}) {
  const workAreaRef = useRef<HTMLDivElement | null>(null);
  const layout = useWorkspaceLayout(workAreaRef, DEFAULT_PANEL_ID);
  const { signals, files, filesError, refreshFiles, freshFilePaths, acknowledge } =
    useWorkspaceSignals(sessionId, events);

  const panels = useMemo(
    () => panelsForMode(workspacePanels, layout.isMobile ? "sheet" : "panel"),
    [layout.isMobile],
  );

  const openPanelId = layout.state.panelId;
  useEffect(() => {
    if (openPanelId) acknowledge(openPanelId);
  }, [openPanelId, acknowledge]);

  // Event-driven reveal. On desktop a fresh artifact pulls the workspace
  // open on the relevant tab; if the operator already has the dock open we
  // leave their tab alone rather than stealing focus. On touch a
  // full-screen sheet appearing unprompted would hijack the conversation,
  // so the chip below the stream offers the jump instead.
  const unseenFiles = signals.unseen.files ?? 0;
  const lastUnseen = useRef(unseenFiles);
  const { isMobile, openPanel } = layout;
  useEffect(() => {
    const grew = unseenFiles > lastUnseen.current;
    lastUnseen.current = unseenFiles;
    if (!grew || isMobile || openPanelId !== null) return;
    openPanel("files");
  }, [unseenFiles, isMobile, openPanelId, openPanel]);

  const showMobileChip = layout.isMobile && openPanelId === null && unseenFiles > 0;

  const data = useMemo<WorkspaceData>(
    () => ({ sessionId, trajectory, files, filesError, refreshFiles, freshFilePaths }),
    [sessionId, trajectory, files, filesError, refreshFiles, freshFilePaths],
  );

  const stripped = isChatStripped(layout);
  const solo = openPanelId === null;

  return (
    <WorkspaceDataProvider value={data}>
      <div className="flex flex-col h-full min-h-0 bg-bg">
        <WorkspaceHeader
          sessionId={sessionId}
          status={status}
          durationMs={durationMs}
          resources={resources}
          panels={panels}
          signals={signals}
          layout={layout}
        />

        <div ref={workAreaRef} className="flex-1 min-h-0 flex relative overflow-hidden">
          {/* Hidden rather than unmounted in fullscreen so the conversation
              keeps its scroll position and in-flight streams when the user
              drops back out. */}
          <section
            aria-label="Conversation"
            className={[
              "flex flex-col min-w-0 bg-bg border-r relative",
              solo ? "border-r-transparent" : "border-border",
              layout.isDragging ? "" : "transition-[flex-basis] duration-[var(--dur-slow)] ease-[var(--ease-soft)]",
              layout.state.fullscreen ? "hidden" : "",
            ].join(" ")}
            style={
              layout.chatBasis === null
                ? { flex: "1 1 auto" }
                : { flex: `0 0 ${layout.chatBasis}px` }
            }
          >
            {stripped ? (
              <div className="flex flex-col items-center gap-3.5 py-3 h-full">
                <button
                  onClick={layout.expandChat}
                  aria-label="Expand conversation"
                  title="Expand conversation"
                  className="grid place-items-center size-6.5 rounded-md text-fg-subtle hover:text-fg hover:bg-bg-surface transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
                >
                  <ChevronRightIcon className="size-3.5" />
                </button>
                <span
                  className={`size-1.5 rounded-full shrink-0 ${status === "running" ? "bg-info animate-pulse" : "bg-success"}`}
                />
                <span className="[writing-mode:vertical-rl] text-[12.5px] tracking-[0.4em] text-fg-subtle select-none">
                  对话
                </span>
              </div>
            ) : (
              <ChatColumn
                {...chat}
                solo={solo}
                notice={
                  showMobileChip ? (
                    <button
                      onClick={() => layout.openPanel("files")}
                      className="absolute left-1/2 bottom-full mb-2.5 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 h-8.5 px-3.5 rounded-full whitespace-nowrap bg-brand-subtle text-brand-hover border border-brand text-[12.5px] font-medium shadow-lg"
                    >
                      <BoltIcon className="size-3" />
                      Files 有新内容 · 查看
                    </button>
                  ) : null
                }
              />
            )}
          </section>

          {!solo && !layout.state.fullscreen && !layout.isMobile && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize conversation column"
              title="Drag to resize · double-click to reset"
              onPointerDown={layout.startDrag}
              onDoubleClick={layout.resetChatWidth}
              className="shrink-0 basis-1.5 -mx-0.5 z-20 cursor-col-resize group"
            >
              <span
                className={`block h-full mx-0.5 transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] ${
                  layout.isSnapping
                    ? "bg-warning"
                    : layout.isDragging
                      ? "bg-brand"
                      : "bg-transparent group-hover:bg-brand"
                }`}
              />
            </div>
          )}

          <WorkspaceDock
            sessionId={sessionId}
            panels={panels}
            signals={signals}
            layout={layout}
          />
        </div>
      </div>
    </WorkspaceDataProvider>
  );
}

/** Re-exported so SessionDetail can seed a sensible initial width without
 *  importing the layout-state module directly. */
export { CHAT_WIDTH_DEFAULT };
