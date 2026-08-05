import { TerminalIcon } from "../icons";

/**
 * Terminal — placeholder. There is no PTY transport to the sandbox yet, so
 * this ships as an empty state rather than a fake shell; a prompt that
 * doesn't run anything is worse than an honest "not here yet".
 */
export function TerminalPanel() {
  return (
    <div className="flex-1 min-h-0 grid place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-3 max-w-80">
        <div className="grid place-items-center size-12 rounded-xl bg-bg-surface border border-border">
          <TerminalIcon className="size-6 text-fg-subtle" />
        </div>
        <div className="text-sm text-fg-muted">Terminal 即将到来</div>
        <div className="text-xs text-fg-subtle leading-relaxed">
          接入沙箱 PTY 后，这里可以直接对本 session 的环境执行命令。
        </div>
      </div>
    </div>
  );
}
