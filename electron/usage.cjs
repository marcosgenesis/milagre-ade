const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const PROVIDER_TIMEOUT_MS = 10_000;
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_EXPIRED = "Claude sign-in expired. Running any Claude agent refreshes it.";
const SESSION = { id: "session", label: "Session", shortLabel: "5h" };
const WEEKLY = { id: "weekly", label: "Weekly", shortLabel: "wk" };
const CLAUDE_RANK = { session: 0, weekly: 1 };

function providerResult(provider, now, status, windows = [], message) {
  return { provider, status, windows, updatedAt: new Date(now()).toISOString(), ...(message ? { message } : {}) };
}

function percentOrNull(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

// Never surface JSON.parse errors: V8 quotes the input, which here is a credential.
function parseOauth(raw) {
  try {
    const oauth = JSON.parse(raw)?.claudeAiOauth;
    return typeof oauth?.accessToken === "string" && oauth.accessToken ? oauth : null;
  } catch {
    return null;
  }
}

function readKeychain(execFileImpl, timeoutMs) {
  return new Promise((resolve) => {
    execFileImpl(
      "/usr/bin/security",
      ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf8", timeout: timeoutMs },
      (error, stdout) => resolve(error ? null : parseOauth(stdout)),
    );
  });
}

async function readClaudeCredentials({ platform, execFileImpl, readFile, home, timeoutMs }) {
  if (platform === "darwin") {
    const oauth = await readKeychain(execFileImpl, timeoutMs);
    if (oauth) return oauth;
  }
  try {
    return parseOauth(await readFile(path.join(home, ".claude", ".credentials.json"), "utf8"));
  } catch {
    return null;
  }
}

function claudeWindow(meta, percent, resetsAt) {
  const usedPercent = percentOrNull(percent);
  if (usedPercent === null) return null;
  return { ...meta, usedPercent, resetsAt: typeof resetsAt === "string" ? resetsAt : null };
}

function claudeWindows(body) {
  if (!Array.isArray(body?.limits)) {
    return [
      claudeWindow(SESSION, body?.five_hour?.utilization, body?.five_hour?.resets_at),
      claudeWindow(WEEKLY, body?.seven_day?.utilization, body?.seven_day?.resets_at),
    ].filter(Boolean);
  }
  return body.limits
    .map((limit) => {
      if (limit?.kind === "session") return claudeWindow(SESSION, limit.percent, limit.resets_at);
      if (limit?.kind === "weekly_all") return claudeWindow(WEEKLY, limit.percent, limit.resets_at);
      const model = limit?.kind === "weekly_scoped" ? limit.scope?.model?.display_name : null;
      if (typeof model !== "string" || !model) return null;
      return claudeWindow({ id: `weekly:${model.toLowerCase()}`, label: model, shortLabel: "wk" }, limit.percent, limit.resets_at);
    })
    .filter(Boolean)
    .sort((a, b) => (CLAUDE_RANK[a.id] ?? 2) - (CLAUDE_RANK[b.id] ?? 2));
}

async function readClaudeUsage(deps = {}) {
  const {
    platform = process.platform,
    execFileImpl = execFile,
    readFile = fs.readFile,
    home = os.homedir(),
    fetchImpl = globalThis.fetch,
    now = Date.now,
    timeoutMs = PROVIDER_TIMEOUT_MS,
  } = deps;
  const done = (status, windows, message) => providerResult("claude", now, status, windows, message);

  const oauth = await readClaudeCredentials({ platform, execFileImpl, readFile, home, timeoutMs });
  if (!oauth) return done("unavailable", [], "Not signed in to Claude Code.");
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt <= now()) return done("error", [], CLAUDE_EXPIRED);

  let response;
  try {
    response = await fetchImpl(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return done("error", [], error?.name === "TimeoutError" ? "Claude usage timed out." : "Couldn't reach Claude.");
  }
  if (response.status === 401) return done("error", [], CLAUDE_EXPIRED);
  if (response.status === 429) return done("error", [], "Claude is rate limiting usage checks. Try again in a minute.");
  if (!response.ok) return done("error", [], `Claude usage failed (HTTP ${response.status}).`);

  let body;
  try {
    body = await response.json();
  } catch {
    return done("error", [], "Claude returned an unreadable usage response.");
  }
  const windows = claudeWindows(body);
  return windows.length ? done("ok", windows) : done("error", [], "Claude returned no usage windows.");
}

module.exports = { readClaudeUsage };
