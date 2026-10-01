const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const { killTree } = require("./process-tree.cjs");
const { waitUntil } = require("./test-helpers.cjs");

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("killTree stops a detached child and the processes it started", async () => {
  const script = 'const { spawn } = require("node:child_process"); const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(grandchild.pid); setInterval(() => {}, 1000);';
  const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const grandchildPid = Number(await new Promise((resolve) => child.stdout.once("data", (data) => resolve(String(data).trim()))));
  assert.ok(isAlive(grandchildPid));

  await killTree(child, { graceMs: 500 });

  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await waitUntil(() => !isAlive(grandchildPid));
});

test("killTree resolves for a process that already exited", async () => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  await killTree(child);
  await killTree(null);
});
