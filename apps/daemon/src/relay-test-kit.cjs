const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { WebSocket, WebSocketServer } = require("ws");
const { boxKeyPair, phoneHello, phoneFinish } = require("@milagre/shared/relay-crypto");
const { splitBody, createAssembler } = require("@milagre/shared/relay-rpc");

const random = (n) => new Uint8Array(randomBytes(n));
const TOKEN = "a".repeat(64);
const LIVE_ORIGIN = "milagre-app://phone";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

async function until(check, label = "condition", ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`);
    await sleep(10);
  }
}

/** What the Mac's loopback bridge looks like to the relay host. */
async function startFakeBridge(t) {
  const seen = { requests: [], liveHeaders: [], liveOpen: 0, uploads: [] };
  const held = [];
  const authorized = (request) => request.headers.authorization === `Bearer ${TOKEN}`;
  const server = http.createServer((request, response) => {
    seen.requests.push({
      method: request.method,
      url: request.url,
      origin: request.headers.origin,
      host: request.headers.host,
      authorization: request.headers.authorization,
    });
    if (!authorized(request)) {
      response.writeHead(401).end();
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === "/rpc") {
        seen.lastBody = Buffer.concat(chunks).toString();
        response.writeHead(200, { "content-type": "application/json", etag: '"abc"', "x-secret": "no", "set-cookie": "a=b" });
        response.end(JSON.stringify({ v: 1, result: "pong" }));
      } else if (request.url === "/attachments") {
        const body = Buffer.concat(chunks);
        seen.uploads.push({ body, type: request.headers["content-type"] });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ v: 1, result: { size: body.length } }));
      } else if (request.url === "/media") {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(Buffer.alloc(600_000, 7));
      } else if (request.url === "/slow") {
        held.push(() => {
          response.writeHead(200, { "content-type": "text/plain" });
          response.end("late");
        });
      } else response.writeHead(404).end();
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  const lives = [];
  server.on("upgrade", (request, socket, head) => {
    seen.liveHeaders.push({ authorization: request.headers.authorization, origin: request.headers.origin, url: request.url });
    if (!authorized(request) || request.headers.origin !== LIVE_ORIGIN) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      seen.liveOpen += 1;
      lives.push(ws);
      ws.send(JSON.stringify({ v: 1, hello: seen.liveOpen }));
      ws.on("message", (data) => ws.send(`echo:${data}`));
    });
  });
  const port = await listen(server);
  t.after(() => {
    for (const client of wss.clients) client.terminate();
    server.closeAllConnections();
    server.close();
  });
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    lives,
    waiting: () => held.length,
    release: () => {
      while (held.length) held.shift()();
    },
  };
}

/** A phone speaking the encrypted protocol over a raw relay socket. */
function connectPhone({ relayUrl, identity, token = TOKEN, key = boxKeyPair(random), name, kind }) {
  const ws = new WebSocket(`${relayUrl}/v1/phone?id=${identity.hostId}`);
  const inbox = [];
  const waiters = [];
  const closed = new Promise((resolve) => ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })));
  ws.on("message", (data) => {
    const bytes = new Uint8Array(data);
    const waiter = waiters.shift();
    if (waiter) waiter(bytes);
    else inbox.push(bytes);
  });
  const nextRaw = (ms = 5000) =>
    new Promise((resolve, reject) => {
      if (inbox.length) return resolve(inbox.shift());
      const timer = setTimeout(() => reject(new Error("Timed out waiting for a frame")), ms);
      waiters.push((bytes) => {
        clearTimeout(timer);
        resolve(bytes);
      });
    });
  const phone = {
    ws,
    key,
    closed,
    nextRaw,
    channel: null,
    opened: new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    }),
    /** Resolves with the channel, or with { error } when the Mac refused the hello. */
    async hello() {
      await phone.opened;
      const { message, ephemeral } = phoneHello({ phone: key, host: identity.box.publicKey, token, random, name, kind });
      ws.send(message);
      const reply = await nextRaw();
      if (reply[0] === 0x04) return { error: JSON.parse(new TextDecoder().decode(reply.subarray(1))) };
      phone.channel = phoneFinish({ ephemeral, phone: key, host: identity.box.publicKey, reply });
      return { channel: phone.channel };
    },
    send(message) {
      ws.send(phone.channel.seal(message));
    },
    async next(ms) {
      return phone.channel.open(await nextRaw(ms));
    },
    /** Sends a request as `req` parts: the body goes out as base64 chunks, `''` and no more when there is none. */
    request(id, { method = "GET", path, headers = {}, body }, size) {
      const chunks = body ? splitBody(typeof body === "string" ? new TextEncoder().encode(body) : body, size) : [""];
      chunks.forEach((chunk, index) => phone.send({ t: "req", id, method, path, headers, chunk, more: index < chunks.length - 1 }));
    },
    /** Reads messages until a complete response for `id` arrives. */
    async response(id, ms) {
      const assembler = createAssembler();
      for (;;) {
        const message = await phone.next(ms);
        if (message.t !== "res" || message.id !== id) continue;
        const result = assembler.add(message);
        if (result.done) return { ...result, parts: undefined };
      }
    },
    close() {
      ws.terminate();
    },
  };
  return phone;
}

module.exports = { random, TOKEN, LIVE_ORIGIN, sleep, listen, until, startFakeBridge, connectPhone };
