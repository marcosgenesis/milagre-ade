const { execFile } = require("node:child_process");
const { resolveExecutable } = require("./environment.cjs");
const { cliBrokenMessage, cliTooOldMessage, lastLine, missingCliMessage } = require("./events.cjs");

// Finds each agent's CLI and checks it against the oldest version Milagre supports:
//   claude  2.1.286, the Claude Code release @anthropic-ai/claude-agent-sdk 0.3.286 is built against
//           (its package.json `claudeCodeVersion`); 2.0.77 rejects the SDK's --effort flag outright.
//   codex   0.158.0, the release Milagre's use of the app-server protocol was verified against.
// `--version` prints "2.1.287 (Claude Code)" and "codex-cli 0.158.0".
const MIN_VERSIONS = { claude: "2.1.286", codex: "0.158.0" };
const VERSION_TIMEOUT_MS = 10_000;

// [major, minor, patch] from the first x.y.z in the text, or null.
function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ""));
  return match ? match.slice(1).map(Number) : null;
}

function isAtLeast(version, minimum) {
  const wanted = parseVersion(minimum);
  for (let index = 0; index < 3; index += 1) if (version[index] !== wanted[index]) return version[index] > wanted[index];
  return true;
}

// `<command> --version`: { output }, or { error } with the last line it printed when it didn't run.
function runVersion(command, { execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    execFileImpl(command, ["--version"], { encoding: "utf8", timeout: VERSION_TIMEOUT_MS }, (error, stdout, stderr) => {
      resolve(error ? { error: lastLine(stderr) || lastLine(error.message) } : { output: String(stdout) });
    });
  });
}

// { command, version } for a CLI Milagre can run, plus `problem`, the message a turn fails with, when it is
// missing, too old or doesn't start. A version Milagre can't read is no reason to refuse the CLI.
async function inspectCli(name, { resolve = resolveExecutable, version = runVersion } = {}) {
  const command = await resolve(name);
  if (!command) return { command: null, version: null, problem: missingCliMessage(name) };
  const result = await version(command);
  if (result.error !== undefined) return { command, version: null, problem: cliBrokenMessage(name, command, result.error) };
  const parsed = parseVersion(result.output);
  if (!parsed) return { command, version: null };
  const text = parsed.join(".");
  return isAtLeast(parsed, MIN_VERSIONS[name]) ? { command, version: text } : { command, version: text, problem: cliTooOldMessage(name, text, MIN_VERSIONS[name]) };
}

// Each CLI is inspected once per app run, after `ready` (the login environment). One with a problem is
// inspected again on the next call, so installing, updating or fixing it needs no restart. Before that
// second look `refresh` runs (it adds install folders created since startup to PATH), because the fix may
// well be an installer that made a new folder.
function createCliCache({ ready = () => undefined, inspect = inspectCli, refresh = () => undefined } = {}) {
  const cache = new Map();
  const hadProblem = new Set();
  const check = (name) => {
    if (!cache.has(name)) {
      const pending = Promise.resolve().then(ready).catch(() => {}).then(() => (hadProblem.has(name) ? refresh() : undefined)).catch(() => {}).then(() => inspect(name)).then((status) => {
        if (status.problem) {
          cache.delete(name);
          hadProblem.add(name);
        } else hadProblem.delete(name);
        return status;
      }, (error) => {
        cache.delete(name);
        throw error;
      });
      cache.set(name, pending);
    }
    return cache.get(name);
  };
  check.invalidate = (name) => {
    cache.delete(name);
    hadProblem.add(name);
  };
  return check;
}

module.exports = { MIN_VERSIONS, createCliCache, inspectCli, isAtLeast, parseVersion, runVersion };
