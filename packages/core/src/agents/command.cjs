const { spawnWindowsJob } = require("./windows-job.cjs");
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

// npm's Windows launchers are batch files. Resolve their JS entry and call Node
// directly so prompts, file names and arguments never pass through cmd.exe.
function commandInvocation(file, args, { platform = process.platform } = {}) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args };
  const script = fs.readFileSync(file, 'utf8');
  const match = /"(?:%dp0%|%~dp0)[\\/]([^"\r\n]+\.(?:[cm]?js))"/i.exec(script);
  if (!match) throw new Error(`Unsupported Windows command wrapper: ${file}. Install the native executable or the npm CLI.`);
  const root = path.dirname(file);
  const entry = path.resolve(root, match[1].replace(/\\/g, path.sep));
  const relative = path.relative(root, entry);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(entry).isFile()) throw new Error(`Unsafe Windows command wrapper: ${file}`);
  const localNode = path.join(root, 'node.exe');
  return { file: fs.existsSync(localNode) ? localNode : process.execPath, args: [entry, ...args] };
}
function spawnCommand(file, args, options, spawnImpl = spawn) {
  const invocation = commandInvocation(file, args);
  if (invocation.file !== file && invocation.file === process.execPath && process.versions.electron) options = { ...options, env: { ...(options.env || process.env), ELECTRON_RUN_AS_NODE: "1" } };
  if (process.platform === "win32") return spawnWindowsJob(invocation.file, invocation.args, options, spawnImpl);
  return spawnImpl(invocation.file, invocation.args, options);
}
function execCommand(file, args, options, callback, execFileImpl = execFile) {
  let invocation;
  try { invocation = commandInvocation(file, args); }
  catch (error) { queueMicrotask(() => callback(error, '', '')); return; }
  if (invocation.file !== file && invocation.file === process.execPath && process.versions.electron) options = { ...options, env: { ...(options.env || process.env), ELECTRON_RUN_AS_NODE: "1" } };
  return execFileImpl(invocation.file, invocation.args, options, callback);
}
module.exports = { commandInvocation, spawnCommand, execCommand };
