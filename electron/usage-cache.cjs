const fs = require("node:fs");
const path = require("node:path");

const PROVIDERS = ["claude", "codex"];

const emptyState = () => Object.fromEntries(PROVIDERS.map((provider) => [provider, { last: null, blocked: null }]));

// Only plain numbers and labels are kept, so nothing from the credentials can end up on disk.
function cleanWindow(item) {
  if (!item || typeof item !== "object") return null;
  const { id, label, shortLabel, usedPercent, resetsAt } = item;
  if (typeof id !== "string" || typeof label !== "string" || typeof shortLabel !== "string") return null;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return null;
  return { id, label, shortLabel, usedPercent, resetsAt: typeof resetsAt === "string" ? resetsAt : null };
}

function cleanLast(last) {
  if (!last || !Array.isArray(last.windows) || typeof last.updatedAt !== "string") return null;
  if (Number.isNaN(Date.parse(last.updatedAt))) return null;
  const windows = last.windows.map(cleanWindow);
  if (windows.length === 0 || windows.includes(null)) return null;
  return { windows, updatedAt: last.updatedAt };
}

function cleanBlocked(blocked) {
  if (!blocked || typeof blocked.until !== "number" || !Number.isFinite(blocked.until)) return null;
  return { until: blocked.until, message: typeof blocked.message === "string" ? blocked.message : "Claude is rate limiting usage checks." };
}

function load(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Object.fromEntries(PROVIDERS.map((provider) => [
      provider,
      { last: cleanLast(parsed?.[provider]?.last), blocked: cleanBlocked(parsed?.[provider]?.blocked) },
    ]));
  } catch {
    return emptyState();
  }
}

// Last good plan usage and rate-limit blocks per provider. Without a file it only lives in memory.
function createUsageStore({ file } = {}) {
  const state = file ? load(file) : emptyState();
  let writing = Promise.resolve();

  function persist() {
    if (!file) return;
    const body = JSON.stringify(state);
    writing = writing
      .then(async () => {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const temp = `${file}.tmp`;
        await fs.promises.writeFile(temp, body);
        await fs.promises.rename(temp, file);
      })
      .catch(() => {});
  }

  return {
    get(provider) {
      return state[provider] ?? { last: null, blocked: null };
    },
    setLast(provider, last) {
      const clean = cleanLast(last);
      if (!clean || !state[provider]) return;
      state[provider].last = clean;
      persist();
    },
    setBlocked(provider, blocked) {
      const entry = state[provider];
      if (!entry || (!entry.blocked && !blocked)) return;
      entry.blocked = cleanBlocked(blocked);
      persist();
    },
    idle: () => writing,
  };
}

module.exports = { createUsageStore };
