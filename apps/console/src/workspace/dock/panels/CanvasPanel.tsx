import { CanvasIcon } from "../icons";

/**
 * Canvas — the surface an agent-built webui will render into.
 *
 * P1 ships the tab and its empty state only. The host runtime (serving the
 * agent's `webui/` bundle, the reload / publish chrome, and the structured
 * feedback channel back to the session) is P2; nothing here should be read
 * as a stub for it.
 */
export function CanvasPanel() {
  return (
    <div className="flex-1 min-h-0 grid place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-3 max-w-80">
        <div className="grid place-items-center size-12 rounded-xl bg-bg-surface border border-border">
          <CanvasIcon className="size-6 text-fg-subtle" />
        </div>
        <div className="text-sm text-fg-muted">Agent 尚未在本 session 构建应用</div>
        <div className="text-xs text-fg-subtle leading-relaxed">
          Agent 构建的 webui 将在这里渲染——可热重载、版本化，也能发布成插件供其他 session 挂载。
        </div>
      </div>
    </div>
  );
}
