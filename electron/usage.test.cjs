const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { createUsageReader, readClaudeUsage, readCodexUsage } = require("./usage.cjs");

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

const RESETS_AT = 1791070247;
const WEEKLY_ONLY = { primary: { usedPercent: 88, windowDurationMins: 10080, resetsAt: RESETS_AT }, secondary: null };

function fakeCodex({ account = { type: "chatgpt", planType: "pro" }, rateLimits, chunked = false, reply = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdin = new EventEmitter();
  child.sent = [];
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  const emit = (message) => {
    const text = `${JSON.stringify(message)}\n`;
    if (!chunked) {
      setImmediate(() => child.stdout.emit("data", Buffer.from(text)));
      return;
    }
    const middle = Math.floor(text.length / 2);
    const notification = `${JSON.stringify({ method: "account/updated", params: { authMode: "chatgpt" } })}\n`;
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from(notification + text.slice(0, middle)));
      setImmediate(() => child.stdout.emit("data", Buffer.from(text.slice(middle))));
    });
  };
  child.stdin.write = (text) => {
    for (const line of String(text).split("\n").filter(Boolean)) {
      const message = JSON.parse(line);
      child.sent.push(message.method);
      if (!reply || message.id === undefined) continue;
      if (message.method === "initialize") emit({ id: message.id, result: { userAgent: "codex" } });
      if (message.method === "account/read") emit({ id: message.id, result: { account, requiresOpenaiAuth: true } });
      if (message.method === "account/rateLimits/read") emit({ id: message.id, result: { rateLimits } });
    }
    return true;
  };
  return child;
}

function codexDeps(child, overrides = {}) {
  const spawnCalls = [];
  const deps = {
    now: () => NOW,
    timeoutMs: 200,
    spawnImpl: (command, args) => {
      spawnCalls.push({ command, args });
      return child;
    },
    ...overrides,
  };
  return { deps, spawnCalls };
}

test("reads Codex usage from the app server and stops it", async () => {
  const child = fakeCodex({ rateLimits: WEEKLY_ONLY });
  const { deps, spawnCalls } = codexDeps(child);
  const result = await readCodexUsage(deps);
  assert.deepEqual(spawnCalls, [{ command: "codex", args: ["app-server"] }]);
  assert.deepEqual(child.sent, ["initialize", "initialized", "account/read", "account/rateLimits/read"]);
  assert.deepEqual(result, {
    provider: "codex",
    status: "ok",
    updatedAt: new Date(NOW).toISOString(),
    windows: [{ id: "weekly", label: "Weekly", shortLabel: "wk", usedPercent: 88, resetsAt: new Date(RESETS_AT * 1000).toISOString() }],
  });
  assert.equal(child.killed, true);
});

test("orders Codex windows shortest first and labels other durations", async () => {
  const both = fakeCodex({ rateLimits: {
    primary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: RESETS_AT },
    secondary: { usedPercent: 12, windowDurationMins: 300, resetsAt: null },
  } });
  const result = await readCodexUsage(codexDeps(both).deps);
  assert.deepEqual(result.windows.map((item) => [item.id, item.label, item.shortLabel]), [["session", "Session", "5h"], ["weekly", "Weekly", "wk"]]);

  const odd = fakeCodex({ rateLimits: {
    primary: { usedPercent: 5, windowDurationMins: 1440, resetsAt: null },
    secondary: { usedPercent: 6, windowDurationMins: 90, resetsAt: null },
  } });
  const oddResult = await readCodexUsage(codexDeps(odd).deps);
  assert.deepEqual(oddResult.windows.map((item) => [item.id, item.label, item.shortLabel]), [["window:90", "90m window", "90m"], ["window:1440", "1d window", "1d"]]);
});

test("parses replies split across chunks and mixed with notifications", async () => {
  const child = fakeCodex({ rateLimits: WEEKLY_ONLY, chunked: true });
  const result = await readCodexUsage(codexDeps(child).deps);
  assert.equal(result.status, "ok");
  assert.equal(result.windows[0].usedPercent, 88);
});

test("reports unavailable when Codex is not signed in", async () => {
  const child = fakeCodex({ account: null, rateLimits: WEEKLY_ONLY });
  const result = await readCodexUsage(codexDeps(child).deps);
  assert.deepEqual([result.status, result.message], ["unavailable", "Not signed in to Codex."]);
  assert.ok(!child.sent.includes("account/rateLimits/read"));
  assert.equal(child.killed, true);
});

test("reports unavailable when the Codex CLI is not installed", async () => {
  const child = fakeCodex({ reply: false });
  setImmediate(() => child.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })));
  const result = await readCodexUsage(codexDeps(child).deps);
  assert.deepEqual([result.status, result.message], ["unavailable", "Codex CLI not found."]);
});

test("times out, kills Codex and reports an error", async () => {
  const child = fakeCodex({ reply: false });
  const result = await readCodexUsage(codexDeps(child, { timeoutMs: 20 }).deps);
  assert.deepEqual([result.status, result.message], ["error", "Codex usage timed out."]);
  assert.equal(child.killed, true);
});

test("reports an error when Codex exits early or returns no windows", async () => {
  const exited = fakeCodex({ reply: false });
  setImmediate(() => exited.emit("close", 1, null));
  const early = await readCodexUsage(codexDeps(exited).deps);
  assert.deepEqual([early.status, early.message], ["error", "Codex exited before reporting usage."]);

  const empty = fakeCodex({ rateLimits: { primary: null, secondary: null } });
  const none = await readCodexUsage(codexDeps(empty).deps);
  assert.deepEqual([none.status, none.message], ["error", "Codex returned no usage windows."]);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("shares one in-flight read between concurrent callers", async () => {
  let claudeReads = 0;
  let codexReads = 0;
  const claude = deferred();
  const updatedAt = new Date(NOW).toISOString();
  const readUsage = createUsageReader({
    now: () => NOW,
    readClaude: () => {
      claudeReads += 1;
      return claude.promise;
    },
    readCodex: async () => {
      codexReads += 1;
      return { provider: "codex", status: "unavailable", windows: [], updatedAt, message: "Codex CLI not found." };
    },
  });

  const first = readUsage();
  const second = readUsage();
  assert.equal(first, second);
  claude.resolve({ provider: "claude", status: "ok", windows: [], updatedAt });
  const snapshot = await first;
  assert.deepEqual(snapshot.providers.map((item) => item.provider), ["claude", "codex"]);
  assert.deepEqual([claudeReads, codexReads], [1, 1]);

  await readUsage();
  assert.deepEqual([claudeReads, codexReads], [2, 2]);
});

test("waits for the login environment before reading either provider", async () => {
  const updatedAt = new Date(NOW).toISOString();
  const environment = deferred();
  const order = [];
  const readUsage = createUsageReader({
    now: () => NOW,
    ready: () => environment.promise.then(() => order.push("environment")),
    readClaude: async () => { order.push("claude"); return { provider: "claude", status: "ok", windows: [], updatedAt }; },
    readCodex: async () => { order.push("codex"); return { provider: "codex", status: "ok", windows: [], updatedAt }; },
  });
  const pending = readUsage();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, []);
  environment.resolve();
  await pending;
  assert.deepEqual(order, ["environment", "claude", "codex"]);
});

test("turns a reader crash into an error for that provider only", async () => {
  const updatedAt = new Date(NOW).toISOString();
  const readUsage = createUsageReader({
    now: () => NOW,
    readClaude: () => {
      throw new Error(`boom ${TOKEN}`);
    },
    readCodex: async () => ({ provider: "codex", status: "ok", windows: [], updatedAt }),
  });
  const { providers } = await readUsage();
  assert.deepEqual(providers[0], { provider: "claude", status: "error", windows: [], updatedAt, message: "Couldn't read usage." });
  assert.equal(providers[1].status, "ok");
  assert.ok(!JSON.stringify(providers).includes(TOKEN));
});

test("reports unavailable for Codex accounts without ChatGPT plan limits", async () => {
  for (const type of ["apiKey", "amazonBedrock"]) {
    const child = fakeCodex({ account: { type }, rateLimits: WEEKLY_ONLY });
    const result = await readCodexUsage(codexDeps(child).deps);
    assert.deepEqual([result.status, result.message], ["unavailable", "Codex plan limits need a ChatGPT sign-in."]);
    assert.ok(!child.sent.includes("account/rateLimits/read"));
  }
});
