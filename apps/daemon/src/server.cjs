const net = require('node:net');
const fs = require('node:fs/promises');
const { once } = require('node:events');
const { createRuntime } = require('@milagre/core');
const { socketPath: pathFor, prepareSocketDirectory } = require('./paths.cjs');
const { VERSION, MAX_FRAME_BYTES, MAX_PENDING, pageSize, wire } = require('./protocol.cjs');

const PAGES_TTL_MS = 30000;
// What one connection may hold in paged responses at once, in characters. A response larger than that alone is still
// served when nothing else is held; the rest wait for a reader to finish rather than evict a response being read.
const PAGES_BUDGET_CHARS = 64 * 1024 * 1024;
// Their replies are sized to fit a frame already; paging them again would never end.
const PAGE_METHODS = new Set(['daemon:result-page', 'daemon:snapshot-page']);

// Responses too large to send whole, kept per connection until their client has read every page in order.
function createResultPages(maxFrameBytes, { ttlMs = PAGES_TTL_MS, budgetChars = PAGES_BUDGET_CHARS } = {}) {
  const captures = new Map();
  const waiting = [];
  const size = pageSize(maxFrameBytes);
  let held = 0;
  let nextId = 0;
  let closed = false;
  const fits = chars => captures.size === 0 || (captures.size < MAX_PENDING && held + chars <= budgetChars);
  function admit() {
    while (waiting.length && (closed || fits(waiting[0].chars))) waiting.shift().resolve();
  }
  function release(id) {
    const capture = captures.get(id);
    if (!capture) return;
    clearTimeout(capture.timer);
    captures.delete(id);
    held -= capture.text.length;
    admit();
  }
  // The time limit runs from the last page read, so a reader that keeps going never loses its response.
  function arm(id, capture) {
    clearTimeout(capture.timer);
    capture.timer = setTimeout(() => release(id), ttlMs);
    capture.timer.unref();
  }
  return {
    /** The page count for `text`, once the connection has room for it; null when the connection closed meanwhile. */
    async capture(text) {
      if (waiting.length || !fits(text.length)) await new Promise(resolve => waiting.push({ chars: text.length, resolve }));
      if (closed) return null;
      const pageId = ++nextId;
      const capture = { text, pageCount: Math.max(1, Math.ceil(text.length / size)), nextPage: 0, timer: null };
      captures.set(pageId, capture);
      held += text.length;
      arm(pageId, capture);
      return { pageId, pageCount: capture.pageCount };
    },
    page(pageId, index) {
      const capture = captures.get(pageId);
      if (!capture) throw new Error('This paged response expired. Send the request again.');
      if (!Number.isInteger(index) || index !== capture.nextPage || index >= capture.pageCount) throw new Error('This page is out of order. Read the pages from the first, or send the request again.');
      const text = capture.text.slice(index * size, (index + 1) * size);
      if (++capture.nextPage === capture.pageCount) release(pageId);
      else arm(pageId, capture);
      return text;
    },
    clear() { closed = true; for (const id of [...captures.keys()]) release(id); admit(); },
  };
}

// A project's state is encoded once per state object (states are replaced, never changed in place) and reused by every
// event, reply and client, so a burst of events and the reads that follow them serialise it once.
const encodedStates = new WeakMap();
function encodeState(state) {
  let encoded = encodedStates.get(state);
  if (!encoded) {
    const json = JSON.stringify(state);
    encoded = { json, bytes: Buffer.byteLength(json) };
    encodedStates.set(state, encoded);
  }
  return encoded;
}
const hasState = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.state && typeof value.state === 'object');
/** JSON for `value`, with its `state` taken from the cache (written last). */
function encode(value) {
  if (!hasState(value)) return JSON.stringify(value ?? null);
  const { state, ...rest } = value;
  const head = JSON.stringify(rest);
  return `${head === '{}' ? '{' : `${head.slice(0, -1)},`}"state":${encodeState(state).json}}`;
}

// An event, encoded once for every client. A state over `inlineLimit` (a quarter of a frame) is left out
// (stateTooLarge) for the client to read in pages: a few events that size queued together would trip the
// stalled-client guard, which allows two frames.
function eventFrame(channel, payload, seq, inlineLimit) {
  let body = payload;
  if (hasState(payload) && encodeState(payload.state).bytes > inlineLimit) {
    const { state: _state, ...rest } = payload;
    body = { ...rest, stateTooLarge: true };
  }
  const json = `{"v":${VERSION},"event":{"channel":${JSON.stringify(channel)},"payload":${encode(body)},"seq":${seq}}}`;
  return { json, bytes: Buffer.byteLength(json) + 1 };
}

async function startDaemon({ dataDir, version, runtimeOptions = {}, maxFrameBytes = MAX_FRAME_BYTES, pagesTtlMs, pagesBudgetChars, onError = error => console.error(error) }) {
  // Anything bigger travels in pages, or (a state in an event) is read in pages by the client.
  const inlineLimit = Math.floor(maxFrameBytes / 4);
  const clients = new Map();
  const views = new Map();
  let eventSeq = 0;
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
    const seq = ++eventSeq;
    if (!clients.size) return;
    // An event that still doesn't fit is skipped, never the connection.
    const { json, bytes } = eventFrame(channel, payload, seq, inlineLimit);
    for (const connection of clients.values()) {
      try { connection.send(null, json, bytes); }
      catch (error) { onError(new Error(`Milagre couldn't send a ${channel} event: ${error.message}`)); }
    }
  }
  const server = net.createServer(socket => {
    if (stopping) { socket.destroy(); return; }
    const inflight = new Set();
    let snapshotCapture;
    let snapshotTimer;
    let nextSnapshotId = 0;
    const resultPages = createResultPages(maxFrameBytes, { ttlMs: pagesTtlMs, budgetChars: pagesBudgetChars });
    function releaseSnapshot() {
      clearTimeout(snapshotTimer);
      snapshotCapture = null;
    }
    socket.once('close', () => { releaseSnapshot(); resultPages.clear(); });
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
      // Serialised once. A client that reads pages (`pages: true`) gets anything over a quarter of a frame as a page
      // count; one that can't gets it whole up to the frame limit, and a clear FRAME_TOO_LARGE error past it.
      async function reply(result) {
        const resultJson = encode(result);
        if (request.pages === true && !PAGE_METHODS.has(request.method) && resultJson.length > inlineLimit) {
          const pages = await resultPages.capture(resultJson);
          if (pages) connection.send({ v: VERSION, id, pages });
          return;
        }
        connection.send(null, `{"v":${VERSION},"id":${JSON.stringify(id)},"result":${resultJson}}`);
      }
      try {
        let result;
        if (request.method === 'daemon:status') result = { pid: process.pid, version, protocolVersion: VERSION, dataDir, socketPath, capabilities: ['desktop-v1', 'snapshot-pages-v1', 'result-pages-v1'], methods: runtime.methods };
        else if (request.method === 'daemon:snapshot') {
          const snapshot = { ...runtime.snapshot(), eventSeq };
          if (request.args[0]?.paged === true) {
            releaseSnapshot();
            // Serialize once: all pages describe the same instant and watermark.
            // JSON-encoding a fragment can expand each UTF-16 unit to six bytes.
            const text = JSON.stringify(snapshot);
            const snapshotId = ++nextSnapshotId;
            const pageCount = Math.ceil(text.length / pageSize(maxFrameBytes));
            snapshotCapture = { snapshotId, text, pageSize: pageSize(maxFrameBytes), pageCount, nextPage: 0 };
            snapshotTimer = setTimeout(releaseSnapshot, 30000);
            snapshotTimer.unref();
            result = { snapshotId, pageCount, eventSeq: snapshot.eventSeq };
          } else result = snapshot;
        }
        else if (request.method === 'daemon:snapshot-page') {
          const [snapshotId, index] = request.args;
          const capture = snapshotCapture;
          if (!capture || capture.snapshotId !== snapshotId || !Number.isInteger(index) || index !== capture.nextPage || index >= capture.pageCount) {
            throw new Error('Snapshot expired or page is out of order. Capture a new snapshot.');
          }
          result = capture.text.slice(index * capture.pageSize, (index + 1) * capture.pageSize);
          capture.nextPage++;
          if (capture.nextPage === capture.pageCount) releaseSnapshot();
        }
        else if (request.method === 'daemon:result-page') result = resultPages.page(...request.args);
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
        else if (request.method === 'daemon:stop') { await runtime.close(); result = { stopping: true }; }
        else if (request.method === 'project:open') result = await runtime.openProject(...request.args);
        else if (request.method === 'project:current' && view.projectPath) result = await runtime.invoke('project:snapshot', [view.projectPath]);
        else result = await runtime.invoke(request.method, request.args);
        if (['project:open', 'project:current', 'project:switch'].includes(request.method) && result?.path) view.projectPath = result.path;
        await reply(result ?? null);
        if (request.method === 'daemon:stop') void close().catch(onError);
      } catch (error) {
        fail(typeof error.code === 'string' ? error.code : 'COMMAND_FAILED', error.message);
      } finally { inflight.delete(id); }
    }
  });
  let socketPath;
  async function close() {
    stopping ??= (async () => {
      // Keep the listening socket available after a failed save so a client
      // can receive the error and retry stop after disk recovery.
      await runtime.close();
      const stopped = listening ? new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : Promise.resolve();
      for (const socket of clients.keys()) socket.end();
      // Do not let a client that never closes its side keep shutdown alive.
      const timeout = setTimeout(() => { for (const socket of clients.keys()) socket.destroy(); }, 1000);
      await stopped;
      clearTimeout(timeout);
    })().catch(error => { stopping = undefined; throw error; });
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
