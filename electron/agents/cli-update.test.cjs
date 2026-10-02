const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { runCliUpdate, linkNewestClaudeVersion } = require("./cli-update.cjs");

test("runCliUpdate: claude returns immediately if linkVersion finds compliant version", async () => {
  const executed = [];
  const execImpl = (cmd, opts, callback) => {
    executed.push(cmd);
    callback(null, "", "");
  };
  const inspect = async () => ({ command: "/bin/claude", version: "2.1.287" });
  const linkVersion = () => true;

  const result = await runCliUpdate("claude", { execImpl, inspect, linkVersion });
  assert.equal(result.ok, true);
  assert.equal(result.version, "2.1.287");
  assert.deepEqual(executed, []);
});

test("runCliUpdate: claude install --force latest succeeds", async () => {
  const executed = [];
  let inspections = 0;
  const execImpl = (cmd, opts, callback) => {
    executed.push(cmd);
    callback(null, "Done", "");
  };
  const inspect = async () => {
    inspections += 1;
    if (inspections === 1) {
      return { command: "/bin/claude", version: "2.1.285", problem: "Milagre needs Claude Code 2.1.286 or later" };
    }
    return { command: "/bin/claude", version: "2.1.287" };
  };
  const linkVersion = () => {};

  const result = await runCliUpdate("claude", { execImpl, inspect, linkVersion });
  assert.equal(result.ok, true);
  assert.equal(result.version, "2.1.287");
  assert.deepEqual(executed, ["claude install --force latest"]);
});

test("runCliUpdate: claude falls back to install.sh latest", async () => {
  const executed = [];
  let inspections = 0;
  const execImpl = (cmd, opts, callback) => {
    executed.push(cmd);
    callback(null, "Done", "");
  };
  const inspect = async () => {
    inspections += 1;
    if (inspections <= 2) {
      return { command: "/bin/claude", version: "2.1.285", problem: "Milagre needs Claude Code 2.1.286 or later" };
    }
    return { command: "/bin/claude", version: "2.1.287" };
  };
  const linkVersion = () => {};

  const result = await runCliUpdate("claude", { execImpl, inspect, linkVersion });
  assert.equal(result.ok, true);
  assert.equal(result.version, "2.1.287");
  assert.deepEqual(executed, [
    "claude install --force latest",
    "curl -fsSL https://claude.ai/install.sh | bash -s latest",
  ]);
});

test("runCliUpdate: codex update succeeds", async () => {
  const executed = [];
  const execImpl = (cmd, opts, callback) => {
    executed.push(cmd);
    callback(null, "Updated codex", "");
  };
  const inspect = async () => ({ command: "/bin/codex", version: "0.158.0" });

  const result = await runCliUpdate("codex", { execImpl, inspect });
  assert.equal(result.ok, true);
  assert.equal(result.version, "0.158.0");
  assert.deepEqual(executed, ["codex update"]);
});

test("runCliUpdate: returns error when CLI remains broken or outdated", async () => {
  const execImpl = (cmd, opts, callback) => callback(new Error("fail"), "", "failed");
  const inspect = async () => ({ command: "/bin/codex", version: "0.150.0", problem: "Still too old" });

  const result = await runCliUpdate("codex", { execImpl, inspect });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Still too old");
});

test("linkNewestClaudeVersion: symlinks highest compliant version", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "claude-link-test-"));
  const versionsDir = path.join(tempHome, ".local/share/claude/versions");
  fs.mkdirSync(versionsDir, { recursive: true });
  fs.writeFileSync(path.join(versionsDir, "2.1.285"), "bin285");
  fs.writeFileSync(path.join(versionsDir, "2.1.287"), "bin287");
  fs.writeFileSync(path.join(versionsDir, "2.1.284"), "bin284");

  const success = linkNewestClaudeVersion(tempHome);
  assert.equal(success, true);
  const targetBin = path.join(tempHome, ".local/bin/claude");
  assert.equal(fs.readlinkSync(targetBin), path.join(versionsDir, "2.1.287"));

  fs.rmSync(tempHome, { recursive: true, force: true });
});
