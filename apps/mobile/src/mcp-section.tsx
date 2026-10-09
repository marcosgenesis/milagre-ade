import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { groupMcpRows, mcpStateCopy, mcpSummary, type McpAccount, type McpAccountCheck, type McpChip, type McpRow } from "@milagre/shared/mcp";
import { providerName } from "@milagre/shared/providers";
import { useSession } from "./session";
import { Icon, ProviderLogo } from "./icons";
import { useStyles } from "./ui";
import { useTheme } from "./theme";

const keyOf = (account: McpAccount) => `${account.provider}:${account.accountId}`;
type Entry = { account: McpAccount; check: McpAccountCheck | null };

/** Settings › MCP for the connected Mac: every account's servers, checked now. */
export function McpSection() {
  const session = useSession();
  return <McpForComputer key={session.client?.url || "disconnected"} />;
}

function McpForComputer() {
  const styles = useStyles();
  const { colors } = useTheme();
  const client = useSession().client;
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const run = useRef(0);
  const refresh = useCallback(async () => {
    if (!client) return;
    const id = ++run.current;
    let accounts: McpAccount[];
    try {
      accounts = await client.call<McpAccount[]>("mcp:accounts", []);
    } catch (cause) {
      // The demo computer (or an older Mac) refuses the method with a 403; anything else is a lost connection.
      if (id === run.current)
        setError(
          (cause as { status?: number }).status === 403
            ? "Not available on this computer. Update Milagre on the Mac, then refresh."
            : "Could not reach the computer. Check the connection, then refresh.",
        );
      return;
    }
    if (id !== run.current) return;
    setError("");
    setEntries(accounts.map((account) => ({ account, check: null })));
    // Every account at once; each fills in as it answers.
    await Promise.all(
      accounts.map(async (account) => {
        const check = await client
          .call<McpAccountCheck>("mcp:check", [account.provider, account.accountId])
          .catch((): McpAccountCheck => ({ ...account, problem: "Could not check. Check the computer connection, then refresh.", servers: [] }));
        if (id !== run.current) return;
        setEntries((current) => current?.map((entry) => (keyOf(entry.account) === keyOf(account) ? { ...entry, check } : entry)) ?? null);
      }),
    );
  }, [client]);
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
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 4 }}>
        <Text style={[styles.muted, { flexShrink: 1 }]}>{listing ? "Checking accounts…" : "The MCP servers each account loads in its Chats."}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh" disabled={checking} onPress={() => void refresh()} hitSlop={10}>
          <Icon icon={RefreshIcon} tone={checking ? "ink3" : "ink"} size={20} />
        </Pressable>
      </View>
      {error ? (
        <Text accessibilityRole="alert" selectable style={[styles.text, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}
      {problems.map((check) => (
        <Text key={keyOf(check)} style={styles.muted}>
          {providerName(check.provider)} · {check.label}: {check.problem}
        </Text>
      ))}
      <Rows rows={user} pending={pending} />
      {other.length ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={[styles.text, { fontWeight: "600", paddingHorizontal: 4 }]}>
            From projects and plugins ({other.length})
          </Text>
          <Text style={[styles.muted, { paddingHorizontal: 4 }]}>Set up in a project, a plugin or claude.ai. Change them there.</Text>
          <Rows rows={other} pending={[]} />
        </View>
      ) : null}
      {entries && !checking && !user.length && !other.length && !problems.length ? (
        <Text style={styles.muted}>No MCP servers yet. Add one with the Claude or Codex CLI on the Mac.</Text>
      ) : null}
    </View>
  );
}

function Rows({ rows, pending }: { rows: McpRow[]; pending: McpAccount[] }) {
  const { colors } = useTheme();
  if (!rows.length && !pending.length) return null;
  const pendingChips = pending.map((account) => (
    <ChipView key={keyOf(account)} chip={{ ...account, scope: "user", state: "pending", tools: 0, error: null }} />
  ));
  return (
    <View
      style={{ backgroundColor: colors.surface, borderRadius: 14, borderCurve: "continuous", overflow: "hidden", borderWidth: 1, borderColor: colors.line }}
    >
      {rows.map((row, index) => (
        <RowView key={row.name} row={row} first={index === 0} pending={pendingChips} />
      ))}
      {!rows.length ? <View style={{ padding: 14, gap: 8 }}>{pendingChips}</View> : null}
    </View>
  );
}

function RowView({ row, first, pending }: { row: McpRow; first: boolean; pending: React.ReactNode }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const transport = row.transport === "command" ? "Command" : row.transport === "url" ? "URL" : "claude.ai";
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderColor: colors.line, padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <Text style={[styles.text, { fontWeight: "600", flexShrink: 1 }]} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={[styles.muted, { flexShrink: 1, fontSize: 13 }]} numberOfLines={1}>
          {transport} · {mcpSummary(row)}
        </Text>
      </View>
      {row.chips.map((chip) => (
        <ChipView key={keyOf(chip)} chip={chip} />
      ))}
      {first ? pending : null}
    </View>
  );
}

function ChipView({ chip }: { chip: McpChip }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const dot = chip.state === "connected" ? colors.green : chip.state === "failed" ? colors.red : chip.state === "needs-sign-in" ? colors.orange : colors.ink3;
  const detail = chip.error ?? (chip.state === "connected" ? `${chip.tools} tools` : mcpStateCopy(chip.state));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <ProviderLogo provider={chip.provider} size={14} />
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />
      <Text style={[styles.muted, { flexShrink: 1, fontSize: 13 }]} numberOfLines={2} selectable>
        {chip.label} · {detail}
      </Text>
    </View>
  );
}
