const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAdvisorStore } = require("./advisor-store.cjs");

test("advisor records survive reopen and concurrent updates without sharing Chat identities", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "advisor-store-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = createAdvisorStore({ dataDir });
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => store.update("chat/a", (records) => [...records, { id: String(i), source: "milagre-advisor", provider: "codex" }])),
  );
  await store.close();
  const reopened = createAdvisorStore({ dataDir });
  assert.equal((await reopened.read("chat/a")).length, 10);
  assert.deepEqual(await reopened.read("chat/b"), []);
  assert.equal((await reopened.read("chat/a"))[0].source, "milagre-advisor");
  await reopened.close();
});

test("storage failure rejects admission without updating memory", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "advisor-store-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, "advisors"), "blocked");
  const store = createAdvisorStore({ dataDir });
  await assert.rejects(store.update("chat", () => [{ id: "a" }]));
});
