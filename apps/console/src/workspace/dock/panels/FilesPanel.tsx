import { useEffect, useMemo, useState } from "react";

import { Markdown } from "../../../components/Markdown";
import { CodeBlock } from "../../../components/ai-elements/code-block";
import { useWorkspaceData } from "../../context";
import type { PanelProps } from "../registry";
import {
  AudioFileIcon,
  ChevronRightIcon,
  CodeFileIcon,
  DownloadIcon,
  FilesIcon,
  FolderIcon,
  ImageFileIcon,
  TextFileIcon,
  VideoFileIcon,
} from "../icons";
import {
  buildFileTree,
  formatBytes,
  isTextualPreview,
  outputUrl,
  previewKindFor,
  type DirNode,
  type FileNode,
  type PreviewKind,
  type TreeNode,
} from "./file-tree";

/**
 * Files panel — directory tree on the left, preview on the right (stacked
 * on touch layouts). Images render inline, video and audio get native
 * `<video controls>` / `<audio controls>` elements, markdown renders
 * through the shared renderer, and JSON / plain text land in the syntax-
 * highlighted code block the chat surface already uses.
 */
export function FilesPanel({ sessionId, displayMode }: PanelProps) {
  const { files, filesError, refreshFiles, freshFilePaths } = useWorkspaceData();
  const [selected, setSelected] = useState<FileNode | null>(null);

  const tree = useMemo(() => buildFileTree(files ?? []), [files]);

  // A file the agent overwrote keeps its path, so re-selecting isn't
  // needed — but one that disappeared (session reset, cascade delete)
  // would leave a preview pointing at a 404.
  useEffect(() => {
    if (!selected || !files) return;
    if (!files.some((f) => f.filename.split("/").filter(Boolean).join("/") === selected.path)) {
      setSelected(null);
    }
  }, [files, selected]);

  const stacked = displayMode === "sheet";

  return (
    <div className={`flex-1 min-h-0 flex ${stacked ? "flex-col" : "flex-row"}`}>
      <div
        className={
          stacked
            ? `shrink-0 flex flex-col min-h-0 border-b border-border bg-bg-surface/25 ${selected ? "max-h-45" : "max-h-[52vh]"} transition-[max-height] duration-[var(--dur-slow)] ease-[var(--ease-soft)]`
            : "w-[254px] shrink-0 flex flex-col min-h-0 border-r border-border bg-bg-surface/25"
        }
      >
        <div className="h-8.5 shrink-0 flex items-center gap-1.5 px-3 border-b border-border font-mono text-[11px] text-fg-subtle">
          <FilesIcon className="size-3 shrink-0" />
          <span className="truncate">/mnt/session/outputs</span>
          <button
            onClick={refreshFiles}
            className="ml-auto shrink-0 text-fg-subtle hover:text-fg transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
            title="Refresh listing"
          >
            ↻
          </button>
        </div>
        <div className="flex-1 overflow-auto p-1.5 pb-4">
          {filesError && <div className="px-2 py-1.5 text-xs text-danger">Failed to load: {filesError}</div>}
          {!files && !filesError && <div className="px-2 py-1.5 text-xs text-fg-subtle">Loading…</div>}
          {files && files.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-fg-subtle leading-relaxed">
              No files yet. The agent must write under{" "}
              <code className="font-mono">/mnt/session/outputs/</code> for artifacts to appear here.
            </div>
          )}
          <TreeLevel
            nodes={tree}
            depth={0}
            selectedPath={selected?.path ?? null}
            freshPaths={freshFilePaths}
            onSelect={setSelected}
          />
        </div>
      </div>

      <PreviewPane sessionId={sessionId} file={selected} />
    </div>
  );
}

function TreeLevel({
  nodes,
  depth,
  selectedPath,
  freshPaths,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  selectedPath: string | null;
  freshPaths: ReadonlySet<string>;
  onSelect: (file: FileNode) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "dir" ? (
          <DirRow
            key={node.path}
            node={node}
            depth={depth}
            selectedPath={selectedPath}
            freshPaths={freshPaths}
            onSelect={onSelect}
          />
        ) : (
          <FileRow
            key={node.path}
            node={node}
            selected={node.path === selectedPath}
            fresh={freshPaths.has(node.path)}
            onSelect={onSelect}
          />
        ),
      )}
    </>
  );
}

function DirRow({
  node,
  depth,
  selectedPath,
  freshPaths,
  onSelect,
}: {
  node: DirNode;
  depth: number;
  selectedPath: string | null;
  freshPaths: ReadonlySet<string>;
  onSelect: (file: FileNode) => void;
}) {
  // Top-level directories open by default — the common shape is a couple
  // of output folders, and making the operator expand each one on every
  // visit is friction for no gain.
  const [open, setOpen] = useState(depth === 0);
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full h-11 sm:h-7 px-2 rounded-md flex items-center gap-1.5 text-left text-fg-muted hover:bg-bg-surface hover:text-fg transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
      >
        <ChevronRightIcon
          className={`size-3 shrink-0 text-fg-subtle transition-transform duration-[var(--dur-quick)] ease-[var(--ease-soft)] ${open ? "rotate-90" : ""}`}
        />
        <FolderIcon className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="font-mono text-[11.5px] truncate">{node.name}/</span>
        <span className="ml-auto font-mono text-[10.5px] text-fg-subtle pl-1.5">
          {node.children.length}
        </span>
      </button>
      {open && (
        <div className="ml-2.5 pl-2 border-l border-border">
          <TreeLevel
            nodes={node.children}
            depth={depth + 1}
            selectedPath={selectedPath}
            freshPaths={freshPaths}
            onSelect={onSelect}
          />
        </div>
      )}
    </>
  );
}

function FileRow({
  node,
  selected,
  fresh,
  onSelect,
}: {
  node: FileNode;
  selected: boolean;
  fresh: boolean;
  onSelect: (file: FileNode) => void;
}) {
  const Icon = fileIconFor(previewKindFor(node));
  return (
    <button
      onClick={() => onSelect(node)}
      className={[
        "w-full h-11 sm:h-7 px-2 rounded-md flex items-center gap-1.5 text-left transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]",
        selected
          ? "bg-brand-subtle text-fg"
          : "text-fg-muted hover:bg-bg-surface hover:text-fg",
        // Amber inset rail marks artifacts written since the panel was
        // last opened, so a long tree still shows what just changed.
        fresh && !selected ? "shadow-[inset_2px_0_0_var(--brand)]" : "",
      ].join(" ")}
      title={node.path}
    >
      <span className="w-3 shrink-0" />
      <Icon className={`size-3.5 shrink-0 ${selected ? "text-brand" : "text-fg-subtle"}`} />
      <span className="font-mono text-[11.5px] truncate">{node.name}</span>
      <span className="ml-auto font-mono text-[10.5px] text-fg-subtle pl-1.5 shrink-0">
        {formatBytes(node.size)}
      </span>
    </button>
  );
}

function fileIconFor(kind: PreviewKind) {
  switch (kind) {
    case "image":
      return ImageFileIcon;
    case "video":
      return VideoFileIcon;
    case "audio":
      return AudioFileIcon;
    case "json":
      return CodeFileIcon;
    default:
      return TextFileIcon;
  }
}

function PreviewPane({ sessionId, file }: { sessionId: string; file: FileNode | null }) {
  if (!file) {
    return (
      <div className="flex-1 min-w-0 min-h-0 grid place-items-center text-center px-6">
        <div className="flex flex-col items-center gap-2.5 max-w-65">
          <FilesIcon className="size-7.5 text-fg-subtle opacity-55" />
          <div className="text-[13px] text-fg-muted">Select a file to preview</div>
          <div className="text-xs text-fg-subtle leading-relaxed">
            Artifacts the agent writes into the sandbox sync here. Video and audio play inline.
          </div>
        </div>
      </div>
    );
  }

  const url = outputUrl(sessionId, file.path);
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="h-8.5 shrink-0 flex items-center gap-2 pl-3.5 pr-3 border-b border-border">
        <span className="font-mono text-xs text-fg truncate">{file.path}</span>
        <span className="font-mono text-[10.5px] text-fg-subtle shrink-0">
          {formatBytes(file.size)}
        </span>
        <a
          href={url}
          download={file.name}
          className="ml-auto shrink-0 grid place-items-center size-11 sm:size-6.5 rounded-md text-fg-subtle hover:text-fg hover:bg-bg-surface transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
          title="Download"
          aria-label={`Download ${file.name}`}
        >
          <DownloadIcon className="size-3.5" />
        </a>
      </div>
      {/* Keyed on the path so switching files tears down the previous
          media element instead of letting a <video> keep its old buffer. */}
      <FilePreview key={file.path} file={file} url={url} />
    </div>
  );
}

function FilePreview({ file, url }: { file: FileNode; url: string }) {
  const kind = previewKindFor(file);
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTextualPreview(kind)) return;
    let cancelled = false;
    setText(null);
    setTextError(null);
    fetch(url, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((body) => {
        if (!cancelled) setText(body);
      })
      .catch((e) => {
        if (!cancelled) setTextError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [kind, url]);

  const body = () => {
    switch (kind) {
      case "image":
        return (
          <img
            src={url}
            alt={file.name}
            className="max-w-190 w-full rounded-xl border border-border bg-bg-surface"
          />
        );
      case "video":
        return (
          <video
            src={url}
            controls
            preload="metadata"
            className="max-w-190 w-full rounded-xl border border-border bg-black"
          />
        );
      case "audio":
        return (
          <div className="max-w-190 w-full rounded-xl border border-border bg-bg-surface p-4">
            <audio src={url} controls preload="metadata" className="w-full" />
          </div>
        );
      case "markdown":
        if (textError) return <PreviewError message={textError} />;
        if (text === null) return <div className="text-xs text-fg-subtle">Loading…</div>;
        return (
          <div className="max-w-[70ch]">
            <Markdown>{text}</Markdown>
          </div>
        );
      case "json":
        if (textError) return <PreviewError message={textError} />;
        if (text === null) return <div className="text-xs text-fg-subtle">Loading…</div>;
        return (
          <div className="max-w-190 rounded-xl overflow-hidden">
            <CodeBlock code={text} language="json" />
          </div>
        );
      case "text":
        // Deliberately not routed through CodeBlock: Shiki's bundled
        // language union has no plaintext grammar, and picking an
        // arbitrary one would colour a log file as if it were source.
        if (textError) return <PreviewError message={textError} />;
        if (text === null) return <div className="text-xs text-fg-subtle">Loading…</div>;
        return (
          <pre className="max-w-190 rounded-xl bg-bg-surface border border-border px-4 py-3 font-mono text-[11.5px] leading-relaxed text-fg-muted whitespace-pre-wrap break-words">
            {text}
          </pre>
        );
      case "binary":
        return (
          <div className="text-sm text-fg-muted leading-relaxed">
            <div>No inline preview for {file.mediaType || "this file type"}.</div>
            <a href={url} download={file.name} className="text-info hover:underline">
              Download {file.name}
            </a>
          </div>
        );
    }
  };

  return <div className="flex-1 min-h-0 overflow-auto p-4 sm:px-5.5 sm:py-5">{body()}</div>;
}

function PreviewError({ message }: { message: string }) {
  return <div className="text-sm text-danger">Failed to read file: {message}</div>;
}
