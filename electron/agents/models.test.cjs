const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { CodexRpc } = require("./codex-rpc.cjs");
const { claudeCapability, claudeModels, codexModels, createModelCache, listClaudeModels, listCodexModels } = require("./models.cjs");

const FAKE = path.join(__dirname, "fixtures", "fake-app-server.cjs");
const FULL = ["low", "medium", "high", "xhigh", "max"];

// Rows of supportedModels() from Claude Code 2.1.287.
const CLAUDE_ROWS = [
  { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)", description: "Opus 5.5 · Best for everyday, complex tasks", supportsEffort: true, supportedEffortLevels: FULL },
  { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5", description: "For complex work and everyday tasks", supportsEffort: true, supportedEffortLevels: FULL },
  { value: "fable", resolvedModel: "claude-fable-5-1", displayName: "Fable 5.1", description: "For your toughest challenges", supportsEffort: true, supportedEffortLevels: FULL },
  { value: "opus[1m]", resolvedModel: "claude-opus-5-5[1m]", displayName: "Opus 5.5 (1M context)", description: "For long sessions", supportsEffort: true, supportedEffortLevels: FULL },
  { value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", description: "Fastest for quick answers" },
  { value: "claude-opus-5", resolvedModel: "claude-opus-5", displayName: "Opus 5", description: "Best for everyday, complex tasks", supportsEffort: true, supportedEffortLevels: FULL },
  { value: "claude-sonnet-4-6", resolvedModel: "claude-sonnet-4-6", displayName: "Sonnet 4.6", description: "Efficient for routine tasks", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "max"] },
];

test("a Claude model with the full effort range offers ultracode", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] }), { efforts: ["low", "medium", "high", "xhigh", "max"], ultracode: true });
});

test("a Claude model without xhigh keeps its levels but not ultracode", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: true, supportedEffortLevels: ["low", "medium", "high"] }), { efforts: ["low", "medium", "high"], ultracode: false });
});

test("a Claude model without effort support has no levels", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: false, supportedEffortLevels: ["low"] }), { efforts: [], ultracode: false });
  assert.deepEqual(claudeCapability({}), { efforts: [], ultracode: false });
});

test("Claude's aliases become the models they resolve to, once each, with the default recommended", () => {
  assert.deepEqual(claudeModels(CLAUDE_ROWS), [
    { id: "claude-opus-5-5", name: "Opus 5.5", description: "For complex work and everyday tasks", recommended: true, efforts: FULL, ultracode: true },
    { id: "claude-fable-5-1", name: "Fable 5.1", description: "For your toughest challenges", recommended: false, efforts: FULL, ultracode: true },
    { id: "claude-haiku-4-5", name: "Haiku 4.5", description: "Fastest for quick answers", recommended: false, efforts: [], ultracode: false },
    { id: "claude-opus-5", name: "Opus 5", description: "Best for everyday, complex tasks", recommended: false, efforts: FULL, ultracode: true },
    { id: "claude-sonnet-4-6", name: "Sonnet 4.6", description: "Efficient for routine tasks", recommended: false, efforts: ["low", "medium", "high", "max"], ultracode: false },
  ]);
  assert.deepEqual(claudeModels([{ value: "opus", displayName: "Opus" }]), []);
});

test("Codex's models keep its names, efforts and default, and drop hidden ones", () => {
  const entries = [
    { id: "gpt-6-astra", model: "gpt-6-astra", displayName: "GPT-6-Astra", description: "Frontier intelligence for the most demanding work.", hidden: false, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }, { reasoningEffort: "ultra", description: "Parallel" }], defaultReasoningEffort: "medium", upgrade: null, upgradeInfo: null },
    { id: "gpt-reserve", displayName: "GPT-Reserve", description: "Fast and affordable agentic coding model.", hidden: true, isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: "medium" },
    { id: "gpt-5.5", displayName: "", description: "Legacy coding model.", hidden: false, isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: null },
  ];
  assert.deepEqual(codexModels(entries), [
    { id: "gpt-6-astra", name: "GPT-6-Astra", description: "Frontier intelligence for the most demanding work", recommended: true, efforts: ["low", "ultra"], defaultEffort: "medium", ultracode: false },
    { id: "gpt-5.5", name: "gpt-5.5", description: "Legacy coding model", recommended: false, efforts: ["low"], ultracode: false },
  ]);
});

test("Codex's model list is read page by page from the app-server", async () => {
  const models = await listCodexModels({ command: process.execPath, cwd: os.tmpdir(), createRpc: (options) => new CodexRpc({ ...options, args: [FAKE] }) });
  assert.deepEqual(models.map((model) => model.id), ["gpt-6-astra", "gpt-6-luna"]);
});

test("Claude's model list comes from an idle query that is closed afterwards", async () => {
  const calls = { closed: 0, options: null };
  const loadSdk = async () => ({
    query: ({ options }) => {
      calls.options = options;
      return { supportedModels: async () => CLAUDE_ROWS.slice(0, 3), close: () => { calls.closed += 1; } };
    },
  });
  const models = await listClaudeModels({ command: "/Users/x/.local/bin/claude", loadSdk });
  assert.deepEqual(models.map((model) => model.id), ["claude-opus-5-5", "claude-fable-5-1"]);
  assert.deepEqual(calls, { closed: 1, options: { pathToClaudeCodeExecutable: "/Users/x/.local/bin/claude" } });
});

test("each agent is asked once per run; a missing CLI or a failed lookup is asked again", async () => {
  const asked = { claude: 0, codex: 0 };
  const statuses = { claude: [{ command: "/c", version: "2.1.287" }], codex: [{ command: null, version: null, problem: "missing" }, { command: "/x", version: "0.158.0" }] };
  const cli = async (provider) => statuses[provider][0].problem ? statuses[provider].shift() : statuses[provider][0];
  let codexFails = true;
  const list = {
    claude: async () => { asked.claude += 1; return [{ id: "claude-opus-5-5" }]; },
    codex: async ({ command }) => {
      asked.codex += 1;
      assert.equal(command, "/x");
      if (codexFails) {
        codexFails = false;
        throw new Error("Codex did not answer model/list within 30 s.");
      }
      return [{ id: "gpt-6-astra" }];
    },
  };
  const models = createModelCache({ cli, cwd: "/tmp", clientVersion: "1.0.0", list });
  assert.deepEqual(await models(), { claude: [{ id: "claude-opus-5-5" }], codex: null });
  assert.deepEqual(await models(), { claude: [{ id: "claude-opus-5-5" }], codex: null });
  assert.deepEqual(await models(), { claude: [{ id: "claude-opus-5-5" }], codex: [{ id: "gpt-6-astra" }] });
  assert.deepEqual(asked, { claude: 1, codex: 2 });
});
