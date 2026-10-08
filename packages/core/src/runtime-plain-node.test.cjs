const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../../..");

// The packaged app loads core from node_modules inside app.asar, where Node won't strip TypeScript types, so the
// host only starts when everything it requires is plain JavaScript. Development and the other tests strip types,
// which hid a `require("@milagre/shared/model-options")` (a .ts file) until the packaged app failed to start.
// The daemon's cli.cjs runs its command when loaded, so its server and phone bridge stand in for it.
for (const entry of ["packages/core/src/runtime.cjs", "apps/daemon/src/server.cjs", "apps/daemon/src/mobile-bridge.cjs"]) {
  test(`${entry} loads without TypeScript type stripping`, () => {
    const result = spawnSync(process.execPath, ["--no-experimental-strip-types", "-e", `require(${JSON.stringify(path.join(ROOT, entry))})`], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stderr.split("\n").slice(0, 12).join("\n"));
  });
}
