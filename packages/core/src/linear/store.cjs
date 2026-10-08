const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { preparePrivateDirectory } = require("../private-files.cjs");

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// The Mac's Linear sign-in and the Experimental switch, owner-only like the provider accounts (accounts.cjs).
function createLinearStore({ dataDir }) {
  const root = path.join(dataDir, "linear");
  const tokenFile = path.join(root, "token.json");
  const settingsFile = path.join(root, "settings.json");
  function write(file, value) {
    preparePrivateDirectory(root);
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  return {
    readToken() {
      const token = read(tokenFile);
      const valid = token && typeof token.accessToken === "string" && typeof token.refreshToken === "string" && Number.isFinite(token.expiresAt);
      return valid ? token : null;
    },
    saveToken: (token) => write(tokenFile, token),
    clearToken: () => fs.rmSync(tokenFile, { force: true }),
    readEnabled: () => read(settingsFile)?.enabled === true,
    saveEnabled(value) {
      write(settingsFile, { enabled: value === true });
      return value === true;
    },
  };
}

module.exports = { createLinearStore };
