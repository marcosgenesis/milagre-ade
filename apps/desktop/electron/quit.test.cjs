const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createQuitHandler } = require("./quit.cjs");
test("quit failure stays visible, keeps the app open, and a second attempt can save", async () => {
  let fail = true,
    prepared = 0,
    exited = 0;
  const errors = [];
  const attempt = createQuitHandler({
    prepare: async () => {
      prepared++;
      if (fail) throw new Error("disk full");
    },
    quit: () => exited++,
    failed: (error) => errors.push(error.message),
  });
  await Promise.all([attempt(), attempt()]);
  assert.equal(prepared, 1);
  assert.equal(exited, 0);
  assert.deepEqual(errors, ["disk full"]);
  fail = false;
  await attempt();
  assert.equal(prepared, 2);
  assert.equal(exited, 1);
});
