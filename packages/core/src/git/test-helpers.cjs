const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);

async function configuredHelper(root, kind, file) {
  const helper = path.join(root, ".git", "analysis-helper");
  const marker = `${helper}.marker`;
  await fs.writeFile(helper, '#!/bin/sh\nprintf invoked >> "$0.marker"\nprintf converted\n', { mode: 0o755 });
  const git = (args) => execFile("git", ["-C", root, ...args]);
  if (["textconv", "clean", "process"].includes(kind)) {
    await fs.writeFile(path.join(root, ".gitattributes"), `${file} ${kind === "textconv" ? "diff" : "filter"}=analysis\n`);
    await git(["config", kind === "textconv" ? "diff.analysis.textconv" : `filter.analysis.${kind}`, helper]);
    if (kind !== "textconv") await git(["config", "filter.analysis.required", "true"]);
  } else await git(["config", kind === "external diff" ? "diff.external" : "core.fsmonitor", helper]);
  return { helper, marker };
}
module.exports = { configuredHelper };
