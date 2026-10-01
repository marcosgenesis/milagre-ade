const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveExecutable } = require("./environment.cjs");

test("returns the first path which reports", async () => {
  const execFileImpl = (file, args, options, callback) => callback(null, "/opt/homebrew/bin/codex\n/usr/local/bin/codex\n");
  assert.equal(await resolveExecutable("codex", { execFileImpl }), "/opt/homebrew/bin/codex");
});

test("returns null when the CLI isn't installed", async () => {
  const execFileImpl = (file, args, options, callback) => callback(Object.assign(new Error("not found"), { code: 1 }), "");
  assert.equal(await resolveExecutable("codex", { execFileImpl }), null);
});
