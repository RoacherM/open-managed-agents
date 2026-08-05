import { describe, expect, it } from "vitest";

import {
  findPanel,
  panelsForMode,
  workspacePanels,
  type WorkspacePanelDefinition,
  type WorkspaceSignals,
} from "./registry";

const signals = (
  totals: Record<string, number> = {},
  unseen: Record<string, number> = {},
): WorkspaceSignals => ({ totals, unseen });

describe("workspacePanels", () => {
  it("registers exactly the P1 surfaces, in tab order", () => {
    // Browser is deliberately absent: agent browser capability ships as a
    // headless tool, not a workspace surface (.agents/corrections,
    // 2026-08-05). This assertion is the guard against it creeping back.
    expect(workspacePanels.map((p) => p.id)).toEqual([
      "canvas",
      "files",
      "terminal",
      "trajectory",
    ]);
  });

  it("gives every panel a unique id", () => {
    const ids = workspacePanels.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares at least one display mode per panel", () => {
    for (const panel of workspacePanels) {
      expect(panel.displayModes.length).toBeGreaterThan(0);
    }
  });
});

describe("badge resolution", () => {
  const files = workspacePanels.find((p) => p.id === "files")!;

  it("reads the files badge from the totals channel", () => {
    expect(files.badge?.(signals({ files: 24 }))).toBe(24);
  });

  it("renders no badge at zero rather than a '0' chip", () => {
    expect(files.badge?.(signals({ files: 0 }))).toBeUndefined();
    expect(files.badge?.(signals())).toBeUndefined();
  });

  it("leaves panels with nothing to count badge-free", () => {
    for (const id of ["canvas", "terminal", "trajectory"]) {
      expect(workspacePanels.find((p) => p.id === id)?.badge).toBeUndefined();
    }
  });
});

describe("panelsForMode", () => {
  const panelOnly = {
    id: "pointer-only",
    displayModes: ["panel"],
  } as unknown as WorkspacePanelDefinition;

  it("keeps registry order", () => {
    expect(panelsForMode(workspacePanels, "panel").map((p) => p.id)).toEqual(
      workspacePanels.map((p) => p.id),
    );
  });

  it("drops panels that don't support the requested mode", () => {
    const withPointerOnly = [...workspacePanels, panelOnly];
    expect(panelsForMode(withPointerOnly, "sheet").map((p) => p.id)).not.toContain("pointer-only");
    expect(panelsForMode(withPointerOnly, "panel").map((p) => p.id)).toContain("pointer-only");
  });

  it("exposes all four P1 panels on touch layouts", () => {
    expect(panelsForMode(workspacePanels, "sheet")).toHaveLength(4);
  });
});

describe("findPanel", () => {
  it("resolves a known id", () => {
    expect(findPanel(workspacePanels, "files")?.title).toBe("Files");
  });

  it("returns undefined for the solo shape and for unknown ids", () => {
    expect(findPanel(workspacePanels, null)).toBeUndefined();
    expect(findPanel(workspacePanels, "browser")).toBeUndefined();
  });
});
