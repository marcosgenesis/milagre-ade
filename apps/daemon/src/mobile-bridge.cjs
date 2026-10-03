const http = require('node:http');
const { once } = require('node:events');
const { timingSafeEqual } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { connect } = require('./client.cjs');

const METHODS = new Set(['daemon:status', 'project:recent', 'project:open', 'chat:runs',
  'chat:send', 'chat:resume', 'agent:interrupt', 'agent:respond-permission',
  'agent:answer-question', 'agent:models', 'agent:cli-status', 'chat:patch',
  'worktree:pull-request', 'project:branches', 'worktree:create', 'git:diff-files', 'git:diff-file']);
const MAX_BODY = 1024 * 1024;
const failure = (status, message) => Object.assign(new Error(message), { status });

// A native-client bridge behind loopback or an explicitly configured TLS proxy. All state stays in the Unix-socket
// daemon; closing this listener must never stop that runtime or its turns.
async function startMobileBridge({ dataDir, port = 8787, token }) {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw new Error('Bridge token must be 32 random bytes encoded as hex');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid bridge port');
  const expected = Buffer.from(`Bearer ${token}`);
  const client = await connect({ dataDir });
  let active = 0;
  let closed;
  let url;
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
        if (req.method === 'GET' && target.pathname === '/snapshot') {
          const projectPath = target.searchParams.get('projectPath');
          const [project, runs] = await Promise.all([client.call('project:snapshot', [projectPath]), client.call('chat:runs')]);
          result = { project, runs };
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
            await client.call('project:snapshot', [projectPath]);
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
