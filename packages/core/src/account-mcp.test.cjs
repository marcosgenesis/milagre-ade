const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inheritClaudeMcp, inheritCodexMcp } = require("./account-mcp.cjs");

function folder(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-account-mcp-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("Claude: the connected account's user and project servers reach the Account; its own servers stay", (t) => {
  const root = folder(t);
  const source = path.join(root, "source.json");
  const target = path.join(root, "target.json");
  fs.writeFileSync(
    source,
    JSON.stringify({
      mcpServers: { pencil: { command: "/Applications/Pen.app/mcp" }, shared: { command: "new" } },
      projects: { "/repo": { mcpServers: { local: { command: "local" } } }, "/other": { mcpServers: {} } },
      oauthAccount: { emailAddress: "terminal@example.test" },
    }),
  );
  fs.writeFileSync(
    target,
    JSON.stringify({ oauthAccount: { emailAddress: "work@example.test" }, mcpServers: { mine: { command: "mine" }, shared: { command: "old" } } }),
  );
  inheritClaudeMcp(source, target);
  const merged = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.deepEqual(Object.keys(merged.mcpServers).toSorted(), ["mine", "pencil", "shared"]);
  assert.equal(merged.mcpServers.shared.command, "new");
  assert.deepEqual(merged.projects, { "/repo": { mcpServers: { local: { command: "local" } } } });
  assert.equal(merged.oauthAccount.emailAddress, "work@example.test", "only servers are inherited, never the sign-in");
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  const mtime = fs.statSync(target).mtimeMs;
  inheritClaudeMcp(source, target);
  assert.equal(fs.statSync(target).mtimeMs, mtime, "nothing new leaves the file untouched");
});

test("Claude: an Account that hasn't signed in yet, or a missing source, is left alone", (t) => {
  const root = folder(t);
  const source = path.join(root, "source.json");
  const target = path.join(root, "target.json");
  inheritClaudeMcp(source, target);
  fs.writeFileSync(source, JSON.stringify({ mcpServers: { pencil: { command: "x" } } }));
  inheritClaudeMcp(source, target);
  assert.equal(fs.existsSync(target), false);
});

test("Codex: server tables are replaced or added, everything else in the Account's config stays", (t) => {
  const root = folder(t);
  const source = path.join(root, "source.toml");
  const target = path.join(root, "target.toml");
  fs.writeFileSync(
    source,
    [
      'model = "gpt-terminal"',
      "",
      "[mcp_servers.linear]",
      'url = "https://mcp.linear.app/mcp"',
      "",
      "[mcp_servers.pencil]",
      'command = "/Applications/Pen.app/mcp"',
      "",
      "[mcp_servers.pencil.env]",
      'A = "1"',
      "",
      "[features]",
      "x = true",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    target,
    [
      'sqlite_home = "/home/.codex"',
      'cli_auth_credentials_store = "file"',
      'model = "gpt-work"',
      "",
      "[mcp_servers.linear]",
      'url = "https://old.example/mcp"',
      "",
      '[mcp_servers."mine"]',
      'command = "mine"',
      "",
    ].join("\n"),
  );
  inheritCodexMcp(source, target);
  const merged = fs.readFileSync(target, "utf8");
  assert.match(merged, /^sqlite_home = "\/home\/\.codex"\ncli_auth_credentials_store = "file"\nmodel = "gpt-work"\n/);
  assert.doesNotMatch(merged, /old\.example|gpt-terminal|\[features\]/);
  assert.match(merged, /\[mcp_servers\."mine"\]\ncommand = "mine"/);
  assert.match(merged, /\[mcp_servers\.linear\]\nurl = "https:\/\/mcp\.linear\.app\/mcp"/);
  assert.match(merged, /\[mcp_servers\.pencil\]\ncommand = "\/Applications\/Pen\.app\/mcp"\n\n\[mcp_servers\.pencil\.env\]\nA = "1"/);
  assert.equal(merged.match(/\[mcp_servers\.linear\]/g).length, 1);
  inheritCodexMcp(source, target);
  assert.equal(fs.readFileSync(target, "utf8"), merged, "a second session start changes nothing");
});
