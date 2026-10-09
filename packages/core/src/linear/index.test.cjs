const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");
const { createLinear } = require("./index.cjs");

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// A fake Linear: the token endpoint, the viewer query and revoke. The browser "approves" by calling the callback.
function fakeLinear() {
  const calls = [];
  const revokes = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/oauth/revoke")) revokes.push(Object.fromEntries(new URLSearchParams(init.body)));
    if (url.endsWith("/oauth/token")) return json(200, { access_token: "a1", refresh_token: "r1", expires_in: 86400 });
    if (url.endsWith("/oauth/revoke")) return json(200, {});
    return json(200, { data: { viewer: { name: "Victor", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } } });
  };
  const approve = (url) => {
    const params = new URL(url).searchParams;
    void fetch(`${params.get("redirect_uri")}?code=abc&state=${params.get("state")}`);
  };
  return { calls, revokes, fetchImpl, approve };
}

function setup(t, overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const linear = fakeLinear();
  let changes = 0;
  const service = createLinear({
    dataDir,
    clientId: "cid",
    apiBase: "https://api.test",
    port: 0,
    fetchImpl: linear.fetchImpl,
    openBrowser: linear.approve,
    changed: () => changes++,
    ...overrides,
  });
  return { service, linear, changes: () => changes };
}

test("connect signs in through the browser and saves who connected", async (t) => {
  const { service, changes } = setup(t);
  assert.deepEqual(service.status(), { connected: false });
  const status = await service.connect();
  assert.deepEqual(status, { connected: true, viewer: { name: "Victor", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } });
  assert.deepEqual(service.status(), status);
  assert.equal(changes(), 1);
});

test("disconnect forgets the token even when the revoke fails", async (t) => {
  const linear = fakeLinear();
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/oauth/revoke")) throw new Error("offline");
    return linear.fetchImpl(url, init);
  };
  const { service, changes } = setup(t, { fetchImpl, openBrowser: linear.approve });
  await service.connect();
  assert.deepEqual(await service.disconnect(), { connected: false });
  assert.deepEqual(service.status(), { connected: false });
  assert.equal(changes(), 2);
  assert.deepEqual(await service.disconnect(), { connected: false });
  assert.equal(changes(), 2, "disconnecting when already disconnected changes nothing");
});

test("a second connect replaces the first", async (t) => {
  let opened = 0;
  const { service, linear } = setup(t, {
    openBrowser: (url) => {
      opened++;
      if (opened === 2) linear.approve(url);
    },
  });
  const first = service.connect();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = service.connect();
  await assert.rejects(first, { code: "cancelled" });
  assert.equal((await second).connected, true);
  assert.equal(opened, 2);
});

test("connect without a client id says the build isn't set up", async (t) => {
  const { service } = setup(t, { clientId: "" });
  await assert.rejects(service.connect(), { code: "not-configured", message: "Linear sign-in isn't set up in this build." });
});

test("the Experimental switch round-trips", async (t) => {
  const { service } = setup(t);
  assert.equal(service.enabled(), false);
  assert.equal(service.setEnabled(true), true);
  assert.equal(service.enabled(), true);
});

// A port that was free a moment ago, so a test can use a fixed one.
async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("dispose cancels a waiting sign-in and frees the callback port", async (t) => {
  const port = await freePort();
  let opened = 0;
  const { service, linear } = setup(t, {
    port,
    openBrowser: (url) => {
      opened++;
      if (opened === 2) linear.approve(url);
    },
  });
  const waiting = service.connect();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await service.dispose();
  await assert.rejects(waiting, { code: "cancelled" });
  assert.equal((await service.connect()).connected, true);
});

test("three connects in a row: only the newest survives", async (t) => {
  const port = await freePort();
  // The superseded sign-ins are cancelled before they reach the browser; the one that does open it is approved.
  let opened = 0;
  const { service, linear } = setup(t, {
    port,
    openBrowser: (url) => {
      opened++;
      linear.approve(url);
    },
  });
  const first = service.connect();
  const second = service.connect();
  const third = service.connect();
  await assert.rejects(first, { code: "cancelled" });
  await assert.rejects(second, { code: "cancelled" });
  assert.equal((await third).connected, true);
  assert.equal(opened, 1);
});

test("disconnect revokes the refresh token once and stops there when Linear accepts it", async (t) => {
  const { service, linear } = setup(t);
  await service.connect();
  await service.disconnect();
  assert.deepEqual(linear.revokes, [{ token: "r1", token_type_hint: "refresh_token" }]);
});

test("disconnect falls back to the access token when revoking the refresh token is refused", async (t) => {
  const linear = fakeLinear();
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/oauth/revoke") && new URLSearchParams(init.body).get("token_type_hint") === "refresh_token") {
      linear.revokes.push({ token: "r1", failed: true });
      return json(400, {});
    }
    return linear.fetchImpl(url, init);
  };
  const { service } = setup(t, { fetchImpl, openBrowser: linear.approve });
  await service.connect();
  assert.deepEqual(await service.disconnect(), { connected: false });
  assert.deepEqual(linear.revokes, [
    { token: "r1", failed: true },
    { token: "a1", token_type_hint: "access_token" },
  ]);
});

test("disconnect falls back to the access token when revoking the refresh token throws", async (t) => {
  const linear = fakeLinear();
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/oauth/revoke") && new URLSearchParams(init.body).get("token_type_hint") === "refresh_token") {
      linear.revokes.push({ token: "r1", failed: true });
      throw new Error("offline");
    }
    return linear.fetchImpl(url, init);
  };
  const { service } = setup(t, { fetchImpl, openBrowser: linear.approve });
  await service.connect();
  assert.deepEqual(await service.disconnect(), { connected: false });
  assert.deepEqual(linear.revokes, [
    { token: "r1", failed: true },
    { token: "a1", token_type_hint: "access_token" },
  ]);
});

test("a sign-in that fails after the token exchange revokes the new grant and says it failed", async (t) => {
  const linear = fakeLinear();
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/graphql")) return json(200, { errors: [{ message: "Viewer unavailable" }] });
    return linear.fetchImpl(url, init);
  };
  const { service, changes } = setup(t, { fetchImpl, openBrowser: linear.approve });
  await assert.rejects(service.connect(), { code: "failed", message: "Linear sign-in failed: Viewer unavailable" });
  assert.deepEqual(linear.revokes, [{ token: "r1", token_type_hint: "refresh_token" }]);
  assert.deepEqual(service.status(), { connected: false });
  assert.equal(changes(), 0);
});

test("a sign-in cancelled while its token is being exchanged saves nothing and revokes it", async (t) => {
  const linear = fakeLinear();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let exchanging;
  const started = new Promise((resolve) => (exchanging = resolve));
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/oauth/token")) {
      exchanging();
      await gate;
    }
    return linear.fetchImpl(url, init);
  };
  const { service, changes } = setup(t, { fetchImpl, openBrowser: linear.approve });
  const waiting = service.connect();
  const rejected = assert.rejects(waiting, { code: "cancelled" });
  await started;
  const disposed = service.dispose();
  release();
  await disposed;
  await rejected;
  assert.deepEqual(service.status(), { connected: false });
  assert.equal(changes(), 0);
  assert.deepEqual(linear.revokes, [{ token: "r1", token_type_hint: "refresh_token" }]);
});
