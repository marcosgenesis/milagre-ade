import type { ModelProvider } from "../model";
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
