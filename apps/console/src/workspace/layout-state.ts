/**
 * Session workspace layout — pure state machine.
 *
 * Three shapes the `/sessions/:id` surface can take:
 *
 *   solo   — conversation only, centred on a reading measure. No panel is
 *            mounted; the dock is translated off to the right.
 *   split  — conversation column (draggable width) + workspace dock.
 *   full   — the active panel fills the viewport; the chat column and the
 *            divider are hidden. Esc returns to `split`.
 *
 * Kept free of React so the transitions can be unit-tested directly
 * (see layout-state.test.ts). `useWorkspaceLayout` is the thin React
 * binding that owns the reducer plus the pointer / storage side effects.
 */

/** Width the divider snaps back to on double-click, and the initial value
 *  when nothing is persisted. */
export const CHAT_WIDTH_DEFAULT = 420;
/** Narrowest the chat column is allowed to settle at. Drags below this
 *  are still tracked live (so the snap threshold is reachable) but never
 *  committed as a width. */
export const CHAT_WIDTH_MIN = 320;
/** Dragging below this collapses the chat column into the vertical strip
 *  instead of committing a width. */
export const CHAT_SNAP_THRESHOLD = 240;
/** Width of the collapsed chat strip ("对话" + status dot + expander). */
export const CHAT_STRIP_WIDTH = 44;
/** Ceiling as a fraction of the viewport — the dock must keep enough room
 *  to be useful no matter how wide the window is. */
export const CHAT_WIDTH_MAX_RATIO = 0.65;

export const CHAT_WIDTH_STORAGE_KEY = "oma-session-chat-width";

export interface WorkspaceLayoutState {
  /** Id of the mounted panel, or null for the solo (chat-only) shape. */
  panelId: string | null;
  /** Committed chat column width in px. Preserved across collapse so
   *  expanding restores what the user last chose. */
  chatWidth: number;
  /** Chat column rendered as the vertical strip. Only meaningful while a
   *  panel is open — solo always shows the full column. */
  chatCollapsed: boolean;
  /** Active panel fills the viewport, hiding chat + divider. */
  fullscreen: boolean;
}

export const initialWorkspaceLayoutState: WorkspaceLayoutState = {
  panelId: null,
  chatWidth: CHAT_WIDTH_DEFAULT,
  chatCollapsed: false,
  fullscreen: false,
};

export type WorkspaceLayoutAction =
  /** Tab click. Toggles back to solo when the tab is already active and
   *  we're not in fullscreen — matches the prototype's "click the live tab
   *  to put the workspace away" affordance. */
  | { type: "toggle-panel"; panelId: string }
  /** Open without the toggle-to-close behaviour (event-driven reveal). */
  | { type: "open-panel"; panelId: string }
  | { type: "close-workspace" }
  | { type: "collapse-chat" }
  | { type: "expand-chat" }
  /** Commit the result of a divider drag. `rawWidth` is the raw pointer
   *  position; clamping and the snap decision happen here. */
  | { type: "commit-drag"; rawWidth: number; viewportWidth: number }
  | { type: "reset-chat-width" }
  | { type: "set-fullscreen"; fullscreen: boolean; fallbackPanelId: string };

/** Upper bound for the chat column at a given viewport width. Never drops
 *  below CHAT_WIDTH_MIN — on a very narrow desktop window the minimum wins
 *  over the ratio so the column stays legible. */
export function maxChatWidth(viewportWidth: number): number {
  return Math.max(CHAT_WIDTH_MIN, Math.round(viewportWidth * CHAT_WIDTH_MAX_RATIO));
}

export function clampChatWidth(width: number, viewportWidth: number): number {
  return Math.max(CHAT_WIDTH_MIN, Math.min(maxChatWidth(viewportWidth), Math.round(width)));
}

/** Live width the chat column should render at mid-drag, before the
 *  pointer is released. Below the snap threshold it previews the strip. */
export function dragPreviewWidth(rawWidth: number): number {
  return rawWidth < CHAT_SNAP_THRESHOLD ? CHAT_STRIP_WIDTH : rawWidth;
}

export function workspaceLayoutReducer(
  state: WorkspaceLayoutState,
  action: WorkspaceLayoutAction,
): WorkspaceLayoutState {
  switch (action.type) {
    case "toggle-panel":
      if (state.panelId === action.panelId && !state.fullscreen) {
        return { ...state, panelId: null, fullscreen: false };
      }
      return { ...state, panelId: action.panelId };

    case "open-panel":
      if (state.panelId === action.panelId) return state;
      return { ...state, panelId: action.panelId };

    case "close-workspace":
      if (state.panelId === null) return state;
      return { ...state, panelId: null, fullscreen: false };

    case "collapse-chat":
      return state.chatCollapsed ? state : { ...state, chatCollapsed: true };

    case "expand-chat":
      return state.chatCollapsed ? { ...state, chatCollapsed: false } : state;

    case "commit-drag":
      // Below the threshold we keep the previously committed chatWidth so
      // expanding later restores the pre-collapse column rather than
      // snapping to the minimum.
      if (action.rawWidth < CHAT_SNAP_THRESHOLD) {
        return { ...state, chatCollapsed: true };
      }
      return {
        ...state,
        chatCollapsed: false,
        chatWidth: clampChatWidth(action.rawWidth, action.viewportWidth),
      };

    case "reset-chat-width":
      return { ...state, chatCollapsed: false, chatWidth: CHAT_WIDTH_DEFAULT };

    case "set-fullscreen":
      if (action.fullscreen === state.fullscreen) return state;
      // Going fullscreen from solo has to mount something — fall back to
      // the caller-supplied default panel rather than showing an empty dock.
      return {
        ...state,
        fullscreen: action.fullscreen,
        panelId: action.fullscreen ? state.panelId ?? action.fallbackPanelId : state.panelId,
      };
  }
}

/** Effective flex-basis for the chat column in the split shape. */
export function chatColumnWidth(state: WorkspaceLayoutState, viewportWidth: number): number {
  if (state.chatCollapsed) return CHAT_STRIP_WIDTH;
  return Math.min(state.chatWidth, maxChatWidth(viewportWidth));
}

/** Read the persisted column width. Values below the minimum (stale key
 *  from an older build, hand-edited storage) are ignored rather than
 *  clamped so a bad entry can't pin the column at 320px forever. */
export function readStoredChatWidth(storage: Pick<Storage, "getItem">): number {
  try {
    const raw = storage.getItem(CHAT_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= CHAT_WIDTH_MIN ? parsed : CHAT_WIDTH_DEFAULT;
  } catch {
    // localStorage can throw in private mode / embedded webviews.
    return CHAT_WIDTH_DEFAULT;
  }
}

export function writeStoredChatWidth(
  storage: Pick<Storage, "setItem">,
  width: number,
): void {
  try {
    storage.setItem(CHAT_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Non-fatal — the width just won't survive a reload.
  }
}
