const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { CodexRpc } = require("./codex-rpc.cjs");
const {
  claudeCapability,
  claudeModels,
  codexModels,
  createModelCache,
  forgetAntigravityModels,
  antigravityModels,
  listClaudeModels,
  listCodexModels,
  listAntigravityModels,
  recordAntigravityModels,
} = require("./models.cjs");

const FAKE = path.join(__dirname, "fixtures", "fake-app-server.cjs");
const FULL = ["low", "medium", "high", "xhigh", "max"];

// Rows of supportedModels() from Claude Code 2.1.288 (supportsFastMode is reported only where it is true).
const CLAUDE_ROWS = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5",
    displayName: "Default (recommended)",
    description: "Opus 5.5 · Best for everyday, complex tasks",
    supportsEffort: true,
    supportedEffortLevels: FULL,
    supportsFastMode: true,
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus 5.5",
    description: "For complex work and everyday tasks",
    supportsEffort: true,
    supportedEffortLevels: FULL,
    supportsFastMode: true,
  },
  {
    value: "fable",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable 5.1",
    description: "For your toughest challenges",
    supportsEffort: true,
    supportedEffortLevels: FULL,
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-5-5[1m]",
    displayName: "Opus 5.5 (1M context)",
    description: "For long sessions",
    supportsEffort: true,
    supportedEffortLevels: FULL,
  },
  { value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5", description: "Fastest for quick answers" },
  {
    value: "claude-opus-5",
    resolvedModel: "claude-opus-5",
    displayName: "Opus 5",
    description: "Best for everyday, complex tasks",
    supportsEffort: true,
    supportedEffortLevels: FULL,
    supportsFastMode: true,
  },
  {
    value: "claude-sonnet-4-6",
    resolvedModel: "claude-sonnet-4-6",
    displayName: "Sonnet 4.6",
    description: "Efficient for routine tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
];

test("a Claude model with the full effort range offers ultracode", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] }), {
    efforts: ["low", "medium", "high", "xhigh", "max"],
    ultracode: true,
    fastMode: false,
  });
});

test("a Claude model offers fast mode only when Claude Code says so", () => {
  assert.equal(claudeCapability({ supportsEffort: true, supportedEffortLevels: FULL, supportsFastMode: true }).fastMode, true);
  assert.equal(claudeCapability({ supportsEffort: true, supportedEffortLevels: FULL, supportsFastMode: false }).fastMode, false);
  assert.equal(claudeCapability({ supportsEffort: true, supportedEffortLevels: FULL }).fastMode, false);
});

test("a Claude model without xhigh keeps its levels but not ultracode", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: true, supportedEffortLevels: ["low", "medium", "high"] }), {
    efforts: ["low", "medium", "high"],
    ultracode: false,
    fastMode: false,
  });
});

test("a Claude model without effort support has no levels", () => {
  assert.deepEqual(claudeCapability({ supportsEffort: false, supportedEffortLevels: ["low"] }), { efforts: [], ultracode: false, fastMode: false });
  assert.deepEqual(claudeCapability({}), { efforts: [], ultracode: false, fastMode: false });
});

test("Claude's aliases become the models they resolve to, once each, with the default recommended", () => {
  assert.deepEqual(claudeModels(CLAUDE_ROWS), [
    {
      id: "claude-opus-5-5",
      name: "Opus 5.5",
      description: "For complex work and everyday tasks",
      recommended: true,
      efforts: FULL,
      ultracode: true,
      fastMode: true,
    },
    {
      id: "claude-fable-5-1",
      name: "Fable 5.1",
      description: "For your toughest challenges",
      recommended: false,
      efforts: FULL,
      ultracode: true,
      fastMode: false,
    },
    { id: "claude-haiku-4-5", name: "Haiku 4.5", description: "Fastest for quick answers", recommended: false, efforts: [], ultracode: false, fastMode: false },
    {
      id: "claude-opus-5",
      name: "Opus 5",
      description: "Best for everyday, complex tasks",
      recommended: false,
      efforts: FULL,
      ultracode: true,
      fastMode: true,
    },
    {
      id: "claude-sonnet-4-6",
      name: "Sonnet 4.6",
      description: "Efficient for routine tasks",
      recommended: false,
      efforts: ["low", "medium", "high", "max"],
      ultracode: false,
      fastMode: false,
    },
  ]);
  assert.deepEqual(claudeModels([{ value: "opus", displayName: "Opus" }]), []);
});

test("Codex's models keep its names, efforts, default and Fast tier, and drop hidden ones", () => {
  const entries = [
    {
      id: "gpt-6-astra",
      model: "gpt-6-astra",
      displayName: "GPT-6-Astra",
      description: "Frontier intelligence for the most demanding work.",
      hidden: false,
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast" },
        { reasoningEffort: "ultra", description: "Parallel" },
      ],
      defaultReasoningEffort: "medium",
      upgrade: null,
      upgradeInfo: null,
      serviceTiers: [{ id: "priority", name: "Fast", description: "2x speed, increased usage" }],
      defaultServiceTier: null,
    },
    {
      id: "gpt-reserve",
      displayName: "GPT-Reserve",
      description: "Fast and affordable agentic coding model.",
      hidden: true,
      isDefault: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: "medium",
    },
    {
      id: "gpt-5.5",
      displayName: "",
      description: "Legacy coding model.",
      hidden: false,
      isDefault: false,
      supportedReasoningEfforts: [{ reasoningEffort: "low" }],
      defaultReasoningEffort: null,
      serviceTiers: [],
    },
  ];
  assert.deepEqual(codexModels(entries), [
    {
      id: "gpt-6-astra",
      name: "GPT-6-Astra",
      description: "Frontier intelligence for the most demanding work",
      recommended: true,
      efforts: ["low", "ultra"],
      defaultEffort: "medium",
      ultracode: false,
      fastMode: true,
    },
    { id: "gpt-5.5", name: "gpt-5.5", description: "Legacy coding model", recommended: false, efforts: ["low"], ultracode: false, fastMode: false },
  ]);
});

test("Codex's model list is read page by page from the app-server", async () => {
  const models = await listCodexModels({ command: process.execPath, cwd: os.tmpdir(), createRpc: (options) => new CodexRpc({ ...options, args: [FAKE] }) });
  assert.deepEqual(
    models.map((model) => model.id),
    ["gpt-6-astra", "gpt-6-luna"],
  );
  assert.deepEqual(
    models.map((model) => model.fastMode),
    [true, false],
  );
});

test("Claude's model list comes from an idle query that is closed afterwards", async () => {
  const calls = { closed: 0, options: null };
  const loadSdk = async () => ({
    query: ({ options }) => {
      calls.options = options;
      return {
        supportedModels: async () => CLAUDE_ROWS.slice(0, 3),
        close: () => {
          calls.closed += 1;
        },
      };
    },
  });
  const models = await listClaudeModels({ command: "/Users/x/.local/bin/claude", loadSdk });
  assert.deepEqual(
    models.map((model) => model.id),
    ["claude-opus-5-5", "claude-fable-5-1"],
  );
  assert.deepEqual(calls, { closed: 1, options: { pathToClaudeCodeExecutable: "/Users/x/.local/bin/claude" } });
});

test("each agent is asked once per run; a missing CLI or a failed lookup is asked again", async () => {
  const asked = { claude: 0, codex: 0 };
  const statuses = {
    claude: [{ command: "/c", version: "2.1.287" }],
    codex: [
      { command: null, version: null, problem: "missing" },
      { command: "/x", version: "0.158.0" },
    ],
  };
  const cli = async (provider) => (statuses[provider][0].problem ? statuses[provider].shift() : statuses[provider][0]);
  let codexFails = true;
  const list = {
    claude: async () => {
      asked.claude += 1;
      return [{ id: "claude-opus-5-5" }];
    },
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
  list.antigravity = () => [{ id: "gemini-3.8-flash-high" }];
  const models = createModelCache({ cli, cwd: "/tmp", clientVersion: "1.0.0", list });
  const antigravity = [{ id: "gemini-3.8-flash-high" }];
  assert.deepEqual(await models(), { claude: [{ id: "claude-opus-5-5" }], codex: null, antigravity });
  assert.deepEqual(await models(), { claude: [{ id: "claude-opus-5-5" }], codex: null, antigravity });
  assert.deepEqual(await models(), { claude: [{ id: "claude-opus-5-5" }], codex: [{ id: "gpt-6-astra" }], antigravity });
  assert.deepEqual(asked, { claude: 1, codex: 2 });
});

test("Antigravity lists the catalog's families until a session reports models, then that account's grouped list", () => {
  forgetAntigravityModels();
  const fallback = listAntigravityModels({ accountId: "work" });
  assert.deepEqual(
    fallback.map((model) => model.id),
    ["gemini-3.8-flash", "gemini-3.1-pro", "gemini-3.7-flash", "gemini-3.6-flash"],
  );
  assert.deepEqual(fallback[0], {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    description: "Fast",
    recommended: true,
    efforts: ["low", "medium", "high"],
    defaultEffort: "high",
    ultracode: false,
    fastMode: false,
  });
  assert.deepEqual(fallback[1].efforts, ["low", "high"]);
  assert.equal(fallback[1].recommended, true);
  recordAntigravityModels(
    "work",
    [
      { value: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)", description: "gemini-3.8-flash-high" },
      { value: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)", description: "gemini-3.8-flash-low" },
      { value: "gemini-4-preview", name: "Gemini 4 Preview", description: "gemini-4-preview" },
      { value: "gemini-5", name: "Gemini 5", description: "Next generation" },
    ],
    "gemini-3.8-flash-low",
  );
  assert.deepEqual(listAntigravityModels({ accountId: "work" }), [
    {
      id: "gemini-3.8-flash",
      name: "Gemini 3.8 Flash",
      description: "Fast",
      recommended: true,
      efforts: ["low", "high"],
      defaultEffort: "low",
      ultracode: false,
      fastMode: false,
    },
    { id: "gemini-4-preview", name: "Gemini 4 Preview", description: "", recommended: false, efforts: [], ultracode: false, fastMode: false },
    { id: "gemini-5", name: "Gemini 5", description: "Next generation", recommended: false, efforts: [], ultracode: false, fastMode: false },
  ]);
  // Another account, and an account the app doesn't name, keep their own lists.
  assert.deepEqual(listAntigravityModels({ accountId: "home" }), fallback);
  assert.deepEqual(listAntigravityModels(), fallback);
  recordAntigravityModels(undefined, [{ value: "x", name: "X" }]);
  assert.equal(listAntigravityModels({ accountId: "default" })[0].id, "x");
  recordAntigravityModels("work", []);
  assert.equal(listAntigravityModels({ accountId: "work" }).length, 3);
  assert.deepEqual(
    antigravityModels(null).map((model) => model.id),
    fallback.map((model) => model.id),
  );
  forgetAntigravityModels();
});

test("the model cache always has an Antigravity list, even for a missing or logged-out agent, keyed by the account", async () => {
  forgetAntigravityModels();
  recordAntigravityModels("a2", [{ value: "m", name: "M" }]);
  const cli = async (provider) => (provider === "antigravity" ? { command: null, problem: "missing", accountId: "a2" } : { command: null, problem: "missing" });
  const models = createModelCache({ cli, cwd: "/tmp", clientVersion: "1.0.0" });
  const read = await models();
  assert.equal(read.claude, null);
  assert.deepEqual(
    read.antigravity.map((model) => model.id),
    ["m"],
  );
  forgetAntigravityModels();
  assert.ok((await models()).antigravity.length > 1);
  const failing = createModelCache({
    cli: async () => {
      throw new Error("no cli");
    },
    cwd: "/tmp",
    clientVersion: "1.0.0",
  });
  assert.ok((await failing()).antigravity.length > 1);
});
