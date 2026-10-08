const { isLinkScopeKey, scopeFromKey } = require('@milagre/shared/chat-scopes');
const { preparePrivateDirectory } = require('@milagre/core/private-files');
const { prepareToken, validToken, authenticationProof, authenticationNonce, validNonce } = require('./local-auth.cjs');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { once } = require('node:events');
const { createRuntime } = require('@milagre/core');
const { socketPath: pathFor, prepareSocketDirectory } = require('./paths.cjs');
const { VERSION, MAX_FRAME_BYTES, MAX_PENDING, pageSize, wire } = require('./protocol.cjs');
const { createPhone } = require('./phone.cjs');
const { createMobilePush } = require('./mobile-push.cjs');
const { createExpoPush } = require('./expo-push.cjs');
const { attentionContext } = require('@milagre/shared/attention');
const { projectOfKey, sessionIdFromKey } = require('@milagre/shared/agent-runs');

// Handled here, never by core, and not in the mobile bridge's allow-list: a paired phone must not manage its own access.
const PUSH_METHODS = Object.freeze(['push:register', 'push:unregister', 'push:focus']);
const PHONE_METHODS = Object.freeze(['phone:status', 'phone:set-enabled', 'phone:reset', 'phone:open-pairing']);

const PAGES_TTL_MS = 30000;
// What one connection may hold in paged responses at once, in characters. A response larger than that alone is still
// served when nothing else is held; the rest wait for a reader to finish rather than evict a response being read.
const PAGES_BUDGET_CHARS = 64 * 1024 * 1024;
// Their replies are sized to fit a frame already; paging them again would never end.
const PAGE_METHODS = new Set(['daemon:result-page', 'daemon:snapshot-page']);

// Responses too large to send whole, kept per connection until their client has read every page in order.
// A capture's slot and characters are reserved the moment it is admitted, so waiters let in together never go past
// the budget or MAX_PENDING; at most MAX_PENDING more may wait.
function createResultPages(maxFrameBytes, { ttlMs = PAGES_TTL_MS, budgetChars = PAGES_BUDGET_CHARS } = {}) {
  const captures = new Map();
  const waiting = [];
  const size = pageSize(maxFrameBytes);
  let slots = 0;
  let held = 0;
  let nextId = 0;
  let closed = false;
  const fits = chars => slots === 0 || (slots < MAX_PENDING && held + chars <= budgetChars);
  const reserve = chars => { slots++; held += chars; };
  function admit() {
    // oxlint-disable-next-line no-unmodified-loop-condition -- clear() sets closed from outside while this loop drains the queue
    while (waiting.length && (closed || fits(waiting[0].chars))) {
      const next = waiting.shift();
      if (!closed) reserve(next.chars);
      next.resolve();
    }
  }
  function release(id) {
    const capture = captures.get(id);
    if (!capture) return;
    clearTimeout(capture.timer);
    captures.delete(id);
    slots--;
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
    /** Whether a capture of `chars` would wait for room now. */
    mustWait: chars => waiting.length > 0 || !fits(chars),
    /** The page count for `text`, once the connection has room for it; null when the connection closed meanwhile. */
    async capture(text) {
      if (waiting.length || !fits(text.length)) {
        if (waiting.length >= MAX_PENDING) throw Object.assign(new Error('Too many large responses are waiting on this connection. Try again.'), { code: 'PAGES_BUSY' });
        await new Promise(resolve => waiting.push({ chars: text.length, resolve }));
      } else reserve(text.length);
      if (closed) return null;
      const pageId = ++nextId;
      const capture = { text, pageCount: Math.max(1, Math.ceil(text.length / size)), nextPage: 0, timer: null };
      captures.set(pageId, capture);
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
    /** Admitted captures, for tests: slots in use and characters reserved. */
    usage: () => ({ slots, chars: held }),
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

async function startDaemon({ dataDir, version, runtimeOptions = {}, phoneOptions = {}, pushOptions = {}, maxFrameBytes = MAX_FRAME_BYTES, pagesTtlMs, pagesBudgetChars, requireAuthentication = process.platform === 'win32', authTimeoutMs = 5000, onError = error => console.error(error) }) {
  if (process.platform === 'win32') preparePrivateDirectory(dataDir);
  const authenticationToken = requireAuthentication ? prepareToken(dataDir) : null;
  const sockets = new Set();
  let unauthenticated = 0;
  // Anything bigger travels in pages, or (a state in an event) is read in pages by the client.
  const inlineLimit = Math.floor(maxFrameBytes / 4);
  const clients = new Map();
  const views = new Map();
  let eventSeq = 0;
  let stopping;
  let listening = false;
  const sender = createExpoPush({ ...pushOptions, onError, onInvalid: token => push.invalidate(token) });
  const push = createMobilePush({ dataDir, send: sender.send, onError, context: async chatId => {
    const owner = projectOfKey(chatId);
    const project = await runtime.invoke(isLinkScopeKey(owner) ? 'link:snapshot' : 'project:snapshot', [isLinkScopeKey(owner) ? scopeFromKey(owner).linkId : owner]);
    return attentionContext(project.state, project.link?.name || project.name || require('node:path').basename(project.path), sessionIdFromKey(chatId));
  } });
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
    if (channel === 'agent:event') push.observe(payload.chatId, payload.event);
    const seq = ++eventSeq;
    if (!clients.size) return;
    // An event that still doesn't fit is skipped, never the connection.
    const { json, bytes } = eventFrame(channel, payload, seq, inlineLimit);
    for (const connection of clients.values()) {
      try { connection.send(null, json, bytes); }
      catch (error) { onError(new Error(`Milagre couldn't send a ${channel} event: ${error.message}`)); }
    }
  }
  // Its bridge connects to this daemon's socket as a client, so it only starts once the socket listens.
  // A first pairing is announced to the desktop, which tells the owner in case it was not them.
  const phone = createPhone({ dataDir, onChange: status => broadcast('phone:status', status), onPaired: info => broadcast('phone:paired', info), ...phoneOptions });
  const server = net.createServer(socket => {
    if (stopping || (requireAuthentication && unauthenticated >= 32)) { socket.destroy(); return; }
    sockets.add(socket);
    let authenticated = !requireAuthentication;
    let challenge;
    let authenticationRejected = false;
    if (!authenticated) unauthenticated++;
    const authenticationTimeout = authenticated ? null : setTimeout(() => socket.destroy(), authTimeoutMs);
    authenticationTimeout?.unref();
    const inflight = new Set();
    // Requests whose reply waits for paging room: they don't hold a MAX_PENDING slot, so a reader's page reads get through.
    const awaitingPages = new Set();
    // Result pages and paged snapshots share one store and its rules.
    const resultPages = createResultPages(maxFrameBytes, { ttlMs: pagesTtlMs, budgetChars: pagesBudgetChars });
    socket.once('close', () => { resultPages.clear(); });
    const view = { focused: false, projectPath: null, chatId: null };
    // Never accept an actor supplied in RPC arguments. Each authenticated socket owns its viewer capabilities.
    const context = Object.freeze({ clientId: randomUUID() });
    if (authenticated) views.set(socket, view);
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
    if (authenticated) clients.set(socket, connection);
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(authenticationTimeout);
      if (!authenticated) unauthenticated--;
      sockets.delete(socket); clients.delete(socket); views.delete(socket);
      Promise.resolve(runtime.disconnect?.(context.clientId)).catch(onError);
    });
    async function dispatch(request) {
      const validId = Number.isSafeInteger(request?.id) || (typeof request?.id === 'string' && request.id.length <= 128);
      const id = validId ? request.id : null;
      function fail(code, message) { connection.send({ v: VERSION, id, error: { code, message } }); }
      if (authenticationRejected) return;
      if (!authenticated) {
        const supplied = request?.args?.[0];
        const valid = request?.v === VERSION && validId && request.method === 'daemon:authenticate' && Array.isArray(request.args) && request.args.length === 1;
        if (valid && !challenge && validNonce(supplied?.clientNonce)) {
          challenge = { clientNonce: supplied.clientNonce, serverNonce: authenticationNonce() };
          connection.send({ v: VERSION, id, result: { serverNonce: challenge.serverNonce, proof: authenticationProof(authenticationToken, 'server', challenge.clientNonce, challenge.serverNonce) } });
          return;
        }
        if (!valid || !challenge || !validToken(authenticationProof(authenticationToken, 'client', challenge.clientNonce, challenge.serverNonce), supplied?.proof)) {
          authenticationRejected = true;
          fail('UNAUTHORIZED', 'Local daemon authentication is required');
          socket.end();
          return;
        }
        authenticated = true; unauthenticated--; clearTimeout(authenticationTimeout);
        clients.set(socket, connection); views.set(socket, view);
        connection.send({ v: VERSION, id, result: { authenticated: true } });
        return;
      }
      if (request?.v !== VERSION) { fail('VERSION_MISMATCH', `Local protocol version ${VERSION} is required`); return; }
      if (!validId || typeof request.method !== 'string' || request.method.length > 128 || !Array.isArray(request.args)) {
        fail('INVALID_REQUEST', 'Expected id, method and an args array'); return;
      }
      if (stopping) { fail('CLOSING', 'The daemon is closing'); return; }
      if (inflight.has(id) || inflight.size - awaitingPages.size >= MAX_PENDING) { fail('TOO_MANY_REQUESTS', 'Request ID is in use or too many requests are pending'); socket.end(); return; }
      inflight.add(id);
      async function capturePages(text) {
        if (resultPages.mustWait(text.length)) awaitingPages.add(id);
        try { return await resultPages.capture(text); }
        finally { awaitingPages.delete(id); }
      }
      // Serialised once. A client that reads pages (`pages: true`) gets anything over a quarter of a frame as a page
      // count; one that can't gets it whole up to the frame limit, and a clear FRAME_TOO_LARGE error past it.
      async function reply(result) {
        const resultJson = encode(result);
        if (request.pages === true && !PAGE_METHODS.has(request.method) && resultJson.length > inlineLimit) {
          const pages = await capturePages(resultJson);
          if (pages) connection.send({ v: VERSION, id, pages });
          return;
        }
        connection.send(null, `{"v":${VERSION},"id":${JSON.stringify(id)},"result":${resultJson}}`);
      }
      try {
        let result;
        if (request.method === 'daemon:status') result = { pid: process.pid, version, protocolVersion: VERSION, dataDir, socketPath, capabilities: ['desktop-v1', 'snapshot-pages-v1', 'result-pages-v1', 'mobile-push-v1'], methods: [...runtime.methods, ...PHONE_METHODS, ...PUSH_METHODS] };
        else if (request.method === 'phone:status') result = phone.status();
        // Settings shows the reply, which arrives after the status events: answer with the settled status, not the
        // "starting" one a reset began from, or the window hides the new code.
        else if (request.method === 'phone:set-enabled') {
          result = await phone.setEnabled(request.args[0]);
          if (request.args[0] === false) { await phone.settled(); await push.clear(); result = phone.status(); }
        }
        else if (request.method === 'phone:reset') { await phone.reset(); await phone.settled(); await push.clear(); result = phone.status(); }
        else if (request.method === 'phone:open-pairing') result = await phone.openPairing();
        else if (request.method === 'push:register') result = await push.register(request.args[0]);
        else if (request.method === 'push:unregister') result = await push.unregister(request.args[0]);
        else if (request.method === 'push:focus') result = push.focus(request.args[0]);
        else if (request.method === 'daemon:snapshot') {
          const snapshot = { ...runtime.snapshot(), eventSeq };
          if (request.args[0]?.paged === true) {
            // Serialize once: all pages describe the same instant and watermark.
            const pages = await capturePages(JSON.stringify(snapshot));
            if (!pages) return;
            result = { snapshotId: pages.pageId, pageCount: pages.pageCount, eventSeq: snapshot.eventSeq };
          } else result = snapshot;
        }
        else if (request.method === 'daemon:snapshot-page' || request.method === 'daemon:result-page') result = resultPages.page(...request.args);
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
        // Only a desktop open (it passes takeNotice) takes the restored-chats notice; the phone's bridge opens without it.
        else if (request.method === 'project:open') result = await runtime.openProject(request.args[0], { takeNotice: request.args[1]?.takeNotice === true });
        else if (request.method === 'project:current' && view.projectPath) result = await runtime.invoke('project:snapshot', [view.projectPath]);
        else result = await runtime.invoke(request.method, request.args, context);
        // An open may finish after its caller disconnects. Dispose that late session as well.
        if (socket.destroyed && /^(simulator|browser):/.test(request.method)) await runtime.disconnect?.(context.clientId);
        if (request.method === 'link:open' && result?.link) view.linkId = result.link.id;
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
      await phone.close();
      await push.close();
      await sender.close();
      await runtime.close();
      // Saved: tell every client this stop was asked for, so a desktop doesn't start the host again (a crash sends nothing).
      broadcast('daemon:stopping', {});
      const stopped = listening ? new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : Promise.resolve();
      for (const socket of sockets) socket.end();
      // Do not let a client that never closes its side keep shutdown alive.
      const timeout = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 1000);
      await stopped;
      clearTimeout(timeout);
    })().catch(error => { stopping = undefined; throw error; });
    return stopping;
  }
  try {
    socketPath = pathFor(dataDir);
    prepareSocketDirectory(socketPath);
    // This host owns the data folder (createRuntime took its lock), so a socket file here is one a crashed host left.
    if (process.platform !== 'win32') await fs.rm(socketPath, { force: true });
    server.listen(socketPath);
    await once(server, 'listening');
    listening = true;
    if (process.platform !== 'win32') await fs.chmod(socketPath, 0o600);
    server.on('error', onError);
    await push.load();
    await phone.start();
    await runtime.resumeRecentProjects();
  } catch (error) {
    await close();
    throw error;
  }
  return { socketPath, close };
}
module.exports = { startDaemon, createResultPages };
