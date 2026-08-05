import { describe, expect, it } from "vitest";

import {
  buildFileTree,
  formatBytes,
  outputUrl,
  previewKindFor,
  type DirNode,
  type FileNode,
  type SessionOutputFile,
} from "./file-tree";

const file = (filename: string, media_type = "application/octet-stream"): SessionOutputFile => ({
  filename,
  size_bytes: 1024,
  uploaded_at: "2026-08-05T00:00:00.000Z",
  media_type,
});

describe("buildFileTree", () => {
  it("keeps top-level files flat", () => {
    const tree = buildFileTree([file("script.md"), file("log.json")]);
    expect(tree.map((n) => n.name)).toEqual(["log.json", "script.md"]);
    expect(tree.every((n) => n.kind === "file")).toBe(true);
  });

  it("reconstructs nesting from separators in the flat listing", () => {
    const tree = buildFileTree([file("shots/sh001.mp4"), file("shots/sh002.mp4")]);
    expect(tree).toHaveLength(1);
    const dir = tree[0] as DirNode;
    expect(dir.kind).toBe("dir");
    expect(dir.name).toBe("shots");
    expect(dir.children.map((c) => c.name)).toEqual(["sh001.mp4", "sh002.mp4"]);
  });

  it("handles multiple levels", () => {
    const tree = buildFileTree([file("a/b/c/deep.txt")]);
    const a = tree[0] as DirNode;
    const b = a.children[0] as DirNode;
    const c = b.children[0] as DirNode;
    expect([a.name, b.name, c.name]).toEqual(["a", "b", "c"]);
    expect((c.children[0] as FileNode).path).toBe("a/b/c/deep.txt");
  });

  it("sorts directories before files, each alphabetically", () => {
    const tree = buildFileTree([
      file("zeta.txt"),
      file("alpha.txt"),
      file("shots/x.mp4"),
      file("audio/y.mp3"),
    ]);
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual([
      "dir:audio",
      "dir:shots",
      "file:alpha.txt",
      "file:zeta.txt",
    ]);
  });

  it("normalises stray separators instead of creating unnamed rows", () => {
    const tree = buildFileTree([file("/shots//a.mp4")]);
    const dir = tree[0] as DirNode;
    expect(dir.name).toBe("shots");
    expect((dir.children[0] as FileNode).path).toBe("shots/a.mp4");
  });

  it("returns nothing for an empty listing", () => {
    expect(buildFileTree([])).toEqual([]);
  });
});

describe("previewKindFor", () => {
  const node = (name: string, mediaType: string): FileNode => ({
    kind: "file",
    name,
    path: name,
    size: 1,
    uploadedAt: "",
    mediaType,
  });

  it("routes media by content type", () => {
    expect(previewKindFor(node("a.png", "image/png"))).toBe("image");
    expect(previewKindFor(node("a.mp4", "video/mp4"))).toBe("video");
    expect(previewKindFor(node("a.mp3", "audio/mpeg"))).toBe("audio");
  });

  it("distinguishes markdown and json from plain text", () => {
    expect(previewKindFor(node("a.md", "text/markdown"))).toBe("markdown");
    expect(previewKindFor(node("a.json", "application/json"))).toBe("json");
    expect(previewKindFor(node("a.csv", "text/csv"))).toBe("text");
  });

  it("falls back to the extension when the media type is generic", () => {
    // The R2 adapter preserves whatever the agent wrote, which is often
    // application/octet-stream for files a tool streamed out.
    expect(previewKindFor(node("notes.md", "application/octet-stream"))).toBe("markdown");
    expect(previewKindFor(node("run.log", "application/octet-stream"))).toBe("text");
  });

  it("marks anything it can't render as binary", () => {
    expect(previewKindFor(node("bundle.zip", "application/zip"))).toBe("binary");
  });
});

describe("outputUrl", () => {
  it("encodes each segment but preserves the separators", () => {
    expect(outputUrl("sess-1", "shots/a b.mp4")).toBe("/v1/sessions/sess-1/outputs/shots/a%20b.mp4");
  });

  it("encodes characters that would otherwise change the path", () => {
    expect(outputUrl("sess-1", "a#b.txt")).toBe("/v1/sessions/sess-1/outputs/a%23b.txt");
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.00 GB");
  });
});
