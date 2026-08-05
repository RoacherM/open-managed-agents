import { useEffect, useRef, useState } from "react";

import type { WorkspacePanelDefinition, WorkspaceSignals } from "./registry";

/**
 * Workspace tab strip. Two visual treatments off the same data:
 *
 *   underline — desktop, sitting in the header band with a sliding brand
 *               indicator under the active tab.
 *   segmented — bottom-sheet header on touch, where an underline on a
 *               horizontally-scrolling row is unreadable, so the active
 *               tab gets a filled pill instead.
 */
export function WorkspaceTabs({
  panels,
  signals,
  activePanelId,
  onSelect,
  variant,
}: {
  panels: WorkspacePanelDefinition[];
  signals: WorkspaceSignals;
  activePanelId: string | null;
  onSelect: (panelId: string) => void;
  variant: "underline" | "segmented";
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    if (variant !== "underline") return;
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !active) {
      setIndicator(null);
      return;
    }
    setIndicator({ left: active.offsetLeft + 10, width: Math.max(0, active.offsetWidth - 20) });
  }, [activePanelId, panels, variant]);

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Workspace panels"
      className={
        variant === "underline"
          ? "relative flex items-center gap-0.5 h-full"
          : "flex items-center gap-1 py-0.5"
      }
    >
      {panels.map((panel) => {
        const active = panel.id === activePanelId;
        const badge = panel.badge?.(signals);
        return (
          <TabButton
            key={panel.id}
            panel={panel}
            active={active}
            badge={badge}
            unseen={signals.unseen[panel.id] ?? 0}
            variant={variant}
            onSelect={onSelect}
          />
        );
      })}
      {variant === "underline" && (
        <span
          aria-hidden
          className="absolute bottom-[-1px] h-0.5 rounded-t-sm bg-brand transition-[left,width,opacity] duration-[var(--dur-slow)] ease-[var(--ease-soft)]"
          style={{
            left: indicator?.left ?? 0,
            width: indicator?.width ?? 0,
            opacity: indicator ? 1 : 0,
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  panel,
  active,
  badge,
  unseen,
  variant,
  onSelect,
}: {
  panel: WorkspacePanelDefinition;
  active: boolean;
  badge: number | undefined;
  unseen: number;
  variant: "underline" | "segmented";
  onSelect: (panelId: string) => void;
}) {
  // Bump the badge whenever the unseen counter climbs — one animation per
  // arrival, retriggered by remounting the element via `key`.
  const [bumpKey, setBumpKey] = useState(0);
  const lastUnseen = useRef(unseen);
  useEffect(() => {
    if (unseen > lastUnseen.current) setBumpKey((k) => k + 1);
    lastUnseen.current = unseen;
  }, [unseen]);

  const Icon = panel.icon;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(panel.id)}
      className={
        variant === "underline"
          ? `relative h-full px-2.5 inline-flex items-center gap-1.5 text-[13px] transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] ${active ? "text-fg" : "text-fg-subtle hover:text-fg-muted"}`
          : `h-10 shrink-0 px-3.5 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] border transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] ${
              active
                ? "bg-brand-subtle border-brand/40 text-fg"
                : "bg-bg-surface border-border text-fg-subtle"
            }`
      }
    >
      <Icon className="size-3.75 opacity-90" />
      {panel.title}
      {badge !== undefined && (
        <span
          key={bumpKey}
          className={`min-w-4.5 h-4.25 px-1.25 rounded-[5px] font-mono text-[10.5px] inline-grid place-items-center ${
            active ? "bg-brand-subtle text-brand-hover" : "bg-bg-bubble text-fg-subtle"
          } ${bumpKey > 0 ? "workspace-badge-bump" : ""}`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
