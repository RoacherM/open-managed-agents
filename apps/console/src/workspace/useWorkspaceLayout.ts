import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  CHAT_SNAP_THRESHOLD,
  CHAT_STRIP_WIDTH,
  chatColumnWidth,
  dragPreviewWidth,
  initialWorkspaceLayoutState,
  readStoredChatWidth,
  workspaceLayoutReducer,
  writeStoredChatWidth,
  type WorkspaceLayoutState,
} from "./layout-state";

/** Matches the `sheet` display mode and the prototype's <768px branch. */
const MOBILE_QUERY = "(max-width: 767px)";

export interface WorkspaceLayoutApi {
  state: WorkspaceLayoutState;
  /** True while the viewport is in the bottom-sheet (touch) layout. */
  isMobile: boolean;
  /** Chat column flex-basis in px for the current shape, or null when the
   *  column should simply fill the work area (solo / mobile). */
  chatBasis: number | null;
  /** Set while a divider drag is in flight — callers disable the width
   *  transition so the column tracks the pointer 1:1. */
  isDragging: boolean;
  /** True when the in-flight drag has crossed below the snap threshold.
   *  The divider turns amber to telegraph the collapse. */
  isSnapping: boolean;
  togglePanel: (panelId: string) => void;
  openPanel: (panelId: string) => void;
  closeWorkspace: () => void;
  collapseChat: () => void;
  expandChat: () => void;
  resetChatWidth: () => void;
  setFullscreen: (fullscreen: boolean) => void;
  /** Attach to the divider's onPointerDown. */
  startDrag: (event: React.PointerEvent<HTMLElement>) => void;
}

/**
 * React binding for the workspace layout state machine.
 *
 * Owns three things the pure reducer can't: the media query that decides
 * between the split and bottom-sheet layouts, the pointer capture loop for
 * the divider, and persistence of the committed column width.
 *
 * @param workAreaRef  The element the chat column and dock live in. Its
 *                     left edge is the origin for divider drags, so the
 *                     hook doesn't need to know about the nav rail's width.
 * @param fallbackPanelId  Panel to mount when the user hits fullscreen
 *                     straight from the solo shape.
 */
export function useWorkspaceLayout(
  workAreaRef: React.RefObject<HTMLElement | null>,
  fallbackPanelId: string,
): WorkspaceLayoutApi {
  const [state, dispatch] = useReducer(workspaceLayoutReducer, undefined, () => ({
    ...initialWorkspaceLayoutState,
    chatWidth: readStoredChatWidth(
      typeof window === "undefined"
        ? { getItem: () => null }
        : window.localStorage,
    ),
  }));

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );
  // Re-read on resize so `maxChatWidth` (a viewport ratio) stays honest
  // when the window is dragged narrower than the committed column width.
  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window === "undefined" ? 1440 : window.innerWidth),
  );
  const [drag, setDrag] = useState<{ raw: number } | null>(null);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    const onResize = () => setViewportWidth(window.innerWidth);
    mql.addEventListener("change", onChange);
    window.addEventListener("resize", onResize);
    return () => {
      mql.removeEventListener("change", onChange);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Esc leaves fullscreen. Registered on the document because focus may be
  // anywhere inside the panel (a file tree row, the terminal, a media
  // element) when the user reaches for it.
  useEffect(() => {
    if (!state.fullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "set-fullscreen", fullscreen: false, fallbackPanelId });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state.fullscreen, fallbackPanelId]);

  const persist = useRef(state.chatWidth);
  useEffect(() => {
    if (persist.current === state.chatWidth) return;
    persist.current = state.chatWidth;
    writeStoredChatWidth(window.localStorage, state.chatWidth);
  }, [state.chatWidth]);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const area = workAreaRef.current;
      if (!area) return;
      const originX = area.getBoundingClientRect().left;
      // Seed from where the pointer went down so a click without movement
      // is a no-op rather than a jump.
      let raw = event.clientX - originX;
      setDrag({ raw });

      // Listeners go on the window, not the divider. Pointer capture would
      // be the usual way to keep events flowing once the pointer outruns a
      // 6px-wide target, but setPointerCapture throws for any pointer id
      // the UA doesn't consider active — and a throw there would abort the
      // gesture before the listeners were attached, so the drag silently
      // did nothing. Window listeners have no such failure mode.
      const onMove = (e: PointerEvent) => {
        // Lower bound of 180 (not CHAT_WIDTH_MIN) so the pointer can reach
        // the snap threshold and preview the collapsed strip.
        raw = Math.max(180, Math.min(area.clientWidth, e.clientX - originX));
        setDrag({ raw });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setDrag(null);
        dispatch({ type: "commit-drag", rawWidth: raw, viewportWidth: window.innerWidth });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [workAreaRef],
  );

  const chatBasis = useMemo(() => {
    // Mobile floats the dock over a full-width chat; solo has no divider.
    if (isMobile || state.panelId === null) return null;
    if (drag) return dragPreviewWidth(drag.raw);
    return chatColumnWidth(state, viewportWidth);
  }, [drag, isMobile, state, viewportWidth]);

  return {
    state,
    isMobile,
    chatBasis,
    isDragging: drag !== null,
    isSnapping: drag !== null && drag.raw < CHAT_SNAP_THRESHOLD,
    // Mid-drag the reducer hasn't committed yet, so derive the collapsed
    // look from the live pointer position instead of state.chatCollapsed.
    togglePanel: useCallback((panelId: string) => dispatch({ type: "toggle-panel", panelId }), []),
    openPanel: useCallback((panelId: string) => dispatch({ type: "open-panel", panelId }), []),
    closeWorkspace: useCallback(() => dispatch({ type: "close-workspace" }), []),
    collapseChat: useCallback(() => dispatch({ type: "collapse-chat" }), []),
    expandChat: useCallback(() => dispatch({ type: "expand-chat" }), []),
    resetChatWidth: useCallback(() => dispatch({ type: "reset-chat-width" }), []),
    setFullscreen: useCallback(
      (fullscreen: boolean) => dispatch({ type: "set-fullscreen", fullscreen, fallbackPanelId }),
      [fallbackPanelId],
    ),
    startDrag,
  };
}

/** Whether the chat column should render as the vertical strip right now,
 *  accounting for an in-flight drag preview. */
export function isChatStripped(api: WorkspaceLayoutApi): boolean {
  if (api.isMobile || api.state.panelId === null) return false;
  if (api.isDragging) return api.chatBasis === CHAT_STRIP_WIDTH;
  return api.state.chatCollapsed;
}
