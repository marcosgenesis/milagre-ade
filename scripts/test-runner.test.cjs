const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { shouldRetry, discoverUnitTests, discoverElectronChecks, selectTests, parseArgs, MANIFEST } = require("./test-runner.cjs");
const root = path.join(__dirname, "..");

test("discovers every node:test file and every Electron check", () => {
  const unit = discoverUnitTests(root);
  assert.ok(unit.includes("packages/shared/src/chats.test.ts"));
  assert.ok(unit.includes("apps/relay/src/room.test.mjs"));
  assert.ok(unit.includes("scripts/monorepo.test.cjs"));
  assert.ok(!unit.some((file) => file.includes("node_modules")));
  const electron = discoverElectronChecks(root);
  assert.ok(electron.includes("scripts/test-chat-titles.cjs"));
  assert.deepEqual(electron, [...electron].sort());
  assert.ok(!electron.includes("scripts/test-runner.cjs") && !electron.includes("scripts/test-runner.test.cjs"));
});

test("--only narrows by name and an unmatched name fails loudly", () => {
  const selected = selectTests({
    unit: ["a/b.test.ts"],
    electron: ["scripts/test-chat-titles.cjs", "scripts/test-ports.cjs"],
    filters: { ...parseArgs(["--only", "chat-titles"]), platform: "darwin", commandExists: () => true },
  });
  assert.deepEqual(selected.electron, ["scripts/test-chat-titles.cjs"]);
  assert.deepEqual(selected.unit, []);
  assert.throws(
    () => selectTests({ unit: [], electron: [], filters: { ...parseArgs(["--only", "nothing"]), platform: "darwin", commandExists: () => true } }),
    /no test matched "nothing"/,
  );
});

test("--workspace keeps that workspace only", () => {
  const selected = selectTests({
    unit: ["packages/core/src/a.test.cjs", "apps/mobile/src/b.test.ts"],
    electron: [],
    filters: { ...parseArgs(["--workspace", "core"]), platform: "darwin", commandExists: () => true },
  });
  assert.deepEqual(selected.unit, ["packages/core/src/a.test.cjs"]);
});

test("platform and tool prerequisites skip checks with a reason instead of failing them", () => {
  const electron = ["scripts/test-windows-cli.cjs", "scripts/test-ports.cjs", "scripts/test-desktop.cjs"];
  const onLinuxWithoutLsof = selectTests({
    unit: [],
    electron,
    filters: { ...parseArgs(["--electron"]), platform: "linux", commandExists: (name) => name !== "lsof" },
  });
  assert.deepEqual(onLinuxWithoutLsof.electron, ["scripts/test-desktop.cjs"]);
  assert.deepEqual(
    onLinuxWithoutLsof.skipped.map((item) => item.file),
    ["scripts/test-ports.cjs", "scripts/test-windows-cli.cjs"].sort(),
  );
  assert.equal(MANIFEST["test-desktop.cjs"].needsBuild, true);
  assert.deepEqual(MANIFEST["test-windows-cli.cjs"].platforms, ["win32"]);
});

test("unknown flags are rejected", () => {
  assert.throws(() => parseArgs(["--watchh"]), /Unknown option --watchh/);
});

test("--changed is rejected until it is implemented", () => {
  assert.throws(() => parseArgs(["--changed"]), /--changed is not implemented yet; use --only or --workspace/);
});

test("a platform skip prints the manifest reason when it has one", () => {
  const electron = ["scripts/test-sidebar-resize.cjs", "scripts/test-windows-cli.cjs"];
  const { skipped } = selectTests({ unit: [], electron, filters: { ...parseArgs(["--electron"]), platform: "linux", commandExists: () => true } });
  assert.deepEqual(skipped, [
    { file: "scripts/test-sidebar-resize.cjs", reason: `needs darwin: ${MANIFEST["test-sidebar-resize.cjs"].reason}` },
    { file: "scripts/test-windows-cli.cjs", reason: "needs win32" },
  ]);
  assert.match(MANIFEST["test-sidebar-resize.cjs"].reason, /#\d+/);
});

test("an Electron check is retried once, only on Linux CI", () => {
  assert.equal(shouldRetry({ platform: "linux", ci: "true", attempt: 1 }), true);
  assert.equal(shouldRetry({ platform: "linux", ci: "true", attempt: 2 }), false);
  assert.equal(shouldRetry({ platform: "linux", ci: undefined, attempt: 1 }), false);
  assert.equal(shouldRetry({ platform: "darwin", ci: "true", attempt: 1 }), false);
});

test("--shard splits the runnable Electron checks round-robin and leaves unit tests alone", () => {
  const electron = ["scripts/test-a.cjs", "scripts/test-b.cjs", "scripts/test-c.cjs", "scripts/test-d.cjs", "scripts/test-windows-cli.cjs"];
  const run = (shard) =>
    selectTests({ unit: ["x.test.ts"], electron, filters: { ...parseArgs(["--shard", shard]), platform: "linux", commandExists: () => true } });
  // Skipped checks are removed before splitting so every shard gets an even share of real work.
  assert.deepEqual(run("1/2").electron, ["scripts/test-a.cjs", "scripts/test-c.cjs"]);
  assert.deepEqual(run("2/2").electron, ["scripts/test-b.cjs", "scripts/test-d.cjs"]);
  assert.deepEqual(run("3/3").electron, ["scripts/test-c.cjs"]);
  assert.deepEqual(run("1/1").electron, electron.slice(0, 4));
  assert.deepEqual(run("2/2").unit, ["x.test.ts"]);
  assert.deepEqual(
    run("2/2").skipped.map((item) => item.file),
    ["scripts/test-windows-cli.cjs"],
  );
  assert.deepEqual(parseArgs(["--shard", "2/3"]).shard, { index: 2, count: 3 });
  assert.equal(parseArgs([]).shard, null);
});

test("a malformed --shard is rejected", () => {
  for (const value of ["0/2", "3/2", "2", "a/b", "1/0", "1.5/2"]) assert.throws(() => parseArgs(["--shard", value]), /--shard needs <index>\/<count>/, value);
  assert.throws(() => parseArgs(["--shard"]), /--shard needs a value/);
});
