const { CodexRpc } = require("../agents/codex-rpc.cjs");

// One Codex account's MCP servers: config/read says how each is configured, mcpServerStatus/list connects them
// without a thread and says whether that worked (the listCodexModels pattern in agents/models.cjs).

function codexServer(status, configured) {
  const tools = Object.keys(status.tools ?? {}).length;
  const signIn = status.authStatus === "notLoggedIn";
  const state = configured?.enabled === false ? "disabled" : status.toolsError ? (signIn ? "needs-sign-in" : "failed") : signIn ? "needs-sign-in" : "connected";
  return {
    name: status.name,
    transport: configured?.url || status.httpOrigin ? "url" : "command",
    scope: status.pluginId ? "plugin" : configured ? "user" : "built-in",
    state,
    tools,
    error: status.toolsError ?? null,
  };
}

async function checkCodex({ command, env, cwd, clientVersion = "0.0.0", createRpc = (options) => new CodexRpc(options) }) {
  const rpc = createRpc({ command, cwd, ...(env ? { env } : {}) });
  rpc.start();
  try {
    await rpc.request("initialize", { clientInfo: { name: "milagre", title: "Milagre", version: clientVersion }, capabilities: null });
    rpc.notify("initialized");
    const configured = (await rpc.request("config/read", { cwd })).config?.mcp_servers ?? {};
    const servers = [];
    let cursor = null;
    do {
      const page = await rpc.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", ...(cursor ? { cursor } : {}) });
      for (const status of page.data ?? []) servers.push(codexServer(status, configured[status.name]));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return servers;
  } finally {
    rpc.close();
  }
}

module.exports = { checkCodex, codexServer };
