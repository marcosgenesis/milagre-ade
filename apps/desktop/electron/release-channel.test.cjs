const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createReleaseChannelStore, configureUpdater, isChannelNotPublished } = require("./release-channel.cjs");

function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-channel-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "release-channel.json");
}

test("defaults to stable, persists beta, ignores garbage", (t) => {
  const file = tempFile(t);
  const store = createReleaseChannelStore({ file });
  assert.equal(store.get(), "stable");
  assert.equal(store.set("beta"), "beta");
  assert.equal(createReleaseChannelStore({ file }).get(), "beta");
  fs.writeFileSync(file, '{"channel":"nightly"}');
  assert.equal(createReleaseChannelStore({ file }).get(), "stable");
  assert.throws(() => store.set("nightly"), /Unknown release channel/);
});

test("stable installs never see prereleases; beta installs do and never downgrade", () => {
  const updater = {};
  configureUpdater(updater, "stable");
  assert.deepEqual(updater, { channel: "latest", allowPrerelease: false, allowDowngrade: false });
  configureUpdater(updater, "beta");
  assert.deepEqual(updater, { channel: "beta", allowPrerelease: true, allowDowngrade: false });
});

test("a stable release without a beta feed is not an error for beta installs", () => {
  assert.equal(isChannelNotPublished(Object.assign(new Error("x"), { code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" })), true);
  assert.equal(isChannelNotPublished(new Error("network")), false);
});
