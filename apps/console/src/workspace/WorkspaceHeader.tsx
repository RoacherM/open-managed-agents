import { Link } from "react-router";

import { SidebarTrigger } from "@/components/ui/sidebar";

import { StatusPill } from "../components/Badge";
import { formatDuration } from "../lib/format";
import { TrajectoryOutcomeChip } from "../pages/session-detail/Trajectory";
import { ResourceCluster, type SessionResources } from "./ResourceCluster";
import { WorkspaceTabs } from "./dock/WorkspaceTabs";
import { ChevronLeftIcon, CloseIcon, CollapseIcon, ExpandIcon } from "./dock/icons";
import type { WorkspacePanelDefinition, WorkspaceSignals } from "./dock/registry";
import type { WorkspaceLayoutApi } from "./useWorkspaceLayout";
import { useWorkspaceData } from "./context";

/**
 * Session header — one 52px band carrying everything that describes the
 * session plus the workspace tab strip.
 *
 * Left to right: nav trigger, chat-collapse toggle, breadcrumb, live status,
 * trajectory outcome, resource cluster ‖ duration, tabs, close, fullscreen.
 * Elements drop out at documented breakpoints rather than wrapping, because
 * a second header row would push the conversation down on every session.
 */
export function WorkspaceHeader({
  sessionId,
  status,
  durationMs,
  resources,
  panels,
  signals,
  layout,
}: {
  sessionId: string;
  status: string;
  durationMs: number | null;
  resources: SessionResources;
  panels: WorkspacePanelDefinition[];
  signals: WorkspaceSignals;
  layout: WorkspaceLayoutApi;
}) {
  const { trajectory } = useWorkspaceData();
  const workspaceOpen = layout.state.panelId !== null;

  return (
    <header className="relative z-30 shrink-0 h-13 flex items-center gap-2.5 pl-3 pr-2.5 border-b border-border bg-bg">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Doubles as the mobile drawer trigger and the desktop "give me the
            full nav back" affordance — the rail is icon-only inside a
            session, so this is the only way out of it. */}
        <SidebarTrigger className="size-11 sm:size-6.5 text-fg-subtle hover:text-fg hover:bg-bg-surface" />

        {/* Collapsing the chat is only meaningful once something else is
            occupying the row, and it has no meaning in fullscreen. */}
        {workspaceOpen && !layout.state.fullscreen && !layout.isMobile && (
          <IconButton
            onClick={layout.state.chatCollapsed ? layout.expandChat : layout.collapseChat}
            label={layout.state.chatCollapsed ? "Expand conversation" : "Collapse conversation"}
          >
            <ChevronLeftIcon
              className={`size-3.5 transition-transform duration-[var(--dur-base)] ease-[var(--ease-soft)] ${layout.state.chatCollapsed ? "rotate-180" : ""}`}
            />
          </IconButton>
        )}

        <nav className="flex items-center gap-1.5 min-w-0 shrink-0 text-[13px]">
          <Link
            to="/sessions"
            className="hidden sm:inline text-fg-subtle hover:text-fg-muted transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
          >
            Sessions
          </Link>
          <span className="hidden sm:inline text-border-strong">/</span>
          <span className="font-mono text-[12.5px] text-fg truncate">{sessionId}</span>
        </nav>

        <StatusPill status={status} />
        <span className="hidden md:contents">
          <TrajectoryOutcomeChip trajectory={trajectory} />
        </span>
        <ResourceCluster resources={resources} />
      </div>

      <div className="flex items-center gap-1 shrink-0 h-full">
        {durationMs !== null && (
          <span className="hidden xl:inline font-mono text-xs text-fg-subtle tabular-nums">
            {formatDuration(durationMs)}
          </span>
        )}
        <span className="hidden xl:block w-px h-4.5 bg-border mx-1" />

        {/* On touch layouts the tab strip lives in the bottom sheet header
            instead — see WorkspaceDock. */}
        {!layout.isMobile && (
          <WorkspaceTabs
            panels={panels}
            signals={signals}
            activePanelId={layout.state.panelId}
            onSelect={layout.togglePanel}
            variant="underline"
          />
        )}

        {workspaceOpen && !layout.isMobile && (
          <IconButton onClick={layout.closeWorkspace} label="Close workspace">
            <CloseIcon className="size-3.5" />
          </IconButton>
        )}
        {!layout.isMobile && (
          <IconButton
            onClick={() => layout.setFullscreen(!layout.state.fullscreen)}
            label={layout.state.fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen workspace"}
          >
            {layout.state.fullscreen ? (
              <CollapseIcon className="size-3.5" />
            ) : (
              <ExpandIcon className="size-3.5" />
            )}
          </IconButton>
        )}
      </div>
    </header>
  );
}

function IconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid place-items-center size-11 sm:size-6.5 shrink-0 rounded-md text-fg-subtle hover:text-fg hover:bg-bg-surface transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
    >
      {children}
    </button>
  );
}
