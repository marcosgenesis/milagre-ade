import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { groupMcpRows, mcpStateCopy, mcpSummary, type McpAccount, type McpAccountCheck, type McpChip, type McpRow } from "@milagre/shared/mcp";
import { providerName } from "@milagre/shared/providers";
import type { MilagreBridge } from "../electron";
import { ProviderLogo } from "./ProviderLogo";

const button =
  "inline-flex items-center gap-1.5 rounded-lg border border-line cursor-pointer disabled:cursor-default px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover disabled:opacity-40";
const keyOf = (account: McpAccount) => `${account.provider}:${account.accountId}`;
const DOT: Record<McpChip["state"], string> = {
  connected: "bg-green",
  failed: "bg-red",
  "needs-sign-in": "bg-orange",
  pending: "bg-ink-3 animate-pulse",
  disabled: "bg-ink-3",
};

type Entry = { account: McpAccount; check: McpAccountCheck | null };

/** Settings › MCP for one computer: this one by default, or a paired Mac's bridge on its computer page. */
export function McpSettings({ bridge = window.milagre }: { bridge?: MilagreBridge }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const run = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++run.current;
    setError("");
    let accounts: McpAccount[];
    try {
      accounts = await bridge.mcp.accounts();
    } catch (cause) {
      if (id === run.current) setError(cause instanceof Error ? cause.message : "Could not reach the computer. Check the connection, then refresh.");
      return;
    }
    if (id !== run.current) return;
    setEntries(accounts.map((account) => ({ account, check: null })));
    // Every account at once; each fills in as it answers, so one slow account never holds the others.
    await Promise.all(
      accounts.map(async (account) => {
        const check = await bridge.mcp
          .check(account.provider, account.accountId)
          .catch((cause): McpAccountCheck => ({ ...account, problem: cause instanceof Error ? cause.message : String(cause), servers: [] }));
        if (id !== run.current) return;
        setEntries((current) => current?.map((entry) => (keyOf(entry.account) === keyOf(account) ? { ...entry, check } : entry)) ?? null);
      }),
    );
  }, [bridge]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const checks = (entries ?? []).flatMap((entry) => (entry.check ? [entry.check] : []));
  const { user, other } = groupMcpRows(checks);
  const pending = (entries ?? []).filter((entry) => !entry.check).map((entry) => entry.account);
  const problems = checks.filter((check) => check.problem);
  const listing = entries === null && !error;
  const checking = listing || pending.length > 0;

  return (
    <div className="mt-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-ink-3">{listing ? "Checking accounts…" : "The MCP servers each account loads in its Chats."}</p>
        <button className={button} disabled={checking} onClick={() => void refresh()}>
          <HugeiconsIcon icon={RefreshIcon} size={14} strokeWidth={1.8} color="currentColor" />
          Refresh
        </button>
      </div>
      {error && <p className="text-[13px] text-red">{error}</p>}
      {problems.length > 0 && (
        <ul className="space-y-1 text-[12px] text-ink-3">
          {problems.map((check) => (
            <li key={keyOf(check)} data-mcp-problem={keyOf(check)}>
              {providerName(check.provider)} · {check.label}: {check.problem}
            </li>
          ))}
        </ul>
      )}
      <Rows rows={user} pending={pending} />
      {other.length > 0 && (
        <details data-mcp-other className="group">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">From projects and plugins ({other.length})</summary>
          <p className="mt-1 text-[12px] text-ink-3">Set up in a project, a plugin or claude.ai. Change them there.</p>
          <div className="mt-3">
            <Rows rows={other} pending={[]} />
          </div>
        </details>
      )}
      {entries && !checking && user.length === 0 && other.length === 0 && problems.length === 0 && (
        <p className="text-[13px] text-ink-3">No MCP servers yet. Add one with the Claude or Codex CLI on the Mac.</p>
      )}
    </div>
  );
}

function Rows({ rows, pending }: { rows: McpRow[]; pending: McpAccount[] }) {
  if (!rows.length && !pending.length) return null;
  return (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {rows.map((row) => (
        <div key={row.name} data-mcp-row={row.name} className="space-y-2 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-ink">{row.name}</span>
            <span className="text-[12px] text-ink-3">
              {row.transport === "command" ? "Command" : row.transport === "url" ? "URL" : "claude.ai"} · {mcpSummary(row)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {row.chips.map((chip) => (
              <Chip key={keyOf(chip)} chip={chip} />
            ))}
            {pending.map((account) => (
              <Chip key={keyOf(account)} chip={{ ...account, scope: "user", state: "pending", tools: 0, error: null }} />
            ))}
          </div>
        </div>
      ))}
      {!rows.length && (
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {pending.map((account) => (
            <Chip key={keyOf(account)} chip={{ ...account, scope: "user", state: "pending", tools: 0, error: null }} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ chip }: { chip: McpChip }) {
  const detail = chip.error ?? (chip.state === "connected" ? `${chip.tools} tools` : mcpStateCopy(chip.state));
  return (
    <span
      data-mcp-chip={keyOf(chip)}
      data-state={chip.state}
      title={detail}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2"
    >
      <ProviderLogo provider={chip.provider} size={12} />
      <span className="truncate">{chip.label}</span>
      <span className={`size-1.5 shrink-0 rounded-full ${DOT[chip.state]}`} />
      {chip.state !== "connected" && <span className="truncate text-ink-3">{chip.error ?? mcpStateCopy(chip.state)}</span>}
    </span>
  );
}
