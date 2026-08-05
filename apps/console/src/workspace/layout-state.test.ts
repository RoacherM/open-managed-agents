import { describe, expect, it } from "vitest";

import {
  CHAT_SNAP_THRESHOLD,
  CHAT_STRIP_WIDTH,
  CHAT_WIDTH_DEFAULT,
  CHAT_WIDTH_MIN,
  chatColumnWidth,
  clampChatWidth,
  dragPreviewWidth,
  initialWorkspaceLayoutState,
  maxChatWidth,
  readStoredChatWidth,
  workspaceLayoutReducer,
  type WorkspaceLayoutState,
} from "./layout-state";

const base = initialWorkspaceLayoutState;

describe("workspaceLayoutReducer", () => {
  it("opens a panel from the solo shape", () => {
    const next = workspaceLayoutReducer(base, { type: "toggle-panel", panelId: "files" });
    expect(next.panelId).toBe("files");
  });

  it("closes back to solo when the active tab is clicked again", () => {
    const open: WorkspaceLayoutState = { ...base, panelId: "files" };
    expect(workspaceLayoutReducer(open, { type: "toggle-panel", panelId: "files" }).panelId).toBeNull();
  });

  it("switches panels rather than closing when a different tab is clicked", () => {
    const open: WorkspaceLayoutState = { ...base, panelId: "files" };
    expect(workspaceLayoutReducer(open, { type: "toggle-panel", panelId: "canvas" }).panelId).toBe(
      "canvas",
    );
  });

  it("keeps the workspace open when the active tab is clicked in fullscreen", () => {
    // Otherwise the only way out of fullscreen would also unmount the panel.
    const fs: WorkspaceLayoutState = { ...base, panelId: "files", fullscreen: true };
    expect(workspaceLayoutReducer(fs, { type: "toggle-panel", panelId: "files" }).panelId).toBe(
      "files",
    );
  });

  it("leaves fullscreen when the workspace is closed", () => {
    const fs: WorkspaceLayoutState = { ...base, panelId: "files", fullscreen: true };
    const next = workspaceLayoutReducer(fs, { type: "close-workspace" });
    expect(next).toMatchObject({ panelId: null, fullscreen: false });
  });

  it("mounts the fallback panel when going fullscreen from solo", () => {
    const next = workspaceLayoutReducer(base, {
      type: "set-fullscreen",
      fullscreen: true,
      fallbackPanelId: "files",
    });
    expect(next).toMatchObject({ panelId: "files", fullscreen: true });
  });

  it("keeps the current panel when going fullscreen from split", () => {
    const open: WorkspaceLayoutState = { ...base, panelId: "canvas" };
    const next = workspaceLayoutReducer(open, {
      type: "set-fullscreen",
      fullscreen: true,
      fallbackPanelId: "files",
    });
    expect(next.panelId).toBe("canvas");
  });

  describe("divider drag", () => {
    it("commits a clamped width above the snap threshold", () => {
      const next = workspaceLayoutReducer(base, {
        type: "commit-drag",
        rawWidth: 500,
        viewportWidth: 1440,
      });
      expect(next).toMatchObject({ chatWidth: 500, chatCollapsed: false });
    });

    it("clamps to the minimum", () => {
      const next = workspaceLayoutReducer(base, {
        type: "commit-drag",
        rawWidth: CHAT_SNAP_THRESHOLD + 1,
        viewportWidth: 1440,
      });
      expect(next.chatWidth).toBe(CHAT_WIDTH_MIN);
    });

    it("clamps to 65% of the viewport", () => {
      const next = workspaceLayoutReducer(base, {
        type: "commit-drag",
        rawWidth: 5000,
        viewportWidth: 1000,
      });
      expect(next.chatWidth).toBe(650);
    });

    it("collapses below the snap threshold and preserves the committed width", () => {
      const wide: WorkspaceLayoutState = { ...base, chatWidth: 520 };
      const next = workspaceLayoutReducer(wide, {
        type: "commit-drag",
        rawWidth: CHAT_SNAP_THRESHOLD - 1,
        viewportWidth: 1440,
      });
      // Expanding again must restore 520, not the minimum.
      expect(next).toMatchObject({ chatCollapsed: true, chatWidth: 520 });
    });

    it("un-collapses when dragged back out past the threshold", () => {
      const collapsed: WorkspaceLayoutState = { ...base, chatCollapsed: true };
      const next = workspaceLayoutReducer(collapsed, {
        type: "commit-drag",
        rawWidth: 400,
        viewportWidth: 1440,
      });
      expect(next).toMatchObject({ chatCollapsed: false, chatWidth: 400 });
    });
  });

  it("resets width and expands on double-click", () => {
    const messy: WorkspaceLayoutState = { ...base, chatWidth: 900, chatCollapsed: true };
    expect(workspaceLayoutReducer(messy, { type: "reset-chat-width" })).toMatchObject({
      chatWidth: CHAT_WIDTH_DEFAULT,
      chatCollapsed: false,
    });
  });
});

describe("width helpers", () => {
  it("never lets the ratio ceiling fall under the minimum", () => {
    expect(maxChatWidth(400)).toBe(CHAT_WIDTH_MIN);
  });

  it("clamps within [min, 65vw]", () => {
    expect(clampChatWidth(100, 1440)).toBe(CHAT_WIDTH_MIN);
    expect(clampChatWidth(420, 1440)).toBe(420);
    expect(clampChatWidth(9999, 1440)).toBe(936);
  });

  it("previews the strip while the pointer is under the snap threshold", () => {
    expect(dragPreviewWidth(CHAT_SNAP_THRESHOLD - 1)).toBe(CHAT_STRIP_WIDTH);
    expect(dragPreviewWidth(CHAT_SNAP_THRESHOLD + 1)).toBe(CHAT_SNAP_THRESHOLD + 1);
  });

  it("reports the strip width while collapsed", () => {
    expect(chatColumnWidth({ ...base, chatCollapsed: true }, 1440)).toBe(CHAT_STRIP_WIDTH);
  });

  it("re-clamps a stored width that no longer fits the viewport", () => {
    expect(chatColumnWidth({ ...base, chatWidth: 900 }, 1000)).toBe(650);
  });
});

describe("readStoredChatWidth", () => {
  const stub = (value: string | null) => ({ getItem: () => value });

  it("returns the default when nothing is stored", () => {
    expect(readStoredChatWidth(stub(null))).toBe(CHAT_WIDTH_DEFAULT);
  });

  it("returns a stored width at or above the minimum", () => {
    expect(readStoredChatWidth(stub("512"))).toBe(512);
  });

  it("ignores junk and out-of-range values rather than clamping them", () => {
    expect(readStoredChatWidth(stub("nope"))).toBe(CHAT_WIDTH_DEFAULT);
    expect(readStoredChatWidth(stub("12"))).toBe(CHAT_WIDTH_DEFAULT);
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("private mode");
      },
    };
    expect(readStoredChatWidth(throwing)).toBe(CHAT_WIDTH_DEFAULT);
  });
});
