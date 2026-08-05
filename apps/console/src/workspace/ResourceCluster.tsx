import { Link } from "react-router";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { AgentIcon, EnvIcon, VaultIcon } from "../components/icons";
import { shortenId } from "../lib/format";

/**
 * Resource cluster — one chip in the session header that collapses the
 * agent / environment / vault badges into a single truncating summary, with
 * the full detail in a popover.
 *
 * The pre-workspace header laid these out as three-plus separate badges,
 * which is fine on a page-width header but not next to a tab strip: on a
 * 1280px window the badges pushed the tabs off the row entirely. Clustering
 * gives the header one element that can absorb truncation while the session
 * id and the tabs keep their widths.
 */

export interface SessionResources {
  agent?: { id: string; name?: string; model?: string; version?: number };
  environment?: { id: string; name?: string; description?: string };
  vaults: Array<{ id: string; display_name?: string }>;
}

export function ResourceCluster({ resources }: { resources: SessionResources }) {
  const { agent, environment, vaults } = resources;
  if (!agent && !environment && vaults.length === 0) return null;

  const summary = [
    agent ? agent.name || shortenId(agent.id) : null,
    environment ? environment.name || shortenId(environment.id) : null,
    vaults.length === 1
      ? vaults[0].display_name || shortenId(vaults[0].id)
      : vaults.length > 1
        ? `${vaults.length} vaults`
        : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Popover>
      <PopoverTrigger className="hidden lg:inline-flex items-center gap-1.5 min-w-0 max-w-full h-6 px-2 rounded-md border border-border text-[11.5px] text-fg-subtle hover:bg-bg-surface hover:border-border-strong hover:text-fg-muted data-[state=open]:bg-bg-surface data-[state=open]:border-border-strong transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]">
        <AgentIcon className="size-3 shrink-0" />
        <span className="truncate">{summary}</span>
        <svg viewBox="0 0 24 24" className="size-3 shrink-0 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-71 gap-1 p-1.5">
        {agent && (
          <ResourceRow
            icon={<AgentIcon className="size-3.5" />}
            title={agent.name || shortenId(agent.id)}
            detail={[shortenId(agent.id), agent.version ? `v${agent.version}` : null, agent.model]
              .filter(Boolean)
              .join(" · ")}
            to={`/agents/${agent.id}`}
          />
        )}
        {environment && (
          <ResourceRow
            icon={<EnvIcon className="size-3.5" />}
            title={environment.name || shortenId(environment.id)}
            detail={[shortenId(environment.id), environment.description].filter(Boolean).join(" · ")}
            to={`/environments/${environment.id}`}
          />
        )}
        {vaults.map((v) => (
          <ResourceRow
            key={v.id}
            icon={<VaultIcon className="size-3.5" />}
            title={v.display_name || shortenId(v.id)}
            detail={shortenId(v.id)}
            to={`/vaults/${v.id}`}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ResourceRow({
  icon,
  title,
  detail,
  to,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-2.5 px-2 py-1.5 rounded-lg hover:bg-bg-surface transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
    >
      <span className="grid place-items-center size-6 shrink-0 rounded-md bg-bg-surface text-fg-subtle">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-fg truncate">{title}</span>
        <span className="block font-mono text-[11px] text-fg-subtle truncate">{detail}</span>
      </span>
    </Link>
  );
}
