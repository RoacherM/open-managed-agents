import type { ComponentType } from "react";

import { CanvasIcon, FilesIcon, TerminalIcon, TrajectoryIcon } from "./icons";
import { CanvasPanel } from "./panels/CanvasPanel";
import { FilesPanel } from "./panels/FilesPanel";
import { TerminalPanel } from "./panels/TerminalPanel";
import { TrajectoryPanel } from "./panels/TrajectoryPanel";

/**
 * Workspace panel registry.
 *
 * Every surface in the session workspace dock — Canvas, Files, Trajectory,
 * Terminal today, agent-published plugins later — is described by a
 * {@link WorkspacePanelDefinition} and mounted through this list. The dock
 * renders tabs from the registry order and never hard-codes a panel id, so
 * contributing a surface is a matter of appending a definition (or, for
 * hosted builds, concatenating a plugin-provided array) rather than editing
 * the shell.
 */

/**
 * Where a panel is being rendered.
 *
 *   panel — desktop split view, mounted beside the conversation column.
 *   sheet — mobile (<768px) full-screen bottom sheet.
 *
 * A definition opts into the modes it can actually support. A panel that
 * needs a pointer (canvas panning, a resizable terminal) can declare
 * `["panel"]` and the dock will hide its tab on touch layouts instead of
 * mounting something unusable.
 */
export type PanelDisplayMode = "panel" | "sheet";

/**
 * Live counters the dock feeds to panels and badges. Produced by
 * `useWorkspaceSignals` from the session's SSE stream.
 */
export interface WorkspaceSignals {
  /**
   * Artifacts produced since the panel was last opened, keyed by panel id.
   * Drives the badge bump animation and the auto-reveal decision; reset to
   * zero when the user opens the panel.
   */
  readonly unseen: Readonly<Record<string, number>>;
  /**
   * Total artifacts the panel currently has to show, keyed by panel id.
   * This is what the badge actually renders — "24 files", not "3 new".
   */
  readonly totals: Readonly<Record<string, number>>;
}

/** Props every panel receives when the dock mounts it. */
export interface PanelProps {
  sessionId: string;
  /** Mount context — panels that lay out differently on touch branch here. */
  displayMode: PanelDisplayMode;
  /** Current signal snapshot, for panels that highlight fresh artifacts. */
  signals: WorkspaceSignals;
}

export interface WorkspacePanelDefinition {
  /** Stable identifier. Used as the React key, the signal channel, and the
   *  value persisted for "which tab was open". Must be unique. */
  id: string;
  /** Tab label. Short — the desktop tab strip shares a 52px-tall header
   *  row with the session breadcrumb and status chips. */
  title: string;
  /** 24×24 stroke icon, rendered at 15px in the tab. */
  icon: ComponentType<{ className?: string }>;
  /**
   * Resolve the badge number from the current signals, or `undefined` to
   * render no badge. Called on every dock render — keep it cheap and pure.
   * Panels with nothing to count (Terminal) simply omit this.
   */
  badge?: (signals: WorkspaceSignals) => number | undefined;
  /** Layouts this panel supports. A panel is hidden in modes it omits. */
  displayModes: PanelDisplayMode[];
  /** The panel body. Mounted only while its tab is active. */
  mount: ComponentType<PanelProps>;
}

const BOTH_MODES: PanelDisplayMode[] = ["panel", "sheet"];

/**
 * P1 registry. Canvas and Terminal are deliberately placeholders — the
 * canvas host runtime is P2 and there is no PTY transport yet — but they
 * ship as real registry entries so the dock's tab/badge/mount plumbing is
 * exercised by every surface it will eventually carry.
 */
export const workspacePanels: WorkspacePanelDefinition[] = [
  {
    id: "canvas",
    title: "Canvas",
    icon: CanvasIcon,
    displayModes: BOTH_MODES,
    mount: CanvasPanel,
  },
  {
    id: "files",
    title: "Files",
    icon: FilesIcon,
    badge: (signals) => signals.totals.files || undefined,
    displayModes: BOTH_MODES,
    mount: FilesPanel,
  },
  {
    id: "terminal",
    title: "Terminal",
    icon: TerminalIcon,
    displayModes: BOTH_MODES,
    mount: TerminalPanel,
  },
  {
    id: "trajectory",
    title: "Trajectory",
    icon: TrajectoryIcon,
    displayModes: BOTH_MODES,
    mount: TrajectoryPanel,
  },
];

/** Panels available in a given layout, in tab order. */
export function panelsForMode(
  panels: WorkspacePanelDefinition[],
  mode: PanelDisplayMode,
): WorkspacePanelDefinition[] {
  return panels.filter((p) => p.displayModes.includes(mode));
}

export function findPanel(
  panels: WorkspacePanelDefinition[],
  id: string | null,
): WorkspacePanelDefinition | undefined {
  return id === null ? undefined : panels.find((p) => p.id === id);
}
