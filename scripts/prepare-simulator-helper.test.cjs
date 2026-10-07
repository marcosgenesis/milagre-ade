const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
test("packaging verifies the Android server before writing it and reuses verified artifacts offline", async (t) => {
  const { prepareSimulatorHelper } = require("./prepare-simulator-helper.cjs");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-android-artifact-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, "server"),
    bytes = Buffer.from("verified artifact"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  await assert.rejects(prepareSimulatorHelper({ target, sha256, download: async () => Buffer.from("corrupt") }), /checksum/);
  await assert.rejects(fs.access(target));
  await prepareSimulatorHelper({ target, sha256, download: async () => bytes });
  await prepareSimulatorHelper({
    target,
    sha256,
    download: async () => {
      throw Error("Must work offline");
    },
  });
  assert.deepEqual(await fs.readFile(target), bytes);
});
