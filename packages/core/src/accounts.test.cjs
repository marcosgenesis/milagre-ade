const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createAccounts } = require("./accounts.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-accounts-"));
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const children = [],
    seen = [],
    changed = [];
  const env = { HOME: home, ANTHROPIC_API_KEY: "secret-claude", OPENAI_API_KEY: "secret-codex" };
  const options = {
    dataDir: path.join(root, "profile"),
    home,
    env,
    cli: async (p) => ({ command: `/cli/${p}` }),
    changed: (p) => changed.push(p),
    inspect: async (p, opts) => {
      seen.push({ p, ...opts });
      return { state: "ready", email: `${p}@example.test`, plan: "pro" };
    },
    spawn: (command, args, opts) => {
      const child = new EventEmitter();
      children.push({ child, command, args, opts });
      return child;
    },
  };
  const accounts = createAccounts(options);
  t.after(() => {
    accounts.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { accounts, root, home, children, seen, changed, options, env };
}
const group = (snapshot, provider) => snapshot.providers.find((p) => p.provider === provider);
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("new profiles isolate credentials, preserve connected CLI auth and resume history", async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.home, ".codex"));
  fs.writeFileSync(path.join(f.home, ".codex", "auth.json"), "terminal-credential");
  fs.writeFileSync(path.join(f.home, ".codex", "config.toml"), 'cli_auth_credentials_store = "keyring"\nmodel = "test"\n[features]\nexample = true\n');
  await f.accounts.list();
  const added = group(await f.accounts.add("codex", "Work"), "codex").accounts[1];
  assert.equal(added.state, "signing-in");
  const env = f.children[0].opts.env;
  assert.equal(env.OPENAI_API_KEY, "");
  assert.equal(f.env.OPENAI_API_KEY, "secret-codex");
  assert.notEqual(env.CODEX_HOME, path.join(f.home, ".codex"));
  assert.equal(fs.existsSync(path.join(env.CODEX_HOME, "auth.json")), false);
  assert.equal(fs.readFileSync(path.join(f.home, ".codex", "auth.json"), "utf8"), "terminal-credential");
  assert.equal(fs.realpathSync(path.join(env.CODEX_HOME, "sessions")), fs.realpathSync(path.join(f.home, ".codex", "sessions")));
  const config = fs.readFileSync(path.join(env.CODEX_HOME, "config.toml"), "utf8");
  assert.match(config, /cli_auth_credentials_store = "file"/);
  assert.doesNotMatch(config, /"keyring"/);
  assert.match(config, /\[features\]\nexample = true/);
  assert.throws(() => f.accounts.select("codex", added.id), /Finish signing/);
  f.children[0].child.emit("close", 0);
  await tick();
  f.accounts.select("codex", added.id);
  assert.equal(f.accounts.environment("codex").CODEX_HOME, env.CODEX_HOME);
  assert.equal(createAccounts(f.options).selected("codex"), added.id);
  assert.equal(fs.statSync(path.join(f.root, "profile/accounts/accounts.json")).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(await f.accounts.list()), /secret|accessToken|refreshToken|CODEX_HOME/);
});

test("Claude uses its own config directory; cancelling and retrying never selects an unfinished account", async (t) => {
  const f = fixture(t);
  await f.accounts.list();
  const added = group(await f.accounts.add("claude", "Personal"), "claude").accounts[1];
  const env = f.children[0].opts.env;
  assert.equal(env.ANTHROPIC_API_KEY, "");
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "");
  assert.ok(env.CLAUDE_CONFIG_DIR);
  assert.deepEqual(f.children[0].args, ["auth", "login", "--claudeai"]);
  assert.equal(f.accounts.selected("claude"), "default");
  f.accounts.cancel("claude", added.id);
  f.children[0].child.emit("close", 0);
  await tick();
  assert.equal(group(await f.accounts.list(), "claude").accounts[1].state, "signed-out");
  await f.accounts.login("claude", added.id);
  f.children[1].child.emit("close", 0);
  await tick();
  f.accounts.select("claude", added.id);
  const snapshot = f.accounts.remove("claude", added.id);
  assert.equal(group(snapshot, "claude").accounts.length, 1);
  assert.equal(group(snapshot, "claude").selectedId, "default");
  assert.equal(f.changed.at(-1), "claude");
  assert.equal(createAccounts(f.options).selected("claude"), "default");
  assert.ok(fs.existsSync(env.CLAUDE_CONFIG_DIR), "A running reply can still use its private profile");
});

test("invalid input never becomes a path or a shell command", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.accounts.add("../codex", "Work"), /Unknown/);
  await assert.rejects(f.accounts.add("codex", ""), /account name/);
  assert.throws(() => f.accounts.select("codex", "../../auth.json"), /not found/);
  await assert.rejects(f.accounts.login("codex", "default"), /Add account/);
  assert.equal(f.children.length, 0);
});

test("a failed sign-in is visible and does not change the selected account", async (t) => {
  const f = fixture(t);
  const added = group(await f.accounts.add("codex", "Work"), "codex").accounts[1];
  f.children[0].child.emit("error", new Error("sensitive stderr must not be returned"));
  await tick();
  const snapshot = await f.accounts.list();
  assert.equal(group(snapshot, "codex").accounts[1].state, "signed-out");
  assert.equal(f.accounts.selected("codex"), "default");
  assert.doesNotMatch(JSON.stringify(snapshot), /sensitive/);
  assert.throws(() => f.accounts.select("codex", added.id), /Sign in/);
});

test("cancelling during the identity check ignores its late result", async (t) => {
  const f = fixture(t);
  let resolveIdentity;
  const accounts = createAccounts({
    ...f.options,
    inspect: () =>
      new Promise((resolve) => {
        resolveIdentity = resolve;
      }),
  });
  t.after(() => accounts.close());
  const added = group(await accounts.add("claude", "Work"), "claude").accounts[1];
  f.children[0].child.emit("close", 0);
  await tick();
  accounts.cancel("claude", added.id);
  resolveIdentity({ state: "ready" });
  await tick();
  assert.equal(group(await accounts.list(), "claude").accounts[1].state, "signed-out");
  assert.deepEqual(f.changed, []);
});
