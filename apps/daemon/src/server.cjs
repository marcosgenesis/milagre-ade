const net = require('node:net');
const fs = require('node:fs/promises');
const { once } = require('node:events');
const { createRuntime } = require('@milagre/core');
const { socketPath: pathFor, prepareSocketDirectory } = require('./paths.cjs');
const { VERSION, MAX_FRAME_BYTES, MAX_PENDING, wire } = require('./protocol.cjs');

async function startDaemon({ dataDir, version, runtimeOptions = {}, maxFrameBytes = MAX_FRAME_BYTES, onError = error => console.error(error) }) {
  const clients = new Map();
  const views = new Map();
  let stopping;
  let listening = false;
  const runtime = createRuntime({ ...runtimeOptions, dataDir, version,
    isChatFocused: chatId => [...views.values()].some(view => view.focused && view.chatId === chatId),
    notifyWaiting(notice) {
      broadcast('notification:waiting', notice);
      runtimeOptions.notifyWaiting?.(notice);
    },
    emit(channel, payload) {
      broadcast(channel, payload);
      runtimeOptions.emit?.(channel, payload);
    },
  });
  function broadcast(channel, payload) {
    for (const [socket, connection] of clients) {
      try { connection.send({ v: VERSION, event: { channel, payload } }); }
      catch { socket.destroy(); }
    }
  }
  const server = net.createServer(socket => {
    if (stopping) { socket.destroy(); return; }
    const inflight = new Set();
    const view = { focused: false, projectPath: null, chatId: null };
    views.set(socket, view);
    const connection = wire(socket, {
      maxFrameBytes,
      onInvalid(error) {
        connection.send({ v: VERSION, id: null, error: { code: error.code, message: error.message } });
        socket.end();
      },
      onMessage(request) {
        void dispatch(request).catch(error => { onError(error); socket.destroy(); });
      },
    });
    clients.set(socket, connection);
    socket.on('error', () => {});
    socket.on('close', () => { clients.delete(socket); views.delete(socket); });
    async function dispatch(request) {
      const validId = Number.isSafeInteger(request?.id) || (typeof request?.id === 'string' && request.id.length <= 128);
      const id = validId ? request.id : null;
      function fail(code, message) { connection.send({ v: VERSION, id, error: { code, message } }); }
      if (request?.v !== VERSION) { fail('VERSION_MISMATCH', `Local protocol version ${VERSION} is required`); return; }
      if (!validId || typeof request.method !== 'string' || request.method.length > 128 || !Array.isArray(request.args)) {
        fail('INVALID_REQUEST', 'Expected id, method and an args array'); return;
      }
      if (stopping) { fail('CLOSING', 'The daemon is closing'); return; }
      if (inflight.has(id) || inflight.size >= MAX_PENDING) { fail('TOO_MANY_REQUESTS', 'Request ID is in use or too many requests are pending'); socket.end(); return; }
      inflight.add(id);
      try {
        let result;
        if (request.method === 'daemon:status') result = { pid: process.pid, version, protocolVersion: VERSION, dataDir, socketPath, capabilities: ['desktop-v1'], methods: runtime.methods };
        else if (request.method === 'daemon:flush') result = await runtime.flush();
        else if (request.method === 'daemon:focus') {
          const next = request.args[0];
          if (!next || typeof next.focused !== 'boolean') throw new Error('Expected a focused boolean');
          view.focused = next.focused;
          if (view.focused) await runtime.focused(view);
        }
        else if (request.method === 'chat:set-open') {
          view.chatId = typeof request.args[0] === 'string' ? request.args[0] : null;
          await runtime.focused(view);
        }
        else if (request.method === 'daemon:stop') result = { stopping: true };
        else if (request.method === 'project:open') result = await runtime.openProject(...request.args);
        else if (request.method === 'project:current' && view.projectPath) result = await runtime.invoke('project:snapshot', [view.projectPath]);
        else result = await runtime.invoke(request.method, request.args);
        if (['project:open', 'project:current', 'project:switch'].includes(request.method) && result?.path) view.projectPath = result.path;
        connection.send({ v: VERSION, id, result: result ?? null });
        if (request.method === 'daemon:stop') void close().catch(onError);
      } catch (error) {
        fail(typeof error.code === 'string' ? error.code : 'COMMAND_FAILED', error.message);
      } finally { inflight.delete(id); }
    }
  });
  let socketPath;
  async function close() {
    stopping ??= (async () => {
      // Stop accepting connections first. Existing sockets stay until their
      // accepted runtime commands and agent shutdown have drained.
      const stopped = listening ? new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : Promise.resolve();
      await runtime.close();
      for (const socket of clients.keys()) socket.end();
      // Do not let a client that never closes its side keep shutdown alive.
      const timeout = setTimeout(() => { for (const socket of clients.keys()) socket.destroy(); }, 1000);
      await stopped;
      clearTimeout(timeout);
    })();
    return stopping;
  }
  try {
    socketPath = pathFor(dataDir);
    prepareSocketDirectory(socketPath);
    server.listen(socketPath);
    await once(server, 'listening');
    listening = true;
    await fs.chmod(socketPath, 0o600);
    server.on('error', onError);
    await runtime.resumeRecentProjects();
  } catch (error) {
    await close();
    throw error;
  }
  return { socketPath, close };
}
module.exports = { startDaemon };
