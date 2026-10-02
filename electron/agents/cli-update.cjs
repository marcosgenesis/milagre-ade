const { exec } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { inspectCli, parseVersion, isAtLeast, MIN_VERSIONS } = require("./cli.cjs");
const { installDirs, mergePath } = require("./environment.cjs");

function runCommand(cmd, execImpl = exec) {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: mergePath(process.env.PATH, installDirs()) };
    execImpl(cmd, { encoding: "utf8", timeout: 120_000, env }, (error, stdout, stderr) => {
      resolve({
        code: error?.code ?? (error ? 1 : 0),
        error: error ? error.message || String(stderr || "") : null,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
      });
    });
  });
}

/**
 * Links ~/.local/bin/claude to the newest installed version in ~/.local/share/claude/versions
 * that satisfies MIN_VERSIONS.claude.
 */
function linkNewestClaudeVersion(home = os.homedir()) {
  try {
    const versionsDir = path.join(home, ".local/share/claude/versions");
    if (!fs.existsSync(versionsDir)) return false;
    const entries = fs.readdirSync(versionsDir);
    const valid = entries
      .map((entry) => ({ entry, parsed: parseVersion(entry) }))
      .filter((item) => item.parsed !== null && isAtLeast(item.parsed, MIN_VERSIONS.claude))
      .sort((a, b) => {
        for (let i = 0; i < 3; i++) {
          if (b.parsed[i] !== a.parsed[i]) return b.parsed[i] - a.parsed[i];
        }
        return 0;
      });
    if (valid.length === 0) return false;
    const best = valid[0].entry;
    const targetBin = path.join(home, ".local/bin/claude");
    const targetVersionPath = path.join(versionsDir, best);
    if (fs.existsSync(targetBin) || fs.lstatSync(targetBin, { throwIfNoEntry: false })) {
      fs.unlinkSync(targetBin);
    }
    fs.mkdirSync(path.dirname(targetBin), { recursive: true });
    fs.symlinkSync(targetVersionPath, targetBin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Updates an agent CLI. For Claude:
 * 1. Checks if a compliant version already exists in ~/.local/share/claude/versions
 * 2. Tries `claude install --force latest`
 * 3. Falls back to `curl -fsSL https://claude.ai/install.sh | bash -s latest`
 * 4. Ensures the symlink points to the newest compliant version
 */
async function runCliUpdate(name, deps = {}) {
  const {
    inspect = inspectCli,
    execImpl = exec,
    linkVersion = linkNewestClaudeVersion,
  } = deps;

  if (name === "claude") {
    // 1. Check if a newer version is already on disk (e.g. downloaded by a previous install)
    linkVersion();
    let status = await inspect("claude");
    if (!status.problem) {
      return { ok: true, version: status.version };
    }

    // 2. Try claude install --force latest
    await runCommand("claude install --force latest", execImpl);
    linkVersion();
    status = await inspect("claude");
    if (!status.problem) {
      return { ok: true, version: status.version };
    }

    // 3. Fallback to install.sh latest
    const fallback = await runCommand("curl -fsSL https://claude.ai/install.sh | bash -s latest", execImpl);
    linkVersion();
    status = await inspect("claude");
    if (!status.problem) {
      return { ok: true, version: status.version };
    }

    // 4. Try standard claude update as last resort
    await runCommand("claude update", execImpl);
    linkVersion();
    status = await inspect("claude");
    if (!status.problem) {
      return { ok: true, version: status.version };
    }

    return {
      ok: false,
      version: status.version,
      error: status.problem || fallback.error || "Claude update did not meet the required version.",
    };
  }

  if (name === "codex") {
    const result = await runCommand("codex update", execImpl);
    const status = await inspect("codex");
    if (!status.problem) {
      return { ok: true, version: status.version };
    }
    return {
      ok: false,
      version: status.version,
      error: status.problem || result.error || "Codex update did not meet the required version.",
    };
  }

  return { ok: false, error: `Unknown provider: ${name}` };
}

module.exports = { runCliUpdate, linkNewestClaudeVersion };
