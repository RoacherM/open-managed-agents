/**
 * Workspace dock icons. Traced from the interaction prototype so the tab
 * strip reads the same as the approved design; the shared `components/
 * icons.tsx` set is sized and weighted for the nav sidebar and doesn't
 * cover Canvas / Terminal / Trajectory.
 */

type IconProps = { className?: string };

const base = "fill-none stroke-current";

export function CanvasIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="7" height="5.5" rx="1.4" />
      <rect x="14" y="3" width="7" height="5.5" rx="1.4" />
      <rect x="14" y="15" width="7" height="5.5" rx="1.4" />
      <path d="M10 6.8h4M10 8.6c3.5 0 3 9.2 4 9.2" />
    </svg>
  );
}

export function FilesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6.6A1.6 1.6 0 0 1 4.6 5h3.9l2 2.5h8.9A1.6 1.6 0 0 1 21 9.1v8.3a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 17.4Z" />
    </svg>
  );
}

export function TerminalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <path d="m7.5 10 2.4 2-2.4 2" />
      <path d="M12.6 14.4h4" />
    </svg>
  );
}

export function TrajectoryIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3.5v17" />
      <circle cx="6" cy="7.5" r="2.1" />
      <circle cx="6" cy="16.5" r="2.1" />
      <path d="M10.5 7.5h8M10.5 16.5h5.5" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function ExpandIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" />
    </svg>
  );
}

export function CollapseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 4.5V9H4.5M19.5 9H15V4.5M15 19.5V15h4.5M4.5 15H9v4.5" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4.5v10" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6.6A1.6 1.6 0 0 1 4.6 5h3.9l2 2.5h8.9A1.6 1.6 0 0 1 21 9.1v8.3a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 17.4Z" />
    </svg>
  );
}

export function VideoFileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5.5" width="13" height="13" rx="2.2" />
      <path d="m16 11 5-3v8l-5-3Z" />
    </svg>
  );
}

export function ImageFileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 17 4.6-4.4 3.4 3.1 3-2.6 4 3.9" />
    </svg>
  );
}

export function AudioFileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 17V5.5l9-1.6V16" />
      <circle cx="7" cy="17.6" r="2.5" />
      <circle cx="16" cy="16" r="2.5" />
    </svg>
  );
}

export function TextFileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3.5h8l4.5 4.5v12.5H6Z" />
      <path d="M14 3.5V8h4.5" />
    </svg>
  );
}

export function CodeFileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 4.5C7.5 4.5 8 8.5 6 9.8c-.6.4-1 .8-1 2.2s.4 1.8 1 2.2c2 1.3 1.5 5.3 3.5 5.3" />
      <path d="M14.5 4.5c2 0 1.5 4 3.5 5.3.6.4 1 .8 1 2.2s-.4 1.8-1 2.2c-2 1.3-1.5 5.3-3.5 5.3" />
    </svg>
  );
}

export function BoltIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`${base} ${className ?? ""}`} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 3 5.5 13.5H11l-1 7.5L18.5 10H13Z" />
    </svg>
  );
}
