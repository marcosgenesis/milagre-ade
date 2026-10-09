const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLinearStore } = require("./store.cjs");

const token = { accessToken: "a", refreshToken: "r", expiresAt: 5, viewer: { name: "V", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } };

test("a workspace's token is saved owner-only and read back, then cleared", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createLinearStore({ dataDir });
  const acme = store.workspace("acme");
  assert.equal(acme.readToken(), null);
  acme.saveToken(token);
  assert.deepEqual(acme.readToken(), token);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(dataDir, "linear", "workspaces", "acme.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(dataDir, "linear", "workspaces")).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(dataDir, "linear")).mode & 0o777, 0o700);
  }
  acme.clearToken();
  assert.equal(acme.readToken(), null);
  assert.deepEqual(store.listWorkspaces(), []);
});

test("a corrupt or incomplete token file reads as not connected", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createLinearStore({ dataDir });
  const acme = store.workspace("acme");
  acme.saveToken({ accessToken: "a" });
  assert.equal(acme.readToken(), null);
  assert.deepEqual(store.listWorkspaces(), []);
  fs.writeFileSync(path.join(dataDir, "linear", "workspaces", "acme.json"), "{", { mode: 0o600 });
  assert.equal(acme.readToken(), null);
  assert.deepEqual(store.listWorkspaces(), []);
});

test("workspaces are listed oldest first with their ids", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createLinearStore({ dataDir });
  assert.deepEqual(store.listWorkspaces(), []);
  store.workspace("beta").saveToken({ ...token, connectedAt: 20, organization: { name: "Beta", urlKey: "beta" } });
  store.workspace("acme").saveToken({ ...token, connectedAt: 30 });
  store.workspace("zed").saveToken({ ...token, connectedAt: 10 });
  assert.deepEqual(
    store.listWorkspaces().map((item) => item.id),
    ["zed", "beta", "acme"],
  );
  assert.equal(store.listWorkspaces()[1].accessToken, "a");
});

test("a token saved before workspaces moves into the list and the old file is removed", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dataDir, "linear"), { recursive: true, mode: 0o700 });
  const legacy = path.join(dataDir, "linear", "token.json");
  fs.writeFileSync(legacy, JSON.stringify(token), { mode: 0o600 });
  const store = createLinearStore({ dataDir });
  const [only, ...rest] = store.listWorkspaces();
  assert.deepEqual(rest, []);
  assert.deepEqual(only, { id: "acme", connectedAt: 0, ...token });
  assert.equal(fs.existsSync(legacy), false);
  assert.deepEqual(store.workspace("acme").readToken(), { connectedAt: 0, ...token });
  assert.equal(store.listWorkspaces().length, 1);
});

test("a workspace id that isn't a URL key throws", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createLinearStore({ dataDir });
  for (const id of ["", "../x", "a/b", "-a", undefined, "a".repeat(65)]) assert.throws(() => store.workspace(id), /isn't a Linear workspace/);
});

test("the Experimental switch is off until saved on", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createLinearStore({ dataDir });
  assert.equal(store.readEnabled(), false);
  assert.equal(store.saveEnabled(true), true);
  assert.equal(createLinearStore({ dataDir }).readEnabled(), true);
  assert.equal(store.saveEnabled("yes"), false);
});
