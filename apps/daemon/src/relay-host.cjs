const nacl = require("tweetnacl");
const { randomBytes } = require("node:crypto");
const { b64url, fromB64url } = require("@milagre/shared/relay-crypto");
const { createPhoneChannels } = require("./phone-channels.cjs");

// helloMs: a phone connection that has not finished its hello by then is closed, so idle sockets cannot fill the room.
// replacedMs: the wait after the relay closes a ready session as replaced (4409): another Mac holds the same identity
// (say, after Migration Assistant), and redialing on the short backoff would have the two knock each other off every second.
// stableMs: how long a session must stay up before the backoff starts over, so a relay that drops us right after
// ready still backs off.
const DEFAULT_TIMING = {
  pingMs: 20_000,
  idleMs: 45_000,
  helloMs: 15_000,
  backoff: [1000, 2000, 5000, 10_000, 30_000],
  replacedMs: 60_000,
  stableMs: 30_000,
  jitter: true,
};
const REPLACED = 4409;
const defaultRandom = (n) => new Uint8Array(randomBytes(n));

/**
 * Keeps the Mac connected to the public relay and serves each phone that comes through it:
 * an encrypted channel per phone, with requests and live sockets forwarded to the loopback bridge.
 * `retired`: the identity is one Reset replaced. It holds the old room only to turn every phone away with
 * `{ code: 'bad-token', reason: 'reset' }`; it needs only `identity.hostId` and `identity.sign`. Apps that predate
 * `reason` still read it as an older code and say to scan again.
 */
function startRelayHost({
  relayUrl,
  identity,
  phones,
  token,
  bridgeUrl,
  canPair,
  retired = false,
  WebSocket = require("ws").WebSocket,
  fetch: fetchBridge = globalThis.fetch,
  random = defaultRandom,
  onStatus,
  timing,
  openPeer,
}) {
  const { pingMs, idleMs, helloMs, backoff, replacedMs, stableMs, jitter } = { ...DEFAULT_TIMING, ...timing };
  const channels = createPhoneChannels({ identity, phones, token, bridgeUrl, canPair, retired, WebSocket, fetch: fetchBridge, random, helloMs, openPeer });
  let status = "connecting";
  let closed = false;
  let attempt = 0;
  let retryTimer = null;
  let session = null; // the live relay socket and its phone connections

  const setStatus = (next) => {
    if (status === next) return;
    status = next;
    try {
      onStatus?.(next);
    } catch {
      /* a listener must not break the host */
    }
  };

  function sendRaw(current, bytes) {
    if (current.socket.readyState === WebSocket.OPEN) current.socket.send(bytes);
  }

  function connect() {
    if (closed) return;
    setStatus("connecting");
    const ws = new WebSocket(`${relayUrl}/v1/host?id=${identity.hostId}`, { handshakeTimeout: idleMs });
    const current = { socket: ws, conns: new Map(), ready: false, lastHeard: Date.now(), timer: null, readyTimer: null, stableTimer: null, over: false };
    current.send = (bytes) => sendRaw(current, bytes);
    // Every channel shares this socket, so a desktop that stops reading is measured by what it holds in all.
    current.queued = () => current.socket.bufferedAmount;
    session = current;

    const finish = (code) => {
      if (current.over) return;
      current.over = true;
      clearInterval(current.timer);
      clearTimeout(current.readyTimer);
      clearTimeout(current.stableTimer);
      for (const conn of [...current.conns.keys()]) channels.dropConn(current, conn, false);
      if (session === current) session = null;
      if (closed) {
        setStatus("offline");
        return;
      }
      setStatus("offline");
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

    ws.on("message", (data, isBinary) => {
      // ws does not catch listener errors, and nothing a relay sends may take the daemon down.
      try {
        current.lastHeard = Date.now();
        if (current.ready) {
          if (isBinary) channels.onFrame(current, data);
          return;
        }
        if (isBinary) return;
        const message = JSON.parse(data.toString());
        if (message?.t === "challenge") {
          const nonce = fromB64url(String(message.nonce));
          if (nonce.length !== 32) throw new Error("Bad challenge");
          ws.send(JSON.stringify({ t: "proof", key: b64url(identity.sign.publicKey), sig: b64url(nacl.sign.detached(nonce, identity.sign.secretKey)) }));
        } else if (message?.t === "ready") {
          current.ready = true;
          clearTimeout(current.readyTimer);
          current.stableTimer = setTimeout(() => {
            attempt = 0;
          }, stableMs);
          setStatus("online");
        }
      } catch {
        ws.terminate();
      }
    });
    ws.on("pong", () => {
      current.lastHeard = Date.now();
    });
    ws.on("close", (code) => finish(code));
    ws.on("error", () => {
      /* close follows */
    });
    ws.on("open", () => {
      current.lastHeard = Date.now();
      current.readyTimer = setTimeout(() => {
        if (!current.ready) ws.terminate();
      }, idleMs);
      current.timer = setInterval(() => {
        if (Date.now() - current.lastHeard > idleMs) {
          ws.terminate();
          finish();
          return;
        }
        try {
          ws.ping();
        } catch {
          /* closing */
        }
      }, pingMs);
    });
  }

  connect();

  return {
    status: () => status,
    /** Keys of the devices with a channel open through the relay now. */
    connectedKeys: () => (session ? channels.keysOf(session) : []),
    /** Closes every channel the device with `key` has open through the relay. */
    drop(key) {
      if (session) channels.dropKey(session, key);
    },
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(retryTimer);
      const current = session;
      if (!current) {
        setStatus("offline");
        return;
      }
      const ended = new Promise((resolve) => current.socket.once("close", resolve));
      for (const conn of [...current.conns.keys()]) channels.dropConn(current, conn, false);
      if (current.socket.readyState === WebSocket.CONNECTING) current.socket.terminate();
      else current.socket.close(1000);
      const timer = setTimeout(() => current.socket.terminate(), 2000);
      await ended;
      clearTimeout(timer);
    },
  };
}

module.exports = { startRelayHost };
