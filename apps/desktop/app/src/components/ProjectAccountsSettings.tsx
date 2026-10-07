import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelProvider, ProjectAccountScope, ProjectAccountsSnapshot } from "@milagre/shared/model";
import { accountType, providerName } from "@milagre/shared/providers";
import { HugeiconsIcon } from "@hugeicons/react";
import { Briefcase01Icon, UserIcon, UserMultipleIcon } from "@hugeicons/core-free-icons";
import { ipcErrorMessage } from "@milagre/shared/result";
import { Select } from "./primitives/Select";
import { ProjectAvatarStack } from "./ProjectAvatarStack";
import { ProviderLogo } from "./ProviderLogo";

function AccountIcon({ plan }: { plan?: string }) {
  const type = accountType(plan);
  return type ? (
    <span role="img" aria-label={`${type} account`} title={`${type} account`} className="flex shrink-0 text-ink-3">
      <HugeiconsIcon icon={type === "Business" ? Briefcase01Icon : type === "Team" ? UserMultipleIcon : UserIcon} size={15} />
    </span>
  ) : null;
}

export function ProjectAccountsSettings({ projectPath, onManageAccounts }: { projectPath?: string; onManageAccounts: () => void }) {
  const [scopeReload, setScopeReload] = useState(0);
  const [scopesLoaded, setScopesLoaded] = useState(false);
  const [scopes, setScopes] = useState<ProjectAccountScope[]>([]);
  const [scope, setScope] = useState(projectPath ?? "");
  const [snapshot, setSnapshot] = useState<ProjectAccountsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    let live = true;
    setScopesLoaded(false);
    const loadScopes = async () => {
      try {
        const available = await window.milagre.listAccountScopes();
        if (!live) return;
        setScopes(available);
        setScopesLoaded(true);
        setError("");
        setScope(available.some((item) => item.key === projectPath) ? projectPath! : (available[0]?.key ?? ""));
      } catch (reason) {
        if (live) setError(ipcErrorMessage(reason));
      }
    };
    void loadScopes();
    return () => {
      live = false;
    };
  }, [projectPath, scopeReload]);
  const load = useCallback(
    async (refresh = false) => {
      if (!scope) return;
      const version = ++generation.current;
      try {
        const next = await window.milagre.getProjectAccounts(scope, refresh);
        if (version === generation.current && currentScope.current === scope) {
          setSnapshot(next);
          setError("");
        }
      } catch (reason) {
        if (version === generation.current && currentScope.current === scope) setError(ipcErrorMessage(reason));
      }
    },
    [scope],
  );
  useEffect(() => {
    setSnapshot(null);
    setError("");
    setBusy(false);
    void load();
    const off = window.milagre.onAccountsChanged?.(() => void load());
    return () => {
      generation.current++;
      off?.();
    };
  }, [load]);
  const signingIn = snapshot?.providers.some((group) => group.accounts.some((account) => account.state === "signing-in"));
  useEffect(() => {
    if (!signingIn) return;
    const timer = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(timer);
  }, [load, signingIn]);
  const act = async (action: () => Promise<unknown>) => {
    const selectedScope = scope;
    setBusy(true);
    setError("");
    try {
      await action();
      if (currentScope.current === selectedScope) await load();
    } catch (reason) {
      if (currentScope.current === selectedScope) setError(ipcErrorMessage(reason));
    } finally {
      if (currentScope.current === selectedScope) setBusy(false);
    }
  };
  const selected = scopes.find((item) => item.key === scope);
  const shown = snapshot?.scopeKey === scope ? snapshot : null;
  return (
    <div data-project-accounts-settings className="mt-3 grid gap-6">
      <p className="text-[13px] leading-5 text-ink-3">Choose which saved accounts a Project or Link uses on this computer.</p>
      <section className="rounded-[12px] bg-surface p-4 shadow-card">
        <div className="mb-3 text-[12px] font-medium text-ink-3">Project or Link</div>
        <Select
          label="Project or Link"
          value={scope}
          width={360}
          disabled={!scopes.length}
          onChange={setScope}
          options={[...scopes]
            .sort((a, b) => Number(a.kind === "link") - Number(b.kind === "link"))
            .map((item) => ({
              value: item.key,
              label: item.name,
              group: item.kind === "link" ? "Links" : "Projects",
              icon: <ProjectAvatarStack projects={item.projects} />,
            }))}
        />
        {selected?.kind === "link" && <p className="mt-3 text-[12px] leading-5 text-ink-3">This Link's accounts are independent of its member Projects.</p>}
      </section>
      {error && (
        <p role="alert" className="text-[13px] text-red">
          {error}{" "}
          <button
            className="underline"
            onClick={() => {
              if (!scopes.length) setScopeReload((value) => value + 1);
              else void load(true);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {!shown && !error && (
        <p role="status" className="text-[13px] text-ink-3">
          {!scopesLoaded || scopes.length ? "Checking accounts..." : "Open a Project to choose its accounts."}
        </p>
      )}
      {shown && (
        <section className="divide-y divide-line rounded-[12px] bg-surface shadow-card">
          {shown.providers.map((group) => {
            const effective = group.accounts.find((account) => account.id === group.effectiveId);
            const missing = group.accountId !== null && (!effective || effective.missing === true);
            const defaultAccount = group.accounts.find((account) => account.id === group.defaultId);
            const statusLabel = (state: string) =>
              state === "signing-in" ? "Signing in" : state === "error" ? "Account error" : state === "unknown" ? "Not checked" : "Not signed in";
            const unavailable = missing || effective?.state !== "ready";
            return (
              <div key={group.provider} className="grid gap-3 px-4 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2.5 text-[14px] font-medium">
                    <ProviderLogo provider={group.provider} size={20} />
                    {providerName(group.provider)}
                  </h2>
                  <Select
                    label={`${providerName(group.provider)} account`}
                    value={group.accountId ?? ""}
                    width={340}
                    disabled={busy}
                    onChange={(id) => void act(() => window.milagre.assignProjectAccount(scope, group.provider as ModelProvider, id || null))}
                    options={[
                      { value: "", label: "Use computer default", description: defaultAccount?.email || defaultAccount?.label },
                      ...(missing && !effective ? [{ value: group.accountId!, label: "Unavailable account", disabled: true }] : []),
                      ...group.accounts.map((account) => ({
                        value: account.id,
                        label: account.missing ? "Unavailable account" : account.email || account.label,
                        description: account.missing ? "Removed account" : account.state === "ready" ? undefined : statusLabel(account.state),
                        disabled: account.missing || account.state !== "ready",
                        icon: <AccountIcon plan={account.plan} />,
                      })),
                    ]}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 pl-8">
                  <p className={`flex items-center gap-2 text-[12px] ${unavailable ? "text-red" : "text-ink-3"}`}>
                    <AccountIcon plan={effective?.plan} />
                    {missing
                      ? "The assigned account is unavailable. Choose another saved account."
                      : `${group.accountId === null ? "Computer default: " : ""}${effective?.email || effective?.label || "Account unavailable"}${effective && effective.state !== "ready" ? ` · ${statusLabel(effective.state)}` : ""}`}
                  </p>
                  {effective && !missing && effective.state !== "ready" && effective.id !== "default" && (
                    <button
                      className="shrink-0 text-[12px] text-ink underline disabled:opacity-40"
                      disabled={busy || signingIn}
                      onClick={() => void act(() => window.milagre.accountAction("login", group.provider, effective.id))}
                    >
                      Re-authenticate
                    </button>
                  )}
                </div>
                {effective?.message && (
                  <p role="status" className="pl-8 text-[12px] text-ink-3">
                    {effective.message}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}
      <p className="text-[12px] leading-5 text-ink-3">Running replies keep their original account. The next turn uses the account selected here.</p>
      <div>
        <button className="text-[13px] font-medium text-ink underline underline-offset-4" onClick={onManageAccounts}>
          Manage saved accounts
        </button>
      </div>
    </div>
  );
}
