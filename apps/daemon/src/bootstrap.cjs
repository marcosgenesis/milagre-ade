const { preparePrivateDirectory } = require('@milagre/core/private-files');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { connect } = require('./client.cjs');
const { staleOwner } = require('@milagre/core/ownership');

async function compatibleClient(dataDir, timeoutMs = 30000) {
  const client = await connect({ dataDir, timeoutMs });
  try {
    const status = await client.call('daemon:status');
    // result-pages-v1 is optional: an older host still serves the desktop, and fails only on very large Projects.
    const required = ['desktop-v1', 'snapshot-pages-v1'];
    if (!required.every(capability => status.capabilities?.includes(capability)) || !Array.isArray(status.methods)) {
      throw Object.assign(new Error('The running Milagre host is older than this desktop. Stop the host cleanly, then reopen Milagre.'), { code: 'INCOMPATIBLE_DAEMON' });
    }
    client.status = status;
    return client;
  } catch (error) { client.close(); throw error; }
}

// Only connection establishment is retried. A caller must never replay a command
// that may already have reached the runtime.
async function ensureDaemon({ dataDir, version, cwd = process.cwd(), worktreeRoot,
  executable = process.execPath, entry = path.join(__dirname, 'cli.cjs'), env = process.env,
  startupTimeoutMs = 15000 } = {}) {
  if (!path.isAbsolute(dataDir ?? '')) throw new Error('Use an absolute data directory');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') preparePrivateDirectory(dataDir);
  try { return await compatibleClient(dataDir); }
  catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
  const logPath = path.join(dataDir, 'daemon.log');
  let child;
  let launchError;
  // An existing lock may be a concurrent launch; wait for it to listen. One whose owner has certainly exited (a crash)
  // doesn't stop a start: the new host takes it over (see acquireOwnership).
  const lockPath = path.join(dataDir, 'runtime.lock');
  if (!fs.existsSync(lockPath) || staleOwner(lockPath)) {
    if (fs.existsSync(logPath) && !fs.lstatSync(logPath).isFile()) throw new Error(`Daemon log must be a regular file: ${logPath}`);
    const log = fs.openSync(logPath, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const args = [entry, 'serve', '--data-dir', dataDir, '--app-version', version, '--cwd', cwd];
      if (worktreeRoot) args.push('--worktree-root', worktreeRoot);
      child = spawn(executable, args, { cwd, env: { ...env,
        // Electron's Node mode may not expose resourcesPath. Pass the desktop's bundled binaries to its host.
        ...(process.resourcesPath ? { MILAGRE_BUNDLED_BIN_DIR: path.join(process.resourcesPath, 'bin') } : {}),
        ELECTRON_RUN_AS_NODE: '1' }, detached: true, stdio: ['ignore', log, log] });
      child.on('error', error => { launchError = error; });
      child.unref();
    } finally { fs.closeSync(log); }
  }
  const until = Date.now() + startupTimeoutMs;
  do {
    try { return await compatibleClient(dataDir); }
    catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
    if (launchError) throw launchError;
    await delay(50);
  } while (Date.now() < until);
  throw new Error(`Milagre host could not start. Check ${logPath} and ${path.join(lockPath, 'owner.json')}. Never remove a live owner's lock.`);
}

module.exports = { ensureDaemon, compatibleClient };
