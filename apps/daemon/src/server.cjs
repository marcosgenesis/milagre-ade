const { isLinkScopeKey, scopeFromKey, scopeKey } = require("@milagre/shared/chat-scopes");
const { diffState } = require("@milagre/shared/state-patch");
const { preparePrivateDirectory } = require("@milagre/core/private-files");
const { prepareToken, validToken, authenticationProof, authenticationNonce, validNonce } = require("./local-auth.cjs");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const { once } = require("node:events");
const { createRuntime } = require("@milagre/core");
const { socketPath: pathFor, prepareSocketDirectory } = require("./paths.cjs");
const { VERSION, MAX_FRAME_BYTES, MAX_PENDING, pageSize, wire } = require("./protocol.cjs");
const { createPhone } = require("./phone.cjs");
const { createMobilePush } = require("./mobile-push.cjs");
const { createExpoPush } = require("./expo-push.cjs");
const { attentionContext } = require("@milagre/shared/attention");
const { projectOfKey, sessionIdFromKey } = require("@milagre/shared/agent-runs");

// Handled here, never by core, and not in the mobile bridge's allow-list: a paired phone must not manage its own access.
const PUSH_METHODS = Object.freeze(["push:register", "push:unregister", "push:focus"]);
const PHONE_METHODS = Object.freeze(["phone:status", "phone:set-enabled", "phone:reset", "phone:open-pairing", "phone:set-lan"]);
// Paired phones and computers, listed and removed from this Mac's own window only (Settings > Devices).
const DEVICE_METHODS = Object.freeze(["devices:list", "devices:remove"]);
// A client that asks for them (daemon:state-patches) gets what changed in a state event, not the whole state; see
// state-patch.mjs. state:read gives it a whole state and its version when it has none or missed one.
const STATE_PATCHES = "state-patches-v1";
// chat:messages, chat:search and daemon:state-patches({ messages: false }): a client can hold only the messages it shows.
const CHAT_PAGES = "chat-pages-v1";
const STATE_METHODS = Object.freeze(["state:read"]);

const PAGES_TTL_MS = 30000;
// What one connection may hold in paged responses at once, in characters. A response larger than that alone is still
// served when nothing else is held; the rest wait for a reader to finish rather than evict a response being read.
const PAGES_BUDGET_CHARS = 64 * 1024 * 1024;
// Their replies are sized to fit a frame already; paging them again would never end.
const PAGE_METHODS = new Set(["daemon:result-page", "daemon:snapshot-page"]);

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
  const fits = (chars) => slots === 0 || (slots < MAX_PENDING && held + chars <= budgetChars);
  const reserve = (chars) => {
    slots++;
    held += chars;
  };
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
    mustWait: (chars) => waiting.length > 0 || !fits(chars),
    /** The page count for `text`, once the connection has room for it; null when the connection closed meanwhile. */
    async capture(text) {
      if (waiting.length || !fits(text.length)) {
        if (waiting.length >= MAX_PENDING)
          throw Object.assign(new Error("Too many large responses are waiting on this connection. Try again."), { code: "PAGES_BUSY" });
        await new Promise((resolve) => waiting.push({ chars: text.length, resolve }));
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
      if (!capture) throw new Error("This paged response expired. Send the request again.");
      if (!Number.isInteger(index) || index !== capture.nextPage || index >= capture.pageCount)
        throw new Error("This page is out of order. Read the pages from the first, or send the request again.");
      const text = capture.text.slice(index * size, (index + 1) * size);
      if (++capture.nextPage === capture.pageCount) release(pageId);
      else arm(pageId, capture);
      return text;
    },
    /** Admitted captures, for tests: slots in use and characters reserved. */
    usage: () => ({ slots, chars: held }),
    clear() {
      closed = true;
      for (const id of [...captures.keys()]) release(id);
      admit();
    },
  };
}

// A state as a client that reads messages by Chat gets it: no messages (one empty array, so no patch ever touches it)
// and `messagesInChats`, the same object for the same state.
const leanStates = new WeakMap();
const NO_MESSAGES = Object.freeze([]);
function withoutMessages(state) {
  if (!state || typeof state !== "object") return state;
  let lean = leanStates.get(state);
  if (!lean) leanStates.set(state, (lean = { ...state, messages: NO_MESSAGES, messagesInChats: true }));
  return lean;
}
/** A reply as a client that reads messages by Chat gets it: every state in it without its messages. */
function leanResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  let lean = result;
  if (result.state && typeof result.state === "object") lean = { ...lean, state: withoutMessages(result.state) };
  for (const key of ["projects", "links"])
    if (Array.isArray(result[key]))
      lean = { ...lean, [key]: result[key].map((item) => (item?.state ? { ...item, state: withoutMessages(item.state) } : item)) };
  return lean;
}
/** The messages `next` has that `previous` didn't (new or changed), each after the message before it in its Chat, and the ids it no longer has. */
function messageChanges(previous = [], next = []) {
  if (previous === next) return { changed: [], removed: [] };
  const before = new Set(previous);
  const changed = next.filter((message) => !before.has(message));
  const ids = new Set(next.map((message) => message.id));
  const removed = previous.filter((message) => !ids.has(message.id)).map((message) => message.id);
  if (!changed.length) return { changed: [], removed };
  const chats = new Map();
  for (const message of next) {
    const list = chats.get(message.session_id);
    if (list) list.push(message);
    else chats.set(message.session_id, [message]);
  }
  return {
    changed: changed.map((message) => {
      const chat = chats.get(message.session_id);
      return { message, after: chat[chat.indexOf(message) - 1]?.id ?? null };
    }),
    removed,
  };
}

/** The Project or Link (scope key) whose state an event carries; null for one without a state. */
function stateScope(channel, payload) {
  if (!payload?.state || typeof payload.state !== "object") return null;
  if (channel === "project:state") return typeof payload.path === "string" ? payload.path : null;
  if (channel === "link:state") return typeof payload.linkId === "string" ? scopeKey({ kind: "link", linkId: payload.linkId }) : null;
  if (channel === "agent:event") return typeof payload.chatId === "string" ? projectOfKey(payload.chatId) : null;
  return null;
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
const hasState = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value) && value.state && typeof value.state === "object");
/** JSON for `value`, with its `state` taken from the cache (written last). */
function encode(value) {
  if (!hasState(value)) return JSON.stringify(value ?? null);
  const { state, ...rest } = value;
  const head = JSON.stringify(rest);
  return `${head === "{}" ? "{" : `${head.slice(0, -1)},`}"state":${encodeState(state).json}}`;
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

async function startDaemon({
  dataDir,
  version,
  runtimeOptions = {},
  phoneOptions = {},
  pushOptions = {},
  maxFrameBytes = MAX_FRAME_BYTES,
  pagesTtlMs,
  pagesBudgetChars,
  requireAuthentication = process.platform === "win32",
  authTimeoutMs = 5000,
  onError = (error) => console.error(error),
}) {
  if (process.platform === "win32") preparePrivateDirectory(dataDir);
  const authenticationToken = requireAuthentication ? prepareToken(dataDir) : null;
  const sockets = new Set();
  let unauthenticated = 0;
  // Anything bigger travels in pages, or (a state in an event) is read in pages by the client.
  const inlineLimit = Math.floor(maxFrameBytes / 4);
  const clients = new Map();
  const views = new Map();
  let eventSeq = 0;
  // Connections that take state patches, and per scope the last state sent and its number. The numbers start again with
  // each host (epoch), so a client that reconnects to a new one reads its states again.
  // Connection -> { messages }: false for a client that reads messages by Chat (chat:messages) and takes states without them.
  const patchClients = new Map();
  const epoch = randomUUID();
  const sentStates = new Map();
  // Per scope, what a snapshot holds besides the state (a Project's path and name, a Link's definition).
  const snapshotRest = new Map();
  let stopping;
  let listening = false;
  const sender = createExpoPush({ ...pushOptions, onError, onInvalid: (token) => push.invalidate(token) });
  const push = createMobilePush({
    dataDir,
    send: sender.send,
    onError,
    context: async (chatId) => {
      const owner = projectOfKey(chatId);
      const project = await runtime.invoke(isLinkScopeKey(owner) ? "link:snapshot" : "project:snapshot", [
        isLinkScopeKey(owner) ? scopeFromKey(owner).linkId : owner,
      ]);
      return attentionContext(project.state, project.link?.name || project.name || require("node:path").basename(project.path), sessionIdFromKey(chatId));
    },
  });
  const runtime = createRuntime({
    ...runtimeOptions,
    dataDir,
    version,
    isChatFocused: (chatId) => [...views.values()].some((view) => view.focused && view.chatId === chatId),
    notifyWaiting(notice) {
      broadcast("notification:waiting", notice);
      runtimeOptions.notifyWaiting?.(notice);
    },
    emit(channel, payload) {
      broadcast(channel, payload);
      runtimeOptions.emit?.(channel, payload);
    },
  });
  function broadcast(channel, payload) {
    if (channel === "agent:event") push.observe(payload.chatId, payload.event);
    const seq = ++eventSeq;
    const patched = statePatch(channel, payload, seq);
    if (!clients.size) return;
    // An event that still doesn't fit is skipped, never the connection. Each form is encoded once, when a client takes it.
    let whole;
    for (const [key, connection] of clients) {
      try {
        const taker = patchClients.get(key);
        const frame = patched && taker ? (taker.messages ? patched.full() : patched.lean()) : (whole ??= eventFrame(channel, payload, seq, inlineLimit));
        connection.send(null, frame.json, frame.bytes);
      } catch (error) {
        onError(new Error(`Milagre couldn't send a ${channel} event: ${error.message}`));
      }
    }
  }
  /**
   * For an event that carries a state: numbers that state, and when a client takes patches, the event with what changed
   * since the last state sent for its scope (`patch`, `base`, `version`) in place of the state. A first state, or a
   * patch too large for an event, says `resync` instead: the client reads the state with state:read.
   */
  function statePatch(channel, payload, seq) {
    const scope = stateScope(channel, payload);
    if (!scope) return null;
    const previous = sentStates.get(scope);
    const version = (previous?.version ?? 0) + 1;
    sentStates.set(scope, { version, state: payload.state });
    if (![...patchClients.keys()].some((key) => clients.has(key))) return null;
    const { state, ...rest } = payload;
    const frame = (body) => eventFrame(channel, body, seq, Infinity);
    const numbered = (patchBody) => {
      if (previous) {
        const patched = frame({ ...rest, ...patchBody(), base: previous.version, version, epoch });
        if (patched.bytes <= inlineLimit) return patched;
      }
      return frame({ ...rest, resync: true, version, epoch });
    };
    // Each form is made once, when a client that takes it is sent the event.
    let full;
    let lean;
    return {
      full: () => (full ??= numbered(() => ({ patch: diffState(previous.state, state) }))),
      // The state without its messages, and the messages this change added, changed or removed, each with the one before
      // it in its Chat (`after`), for a client that holds only some of each Chat's messages.
      lean: () =>
        (lean ??= numbered(() => ({
          patch: diffState(withoutMessages(previous.state), withoutMessages(state)),
          messages: messageChanges(previous.state.messages, state.messages),
        }))),
    };
  }
  /**
   * A scope's state with its number, for a client that takes patches, beside the rest of its snapshot (a Project's path
   * and name, a Link's definition). A newer state than the one sent goes out first.
   */
  async function readState(owner, { messages = true } = {}) {
    if (typeof owner !== "string" || !owner) throw new Error("Choose a Project or Link");
    const link = isLinkScopeKey(owner);
    const answer = (sent) => ({ ...snapshotRest.get(owner), state: messages ? sent.state : withoutMessages(sent.state), version: sent.version, epoch });
    // The last state sent answers at once: a client reading again is waiting with its events held back, and reading the
    // snapshot waits behind whatever the Project or Link is busy with (a shared Chat's Worktrees being prepared). Its
    // next change follows as a patch on it. A client that needs the rest of the snapshot (a name) reads it once.
    const sent = sentStates.get(owner);
    if (sent && (!messages || snapshotRest.has(owner))) return answer(sent);
    const { state, ...rest } = await runtime.invoke(link ? "link:snapshot" : "project:snapshot", [link ? scopeFromKey(owner).linkId : owner]);
    snapshotRest.set(owner, rest);
    if (sentStates.get(owner)?.state !== state)
      broadcast(link ? "link:state" : "project:state", link ? { linkId: scopeFromKey(owner).linkId, state } : { path: owner, state });
    return answer(sentStates.get(owner));
  }
  // Its bridge connects to this daemon's socket as a client, so it only starts once the socket listens.
  // A first pairing is announced to the desktop, which tells the owner in case it was not them.
  const phone = createPhone({
    dataDir,
    onChange: (status) => broadcast("phone:status", status),
    onPaired: (info) => broadcast("phone:paired", info),
    ...phoneOptions,
  });
  /**
   * One client of the daemon, whatever carries its frames: the Unix socket below, and (PR 2) a paired desktop's channel.
   * The carrier supplies `send(message, json, bytes)`, which writes one frame as wire()'s send does (it may throw
   * FRAME_TOO_LARGE, and returns false once closed); `end()`, which closes after what is queued; `destroy()`, which
   * closes now; and `isClosed()`. `requireAuthentication`: the first requests must be the daemon:authenticate handshake
   * (the socket on Windows). `policy.denies(method)` refuses a method before it runs and leaves it out of daemon:status;
   * the socket has none. The carrier hands the result each parsed request (`receive`), a framing error (`invalid`) and,
   * once, its own close (`close`).
   */
  function acceptConnection({ send, end, destroy, isClosed, requireAuthentication: mustAuthenticate = false, policy = null }) {
    if (mustAuthenticate && !authenticationToken) throw new Error("requireAuthentication needs a daemon that has an authentication token");
    let authenticated = !mustAuthenticate;
    let challenge;
    let authenticationRejected = false;
    let closed = false;
    if (!authenticated) unauthenticated++;
    const authenticationTimeout = authenticated ? null : setTimeout(destroy, authTimeoutMs);
    authenticationTimeout?.unref();
    const inflight = new Set();
    // Requests whose reply waits for paging room: they don't hold a MAX_PENDING slot, so a reader's page reads get through.
    const awaitingPages = new Set();
    // Result pages and paged snapshots share one store and its rules.
    const resultPages = createResultPages(maxFrameBytes, { ttlMs: pagesTtlMs, budgetChars: pagesBudgetChars });
    const view = { focused: false, projectPath: null, chatId: null };
    // Never accept an actor supplied in RPC arguments. Each authenticated connection owns its viewer capabilities.
    const context = Object.freeze({ clientId: randomUUID() });
    // This connection in clients, views and patchClients.
    const key = Symbol("connection");
    const connection = { send };
    if (authenticated) {
      clients.set(key, connection);
      views.set(key, view);
    }
    async function dispatch(request) {
      const validId = Number.isSafeInteger(request?.id) || (typeof request?.id === "string" && request.id.length <= 128);
      const id = validId ? request.id : null;
      function fail(code, message) {
        connection.send({ v: VERSION, id, error: { code, message } });
      }
      if (authenticationRejected) return;
      if (!authenticated) {
        const supplied = request?.args?.[0];
        const valid = request?.v === VERSION && validId && request.method === "daemon:authenticate" && Array.isArray(request.args) && request.args.length === 1;
        if (valid && !challenge && validNonce(supplied?.clientNonce)) {
          challenge = { clientNonce: supplied.clientNonce, serverNonce: authenticationNonce() };
          connection.send({
            v: VERSION,
            id,
            result: {
              serverNonce: challenge.serverNonce,
              proof: authenticationProof(authenticationToken, "server", challenge.clientNonce, challenge.serverNonce),
            },
          });
          return;
        }
        if (
          !valid ||
          !challenge ||
          !validToken(authenticationProof(authenticationToken, "client", challenge.clientNonce, challenge.serverNonce), supplied?.proof)
        ) {
          authenticationRejected = true;
          fail("UNAUTHORIZED", "Local daemon authentication is required");
          end();
          return;
        }
        if (closed) return;
        authenticated = true;
        unauthenticated--;
        clearTimeout(authenticationTimeout);
        clients.set(key, connection);
        views.set(key, view);
        connection.send({ v: VERSION, id, result: { authenticated: true } });
        return;
      }
      if (request?.v !== VERSION) {
        fail("VERSION_MISMATCH", `Local protocol version ${VERSION} is required`);
        return;
      }
      if (!validId || typeof request.method !== "string" || request.method.length > 128 || !Array.isArray(request.args)) {
        fail("INVALID_REQUEST", "Expected id, method and an args array");
        return;
      }
      if (stopping) {
        fail("CLOSING", "The daemon is closing");
        return;
      }
      if (policy?.denies(request.method)) {
        fail("NOT_AVAILABLE_REMOTELY", "Not available on a remote computer");
        return;
      }
      if (inflight.has(id) || inflight.size - awaitingPages.size >= MAX_PENDING) {
        fail("TOO_MANY_REQUESTS", "Request ID is in use or too many requests are pending");
        end();
        return;
      }
      inflight.add(id);
      async function capturePages(text) {
        if (resultPages.mustWait(text.length)) awaitingPages.add(id);
        try {
          return await resultPages.capture(text);
        } finally {
          awaitingPages.delete(id);
        }
      }
      // Serialised once. A client that reads pages (`pages: true`) gets anything over a quarter of a frame as a page
      // count; one that can't gets it whole up to the frame limit, and a clear FRAME_TOO_LARGE error past it.
      async function reply(result) {
        const resultJson = encode(patchClients.get(key)?.messages === false ? leanResult(result) : result);
        if (request.pages === true && !PAGE_METHODS.has(request.method) && resultJson.length > inlineLimit) {
          const pages = await capturePages(resultJson);
          if (pages) connection.send({ v: VERSION, id, pages });
          return;
        }
        connection.send(null, `{"v":${VERSION},"id":${JSON.stringify(id)},"result":${resultJson}}`);
      }
      try {
        let result;
        if (request.method === "daemon:status")
          result = {
            pid: process.pid,
            version,
            protocolVersion: VERSION,
            dataDir,
            socketPath,
            capabilities: ["desktop-v1", "snapshot-pages-v1", "result-pages-v1", "mobile-push-v1", STATE_PATCHES, CHAT_PAGES],
            methods: [...runtime.methods, ...PHONE_METHODS, ...DEVICE_METHODS, ...PUSH_METHODS, ...STATE_METHODS].filter((method) => !policy?.denies(method)),
          };
        else if (request.method === "phone:status") result = phone.status();
        // Settings shows the reply, which arrives after the status events: answer with the settled status, not the
        // "starting" one a reset began from, or the window hides the new code.
        else if (request.method === "phone:set-enabled") {
          result = await phone.setEnabled(request.args[0]);
          if (request.args[0] === false) {
            await phone.settled();
            await push.clear();
            result = phone.status();
          }
        } else if (request.method === "phone:reset") {
          await phone.reset();
          await phone.settled();
          await push.clear();
          result = phone.status();
        } else if (request.method === "phone:open-pairing") result = await phone.openPairing();
        else if (request.method === "phone:set-lan") result = await phone.setLan(request.args[0]);
        else if (request.method === "devices:list") result = await phone.devices();
        else if (request.method === "devices:remove") result = await phone.removeDevice(request.args[0]);
        else if (request.method === "push:register") result = await push.register(request.args[0]);
        else if (request.method === "push:unregister") result = await push.unregister(request.args[0]);
        else if (request.method === "push:focus") result = push.focus(request.args[0]);
        else if (request.method === "daemon:snapshot") {
          const whole = runtime.snapshot();
          const snapshot = { ...(patchClients.get(key)?.messages === false ? leanResult(whole) : whole), eventSeq };
          if (request.args[0]?.paged === true) {
            // Serialize once: all pages describe the same instant and watermark.
            const pages = await capturePages(JSON.stringify(snapshot));
            if (!pages) return;
            result = { snapshotId: pages.pageId, pageCount: pages.pageCount, eventSeq: snapshot.eventSeq };
          } else result = snapshot;
        } else if (request.method === "daemon:snapshot-page" || request.method === "daemon:result-page") result = resultPages.page(...request.args);
        else if (request.method === "daemon:flush") result = await runtime.flush();
        else if (request.method === "daemon:state-patches") {
          if (!closed) patchClients.set(key, { messages: request.args[0]?.messages !== false });
          result = { epoch };
        } else if (request.method === "state:read") result = await readState(request.args[0], { messages: patchClients.get(key)?.messages !== false });
        else if (request.method === "daemon:focus") {
          const next = request.args[0];
          if (!next || typeof next.focused !== "boolean") throw new Error("Expected a focused boolean");
          view.focused = next.focused;
          if (view.focused) await runtime.focused(view);
        } else if (request.method === "chat:set-open") {
          view.chatId = typeof request.args[0] === "string" ? request.args[0] : null;
          await runtime.focused(view);
        } else if (request.method === "daemon:stop") {
          await runtime.close();
          result = { stopping: true };
        }
        // Only a desktop open (it passes takeNotice) takes the restored-chats notice; the phone's bridge opens without it.
        else if (request.method === "project:open") result = await runtime.openProject(request.args[0], { takeNotice: request.args[1]?.takeNotice === true });
        else if (request.method === "project:current" && view.projectPath) result = await runtime.invoke("project:snapshot", [view.projectPath]);
        else result = await runtime.invoke(request.method, request.args, context);
        // An open may finish after its caller disconnects. Dispose that late session as well.
        if (isClosed() && /^(simulator|browser):/.test(request.method)) await runtime.disconnect?.(context.clientId);
        if (request.method === "link:open" && result?.link) view.linkId = result.link.id;
        if (["project:open", "project:current", "project:switch"].includes(request.method) && result?.path) view.projectPath = result.path;
        await reply(result ?? null);
        if (request.method === "daemon:stop") void close().catch(onError);
      } catch (error) {
        fail(typeof error.code === "string" ? error.code : "COMMAND_FAILED", error.message);
      } finally {
        inflight.delete(id);
      }
    }
    return {
      receive(request) {
        if (closed) return;
        void dispatch(request).catch((error) => {
          onError(error);
          destroy();
        });
      },
      invalid(error) {
        connection.send({ v: VERSION, id: null, error: { code: error.code, message: error.message } });
        end();
      },
      close() {
        if (closed) return;
        closed = true;
        resultPages.clear();
        clearTimeout(authenticationTimeout);
        if (!authenticated) unauthenticated--;
        clients.delete(key);
        views.delete(key);
        patchClients.delete(key);
        Promise.resolve(runtime.disconnect?.(context.clientId)).catch(onError);
      },
    };
  }

  const server = net.createServer((socket) => {
    if (stopping || (requireAuthentication && unauthenticated >= 32)) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    let framed;
    const client = acceptConnection({
      send: (message, json, bytes) => framed.send(message, json, bytes),
      end: () => socket.end(),
      destroy: () => socket.destroy(),
      isClosed: () => socket.destroyed,
      requireAuthentication,
    });
    framed = wire(socket, { maxFrameBytes, onInvalid: (error) => client.invalid(error), onMessage: (request) => client.receive(request) });
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      client.close();
    });
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
      broadcast("daemon:stopping", {});
      const stopped = listening ? new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))) : Promise.resolve();
      for (const socket of sockets) socket.end();
      // Do not let a client that never closes its side keep shutdown alive.
      const timeout = setTimeout(() => {
        for (const socket of sockets) socket.destroy();
      }, 1000);
      await stopped;
      clearTimeout(timeout);
    })().catch((error) => {
      stopping = undefined;
      throw error;
    });
    return stopping;
  }
  try {
    socketPath = pathFor(dataDir);
    prepareSocketDirectory(socketPath);
    // This host owns the data folder (createRuntime took its lock), so a socket file here is one a crashed host left.
    if (process.platform !== "win32") await fs.rm(socketPath, { force: true });
    server.listen(socketPath);
    await once(server, "listening");
    listening = true;
    if (process.platform !== "win32") await fs.chmod(socketPath, 0o600);
    server.on("error", onError);
    await push.load();
    await phone.start();
    await runtime.resumeRecentProjects();
  } catch (error) {
    await close();
    throw error;
  }
  return { socketPath, close, acceptConnection };
}
module.exports = { startDaemon, createResultPages };
