const { execFile } = require("node:child_process");

// Absolute path of a CLI on the app's PATH, or null when it isn't installed. Importing the
// login shell's PATH for apps opened from Finder is part of a later step.
function resolveExecutable(name, { execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    execFileImpl("/usr/bin/which", [name], { encoding: "utf8", timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : String(stdout).trim().split("\n")[0] || null);
    });
  });
}

module.exports = { resolveExecutable };
