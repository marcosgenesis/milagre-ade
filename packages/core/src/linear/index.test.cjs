const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLinear } = require("./index.cjs");

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// A fake Linear: the token endpoint, the viewer query and revoke. The browser "approves" by calling the callback.
function fakeLinear() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/oauth/token")) return json(200, { access_token: "a1", refresh_token: "r1", expires_in: 86400 });
    if (url.endsWith("/oauth/revoke")) return json(200, {});
    return json(200, { data: { viewer: { name: "Victor", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } } });
  };
  const approve = (url) => {
    const params = new URL(url).searchParams;
    void fetch(`${params.get("redirect_uri")}?code=abc&state=${params.get("state")}`);
  };
  return { calls, fetchImpl, approve };
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
