const nacl = require('tweetnacl');
const { randomBytes } = require('node:crypto');
const { b64url, fromB64url, hostAccept, RelayAuthError } = require('@milagre/shared/relay-crypto');
const { splitBody, createAssembler, MAX_RESPONSE } = require('@milagre/shared/relay-rpc');

const OPEN = 1, DATA = 2, CLOSE = 3;
const ERROR_MARK = 0x04;
const LIVE_ORIGIN = 'milagre-app://phone';
const MAX_LIVE = 8;
const MAX_INFLIGHT = 16;
const MAX_UPLOAD = 8 * 1024 * 1024;
// Longer than the phone's own deadline for the slowest call (worktree:create, 330 s), so the phone gives up first.
const REQUEST_TIMEOUT = 340_000;
// helloMs: a phone connection that has not finished its hello by then is closed, so idle sockets cannot fill the room.
// replacedMs: the wait after the relay closes a ready session as replaced (4409): another Mac holds the same identity
// (say, after Migration Assistant), and redialing on the short backoff would have the two knock each other off every second.
// stableMs: how long a session must stay up before the backoff starts over, so a relay that drops us right after
// ready still backs off.
const DEFAULT_TIMING = { pingMs: 20_000, idleMs: 45_000, helloMs: 15_000, backoff: [1000, 2000, 5000, 10_000, 30_000], replacedMs: 60_000, stableMs: 30_000, jitter: true };
const REPLACED = 4409;
// What the phone may set. Origin and Host belong to the bridge's own checks, and Authorization is ours.
const BLOCKED_HEADERS = new Set(['host', 'origin', 'authorization', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'cookie']);
const FORWARDED_HEADERS = ['content-type', 'etag'];
const encoder = new TextEncoder();
const defaultRandom = n => new Uint8Array(randomBytes(n));

function frame(type, conn, payload = new Uint8Array()) {
  const out = new Uint8Array(9 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setBigUint64(1, conn);
  out.set(payload, 9);
  return out;
}

const tooLarge = encoder.encode(JSON.stringify({ v: 1, error: { message: 'Upload too large' } }));
const tooManyRequests = encoder.encode(JSON.stringify({ v: 1, error: { message: 'Too many requests' } }));
const routeOk = path => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');

/**
 * Keeps the Mac connected to the public relay and serves each phone that comes through it:
 * an encrypted channel per phone, with requests and live sockets forwarded to the loopback bridge.
 */
function startRelayHost({ relayUrl, identity, phones, token, bridgeUrl, canPair, WebSocket = require('ws').WebSocket, fetch: fetchBridge = globalThis.fetch, random = defaultRandom, onStatus, timing }) {
  const { pingMs, idleMs, helloMs, backoff, replacedMs, stableMs, jitter } = { ...DEFAULT_TIMING, ...timing };
  let status = 'connecting';
  let closed = false;
  let attempt = 0;
  let retryTimer = null;
  let session = null; // the live relay socket and its phone connections

  const setStatus = next => { if (status === next) return; status = next; try { onStatus?.(next); } catch { /* a listener must not break the host */ } };

  function sendRaw(current, bytes) {
    if (current.socket.readyState === WebSocket.OPEN) current.socket.send(bytes);
  }
  const sendFrame = (current, type, conn, payload) => sendRaw(current, frame(type, conn, payload));
  function sendMessage(current, conn, record, message) {
    if (current.conns.get(conn) !== record || !record.channel) return;
    sendFrame(current, DATA, conn, record.channel.seal(message));
  }

  function closeLives(record) {
    for (const live of record.lives.values()) { try { live.close(1001); } catch { /* already closed */ } }
    record.lives.clear();
  }
  /** Forgets one phone connection. `notify` tells the relay so the phone's socket closes too. */
  function dropConn(current, conn, notify) {
    const record = current.conns.get(conn);
    if (!record) return;
    current.conns.delete(conn);
    clearTimeout(record.helloTimer);
    closeLives(record);
    if (notify) sendFrame(current, CLOSE, conn);
  }

  function refuse(current, conn, code) {
    sendFrame(current, DATA, conn, new Uint8Array([ERROR_MARK, ...encoder.encode(JSON.stringify({ t: 'error', code }))]));
    dropConn(current, conn, true);
  }

  async function hello(current, conn, record, bytes) {
    record.state = 'accepting';
    let accepted;
    try {
      accepted = hostAccept({ host: identity.box, hello: bytes, isKnown: id => phones.isKnown(id), canPair: !!canPair(), token, random });
    } catch (error) {
      if (error instanceof RelayAuthError) return refuse(current, conn, error.code);
      return refuse(current, conn, 'bad-hello');
    }
    if (accepted.firstPairing) {
      try { await phones.add(accepted.phoneKey); } catch { return dropConn(current, conn, true); }
    }
    if (current.conns.get(conn) !== record) return;
    record.channel = accepted.channel;
    record.state = 'open';
    clearTimeout(record.helloTimer);
    sendFrame(current, DATA, conn, accepted.reply);
  }

  /** Sends a whole response as `res` parts. */
  function respond(current, conn, record, id, status, headers, body) {
    const parts = splitBody(body);
    parts.forEach((chunk, index) => sendMessage(current, conn, record, { t: 'res', id, status, headers, chunk, more: index < parts.length - 1 }));
  }
  const JSON_HEADERS = { 'content-type': 'application/json' };

  async function forward(current, conn, record, { id, method, path, headers: phoneHeaders }, body) {
    record.inflight += 1;
    try {
      const headers = {};
      for (const [name, value] of Object.entries(phoneHeaders ?? {})) {
        if (typeof value === 'string' && !BLOCKED_HEADERS.has(name.toLowerCase())) headers[name] = value;
      }
      headers.Authorization = `Bearer ${token}`;
      const response = await fetchBridge(bridgeUrl + path, { method, headers, body: method === 'POST' && body.length ? body : undefined, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const forwarded = {};
      for (const name of FORWARDED_HEADERS) { const value = response.headers.get(name); if (value !== null) forwarded[name] = value; }
      if (bytes.length > MAX_RESPONSE) respond(current, conn, record, id, 502, JSON_HEADERS, encoder.encode(JSON.stringify({ v: 1, error: { message: 'Response too large' } })));
      else respond(current, conn, record, id, response.status, forwarded, bytes);
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError';
      respond(current, conn, record, id, timedOut ? 504 : 502, JSON_HEADERS, encoder.encode(JSON.stringify({ v: 1, error: { message: timedOut ? 'The computer took too long to answer' : 'The computer could not be reached' } })));
    } finally { record.inflight -= 1; }
  }

  /**
   * One part of a request. The first part carries the method, path and headers; the body arrives as
   * base64 chunks, reassembled here and capped at MAX_UPLOAD. Throws on a malformed part: the caller closes the connection.
   */
  function requestPart(current, conn, record, message) {
    const { id } = message;
    if (!Number.isSafeInteger(id) || typeof message.chunk !== 'string' || typeof message.more !== 'boolean') throw new Error('Bad request part');
    if (record.rejected.has(id)) { if (!message.more) record.rejected.delete(id); return; }
    let upload = record.uploads.get(id);
    if (!upload) {
      if (record.inflight + record.uploads.size >= MAX_INFLIGHT) return refuseRequest(current, conn, record, message, 429, tooManyRequests);
      if ((message.method !== 'GET' && message.method !== 'POST') || !routeOk(message.path)) return refuseRequest(current, conn, record, message, 400, new Uint8Array());
      upload = { size: 0, meta: { id, method: message.method, path: message.path, headers: message.headers } };
      record.uploads.set(id, upload);
    }
    upload.size += Math.floor(message.chunk.length * 3 / 4);
    if (upload.size > MAX_UPLOAD) {
      record.assembler.drop(id);
      record.uploads.delete(id);
      return refuseRequest(current, conn, record, message, 413, tooLarge);
    }
    let result;
    try { result = record.assembler.add({ t: 'res', id, status: 0, headers: {}, chunk: message.chunk, more: message.more }); } catch (error) { record.assembler.drop(id); record.uploads.delete(id); throw error; }
    if (!result.done) return;
    record.uploads.delete(id);
    void forward(current, conn, record, upload.meta, result.body);
  }

  /** Answers a request without forwarding it; the rest of its parts are skipped. */
  function refuseRequest(current, conn, record, message, status, body) {
    if (message.more) {
      if (record.rejected.size >= 64) throw new Error('Too many abandoned uploads');
      record.rejected.add(message.id);
    }
    respond(current, conn, record, message.id, status, JSON_HEADERS, body);
  }

  function liveOpen(current, conn, record, message) {
    const { id } = message;
    const refuseLive = code => sendMessage(current, conn, record, { t: 'live-close', id, code });
    if (!Number.isSafeInteger(id) || record.lives.has(id) || !routeOk(message.path)) return refuseLive(1008);
    if (record.lives.size >= MAX_LIVE) return refuseLive(1013);
    const live = new WebSocket(bridgeUrl.replace(/^http/, 'ws') + message.path, { headers: { Authorization: `Bearer ${token}`, Origin: LIVE_ORIGIN } });
    record.lives.set(id, live);
    live.on('message', data => { if (record.lives.get(id) === live) sendMessage(current, conn, record, { t: 'live', id, data: data.toString() }); });
    const ended = code => {
      if (record.lives.get(id) !== live) return;
      record.lives.delete(id);
      sendMessage(current, conn, record, { t: 'live-close', id, code });
    };
    live.on('close', code => ended(code));
    live.on('error', () => ended(1011)); // ws emits close after error; the first one wins
  }

  function handleMessage(current, conn, record, message) {
    if (!message || typeof message !== 'object') throw new Error('Not a message');
    switch (message.t) {
      case 'req': requestPart(current, conn, record, message); break;
      case 'live-open': liveOpen(current, conn, record, message); break;
      case 'live': {
        const live = record.lives.get(message.id);
        if (live && live.readyState === WebSocket.OPEN && typeof message.data === 'string') live.send(message.data);
        break;
      }
      case 'live-close': {
        const live = record.lives.get(message.id);
        if (live) { record.lives.delete(message.id); live.close(1000); }
        break;
      }
      case 'ping': sendMessage(current, conn, record, { t: 'pong' }); break;
      default: throw new Error('Unknown message');
    }
  }

  function onFrame(current, data) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (bytes.length < 9) return;
    const type = bytes[0];
    const conn = new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(1);
    const payload = bytes.subarray(9);
    if (type === OPEN) {
      const record = { state: 'hello', channel: null, lives: new Map(), inflight: 0, uploads: new Map(), rejected: new Set(), assembler: createAssembler(), helloTimer: null };
      current.conns.set(conn, record);
      record.helloTimer = setTimeout(() => { if (current.conns.get(conn) === record && record.state !== 'open') dropConn(current, conn, true); }, helloMs);
      return;
    }
    if (type === CLOSE) { dropConn(current, conn, false); return; }
    if (type !== DATA) return;
    const record = current.conns.get(conn);
    if (!record) return;
    if (record.state === 'hello') { void hello(current, conn, record, payload); return; }
    if (record.state !== 'open') return dropConn(current, conn, true);
    try { handleMessage(current, conn, record, record.channel.open(payload)); } catch { dropConn(current, conn, true); }
  }

  function connect() {
    if (closed) return;
    setStatus('connecting');
    const ws = new WebSocket(`${relayUrl}/v1/host?id=${identity.hostId}`, { handshakeTimeout: idleMs });
    const current = { socket: ws, conns: new Map(), ready: false, lastHeard: Date.now(), timer: null, readyTimer: null, stableTimer: null, over: false };
    session = current;

    const finish = code => {
      if (current.over) return;
      current.over = true;
      clearInterval(current.timer);
      clearTimeout(current.readyTimer);
      clearTimeout(current.stableTimer);
      for (const conn of [...current.conns.keys()]) dropConn(current, conn, false);
      if (session === current) session = null;
      if (closed) { setStatus('offline'); return; }
      setStatus('offline');
      let delay;
      // Only a proven host being replaced means a twin Mac: replacing a pending socket takes no key, so anyone
      // who knows the hostId could otherwise keep this Mac offline for a minute at a time.
      if (code === REPLACED && current.ready) {
        // The usual 40% jitter spread, laid above replacedMs so the wait is never shorter than it.
        delay = jitter ? replacedMs * (1 + Math.random() * 0.4) : replacedMs;
      } else {
        const base = backoff[Math.min(attempt, backoff.length - 1)];
        delay = jitter ? base * (0.8 + Math.random() * 0.4) : base;
      }
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    };

    ws.on('message', (data, isBinary) => {
      // ws does not catch listener errors, and nothing a relay sends may take the daemon down.
      try {
        current.lastHeard = Date.now();
        if (current.ready) { if (isBinary) onFrame(current, data); return; }
        if (isBinary) return;
        const message = JSON.parse(data.toString());
        if (message?.t === 'challenge') {
          const nonce = fromB64url(String(message.nonce));
          if (nonce.length !== 32) throw new Error('Bad challenge');
          ws.send(JSON.stringify({ t: 'proof', key: b64url(identity.sign.publicKey), sig: b64url(nacl.sign.detached(nonce, identity.sign.secretKey)) }));
        } else if (message?.t === 'ready') {
          current.ready = true;
          clearTimeout(current.readyTimer);
          current.stableTimer = setTimeout(() => { attempt = 0; }, stableMs);
          setStatus('online');
        }
      } catch { ws.terminate(); }
    });
    ws.on('pong', () => { current.lastHeard = Date.now(); });
    ws.on('close', code => finish(code));
    ws.on('error', () => { /* close follows */ });
    ws.on('open', () => {
      current.lastHeard = Date.now();
      current.readyTimer = setTimeout(() => { if (!current.ready) ws.terminate(); }, idleMs);
      current.timer = setInterval(() => {
        if (Date.now() - current.lastHeard > idleMs) { ws.terminate(); finish(); return; }
        try { ws.ping(); } catch { /* closing */ }
      }, pingMs);
    });
  }

  connect();

  return {
    status: () => status,
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(retryTimer);
      const current = session;
      if (!current) { setStatus('offline'); return; }
      const ended = new Promise(resolve => current.socket.once('close', resolve));
      for (const conn of [...current.conns.keys()]) dropConn(current, conn, false);
      if (current.socket.readyState === WebSocket.CONNECTING) current.socket.terminate();
      else current.socket.close(1000);
      const timer = setTimeout(() => current.socket.terminate(), 2000);
      await ended;
      clearTimeout(timer);
    },
  };
}

module.exports = { startRelayHost };
