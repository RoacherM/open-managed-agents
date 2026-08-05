import { useRef, useState } from "react";

import { CloseIcon } from "./icons";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { findPanel, type WorkspacePanelDefinition, type WorkspaceSignals } from "./registry";
import type { WorkspaceLayoutApi } from "../useWorkspaceLayout";

/**
 * Panel host.
 *
 * Desktop: a plain flex sibling of the conversation column that slides in
 * from the right — the transition lives on the chat column's flex-basis, so
 * the dock only needs to fade its contents to avoid a visible reflow while
 * the width interpolates.
 *
 * Touch (<768px): a full-screen bottom sheet layered over the conversation,
 * with its own header carrying the grab handle, a horizontally scrolling
 * tab strip, and a close button.
 */
export function WorkspaceDock({
  sessionId,
  panels,
  signals,
  layout,
}: {
  sessionId: string;
  panels: WorkspacePanelDefinition[];
  signals: WorkspaceSignals;
  layout: WorkspaceLayoutApi;
}) {
  const active = findPanel(panels, layout.state.panelId);
  const open = layout.state.panelId !== null;

  if (layout.isMobile) {
    return (
      <MobileSheet
        open={open}
        panels={panels}
        signals={signals}
        activePanelId={layout.state.panelId}
        onSelect={layout.togglePanel}
        onClose={layout.closeWorkspace}
      >
        {active && <active.mount sessionId={sessionId} displayMode="sheet" signals={signals} />}
      </MobileSheet>
    );
  }

  return (
    <section
      aria-label="Workspace"
      className="flex-1 min-w-0 flex flex-col bg-bg overflow-hidden"
    >
      <div
        className={`flex-1 min-h-0 flex flex-col transition-[opacity,transform] duration-[var(--dur-slow)] ease-[var(--ease-soft)] ${
          open ? "opacity-100" : "opacity-0 translate-x-7 pointer-events-none"
        }`}
      >
        {active && <active.mount sessionId={sessionId} displayMode="panel" signals={signals} />}
      </div>
    </section>
  );
}

function MobileSheet({
  open,
  panels,
  signals,
  activePanelId,
  onSelect,
  onClose,
  children,
}: {
  open: boolean;
  panels: WorkspacePanelDefinition[];
  signals: WorkspaceSignals;
  activePanelId: string | null;
  onSelect: (panelId: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [dragY, setDragY] = useState(0);
  const dragging = useRef(false);
  const startY = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    startY.current = e.clientY;
    setDragY(0);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setDragY(Math.max(0, e.clientY - startY.current));
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // Past ~90px of pull the gesture reads as a dismissal rather than a
    // mis-grab, matching the platform sheet convention.
    if (dragY > 90) onClose();
    setDragY(0);
  };

  return (
    <section
      aria-label="Workspace"
      aria-hidden={!open}
      className="fixed inset-0 z-40 flex flex-col bg-bg border-t border-border pb-[env(safe-area-inset-bottom)]"
      style={{
        transform: open ? `translateY(${dragY}px)` : "translateY(100%)",
        transition: dragging.current ? "none" : "transform var(--dur-slow) var(--ease-soft)",
      }}
    >
      <div className="shrink-0 flex flex-col border-b border-border bg-bg">
        <div
          role="button"
          aria-label="Drag down to dismiss"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="h-5.5 flex items-center justify-center touch-none cursor-grab active:cursor-grabbing"
        >
          <span className="w-9.5 h-1 rounded-full bg-border-strong" />
        </div>
        <div className="flex items-center gap-1.5 pl-2.5 pr-1.5 pb-1.5 min-w-0">
          <div className="flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <WorkspaceTabs
              panels={panels}
              signals={signals}
              activePanelId={activePanelId}
              onSelect={onSelect}
              variant="segmented"
            />
          </div>
          <button
            onClick={onClose}
            aria-label="Close workspace"
            className="shrink-0 grid place-items-center size-11 rounded-md text-fg-subtle hover:text-fg hover:bg-bg-surface transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
          >
            <CloseIcon className="size-4.5" />
          </button>
        </div>
      </div>
      {open && <div className="flex-1 min-h-0 flex flex-col">{children}</div>}
    </section>
  );
}
