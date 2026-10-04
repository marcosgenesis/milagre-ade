const http = require('node:http');
const { once } = require('node:events');
const { timingSafeEqual } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');
const { connect } = require('./client.cjs');

const METHODS = new Set(['daemon:status', 'project:recent', 'project:open', 'chat:runs',
  'chat:send', 'chat:resume', 'agent:interrupt', 'agent:respond-permission',
  'agent:answer-question', 'agent:models', 'agent:cli-status', 'chat:patch',
  'worktree:pull-request', 'project:branches', 'worktree:create', 'git:diff-files', 'git:diff-file']);
const MAX_BODY = 1024 * 1024;
const MAX_MEDIA = 15 * MAX_BODY;
const MEDIA_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heic' };
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
// Decide by content too, so a renamed non-image never leaves the Mac as an image.
function sniffsAs(type, head) {
  if (type === 'image/png') return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (type === 'image/gif') return /^GIF8[79]a$/.test(head.subarray(0, 6).toString('latin1'));
  if (type === 'image/webp') return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  return head.subarray(4, 8).toString('latin1') === 'ftyp' && HEIC_BRANDS.has(head.subarray(8, 12).toString('latin1'));
}
const realOrNull = async file => { try { return await fs.realpath(file); } catch { return null; } };
const failure = (status, message) => Object.assign(new Error(message), { status });

// A native-client bridge behind loopback or an explicitly configured TLS proxy. All state stays in the Unix-socket
// daemon; closing this listener must never stop that runtime or its turns.
async function startMobileBridge({ dataDir, port = 8787, token }) {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw new Error('Bridge token must be 32 random bytes encoded as hex');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid bridge port');
  const expected = Buffer.from(`Bearer ${token}`);
  const client = await connect({ dataDir });
  let active = 0;
  // The phone polls /snapshot every second. Each Project's last answer is kept with its revision: while the state is
  // the same, the daemon answers `unchanged` and the state is neither read in pages nor encoded again.
  const snapshots = new Map();
  async function snapshotJson(projectPath) {
    const cached = snapshots.get(projectPath);
    const project = await client.call('project:snapshot', [projectPath, cached ? { unlessRevision: cached.revision } : {}]);
    if (project?.unchanged && cached) return cached.json;
    const json = JSON.stringify(project);
    snapshots.delete(projectPath);
    if (typeof project?.revision === 'string') snapshots.set(projectPath, { revision: project.revision, json });
    return json;
  }
  let closed;
  let url;
  // Images the paired app may show: the Project's Worktrees, its persisted attachments (<Project>/.milagre/images),
  // files uploaded from mobile, and the folders where agents save generated images. Everything is checked after
  // realpath, so a symlink cannot lead out.
  async function serveMedia(target, res) {
    const projectPath = target.searchParams.get('projectPath');
    const requested = target.searchParams.get('path');
    if (!projectPath || !requested || !path.isAbsolute(projectPath) || !path.isAbsolute(requested)) throw failure(400, 'projectPath and path must be absolute');
    const type = MEDIA_TYPES[path.extname(requested).toLowerCase()];
    if (!type) throw failure(415, 'Only png, jpeg, gif, webp and heic images are served');
    // Only the worktree folders: a big Project's whole state would be read in pages for every image.
    const worktreePaths = await client.call('project:worktree-paths', [projectPath]);
    const candidates = [
      ...(Array.isArray(worktreePaths) ? worktreePaths : []),
      path.join(projectPath, '.milagre', 'images'),
      path.join(dataDir, 'mobile-attachments'),
      path.join(os.tmpdir(), 'milagre-generated-images'),
      path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'generated_images'),
    ].filter(candidate => typeof candidate === 'string' && path.isAbsolute(candidate));
    const roots = (await Promise.all(candidates.map(realOrNull))).filter(Boolean);
    const real = await realOrNull(requested);
    if (!real) {
      // Missing files are only reported as missing inside an allowed folder, so paths elsewhere are not probed.
      const lexical = path.resolve(requested);
      throw (roots.some(root => inside(root, lexical)) || candidates.some(root => inside(path.resolve(root), lexical)))
        ? failure(404, 'Image not found') : failure(403, 'This file is not available to the mobile app');
    }
    if (!roots.some(root => inside(root, real))) throw failure(403, 'This file is not available to the mobile app');
    if (MEDIA_TYPES[path.extname(real).toLowerCase()] !== type) throw failure(415, 'Only png, jpeg, gif, webp and heic images are served');
    const handle = await fs.open(real, 'r').catch(error => { throw failure(error.code === 'ENOENT' ? 404 : 403, error.code === 'ENOENT' ? 'Image not found' : 'This file is not available to the mobile app'); });
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw failure(403, 'This file is not available to the mobile app');
      if (info.size > MAX_MEDIA) throw failure(413, 'Images must be 15 MiB or smaller');
      const head = Buffer.alloc(12);
      const { bytesRead } = await handle.read(head, 0, 12, 0);
      if (!sniffsAs(type, head.subarray(0, bytesRead))) throw failure(415, 'The file is not a supported image');
      res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
      // Bounded by the size checked above, so a file that grows afterwards cannot exceed Content-Length.
      await pipeline(handle.createReadStream({ start: 0, end: Math.max(info.size - 1, 0), autoClose: true }), res);
    } catch (error) {
      await handle.close().catch(() => {});
      if (res.headersSent) { res.destroy(); return; }
      throw error;
    }
  }
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, (req, res) => {
    const reply = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify({ v: 1, ...value }));
    };
    void (async () => {
      const received = Buffer.from(req.headers.authorization ?? '');
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw failure(401, 'Connection token is missing or incorrect');
      const address = new URL(url);
      // Android's emulator maps 10.0.2.2 to this host's loopback interface.
      if (req.headers.origin || ![address.host, `10.0.2.2:${address.port}`].includes(req.headers.host)) throw failure(403, 'Only a native localhost client is supported');
      if (closed) throw failure(503, 'Bridge is closing');
      if (active >= 16) throw failure(429, 'Too many pending requests');
      active++;
      try {
        const target = new URL(req.url, url);
        let result;
        if (req.method === 'GET' && target.pathname === '/media') {
          await serveMedia(target, res);
          return;
        }
        if (req.method === 'GET' && target.pathname === '/snapshot') {
          const projectPath = target.searchParams.get('projectPath');
          const [project, runs] = await Promise.all([snapshotJson(projectPath), client.call('chat:runs')]);
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          res.end(`{"v":1,"result":{"project":${project},"runs":${JSON.stringify(runs)}}}`);
          return;
        } else if (req.method === 'POST' && ['/rpc', '/attachments'].includes(target.pathname)) {
          if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw failure(415, 'Use application/json');
          const limit = target.pathname === '/attachments' ? 7 * MAX_BODY : MAX_BODY;
          if (Number(req.headers['content-length']) > limit) throw failure(413, 'Request exceeds the upload limit');
          let size = 0;
          const chunks = [];
          // Reading through data events lets us return 413 without destroying the socket.
          const body = await new Promise((resolve, reject) => {
            req.on('data', chunk => {
              size += chunk.length;
              if (size > limit) { reject(failure(413, 'Request exceeds the upload limit')); return; }
              chunks.push(chunk);
            });
            req.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            req.once('error', reject);
            req.once('aborted', () => reject(failure(400, 'Request was interrupted')));
          });
          let request;
          try { request = JSON.parse(body); } catch { throw failure(400, 'Invalid JSON'); }
          if (target.pathname === '/attachments') {
            const { projectPath, name, base64 } = request || {};
            if (typeof projectPath !== 'string' || typeof name !== 'string' || typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw failure(400, 'Invalid attachment');
            const bytes = Buffer.from(base64, 'base64');
            if (bytes.length > 5 * MAX_BODY) throw failure(413, 'Each file must be 5 MiB or smaller');
            if (!bytes.length || bytes.toString('base64') !== base64) throw failure(400, 'Invalid attachment data');
            await client.call('project:worktree-paths', [projectPath]);
            const folder = path.join(dataDir, 'mobile-attachments', randomUUID());
            const filename = path.basename(name.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 180);
            if (!filename || filename === '.' || filename === '..') throw failure(400, 'Choose a file with a name');
            await fs.mkdir(folder, { recursive: true, mode: 0o700 });
            const destination = path.join(folder, filename);
            try { await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 }); }
            catch (error) { await fs.rm(folder, { recursive: true, force: true }); throw error; }
            result = { path: destination, name: filename };
          } else {
          if (request?.v !== 1 || typeof request.method !== 'string' || !Array.isArray(request.args)) throw failure(400, 'Expected version 1, method and args array');
          if (!METHODS.has(request.method)) throw failure(403, 'Command is not available from mobile');
          result = await client.call(request.method, request.args);
          }
        } else throw failure(404, 'Unknown endpoint');
        reply(200, { result: result ?? null });
      } finally { active--; }
    })().catch(error => { if (!res.headersSent && !res.destroyed) reply(error.status ?? 409, { error: { message: error.message } }); });
  });
  async function close() {
    closed ??= new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
      client.close();
    });
    return closed;
  }
  client.once('close', () => { void close(); });
  try {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${server.address().port}`;
  } catch (error) { await close(); throw error; }
  return { url, close };
}
module.exports = { startMobileBridge };
