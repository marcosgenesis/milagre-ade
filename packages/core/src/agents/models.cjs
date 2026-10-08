const { CodexRpc } = require("./codex-rpc.cjs");

// The models each agent offers, asked from its CLI once per app run: Claude's supportedModels() and
// Codex's model/list. A model is { id, name, description, recommended, efforts, defaultEffort?, ultracode, fastMode },
// where `efforts` are the levels it accepts, lightest first (none when it has no effort control) and `fastMode`
// says whether it has a faster, costlier tier: Claude Code's fast mode, or Codex's "priority" service tier.

// "claude-haiku-4-5-20251001" and "claude-opus-5-5[1m]" are the picker's "claude-haiku-4-5" and "claude-opus-5-5".
const plainId = (id) =>
  String(id ?? "")
    .replace(/\[.*\]$/, "")
    .replace(/-\d{8}$/, "");
// Codex ends its descriptions with a period; Claude's and the picker's have none.
const sentence = (text) =>
  String(text ?? "")
    .trim()
    .replace(/\.$/, "");

// Claude reports no ultracode flag. Ultracode needs a model with the full effort range, so
// models that offer xhigh are treated as ultracode-capable. supportsFastMode comes only on the
// models that have it (Opus 5.5, Opus 5 and Opus 4.8 as of Claude Code 2.1.288).
function claudeCapability(info) {
  const efforts = info.supportsEffort ? (info.supportedEffortLevels ?? []) : [];
  return { efforts, ultracode: efforts.includes("xhigh"), fastMode: info.supportsFastMode === true };
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

// Codex's fast mode is the "priority" service tier, listed per model (turn/start's serviceTierForTurn).
const CODEX_FAST_TIER = "priority";

// model/list leaves hidden models out unless asked for them; any that come anyway are dropped.
function codexModels(entries) {
  return entries
    .filter((model) => model?.id && model.hidden !== true)
    .map((model) => ({
      id: model.id,
      name: model.displayName || model.id,
      description: sentence(model.description),
      recommended: model.isDefault === true,
      efforts: (model.supportedReasoningEfforts ?? []).map((option) => option.reasoningEffort ?? option),
      ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort } : {}),
      ultracode: false,
      fastMode: (model.serviceTiers ?? []).some((tier) => tier?.id === CODEX_FAST_TIER),
    }));
}

async function listClaudeModels({ command, env, loadSdk = () => import("@anthropic-ai/claude-agent-sdk") }) {
  const { query } = await loadSdk();
  const idle = {
    // oxlint-disable-next-line require-yield -- async generator stub that throws or never settles on purpose to simulate a failing or idle stream
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {});
    },
  };
  const session = query({ prompt: idle, options: { pathToClaudeCodeExecutable: command, ...(env ? { env } : {}) } });
  try {
    return claudeModels(await session.supportedModels());
  } finally {
    session.close?.();
  }
}

async function listCodexModels({ command, cwd, env, clientVersion = "0.0.0", createRpc = (options) => new CodexRpc(options) }) {
  const rpc = createRpc({ command, cwd, ...(env ? { env } : {}) });
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
        .then((status) =>
          status.problem || !status.command
            ? null
            : list[provider]({ command: status.command, cwd, clientVersion, ...(status.env ? { env: status.env } : {}) }),
        )
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
  const read = async () => {
    const [claude, codex] = await Promise.all([lookup("claude"), lookup("codex")]);
    return { claude, codex };
  };
  read.invalidate = (provider) => cache.delete(provider);
  return read;
}

module.exports = { CODEX_FAST_TIER, claudeCapability, claudeModels, codexModels, createModelCache, listClaudeModels, listCodexModels };
