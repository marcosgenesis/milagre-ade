const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLinearStore } = require("./store.cjs");

const token = { accessToken: "a", refreshToken: "r", expiresAt: 5, viewer: { name: "V", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } };

test("the token is saved owner-only and read back, then cleared", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createLinearStore({ dataDir });
  assert.equal(store.readToken(), null);
  store.saveToken(token);
  assert.deepEqual(store.readToken(), token);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(dataDir, "linear", "token.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(dataDir, "linear")).mode & 0o777, 0o700);
  }
  store.clearToken();
  assert.equal(store.readToken(), null);
});

test("a corrupt or incomplete token file reads as not connected", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createLinearStore({ dataDir });
  store.saveToken({ accessToken: "a" });
  assert.equal(store.readToken(), null);
  fs.writeFileSync(path.join(dataDir, "linear", "token.json"), "{", { mode: 0o600 });
  assert.equal(store.readToken(), null);
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
