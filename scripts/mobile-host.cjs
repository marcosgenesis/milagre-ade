const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { parseArgs } = require('node:util');
const { spawn } = require('node:child_process');
const { startDaemon } = require('../apps/daemon/src/server.cjs');
const { startMobileBridge } = require('../apps/daemon/src/mobile-bridge.cjs');
const { connect } = require('../apps/daemon/src/client.cjs');
const { version } = require('../package.json');

async function readToken(file) {
  let handle;
  try { handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') return randomBytes(32).toString('hex'); throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid())) throw new Error('Connection file must be private to your account with permissions 0600. Remove it after the host stops to create a new token.');
    const value = JSON.parse(await handle.readFile('utf8'));
    if (!/^[a-f0-9]{64}$/i.test(value.token)) throw new Error('Connection file has an invalid token. Move it aside after the host stops to pair again.');
    return value.token;
  } finally { await handle.close(); }
}

async function startMobileHost({ dataDir, project, port = 8787, publicUrl, runtimeOptions } = {}) {
  if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('Use an absolute data directory.');
  if (project && !path.isAbsolute(project)) throw new Error('Use an absolute Project path.');
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('The public URL must be an HTTPS origin without credentials or a path.');
    publicUrl = url.origin;
  }
  const daemon = await startDaemon({ dataDir, version, runtimeOptions });
  const connectionFile = path.join(dataDir, 'mobile-connection.json');
  let bridge, socket, closing;
  const close = () => closing ??= (async () => { await bridge?.close(); socket?.close(); await daemon.close(); })();
  try {
    const token = await readToken(connectionFile);
    bridge = await startMobileBridge({ dataDir, port, token });
    if (project) { socket = await connect({ dataDir }); await socket.call('project:open', [project]); socket.close(); socket = null; }
    const temporary = `${connectionFile}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ url: publicUrl || bridge.url, token }, null, 2), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, connectionFile);
    } finally { await fs.rm(temporary, { force: true }); }
    return { url: publicUrl || bridge.url, localUrl: bridge.url, connectionFile, close };
  } catch (error) { await close(); throw error; }
}

async function main() {
  const { values } = parseArgs({ options: {
    'data-dir': { type: 'string', default: path.join(os.homedir(), '.milagre-mobile') },
    project: { type: 'string' }, port: { type: 'string', default: '8787' },
    'public-url': { type: 'string' }, 'stay-awake': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('npm run mobile:host -- [--data-dir /absolute/profile] [--project /absolute/Project] [--port 8787] [--public-url https://host.example] [--stay-awake]\nSeparate real-provider host; never opens the development Project by default. Ctrl+C stops it. Tokens stay in the private connection file and can be reused after restart.');
    return;
  }
  const host = await startMobileHost({ dataDir: values['data-dir'], project: values.project, port: Number(values.port), publicUrl: values['public-url'] });
  let awake;
  if (values['stay-awake'] && process.platform === 'darwin') {
    awake = spawn('/usr/bin/caffeinate', ['-i'], { stdio: 'ignore' });
    awake.on('error', error => console.error(`Keep awake unavailable: ${error.message}`));
  }
  const stop = async () => { awake?.kill('SIGTERM'); await host.close(); };
  process.once('SIGINT', () => void stop().catch(error => { console.error(error.message); process.exitCode = 1; }));
  process.once('SIGTERM', () => void stop().catch(error => { console.error(error.message); process.exitCode = 1; }));
  console.log(`Milagre host: ${host.url}\nConnection details: ${host.connectionFile}\nUses installed Codex and Claude. Close a Project in other Milagre hosts before opening it here. Ctrl+C stops this host.`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { startMobileHost };
