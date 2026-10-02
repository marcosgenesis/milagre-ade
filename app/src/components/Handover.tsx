import type { ModelProvider } from "../model";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { providerLabel } from "../lib/handover";
import { ProviderLogo } from "./ProviderLogo";

/** Replaces the provider tabs once a chat has messages: opens a new chat on the other provider with this one's context. */
export function HandoverRow({ provider, blocked, onClick }: { provider: ModelProvider; blocked: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      data-handover-row
      disabled={blocked !== null}
      title={blocked ?? undefined}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-control bg-inset px-2.5 py-2 text-left hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
    >
      <ProviderLogo provider={provider} size={16} />
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-semibold text-ink">Handover to {providerLabel(provider)}</span>
        <span className="truncate text-[11px] text-ink-3">New chat with this chat's context</span>
      </span>
    </button>
  );
}

export function HandoverLinkBar({ to, onOpen }: { to: { id: number; title: string; provider: ModelProvider }; onOpen: (id: number) => void }) {
  return (
    <button type="button" data-handover-to onClick={() => onOpen(to.id)} className="flex w-full items-center gap-2 rounded-control border border-line px-3 py-2 text-left text-[12px] text-ink-2 hover:bg-hover">
      <ProviderLogo provider={to.provider} size={14} />
      <span>Handed over to {providerLabel(to.provider)}</span>
      <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.8} color="currentColor" />
      <span className="min-w-0 truncate font-medium text-ink">{to.title}</span>
    </button>
  );
}

export function HandoverFromLabel({ from, onOpen }: { from: { id: number; title: string }; onOpen: (id: number) => void }) {
  return (
    <button type="button" data-handover-from onClick={() => onOpen(from.id)} className="self-end text-[11px] text-ink-3 hover:text-ink">
      Handed over from <span className="font-medium">{from.title}</span>
    </button>
  );
}
