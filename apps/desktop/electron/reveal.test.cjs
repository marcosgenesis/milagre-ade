const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { revealFolder } = require("./reveal.cjs");

test("project:reveal only opens the top folder of a checkout", async (t) => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-reveal-")));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const repo = path.join(base, "repo");
  await fs.mkdir(path.join(repo, "sub"), { recursive: true });
  execFileSync("/usr/bin/git", ["init", "-q"], { cwd: repo });
  await fs.mkdir(path.join(base, "plain"));
  const opened = [];
  const open = async (folder) => { opened.push(folder); return ""; };

  await revealFolder(repo, { open });
  assert.deepEqual(opened, [repo]);

  for (const folder of ["/", path.join(base, "plain"), path.join(repo, "sub"), path.join(base, "missing"), "repo", undefined, 7]) {
    await assert.rejects(revealFolder(folder, { open }), /That folder isn't a project/, String(folder));
  }
  assert.deepEqual(opened, [repo]);
});

test("project:reveal reports the file manager's error", async () => {
  await assert.rejects(revealFolder("/x", { open: async () => "no file manager", checkRoot: async () => {} }), /no file manager/);
});
