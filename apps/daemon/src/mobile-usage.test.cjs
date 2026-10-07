const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { once } = require("node:events");
const { socketPath, prepareSocketDirectory } = require("./paths.cjs");
const { wire } = require("./protocol.cjs");
const { startMobileBridge } = require("./mobile-bridge.cjs");

test("paired phones can read cached and live usage through the owner without opening a Project", async (t) => {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-usage-")));
  const address = socketPath(dataDir);
  prepareSocketDirectory(address);
  const usage = {
    providers: [
      {
        provider: "codex",
        status: "ok",
        updatedAt: new Date().toISOString(),
        windows: [{ id: "weekly", label: "Weekly", shortLabel: "wk", usedPercent: 64, resetsAt: null }],
      },
    ],
  };
  const requests = [],
    sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const connection = wire(socket, {
      onMessage(request) {
        requests.push(request.method);
        connection.send({ v: 1, id: request.id, result: usage });
      },
      onInvalid: (error) => socket.destroy(error),
    });
  });
  server.listen(address);
  await once(server, "listening");
  const token = "a".repeat(64);
  const bridge = await startMobileBridge({ dataDir, port: 0, token });
  t.after(async () => {
    await bridge.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const rpc = (method, authorization = `Bearer ${token}`) =>
    fetch(bridge.url + "/rpc", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ v: 1, method, args: [] }),
    });
  for (const method of ["usage:cached", "usage:read"]) {
    const response = await rpc(method);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, usage);
  }
  assert.deepEqual(requests, ["usage:cached", "usage:read"]);
  assert.equal((await rpc("usage:read", "Bearer incorrect")).status, 401);
  assert.equal((await rpc("phone:reset")).status, 403);
  assert.deepEqual(requests, ["usage:cached", "usage:read"]);
});
