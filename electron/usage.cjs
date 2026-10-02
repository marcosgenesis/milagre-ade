const { execFile, spawn } = require("node:child_process");
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

const APP_SERVER_CLIENT = { name: "milagre", title: "Milagre", version: "0.1.0" };

function codexWindowMeta(minutes) {
  if (minutes === 300) return SESSION;
  if (minutes === 10080) return WEEKLY;
  const short = minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  return { id: `window:${minutes}`, label: `${short} window`, shortLabel: short };
}

function codexWindows(rateLimits) {
  return [rateLimits?.primary, rateLimits?.secondary]
    .filter((item) => percentOrNull(item?.usedPercent) !== null && Number.isInteger(item.windowDurationMins) && item.windowDurationMins > 0)
    .sort((a, b) => a.windowDurationMins - b.windowDurationMins)
    .map((item) => ({
      ...codexWindowMeta(item.windowDurationMins),
      usedPercent: percentOrNull(item.usedPercent),
      resetsAt: typeof item.resetsAt === "number" ? new Date(item.resetsAt * 1000).toISOString() : null,
    }));
}

function readCodexUsage(deps = {}) {
  const { spawnImpl = spawn, now = Date.now, timeoutMs = PROVIDER_TIMEOUT_MS } = deps;
  const done = (status, windows, message) => providerResult("codex", now, status, windows, message);

  return new Promise((resolve) => {
    const child = spawnImpl("codex", ["app-server"], { stdio: ["pipe", "pipe", "ignore"], env: process.env, windowsHide: true });
    let settled = false;
    let buffer = "";
    const timer = setTimeout(() => finish(done("error", [], "Codex usage timed out.")), timeoutMs);

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve(value);
    }

    function send(message) {
      if (!settled) child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function handle(message) {
      if (message.error && [1, 2, 3].includes(message.id)) return finish(done("error", [], "Codex couldn't read usage."));
      if (message.id === 1) {
        send({ method: "initialized" });
        send({ id: 2, method: "account/read", params: {} });
      } else if (message.id === 2) {
        const account = message.result?.account;
        if (!account) return finish(done("unavailable", [], "Not signed in to Codex."));
        // Plan windows only exist for ChatGPT sign-ins; API-key and Bedrock accounts have none to show.
        if (account.type !== "chatgpt") return finish(done("unavailable", [], "Codex plan limits need a ChatGPT sign-in."));
        send({ id: 3, method: "account/rateLimits/read" });
      } else if (message.id === 3) {
        const windows = codexWindows(message.result?.rateLimits);
        finish(windows.length ? done("ok", windows) : done("error", [], "Codex returned no usage windows."));
      }
    }

    child.on("error", (error) => finish(error?.code === "ENOENT"
      ? done("unavailable", [], "Codex CLI not found.")
      : done("error", [], "Couldn't start Codex.")));
    child.on("close", () => finish(done("error", [], "Codex exited before reporting usage.")));
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        handle(message);
      }
    });

    send({ id: 1, method: "initialize", params: { clientInfo: APP_SERVER_CLIENT } });
  });
}

function createUsageReader(deps = {}) {
  // `ready` resolves once the login environment is applied: opened from Finder the app's PATH is bare until then,
  // and the Codex lookup starts `codex` from it.
  const { readClaude = readClaudeUsage, readCodex = readCodexUsage, now = Date.now, ready = () => undefined } = deps;
  const safely = (provider, read) => Promise.resolve()
    .then(() => read())
    .catch(() => providerResult(provider, now, "error", [], "Couldn't read usage."));
  let inFlight = null;
  return function readUsage() {
    inFlight ??= Promise.resolve().then(ready).catch(() => {})
      .then(() => Promise.all([safely("claude", readClaude), safely("codex", readCodex)]))
      .then((providers) => ({ providers }))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

module.exports = { createUsageReader, readClaudeUsage, readCodexUsage };
