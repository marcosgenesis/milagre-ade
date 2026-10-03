const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { connect } = require('./client.cjs');

async function compatibleClient(dataDir, timeoutMs = 30000) {
  const client = await connect({ dataDir, timeoutMs });
  try {
    const status = await client.call('daemon:status');
    if (!status.capabilities?.includes('desktop-v1') || !Array.isArray(status.methods)) {
      throw Object.assign(new Error('The running Milagre host is older than this desktop. Stop the host cleanly, then reopen Milagre.'), { code: 'INCOMPATIBLE_DAEMON' });
    }
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
  try { return await compatibleClient(dataDir); }
  catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
  const logPath = path.join(dataDir, 'daemon.log');
  let child;
  let launchError;
  // An existing lock may be a concurrent launch; wait for it to listen, but
  // never remove it. A stale owner remains an explicit recovery operation.
  if (!fs.existsSync(path.join(dataDir, 'runtime.lock'))) {
    const log = fs.openSync(logPath, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    try {
      const args = [entry, 'serve', '--data-dir', dataDir, '--app-version', version, '--cwd', cwd];
      if (worktreeRoot) args.push('--worktree-root', worktreeRoot);
      child = spawn(executable, args, { cwd, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, detached: true, stdio: ['ignore', log, log] });
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
  throw new Error(`Milagre host could not start. Check ${logPath} and ${path.join(dataDir, 'runtime.lock/owner.json')}. Never remove a live owner's lock.`);
}

module.exports = { ensureDaemon, compatibleClient };
