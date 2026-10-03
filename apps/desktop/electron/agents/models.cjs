const { CodexRpc } = require("./codex-rpc.cjs");

// The models each agent offers, asked from its CLI once per app run: Claude's supportedModels() and
// Codex's model/list. A model is { id, name, description, recommended, efforts, defaultEffort?, ultracode },
// where `efforts` are the levels it accepts, lightest first (none when it has no effort control).

// "claude-haiku-4-5-20251001" and "claude-opus-5-5[1m]" are the picker's "claude-haiku-4-5" and "claude-opus-5-5".
const plainId = (id) => String(id ?? "").replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");
// Codex ends its descriptions with a period; Claude's and the picker's have none.
const sentence = (text) => String(text ?? "").trim().replace(/\.$/, "");

// Claude reports no ultracode flag. Ultracode needs a model with the full effort range, so
// models that offer xhigh are treated as ultracode-capable.
function claudeCapability(info) {
  const efforts = info.supportsEffort ? info.supportedEffortLevels ?? [] : [];
  return { efforts, ultracode: efforts.includes("xhigh") };
}

// supportedModels() lists aliases first (default, opus, fable, sonnet, haiku), each resolving to a model,
// then older models by id. The picker lists models by id, so a chat keeps its model when an alias moves
// on to a newer one; "default" only says which model Claude Code recommends.
function claudeModels(infos) {
  const recommended = plainId(infos.find((info) => info.value === "default")?.resolvedModel);
  const models = new Map();
  for (const info of infos) {
    const id = plainId(String(info.value).startsWith("claude-") ? info.value : info.resolvedModel);
    if (info.value === "default" || !id.startsWith("claude-") || models.has(id)) continue;
    models.set(id, { id, name: info.displayName || id, description: sentence(info.description), recommended: id === recommended, ...claudeCapability(info) });
  }
  return [...models.values()];
}

// model/list leaves hidden models out unless asked for them; any that come anyway are dropped.
function codexModels(entries) {
  return entries.filter((model) => model?.id && model.hidden !== true).map((model) => ({
    id: model.id,
    name: model.displayName || model.id,
    description: sentence(model.description),
    recommended: model.isDefault === true,
    efforts: (model.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort ?? option),
    ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort } : {}),
    ultracode: false,
  }));
}

async function listClaudeModels({ command, loadSdk = () => import("@anthropic-ai/claude-agent-sdk") }) {
  const { query } = await loadSdk();
  const idle = { async *[Symbol.asyncIterator]() { await new Promise(() => {}); } };
  const session = query({ prompt: idle, options: { pathToClaudeCodeExecutable: command } });
  try {
    return claudeModels(await session.supportedModels());
  } finally {
    session.close?.();
  }
}

async function listCodexModels({ command, cwd, clientVersion = "0.0.0", createRpc = (options) => new CodexRpc(options) }) {
  const rpc = createRpc({ command, cwd });
  rpc.start();
  try {
    await rpc.request("initialize", { clientInfo: { name: "milagre", title: "Milagre", version: clientVersion }, capabilities: null });
    rpc.notify("initialized");
    const entries = [];
    let cursor = null;
    do {
      const page = await rpc.request("model/list", cursor ? { cursor } : {});
      entries.push(...(page.data ?? []));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return codexModels(entries);
  } finally {
    rpc.close();
  }
}

/**
 * Asks each agent's CLI once per run. An agent whose CLI has a problem (missing, too old) or whose lookup
 * fails or comes back empty reports null, and is asked again on the next call.
 */
function createModelCache({ cli, cwd, clientVersion, list = { claude: listClaudeModels, codex: listCodexModels } }) {
  const cache = new Map();
  function lookup(provider) {
    if (!cache.has(provider)) {
      const pending = cli(provider)
        .then((status) => (status.problem || !status.command ? null : list[provider]({ command: status.command, cwd, clientVersion })))
        .catch(() => null)
        .then((models) => {
          if (models?.length) return models;
          cache.delete(provider);
          return null;
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

module.exports = { claudeCapability, claudeModels, codexModels, createModelCache, listClaudeModels, listCodexModels };
