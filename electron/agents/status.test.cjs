const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const path = require("node:path");
const { CodexRpc } = require("./codex-rpc.cjs");
const { cliBrokenMessage, cliTooOldMessage, loginMessage, missingCliMessage } = require("./events.cjs");
const { READY_TTL_MS, claudeLoggedOut, cliWhenLoggedIn, codexLoggedOut, createCliStatus } = require("./status.cjs");

const FAKE = path.join(__dirname, "fixtures", "fake-app-server.cjs");
const fakeRpc = (scenario) => (options) => new CodexRpc({ ...options, args: [FAKE], env: { ...process.env, FAKE_SCENARIO: scenario } });

// Recorded from Claude Code 2.1.287: `claude auth status` exits 1 and prints this with an empty CLAUDE_CONFIG_DIR.
const LOGGED_OUT = JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty", analyticsDisabled: false, projectsDirectory: "/tmp/empty/projects", configDirectory: "/tmp/empty" }, null, 2);
const LOGGED_IN = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", configDirectory: "/Users/x/.claude" }, null, 2);

const claudeExec = (stdout, error = null, calls = []) => (file, args, options, callback) => {
  calls.push({ file, args, options });
  callback(error, stdout, "");
  return { stdin: { end() {} } };
};

test("Claude: loggedIn false, with the exit code 1 that goes with it, is logged out", async () => {
  const calls = [];
  assert.equal(await claudeLoggedOut("/c/claude", { execFileImpl: claudeExec(LOGGED_OUT, Object.assign(new Error("exit 1"), { code: 1 }), calls) }), true);
  assert.deepEqual(calls, [{ file: "/c/claude", args: ["auth", "status"], options: { encoding: "utf8", timeout: 10000 } }]);
  assert.equal(await claudeLoggedOut("/c/claude", { execFileImpl: claudeExec(LOGGED_IN) }), false);
});

test("Claude: a check that fails in any other way counts as ready", async () => {
  assert.equal(await claudeLoggedOut("/c/claude", { execFileImpl: claudeExec("", Object.assign(new Error("timed out"), { killed: true })) }), false);
  assert.equal(await claudeLoggedOut("/c/claude", { execFileImpl: claudeExec("Not logged in · Please run /login", Object.assign(new Error("exit 1"), { code: 1 })) }), false);
  assert.equal(await claudeLoggedOut("/c/claude", { execFileImpl: claudeExec("{ \"authMethod\": \"none\" }") }), false);
  assert.equal(await claudeLoggedOut("/c/claude", { execFileImpl: () => { throw new Error("spawn EACCES"); } }), false);
});

test("Codex: no account while OpenAI auth is required is logged out", async () => {
  assert.equal(await codexLoggedOut(process.execPath, { cwd: os.tmpdir(), createRpc: fakeRpc("logged-out") }), true);
  assert.equal(await codexLoggedOut(process.execPath, { cwd: os.tmpdir(), createRpc: fakeRpc("reply") }), false);
  assert.equal(await codexLoggedOut(process.execPath, { cwd: os.tmpdir(), createRpc: fakeRpc("custom-provider") }), false);
});

test("Codex: an account/read error, or an app-server that won't start, counts as ready", async () => {
  const failing = () => ({
    start() {},
    notify() {},
    close() {},
    request: async (method) => {
      if (method === "account/read") throw new Error("account/read is not supported");
      return {};
    },
  });
  assert.equal(await codexLoggedOut("/x/codex", { createRpc: failing }), false);
  assert.equal(await codexLoggedOut("/nonexistent/codex", { cwd: os.tmpdir() }), false);
});

// A stand-in for the CLI check: `statuses[name]` is the queue of answers, the last one repeating.
function fakeCli(statuses) {
  const asked = { claude: 0, codex: 0 };
  const cli = async (name) => {
    asked[name] += 1;
    const queue = statuses[name];
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  return { cli, asked };
}
const GOOD = (name) => ({ command: `/bin/${name}`, version: "9.9.9" });

function statusFor({ statuses, loggedOut, now }) {
  const { cli, asked } = fakeCli(statuses);
  const checked = { claude: 0, codex: 0 };
  const flags = { claude: false, codex: false, ...loggedOut };
  const check = createCliStatus({
    cli,
    cwd: "/tmp",
    clientVersion: "1.0.0",
    now,
    loggedOut: {
      claude: async () => { checked.claude += 1; return typeof flags.claude === "function" ? flags.claude() : flags.claude; },
      codex: async () => { checked.codex += 1; return typeof flags.codex === "function" ? flags.codex() : flags.codex; },
    },
  });
  return { check, asked, checked, flags };
}

test("each state, with the message a turn fails with", async () => {
  const missing = { command: null, version: null, problem: missingCliMessage("codex") };
  const outdated = { command: "/bin/claude", version: "2.1.200", problem: cliTooOldMessage("claude", "2.1.200", "2.1.286") };
  assert.deepEqual(await statusFor({ statuses: { claude: [GOOD("claude")], codex: [missing] } }).check(), {
    claude: { state: "ready" },
    codex: { state: "missing", message: missingCliMessage("codex") },
  });
  assert.deepEqual(await statusFor({ statuses: { claude: [outdated], codex: [GOOD("codex")] } }).check(), {
    claude: { state: "outdated", message: cliTooOldMessage("claude", "2.1.200", "2.1.286") },
    codex: { state: "ready" },
  });
  const broken = { command: "/bin/codex", version: null, problem: cliBrokenMessage("codex", "/bin/codex", "env: node: No such file or directory") };
  assert.deepEqual((await statusFor({ statuses: { claude: [GOOD("claude")], codex: [broken] } }).check()).codex, { state: "broken", message: cliBrokenMessage("codex", "/bin/codex", "env: node: No such file or directory") });
  assert.deepEqual(await statusFor({ statuses: { claude: [GOOD("claude")], codex: [GOOD("codex")] }, loggedOut: { claude: true, codex: true } }).check(), {
    claude: { state: "logged-out", message: loginMessage("claude") },
    codex: { state: "logged-out", message: loginMessage("codex") },
  });
});

test("the login check is not run for a CLI that doesn't run", async () => {
  const { check, checked } = statusFor({ statuses: { claude: [{ command: null, version: null, problem: "missing" }], codex: [{ command: "/x", version: null, problem: "broken" }] }, loggedOut: { claude: true, codex: true } });
  await check();
  assert.deepEqual(checked, { claude: 0, codex: 0 });
});

test("a ready status is kept for 5 minutes", async () => {
  let clock = 1_000_000;
  const { check, checked } = statusFor({ statuses: { claude: [GOOD("claude")], codex: [GOOD("codex")] }, now: () => clock });
  await check();
  clock += READY_TTL_MS - 1;
  await check();
  assert.deepEqual(checked, { claude: 1, codex: 1 });
  clock += 2;
  await check();
  assert.deepEqual(checked, { claude: 2, codex: 2 });
  assert.equal(READY_TTL_MS, 300_000);
});

test("a problem is looked at again on every call, and fixing it shows at once", async () => {
  const clock = 5;
  const { check, asked, flags } = statusFor({ statuses: { claude: [GOOD("claude")], codex: [{ command: null, version: null, problem: "missing" }, GOOD("codex")] }, loggedOut: { claude: true }, now: () => clock });
  assert.equal((await check()).claude.state, "logged-out");
  assert.equal((await check()).claude.state, "logged-out");
  assert.deepEqual((await check()).codex, { state: "ready" });
  flags.claude = false;
  assert.deepEqual((await check()).claude, { state: "ready" });
  assert.equal(asked.claude, 4);
  // Codex was missing once, then ready, and a ready status is kept.
  assert.equal(asked.codex, 2);
});

test("a login check that blows up counts as ready, and so does a CLI check that throws", async () => {
  const boom = statusFor({ statuses: { claude: [GOOD("claude")], codex: [GOOD("codex")] }, loggedOut: { claude: () => { throw new Error("boom"); } } });
  assert.deepEqual(await boom.check(), { claude: { state: "ready" }, codex: { state: "ready" } });
  const check = createCliStatus({ cli: async () => { throw new Error("cli check failed"); }, loggedOut: { claude: async () => true, codex: async () => true } });
  assert.deepEqual(await check(), { claude: { state: "ready" }, codex: { state: "ready" } });
});

test("concurrent callers share one lookup", async () => {
  const { check, asked } = statusFor({ statuses: { claude: [GOOD("claude")], codex: [GOOD("codex")] } });
  await Promise.all([check(), check(), check()]);
  assert.deepEqual(asked, { claude: 1, codex: 1 });
});

test("a logged-out Claude is a CLI with a problem for the model lookup, so its degraded list isn't kept", async () => {
  const cli = async (name) => ({ command: `/bin/${name}`, version: "9.9.9" });
  let state = "logged-out";
  const status = async () => ({ claude: { state, ...(state === "logged-out" ? { message: loginMessage("claude") } : {}) }, codex: { state: "logged-out", message: loginMessage("codex") } });
  const wrapped = cliWhenLoggedIn(cli, status);
  assert.deepEqual(await wrapped("claude"), { command: "/bin/claude", version: "9.9.9", problem: loginMessage("claude") });
  // Codex lists its models whether or not it is logged in.
  assert.deepEqual(await wrapped("codex"), { command: "/bin/codex", version: "9.9.9" });
  state = "ready";
  assert.deepEqual(await wrapped("claude"), { command: "/bin/claude", version: "9.9.9" });
  const broken = cliWhenLoggedIn(async () => ({ command: null, version: null, problem: "missing" }), async () => assert.fail("not asked for a CLI that's missing"));
  assert.equal((await broken("claude")).problem, "missing");
  const failing = cliWhenLoggedIn(cli, async () => { throw new Error("boom"); });
  assert.deepEqual(await failing("claude"), { command: "/bin/claude", version: "9.9.9" });
});
