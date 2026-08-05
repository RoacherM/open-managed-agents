/**
 * Session outputs → tree.
 *
 * `GET /v1/sessions/:id/outputs` returns a flat listing whose `filename`
 * is the path relative to `/mnt/session/outputs/` — R2 keys and the Node
 * recursive walk both carry directory separators. The dock renders a tree,
 * so the nesting is reconstructed here rather than adding a second
 * response shape to the API.
 */

export interface SessionOutputFile {
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  media_type: string;
}

export interface FileNode {
  kind: "file";
  /** Last path segment — what the tree row shows. */
  name: string;
  /** Full path relative to the outputs root; the download/preview key. */
  path: string;
  size: number;
  uploadedAt: string;
  mediaType: string;
}

export interface DirNode {
  kind: "dir";
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = DirNode | FileNode;

/**
 * Build the tree. Directories sort before files, each group alphabetically
 * — the same ordering a file manager uses, so scanning for a folder doesn't
 * mean reading past every loose artifact at that level.
 */
export function buildFileTree(files: SessionOutputFile[]): TreeNode[] {
  const root: DirNode = { kind: "dir", name: "", path: "", children: [] };
  const dirs = new Map<string, DirNode>([["", root]]);

  const ensureDir = (path: string): DirNode => {
    const existing = dirs.get(path);
    if (existing) return existing;
    const idx = path.lastIndexOf("/");
    const parent = ensureDir(idx === -1 ? "" : path.slice(0, idx));
    const dir: DirNode = {
      kind: "dir",
      name: idx === -1 ? path : path.slice(idx + 1),
      path,
      children: [],
    };
    parent.children.push(dir);
    dirs.set(path, dir);
    return dir;
  };

  for (const file of files) {
    // Normalise away leading slashes and any empty segments so a stray
    // "shots//a.mp4" doesn't materialise an unnamed directory row.
    const segments = file.filename.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    const name = segments[segments.length - 1];
    const parent = ensureDir(segments.slice(0, -1).join("/"));
    parent.children.push({
      kind: "file",
      name,
      path: segments.join("/"),
      size: file.size_bytes,
      uploadedAt: file.uploaded_at,
      mediaType: file.media_type,
    });
  }

  sortTree(root.children);
  return root.children;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.kind === "dir") sortTree(node.children);
  }
}

/** How the preview pane should render a file. */
export type PreviewKind = "image" | "video" | "audio" | "markdown" | "json" | "text" | "binary";

const TEXT_EXTENSIONS = new Set([
  "txt", "log", "csv", "tsv", "yaml", "yml", "toml", "ini", "env",
  "js", "ts", "tsx", "jsx", "py", "sh", "css", "html", "xml", "sql",
]);

/**
 * Media type first, extension as the fallback. The outputs adapters guess
 * the type from the extension anyway, but R2 preserves whatever
 * content-type the agent wrote, which is the more reliable signal when
 * present.
 */
export function previewKindFor(node: FileNode): PreviewKind {
  const mime = node.mediaType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "text/markdown") return "markdown";
  if (mime === "application/json") return "json";
  if (mime.startsWith("text/")) return "text";

  const ext = node.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "json") return "json";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "binary";
}

/** Preview kinds whose bytes we fetch as text instead of handing the URL
 *  to a media element. */
export function isTextualPreview(kind: PreviewKind): boolean {
  return kind === "markdown" || kind === "json" || kind === "text";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Download / preview URL. Path segments are encoded individually so the
 *  separators survive — `encodeURIComponent` on the whole path would turn
 *  `shots/a.mp4` into a single literal segment the router can't match. */
export function outputUrl(sessionId: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `/v1/sessions/${encodeURIComponent(sessionId)}/outputs/${encoded}`;
}
