import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { ArrowDown01Icon, Tick02Icon, Briefcase01Icon, UserIcon, UserMultipleIcon } from "@hugeicons/core-free-icons";
import type { ModelProvider, ProjectAccountScope, ProjectAccountsSnapshot } from "@milagre/shared/model";
import { accountType, providerName } from "@milagre/shared/providers";
import { useSession } from "./session";
import { Icon, ProviderLogo } from "./icons";
import { ProjectIcon, ProjectIcons } from "./project-icon";
import { ListRow, PageScroll, PullDown, colors, styles } from "./ui";

export function ProjectAccountsSection() {
  const session = useSession();
  return <ProjectAccountsForComputer key={session.client?.url || "disconnected"} />;
}

export function ProjectAccountsForComputer() {
  const session = useSession();
  const client = session.client;
  const [scopes, setScopes] = useState<ProjectAccountScope[]>([]);
  const [scopeKey, setScopeKey] = useState(session.snapshot?.project.path || "");
  const [snapshot, setSnapshot] = useState<ProjectAccountsSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const activeScope = useRef(scopeKey);
  useEffect(() => {
    activeScope.current = scopeKey;
  }, [scopeKey]);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void client
      .call<ProjectAccountScope[]>("accounts:scopes")
      .then((value) => {
        if (!live) return;
        setScopes(value);
        setScopeKey((current) => (value.some((scope) => scope.key === current) ? current : value[0]?.key || ""));
      })
      .catch(() => {
        if (live) setError("Could not load Projects & Links. Check the computer connection.");
      });
    return () => {
      live = false;
    };
  }, [client, retry]);
  const load = useCallback(
    async (refresh = false) => {
      if (!client || !scopeKey) return;
      const version = ++request.current;
      try {
        const value = await client.call<ProjectAccountsSnapshot>("accounts:scope", [scopeKey, refresh]);
        if (version === request.current && activeScope.current === scopeKey) {
          setSnapshot(value);
          setError("");
        }
      } catch {
        if (version === request.current) setError("Could not load project accounts. Try refreshing.");
      }
    },
    [client, scopeKey],
  );
  const invalidate = useCallback(() => {
    request.current++;
  }, []);
  // This effect fetches the newly selected scope from the connected computer.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void load();
    return invalidate;
  }, [load, invalidate, session.providerRevision, retry]);
  const visible = snapshot?.scopeKey === scopeKey ? snapshot : null;
  const { refreshProviders } = session;
  const signingIn = visible?.providers.some((group) => group.accounts.some((account) => account.state === "signing-in"));
  useEffect(() => {
    if (!signingIn) return;
    const timer = setInterval(() => {
      void load(true);
      void refreshProviders();
    }, 1500);
    return () => clearInterval(timer);
  }, [load, signingIn, refreshProviders]);
  const assign = async (provider: ModelProvider, id: string | null) => {
    if (!client || busy) return;
    const version = ++request.current;
    setBusy(true);
    setError("");
    try {
      const value = await client.call<ProjectAccountsSnapshot>("accounts:assign", [scopeKey, provider, id]);
      if (version === request.current && activeScope.current === scopeKey) setSnapshot(value);
      void refreshProviders();
    } catch (reason) {
      if (activeScope.current === scopeKey) setError(reason instanceof Error ? reason.message : "Could not update this account. Try again.");
    } finally {
      if (activeScope.current === scopeKey) setBusy(false);
    }
  };
  const reauthenticate = async (provider: ModelProvider, id: string) => {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.call("accounts:login", [provider, id]);
      if (activeScope.current !== scopeKey) return;
      await load();
      void refreshProviders();
    } catch (reason) {
      if (activeScope.current === scopeKey) setError(reason instanceof Error ? reason.message : "Could not start sign-in. Try again.");
    } finally {
      if (activeScope.current === scopeKey) setBusy(false);
    }
  };
  const selected = scopes.find((scope) => scope.key === scopeKey);
  const photo = (scope: ProjectAccountScope) =>
    scope.kind === "link" ? (
      <ProjectIcons client={client} projects={scope.projects} />
    ) : (
      <ProjectIcon client={client} path={scope.projects[0]?.path || scope.key} />
    );
  if (!client) return <Text style={styles.muted}>Connect to a computer to choose project accounts.</Text>;
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 8 }}>
        <Text style={styles.caption}>Projects &amp; Links</Text>
        <View style={styles.card}>
          <ListRow
            compact
            title={selected?.name || "Choose a Project or Link"}
            leading={selected ? photo(selected) : undefined}
            trailing={<Icon icon={ArrowDown01Icon} size={18} />}
            onPress={() => setExpanded((value) => !value)}
          />
          {expanded ? (
            <PageScroll nestedScrollEnabled style={{ maxHeight: 280 }} contentContainerStyle={{ padding: 0 }}>
              {(["project", "link"] as const).map((kind) => (
                <View key={kind}>
                  {scopes.some((scope) => scope.kind === kind) ? <Text style={styles.caption}>{kind === "project" ? "Projects" : "Links"}</Text> : null}
                  {scopes
                    .filter((scope) => scope.kind === kind)
                    .map((scope) => (
                      <ListRow
                        key={scope.key}
                        compact
                        title={scope.name}
                        leading={photo(scope)}
                        trailing={scope.key === scopeKey ? <Icon icon={Tick02Icon} size={18} /> : undefined}
                        onPress={() => {
                          activeScope.current = scope.key;
                          setScopeKey(scope.key);
                          setBusy(false);
                          setError("");
                          setExpanded(false);
                        }}
                      />
                    ))}
                </View>
              ))}
            </PageScroll>
          ) : null}
        </View>
      </View>
      {error ? (
        <View>
          <Text accessibilityRole="alert" style={styles.text}>
            {error}
          </Text>
          <ListRow compact title="Retry" onPress={() => setRetry((value) => value + 1)} />
        </View>
      ) : null}
      {!visible && scopeKey && !error ? <Text style={styles.muted}>Checking accounts...</Text> : null}
      {visible?.providers.map((group) => {
        const effective = group.accounts.find((account) => account.id === group.effectiveId);
        const fallback = group.accounts.find((account) => account.id === group.defaultId);
        const type = accountType(effective?.plan);
        const typeIcon = type === "Business" ? Briefcase01Icon : type === "Team" ? UserMultipleIcon : UserIcon;
        return (
          <View key={group.provider} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <ProviderLogo provider={group.provider} size={18} />
              <Text style={styles.text}>{providerName(group.provider)}</Text>
            </View>
            <PullDown
              label={`${providerName(group.provider)} account`}
              sections={[
                {
                  items: [
                    {
                      id: "__default__",
                      title: `Use computer default${fallback?.email ? ` · ${fallback.email}` : ""}`,
                      systemImage: "desktopcomputer",
                      checked: group.accountId === null,
                      disabled: busy,
                    },
                    ...group.accounts.map((account) => ({
                      id: account.id,
                      title: account.email || account.label,
                      subtitle:
                        account.state === "signed-out"
                          ? "Not signed in"
                          : account.state === "signing-in"
                            ? "Finish sign-in on computer"
                            : account.state === "unknown"
                              ? "Not checked"
                              : account.state === "error"
                                ? account.message || "Account unavailable"
                                : undefined,
                      systemImage: accountType(account.plan) === "Business" ? "briefcase" : accountType(account.plan) === "Team" ? "person.2" : "person",
                      checked: group.accountId === account.id,
                      disabled: busy || account.state !== "ready",
                    })),
                  ],
                },
              ]}
              onSelect={(id) => {
                void assign(group.provider, id === "__default__" ? null : id);
              }}
            >
              <View style={[styles.card, { flexDirection: "row", gap: 10, alignItems: "center", minHeight: 54 }]}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text numberOfLines={1} style={styles.text}>
                    {group.accountId === null ? "Use computer default" : effective?.email || effective?.label || "Account unavailable"}
                  </Text>
                  {group.accountId === null ? <Text style={styles.caption}>{fallback?.email || fallback?.label || "No computer default"}</Text> : null}
                </View>
                {type ? <Icon icon={typeIcon} tone="ink3" size={17} /> : null}
                <Icon icon={ArrowDown01Icon} tone="ink3" size={18} />
              </View>
            </PullDown>
            {effective?.message ? (
              <Text accessibilityRole={effective.state === "error" ? "alert" : undefined} style={styles.caption}>
                {effective.message}
              </Text>
            ) : effective && effective.state !== "ready" ? (
              <Text style={styles.caption}>
                {effective.state === "signed-out"
                  ? "Not signed in"
                  : effective.state === "signing-in"
                    ? "Finish sign-in on computer"
                    : effective.state === "unknown"
                      ? "Not checked"
                      : "Account unavailable"}
              </Text>
            ) : null}
            {group.accounts
              .filter((account) => account.state !== "ready" && account.id !== "default" && !account.missing)
              .map((account) => (
                <ListRow
                  key={account.id}
                  compact
                  title={`${account.state === "signing-in" ? "Finish sign-in on computer" : "Re-authenticate"}: ${account.email || account.label}`}
                  disabled={busy || account.state === "signing-in"}
                  onPress={() => {
                    void reauthenticate(group.provider, account.id);
                  }}
                />
              ))}
          </View>
        );
      })}
      {!scopeKey && !error ? <Text style={styles.muted}>Open a Project on your computer to choose its accounts.</Text> : null}
      <Text style={styles.caption}>Running turns keep their original account. The next turn uses the account selected here.</Text>
      <View style={{ borderTopWidth: 1, borderColor: colors.line }}>
        <ListRow compact title="Manage saved accounts" onPress={() => router.push("/accounts")} />
      </View>
    </View>
  );
}
