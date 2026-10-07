// Fixed editor invocations avoid executing Windows batch files through a shell.
const fs = require("node:fs");
const path = require("node:path");
function editorInvocation(file, args, { platform = process.platform } = {}) {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(file)) return null;
  const names = { "code.cmd": "Code.exe", "cursor.cmd": "Cursor.exe", "windsurf.cmd": "Windsurf.exe", "codium.cmd": "VSCodium.exe" };
  const executable = names[path.basename(file).toLowerCase()];
  if (!executable || path.basename(path.dirname(file)).toLowerCase() !== "bin") return null;
  const root = path.dirname(path.dirname(file));
  const binary = path.join(root, executable),
    cli = path.join(root, "resources", "app", "out", "cli.js");
  for (const target of [binary, cli]) if (!fs.statSync(target).isFile()) throw new Error("The installed editor CLI is incomplete");
  return { file: binary, args: [cli, ...args], env: { ELECTRON_RUN_AS_NODE: "1", VSCODE_DEV: "" } };
}
module.exports = { editorInvocation };
