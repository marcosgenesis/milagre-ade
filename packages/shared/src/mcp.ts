// MCP servers as Settings › MCP shows them, shared by desktop and phone (docs/superpowers/specs/2026-10-09-mcp-settings-design.md).

export type McpChipState = "connected" | "failed" | "needs-sign-in" | "pending" | "disabled";
export type McpTransport = "command" | "url" | "connector";
export type McpScope = "user" | "project" | "local" | "plugin" | "claude.ai" | "built-in";
/** One server as one account loads it. */
export type McpServerReport = { name: string; transport: McpTransport; scope: McpScope; state: McpChipState; tools: number; error: string | null };
export type McpAccount = { provider: "claude" | "codex"; accountId: string; label: string };
/** The answer to mcp:check. `problem` is set when the account could not be checked; `servers` is then empty. */
export type McpAccountCheck = McpAccount & { problem: string | null; servers: McpServerReport[] };
export type McpChip = McpAccount & { scope: McpScope; state: McpChipState; tools: number; error: string | null };
/** One server name, with a chip per account that loads it. Only user-scope servers can be edited (PR 2). */
export type McpRow = { name: string; transport: McpTransport; editable: boolean; chips: McpChip[] };

/** Rows by server name: `user` holds every row with a user-scope chip, `other` the project, plugin and claude.ai ones. */
export function groupMcpRows(checks: McpAccountCheck[]): { user: McpRow[]; other: McpRow[] } {
  const rows = new Map<string, McpRow>();
  for (const check of checks) {
    if (check.problem) continue;
    for (const server of check.servers) {
      const row = rows.get(server.name) ?? { name: server.name, transport: server.transport, editable: false, chips: [] };
      row.chips.push({
        provider: check.provider,
        accountId: check.accountId,
        label: check.label,
        scope: server.scope,
        state: server.state,
        tools: server.tools,
        error: server.error,
      });
      row.editable ||= server.scope === "user";
      rows.set(server.name, row);
    }
  }
  const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { user: sorted.filter((row) => row.editable), other: sorted.filter((row) => !row.editable) };
}

const STATE_COPY: Record<McpChipState, string> = {
  connected: "Connected",
  failed: "Failed",
  "needs-sign-in": "Needs sign-in",
  pending: "Checking",
  disabled: "Off",
};

/** "Connected" for a single chip, "1 of 2 connected" for several. */
export function mcpSummary(row: McpRow): string {
  const [only] = row.chips;
  if (only && row.chips.length === 1) return STATE_COPY[only.state];
  const connected = row.chips.filter((chip) => chip.state === "connected").length;
  return `${connected} of ${row.chips.length} connected`;
}

export const mcpStateCopy = (state: McpChipState) => STATE_COPY[state];
