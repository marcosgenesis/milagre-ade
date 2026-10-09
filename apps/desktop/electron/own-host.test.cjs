const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { readIdentity } = require("@milagre/daemon/relay-identity");
const { readOwnHostId } = require("./own-host.cjs");

test("this Mac's host id comes from its relay identity, and none is made when there is none", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "own-host-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  assert.equal(await readOwnHostId(dataDir), null);
  assert.deepEqual(await fs.readdir(dataDir), [], "reading never creates the identity");
  const identity = await readIdentity(dataDir);
  assert.equal(await readOwnHostId(dataDir), identity.hostId);
  await fs.writeFile(path.join(dataDir, "relay-identity.json"), "not json", { mode: 0o600 });
  assert.equal(await readOwnHostId(dataDir), null);
});
