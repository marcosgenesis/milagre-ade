const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { spawn, spawnSync } = require("node:child_process");
const { acquireOwnership, staleOwner } = require("./ownership.cjs");

function lockFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-owner-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "runtime.lock");
}
function writeOwner(lockPath, owner) {
  fs.mkdirSync(lockPath);
  const record = JSON.stringify(owner);
  fs.writeFileSync(path.join(lockPath, "owner.json"), record);
  return record;
}
const readOwner = (lockPath) => fs.readFileSync(path.join(lockPath, "owner.json"), "utf8");

test("a lock left by an owner that exited uncleanly is taken over", (t) => {
  const lockPath = lockFixture(t);
  const result = spawnSync(
    process.execPath,
    ["-e", "require(process.argv[1]).acquireOwnership(process.argv[2]);", require.resolve("./ownership.cjs"), lockPath],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const crashed = JSON.parse(readOwner(lockPath));
  assert.deepEqual(staleOwner(lockPath), crashed);
  const owner = acquireOwnership(lockPath);
  assert.equal(JSON.parse(readOwner(lockPath)).pid, process.pid);
  owner.release();
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.existsSync(`${lockPath}.takeover`), false);
});

test("a live owner keeps its lock", async (t) => {
  const lockPath = lockFixture(t);
  const child = spawn(
    process.execPath,
    [
      "-e",
      'require(process.argv[1]).acquireOwnership(process.argv[2]); console.log("owned"); setInterval(() => {}, 1000);',
      require.resolve("./ownership.cjs"),
      lockPath,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  t.after(() => child.kill("SIGKILL"));
  await once(child.stdout, "data");
  const before = readOwner(lockPath);
  assert.equal(staleOwner(lockPath), null);
  assert.throws(() => acquireOwnership(lockPath), /already owned.*owner.json/s);
  assert.equal(readOwner(lockPath), before);
});

test("a reused pid is not mistaken for the owner", (t) => {
  const lockPath = lockFixture(t);
  // This test's own process is alive, but started long after this owner did: the owner is gone and its pid reused.
  writeOwner(lockPath, { pid: process.pid, token: "reused", startedAt: "2000-01-01T00:00:00.000Z", host: os.hostname() });
  assert.equal(staleOwner(lockPath)?.token, "reused");
  acquireOwnership(lockPath).release();
});

test("an unclear lock stays: another computer's, a live process that may own it, no pid, no record yet", (t) => {
  const lockPath = lockFixture(t);
  const dead = 2147483647;
  for (const owner of [
    { pid: dead, token: "remote", startedAt: "2000-01-01T00:00:00.000Z", host: `not-${os.hostname()}` },
    { pid: process.pid, token: "live", startedAt: new Date().toISOString() },
    { token: "no-pid", startedAt: "2000-01-01T00:00:00.000Z" },
  ]) {
    const record = writeOwner(lockPath, owner);
    assert.equal(staleOwner(lockPath), null, owner.token);
    assert.throws(() => acquireOwnership(lockPath), /already owned/);
    assert.equal(readOwner(lockPath), record);
    fs.rmSync(lockPath, { recursive: true });
  }
  fs.mkdirSync(lockPath);
  assert.equal(staleOwner(lockPath), null, "a lock whose owner is still writing its record");
  assert.throws(() => acquireOwnership(lockPath), /already owned/);
  assert.ok(fs.existsSync(lockPath));
});

test("release is idempotent and cannot remove a replacement ownership record", (t) => {
  const lockPath = lockFixture(t);
  const first = acquireOwnership(lockPath);
  first.release();
  const second = acquireOwnership(lockPath);
  first.release();
  assert.throws(() => acquireOwnership(lockPath), /already owned/);
  second.release();
  assert.equal(fs.existsSync(lockPath), false);
});
