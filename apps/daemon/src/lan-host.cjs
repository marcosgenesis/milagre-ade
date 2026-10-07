const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { WebSocketServer, WebSocket: NodeWebSocket } = require("ws");
const { createPhoneChannels, frame, OPEN, DATA, CLOSE } = require("./phone-channels.cjs");

const MAX_PHONES = 16;
// Larger than one sealed 256 KiB upload chunk, base64 and all.
const MAX_FRAME = 4 * 1024 * 1024;
const HELLO_MS = 15_000;
const notFound = "HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n";

/**
 * Phone access on the local network: the relay's phone protocol, end to end encrypted, over a socket the phone
 * dials directly. `/v1/hello` lets a phone check, without credentials, that this address is still this Mac.
 * Pairing never happens here: a phone must already be known (paired over the relay, or registered through
 * `phone:routes` on a route it trusts).
 */
function startLanHost({
  port,
  hostname = "0.0.0.0",
  identity,
  phones,
  token,
  bridgeUrl,
  WebSocket = NodeWebSocket,
  fetch = globalThis.fetch,
  random = (n) => new Uint8Array(randomBytes(n)),
  helloMs = HELLO_MS,
}) {
  const channels = createPhoneChannels({ identity, phones, token, bridgeUrl, canPair: () => false, WebSocket, fetch, random, helloMs });
  const sockets = new Map(); // conn id -> the phone's socket
  let nextConn = 1n;
  const session = {
    conns: new Map(),
    send(bytes) {
      const conn = new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(1);
      const ws = sockets.get(conn);
      if (!ws) return;
      if (bytes[0] === DATA) {
        if (ws.readyState === NodeWebSocket.OPEN) ws.send(bytes.subarray(9));
      } else if (bytes[0] === CLOSE) {
        sockets.delete(conn);
        ws.close(1000);
      }
    },
  };
  const hello = JSON.stringify({ v: 1, hostId: identity.hostId });
  const server = http.createServer((req, res) => {
    const target = new URL(req.url, "http://lan");
    if (req.method === "GET" && target.pathname === "/v1/hello") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(hello);
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {});
    const target = new URL(req.url, "http://lan");
    if (target.pathname !== "/v1/phone" || target.searchParams.get("id") !== identity.hostId || sockets.size >= MAX_PHONES) {
      socket.end(notFound);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = nextConn++;
      sockets.set(conn, ws);
      channels.onFrame(session, frame(OPEN, conn));
      ws.on("message", (data, isBinary) => {
        // Nothing a phone sends may take the daemon down.
        try {
          if (!isBinary) return ws.close(1003);
          channels.onFrame(session, frame(DATA, conn, new Uint8Array(data)));
        } catch {
          ws.terminate();
        }
      });
      ws.on("close", () => {
        if (sockets.get(conn) === ws) sockets.delete(conn);
        channels.onFrame(session, frame(CLOSE, conn));
      });
      ws.on("error", () => {});
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      server.off("error", reject);
      resolve({
        port: server.address().port,
        async close() {
          for (const ws of sockets.values()) ws.terminate();
          sockets.clear();
          server.closeAllConnections?.();
          await new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

module.exports = { startLanHost, LAN_PORT: 8798 };
