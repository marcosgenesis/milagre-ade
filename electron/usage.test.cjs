const assert = require("node:assert/strict");
const test = require("node:test");
const { readClaudeUsage } = require("./usage.cjs");

const TOKEN = "sk-ant-oat01-SECRET-TOKEN";
const NOW = Date.parse("2026-10-01T19:30:00Z");
const CREDENTIALS = JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: NOW + 60 * 60_000, subscriptionType: "max" } });
const CREDENTIALS_FILE = "/Users/test/.claude/.credentials.json";

const USAGE_BODY = {
  five_hour: { utilization: 73, resets_at: "2026-10-01T20:49:59Z" },
  seven_day: { utilization: 61, resets_at: "2026-10-06T19:59:59Z" },
  limits: [
    { kind: "session", group: "session", percent: 73, resets_at: "2026-10-01T20:49:59Z", scope: null },
    { kind: "weekly_all", group: "weekly", percent: 61, resets_at: "2026-10-06T19:59:59Z", scope: null },
    { kind: "weekly_scoped", group: "weekly", percent: 66, resets_at: "2026-10-06T19:59:59Z", scope: { model: { id: null, display_name: "Fable" }, surface: null } },
  ],
};

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setup({ platform = "darwin", keychainOutput = CREDENTIALS, fileContents = {}, response = json(200, USAGE_BODY) } = {}) {
  const execCalls = [];
  const fetchCalls = [];
  const deps = {
    platform,
    home: "/Users/test",
    now: () => NOW,
    execFileImpl: (command, args, _options, callback) => {
      execCalls.push({ command, args });
      if (keychainOutput instanceof Error) callback(keychainOutput, "", "");
      else callback(null, keychainOutput, "");
    },
    readFile: async (file) => {
      if (Object.hasOwn(fileContents, file)) return fileContents[file];
      throw Object.assign(new Error(`ENOENT: no such file, open '${file}'`), { code: "ENOENT" });
    },
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      if (response instanceof Error) throw response;
      return response;
    },
  };
  return { deps, execCalls, fetchCalls };
}

test("reads Claude usage with the Claude Code token and maps every limit", async () => {
  const { deps, execCalls, fetchCalls } = setup();
  const result = await readClaudeUsage(deps);
  assert.deepEqual(execCalls, [{ command: "/usr/bin/security", args: ["find-generic-password", "-s", "Claude Code-credentials", "-w"] }]);
  assert.equal(fetchCalls[0].url, "https://api.anthropic.com/api/oauth/usage");
  assert.equal(fetchCalls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(fetchCalls[0].init.headers["anthropic-beta"], "oauth-2025-04-20");
  assert.deepEqual(result, {
    provider: "claude",
    status: "ok",
    updatedAt: new Date(NOW).toISOString(),
    windows: [
      { id: "session", label: "Session", shortLabel: "5h", usedPercent: 73, resetsAt: "2026-10-01T20:49:59Z" },
      { id: "weekly", label: "Weekly", shortLabel: "wk", usedPercent: 61, resetsAt: "2026-10-06T19:59:59Z" },
      { id: "weekly:fable", label: "Fable", shortLabel: "wk", usedPercent: 66, resetsAt: "2026-10-06T19:59:59Z" },
    ],
  });
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test("puts Session and Weekly first and skips limits it does not understand", async () => {
  const [session, weekly, fable] = USAGE_BODY.limits;
  const { deps } = setup({ response: json(200, { limits: [fable, { kind: "monthly_mystery", percent: 10, resets_at: null }, weekly, session] }) });
  const result = await readClaudeUsage(deps);
  assert.deepEqual(result.windows.map((item) => item.id), ["session", "weekly", "weekly:fable"]);
});

test("falls back to five_hour and seven_day when limits is missing", async () => {
  const { deps } = setup({ response: json(200, { five_hour: USAGE_BODY.five_hour, seven_day: USAGE_BODY.seven_day }) });
  const result = await readClaudeUsage(deps);
  assert.deepEqual(result.windows.map((item) => [item.id, item.usedPercent]), [["session", 73], ["weekly", 61]]);
});

test("clamps out-of-range percentages and skips missing ones", async () => {
  const { deps } = setup({ response: json(200, { limits: [
    { kind: "session", percent: 130, resets_at: null },
    { kind: "weekly_all", percent: null, resets_at: null },
  ] }) });
  const result = await readClaudeUsage(deps);
  assert.deepEqual(result.windows, [{ id: "session", label: "Session", shortLabel: "5h", usedPercent: 100, resetsAt: null }]);
});

test("uses the credentials file when the Keychain has no Claude item", async () => {
  const { deps, fetchCalls } = setup({
    keychainOutput: new Error("The specified item could not be found in the keychain."),
    fileContents: { [CREDENTIALS_FILE]: CREDENTIALS },
  });
  const result = await readClaudeUsage(deps);
  assert.equal(result.status, "ok");
  assert.equal(fetchCalls.length, 1);
});

test("skips the Keychain outside macOS", async () => {
  const { deps, execCalls } = setup({ platform: "linux", fileContents: { [CREDENTIALS_FILE]: CREDENTIALS } });
  const result = await readClaudeUsage(deps);
  assert.equal(result.status, "ok");
  assert.equal(execCalls.length, 0);
});

test("reports unavailable without calling the API when there are no credentials", async () => {
  const { deps, fetchCalls } = setup({ keychainOutput: new Error("not found") });
  const result = await readClaudeUsage(deps);
  assert.deepEqual([result.status, result.windows, result.message], ["unavailable", [], "Not signed in to Claude Code."]);
  assert.equal(fetchCalls.length, 0);
});

test("ignores malformed credentials without echoing them", async () => {
  const { deps } = setup({ keychainOutput: `{"claudeAiOauth":{"accessToken":"${TOKEN}"` });
  const result = await readClaudeUsage(deps);
  assert.equal(result.status, "unavailable");
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test("reports an expired sign-in without calling the API", async () => {
  const { deps, fetchCalls } = setup({ keychainOutput: JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: NOW - 1 } }) });
  const result = await readClaudeUsage(deps);
  assert.deepEqual([result.status, result.message], ["error", "Claude sign-in expired. Running any Claude agent refreshes it."]);
  assert.equal(fetchCalls.length, 0);
});

const FAILURES = [
  ["HTTP 401", json(401, { error: "unauthorized" }), "Claude sign-in expired. Running any Claude agent refreshes it."],
  ["HTTP 429", json(429, {}), "Claude is rate limiting usage checks. Try again in a minute."],
  ["HTTP 500", json(500, {}), "Claude usage failed (HTTP 500)."],
  ["unreadable JSON", { ok: true, status: 200, json: async () => { throw new SyntaxError(`Unexpected token near ${TOKEN}`); } }, "Claude returned an unreadable usage response."],
  ["no windows", json(200, { limits: [] }), "Claude returned no usage windows."],
  ["a network failure", new TypeError(`fetch failed for ${TOKEN}`), "Couldn't reach Claude."],
  ["a timeout", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "Claude usage timed out."],
];

for (const [name, response, message] of FAILURES) {
  test(`reports ${name} as an error without leaking the token`, async () => {
    const { deps } = setup({ response });
    const result = await readClaudeUsage(deps);
    assert.deepEqual([result.status, result.windows, result.message], ["error", [], message]);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });
}
