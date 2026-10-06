import { useCallback, useEffect, useState } from "react";
import type { AccountsSnapshot, ModelProvider } from "@milagre/shared/model";
import { providerName } from "@milagre/shared/providers";
import { ProviderLogo } from "./ProviderLogo";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, CircleIcon, Delete02Icon, RefreshIcon } from "@hugeicons/core-free-icons";

const button = "rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover disabled:opacity-40";

export function AccountsSettings() {
  const [snapshot, setSnapshot] = useState<AccountsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<ModelProvider | null>(null);
  const [label, setLabel] = useState("");
  const load = useCallback(async (refresh = false) => {
    try { setSnapshot(await window.milagre.listAccounts(refresh)); setError(""); }
    catch { setError("Could not load accounts. Check the computer connection, then refresh."); }
  }, []);
  useEffect(() => { void load(); return window.milagre.onAccountsChanged?.(() => void load()); }, [load]);
  const signingIn = snapshot?.providers.some(p => p.accounts.some(a => a.state === "signing-in"));
  useEffect(() => {
    if (!signingIn) return;
    const timer = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(timer);
  }, [load, signingIn]);
  const act = async (action: "add" | "select" | "login" | "cancel" | "remove", provider: ModelProvider, value: string) => {
    setBusy(true); setError("");
    try { setSnapshot(await window.milagre.accountAction(action, provider, value)); if (action === "add") { setAdding(null); setLabel(""); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update this account. Try again."); }
    finally { setBusy(false); }
  };
  return <div className="mt-6 grid gap-5" data-accounts-settings>
    <div className="flex items-start justify-between gap-6">
      <p className="max-w-[430px] text-[13px] leading-5 text-ink-3">Click an account to switch across your Projects. Running replies keep their account until they finish.</p>
      <button className={button} disabled={busy} onClick={() => { setBusy(true); void load(true).finally(() => setBusy(false)); }}>Refresh</button>
    </div>
    {error && <p role="alert" className="text-[13px] text-red">{error}</p>}
    {!snapshot && !error && <p role="status" className="text-[13px] text-ink-3">Checking accounts...</p>}
    {snapshot?.providers.map(group => <section key={group.provider} className="overflow-hidden rounded-[12px] bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-4">
        <h2 className="flex items-center gap-2.5 text-[14px] font-medium"><ProviderLogo provider={group.provider} size={20} />{providerName(group.provider)}</h2>
        <button className={button} disabled={busy || signingIn} onClick={() => { setAdding(group.provider); setLabel(""); }}>Add account</button>
      </div>
      <div className="grid gap-2 p-3" role="group" aria-label={`${providerName(group.provider)} accounts`}>
        {group.accounts.map(account => {
          const selected = group.selectedId === account.id;
          return <div key={account.id} className={`flex items-center gap-2 rounded-lg border pr-3 transition-colors ${selected ? "border-line-strong bg-hover" : "border-line hover:bg-hover"}`}>
            <button type="button" role="radio" aria-checked={selected} aria-label={account.email || account.label} disabled={busy || account.state !== "ready"} onClick={() => { if (!selected) void act("select", group.provider, account.id); }} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-2 disabled:cursor-default">
              <HugeiconsIcon icon={selected ? CheckmarkCircle02Icon : CircleIcon} size={18} strokeWidth={1.8} className={`shrink-0 ${selected ? "text-ink" : "text-ink-3"}`} />
              <span className="min-w-0 space-y-1">
                <span className="flex items-center gap-2"><span className="truncate text-[13.5px] font-medium">{account.email || account.label}</span>{selected && <span className="shrink-0 text-[11px] text-ink-2">Active</span>}</span>
                <span className="block text-[12px] text-ink-3">{[account.email ? account.label : null, account.plan, account.state === "signed-out" ? "Not signed in" : account.state === "unknown" ? "Not checked" : null].filter(Boolean).join(" · ")}</span>
                {account.message && <span role={account.state === "error" ? "alert" : "status"} className="block max-w-[390px] text-[12px] leading-5 text-ink-3">{account.message}</span>}
              </span>
            </button>
            {account.id !== "default" && <div className="flex shrink-0 gap-2">
              {account.state === "signing-in" ? <button className={button} disabled={busy} onClick={() => void act("cancel", group.provider, account.id)}>Cancel</button>
                : <button className={`${button} flex items-center gap-1.5 border-transparent`} disabled={busy || signingIn} title="Sign in again in this computer's browser" onClick={() => void act("login", group.provider, account.id)}><HugeiconsIcon icon={RefreshIcon} size={14} />Re-authenticate</button>}
              <button className={`${button} flex items-center gap-1.5 border-transparent`} disabled={busy} title="Remove from Milagre. The local profile remains. Removing the active account selects the connected CLI account." onClick={() => void act("remove", group.provider, account.id)}><HugeiconsIcon icon={Delete02Icon} size={14} />Remove</button>
            </div>}
          </div>;
        })}
      </div>
      {adding === group.provider && <form className="grid gap-3 border-t border-line px-4 py-4" onSubmit={event => { event.preventDefault(); void act("add", group.provider, label); }}>
        <label className="grid gap-2 text-[12px] text-ink-2">Account name<input autoFocus required maxLength={80} value={label} onChange={event => setLabel(event.target.value)} placeholder="Personal or work" className="rounded-lg border border-line bg-field px-3 py-2 text-[13px] text-ink outline-none focus:border-line-strong" /></label>
        <p className="text-[12px] text-ink-3">Sign-in opens in your computer's browser. Choose the account you want to add.</p>
        <div className="flex gap-2"><button type="submit" className={button} disabled={busy || !label.trim()}>Continue to sign in</button><button type="button" className={button} disabled={busy} onClick={() => setAdding(null)}>Cancel</button></div>
      </form>}
    </section>)}
    <p className="text-[12px] leading-5 text-ink-3">Add and sign in on this computer. Paired phones can switch accounts. Remove keeps the local profile; removing the active account selects the connected CLI account.</p>
  </div>;
}
