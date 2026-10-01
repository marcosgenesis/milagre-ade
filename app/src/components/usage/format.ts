import type { ModelProvider, ProviderUsage, UsageSnapshot } from "../../model";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const PROVIDER_NAMES: Record<ModelProvider, string> = { claude: "Claude", codex: "Codex" };

export type UsageTone = "normal" | "warning" | "critical";

export function usageTone(usedPercent: number): UsageTone {
  const rounded = Math.round(usedPercent);
  if (rounded >= 95) return "critical";
  if (rounded >= 80) return "warning";
  return "normal";
}

export function formatPercent(usedPercent: number) {
  return `${Math.round(usedPercent)}%`;
}

export function formatResetsIn(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return null;
  const remaining = target - now;
  if (remaining <= 0) return "Resetting…";
  if (remaining < HOUR) return `Resets in ${Math.max(1, Math.ceil(remaining / MINUTE))}m`;
  if (remaining < DAY) return `Resets in ${Math.floor(remaining / HOUR)}h ${Math.floor((remaining % HOUR) / MINUTE)}m`;
  return `Resets in ${Math.floor(remaining / DAY)}d ${Math.floor((remaining % DAY) / HOUR)}h`;
}

export function formatUpdatedAgo(updatedAt: string, now: number): string {
  const elapsed = now - Date.parse(updatedAt);
  // NaN and negative (clock skew) both land here.
  if (!(elapsed >= MINUTE)) return "Updated just now";
  if (elapsed < HOUR) return `Updated ${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `Updated ${Math.floor(elapsed / HOUR)}h ago`;
  return `Updated ${Math.floor(elapsed / DAY)}d ago`;
}

export function visibleProviders(snapshot: UsageSnapshot) {
  return snapshot.providers.filter((item) => item.status !== "unavailable");
}

export function usageLabel(usage: ProviderUsage) {
  const name = PROVIDER_NAMES[usage.provider];
  if (usage.windows.length === 0) return `${name} usage unavailable`;
  const windows = usage.windows.slice(0, 2).map((item) => `${item.label} ${formatPercent(item.usedPercent)} used`);
  return `${name} usage: ${windows.join(", ")}`;
}

// A failed refresh keeps the last good windows and their timestamp, so the card
// stays useful and "Updated Xm ago" stays truthful while showing the error.
export function mergeSnapshot(previous: UsageSnapshot | null, next: UsageSnapshot): UsageSnapshot {
  return {
    providers: next.providers.map((current) => {
      if (current.status !== "error") return current;
      const before = previous?.providers.find((item) => item.provider === current.provider);
      if (!before || before.windows.length === 0) return current;
      return { ...current, windows: before.windows, updatedAt: before.updatedAt };
    }),
  };
}
