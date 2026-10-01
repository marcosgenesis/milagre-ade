const { CodexRpc } = require("./codex-rpc.cjs");

// What each model accepts, asked from the agents themselves: Claude's supportedModels() and
// Codex's model/list. Keyed by model id; a model missing from the map is unknown to the agent.

// Claude reports no ultracode flag. Ultracode needs a model with the full effort range, so
// models that offer xhigh are treated as ultracode-capable.
function claudeCapability(info) {
  const efforts = info.supportsEffort ? info.supportedEffortLevels ?? [] : [];
  return { efforts, ultracode: efforts.includes("xhigh") };
}

async function claudeCapabilities({ command, loadSdk = () => import("@anthropic-ai/claude-agent-sdk") }) {
  const { query } = await loadSdk();
  const idle = { async *[Symbol.asyncIterator]() { await new Promise(() => {}); } };
  const session = query({ prompt: idle, options: { pathToClaudeCodeExecutable: command } });
  try {
    const models = await session.supportedModels();
    const result = {};
    for (const info of models) {
      const capability = claudeCapability(info);
      for (const id of [info.value, info.resolvedModel]) if (id) result[id.replace(/\[.*\]$/, "")] = capability;
    }
    return result;
  } finally {
    session.close?.();
  }
}

async function codexCapabilities({ command, cwd, clientVersion = "0.0.0" }) {
  const rpc = new CodexRpc({ command, cwd });
  rpc.start();
  try {
    await rpc.request("initialize", { clientInfo: { name: "milagre", title: "Milagre", version: clientVersion }, capabilities: null });
    rpc.notify("initialized");
    const result = {};
    let cursor = null;
    do {
      const page = await rpc.request("model/list", cursor ? { cursor } : {});
      for (const model of page.data ?? []) {
        const efforts = (model.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort ?? option);
        result[model.id] = { efforts, defaultEffort: model.defaultReasoningEffort ?? undefined, ultracode: false };
      }
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return result;
  } finally {
    rpc.close();
  }
}

/** Asks each installed agent once per run; a failed lookup is retried on the next call. */
function createCapabilityCache({ executable, cwd, clientVersion }) {
  const cache = new Map();
  function lookup(provider) {
    if (!cache.has(provider)) {
      const pending = executable(provider).then((command) => {
        if (!command) return {};
        return provider === "codex" ? codexCapabilities({ command, cwd, clientVersion }) : claudeCapabilities({ command });
      }).catch(() => {
        cache.delete(provider);
        return {};
      });
      cache.set(provider, pending);
    }
    return cache.get(provider);
  }
  return async () => {
    const [claude, codex] = await Promise.all([lookup("claude"), lookup("codex")]);
    return { claude, codex };
  };
}

module.exports = { claudeCapability, createCapabilityCache };
