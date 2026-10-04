const nacl = require('tweetnacl');
const { randomBytes } = require('node:crypto');
const { b64url, fromB64url, hostAccept, RelayAuthError } = require('@milagre/shared/relay-crypto');
const { splitBody, MAX_RESPONSE } = require('@milagre/shared/relay-rpc');

const OPEN = 1, DATA = 2, CLOSE = 3;
const ERROR_MARK = 0x04;
const LIVE_ORIGIN = 'milagre-app://phone';
const MAX_LIVE = 8;
const MAX_INFLIGHT = 16;
const REQUEST_TIMEOUT = 120_000;
const DEFAULT_TIMING = { pingMs: 20_000, idleMs: 45_000, backoff: [1000, 2000, 5000, 10_000, 30_000], jitter: true };
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

const tooManyRequests = encoder.encode(JSON.stringify({ v: 1, error: { message: 'Too many requests' } }));
const routeOk = path => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');

/**
 * Keeps the Mac connected to the public relay and serves each phone that comes through it:
 * an encrypted channel per phone, with requests and live sockets forwarded to the loopback bridge.
 */
function startRelayHost({ relayUrl, identity, phones, token, bridgeUrl, canPair, WebSocket = require('ws').WebSocket, fetch: fetchBridge = globalThis.fetch, random = defaultRandom, onStatus, timing }) {
  const { pingMs, idleMs, backoff, jitter } = { ...DEFAULT_TIMING, ...timing };
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
    sendFrame(current, DATA, conn, accepted.reply);
  }

  async function request(current, conn, record, message) {
    const { id } = message;
    const respond = (status, headers, body) => {
      const parts = splitBody(body);
      parts.forEach((chunk, index) => sendMessage(current, conn, record, { t: 'res', id, status, headers, chunk, more: index < parts.length - 1 }));
    };
    if (record.inflight >= MAX_INFLIGHT) return respond(429, { 'content-type': 'application/json' }, tooManyRequests);
    const method = message.method;
    if ((method !== 'GET' && method !== 'POST') || !routeOk(message.path)) return respond(400, {}, new Uint8Array());
    record.inflight += 1;
    try {
      const headers = {};
      for (const [name, value] of Object.entries(message.headers ?? {})) {
        if (typeof value === 'string' && !BLOCKED_HEADERS.has(name.toLowerCase())) headers[name] = value;
      }
      headers.Authorization = `Bearer ${token}`;
      const response = await fetchBridge(bridgeUrl + message.path, { method, headers, body: method === 'POST' ? message.body : undefined, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
      const body = new Uint8Array(await response.arrayBuffer());
      const forwarded = {};
      for (const name of FORWARDED_HEADERS) { const value = response.headers.get(name); if (value !== null) forwarded[name] = value; }
      if (body.length > MAX_RESPONSE) respond(502, { 'content-type': 'application/json' }, encoder.encode(JSON.stringify({ v: 1, error: { message: 'Response too large' } })));
      else respond(response.status, forwarded, body);
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError';
      respond(timedOut ? 504 : 502, { 'content-type': 'application/json' }, encoder.encode(JSON.stringify({ v: 1, error: { message: timedOut ? 'The computer took too long to answer' : 'The computer could not be reached' } })));
    } finally { record.inflight -= 1; }
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
      case 'req': void request(current, conn, record, message); break;
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
    if (type === OPEN) { current.conns.set(conn, { state: 'hello', channel: null, lives: new Map(), inflight: 0 }); return; }
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
    const ws = new WebSocket(`${relayUrl}/v1/host?id=${identity.hostId}`);
    const current = { socket: ws, conns: new Map(), ready: false, lastHeard: Date.now(), timer: null, over: false };
    session = current;

    const finish = () => {
      if (current.over) return;
      current.over = true;
      clearInterval(current.timer);
      for (const conn of [...current.conns.keys()]) dropConn(current, conn, false);
      if (session === current) session = null;
      if (closed) { setStatus('offline'); return; }
      setStatus('offline');
      const base = backoff[Math.min(attempt, backoff.length - 1)];
      attempt += 1;
      const delay = jitter ? base * (0.8 + Math.random() * 0.4) : base;
      retryTimer = setTimeout(connect, delay);
    };

    ws.on('message', (data, isBinary) => {
      current.lastHeard = Date.now();
      if (!current.ready) {
        if (isBinary) return;
        let message;
        try { message = JSON.parse(data.toString()); } catch { return; }
        if (message?.t === 'challenge') {
          const nonce = fromB64url(String(message.nonce));
          ws.send(JSON.stringify({ t: 'proof', key: b64url(identity.sign.publicKey), sig: b64url(nacl.sign.detached(nonce, identity.sign.secretKey)) }));
        } else if (message?.t === 'ready') {
          current.ready = true;
          attempt = 0;
          setStatus('online');
        }
        return;
      }
      if (isBinary) onFrame(current, data);
    });
    ws.on('pong', () => { current.lastHeard = Date.now(); });
    ws.on('close', finish);
    ws.on('error', () => { /* close follows */ });
    ws.on('open', () => {
      current.lastHeard = Date.now();
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
