const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnCommand: spawn } = require("./command.cjs");
const { killTree } = require("./process-tree.cjs");
const { waitUntil, waitForOutput } = require("./test-helpers.cjs");

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("killTree stops a detached child and the processes it started", { timeout: 45000 }, async (t) => {
  const script =
    'const { spawn } = require("node:child_process"); const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: process.platform === "win32", stdio: "ignore" }); console.log(String(grandchild.pid)); setInterval(() => {}, 1000);';
  const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => killTree(child));
  const grandchildPid = Number(String(await waitForOutput(child)).trim());
  assert.ok(isAlive(grandchildPid));

  await killTree(child, { graceMs: 500 });

  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await waitUntil(() => !isAlive(grandchildPid));
});

test("killTree stops the rest of the group after its leader already exited", { timeout: 45000 }, async (t) => {
  // Detached Windows children escape Node's own inner kill-on-close job, while
  // remaining in the production helper's outer job after their leader exits.
  const script =
    'const { spawn } = require("node:child_process"); const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: process.platform === "win32", stdio: "ignore" }); console.log(String(grandchild.pid)); setInterval(() => {}, 1000);';
  const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => killTree(child));
  const grandchildPid = Number(String(await waitForOutput(child)).trim());
  t.after(() => {
    if (isAlive(grandchildPid)) process.kill(grandchildPid, "SIGKILL");
  });
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  assert.ok(isAlive(grandchildPid));

  await killTree(child, { graceMs: 500 });

  await waitUntil(() => !isAlive(grandchildPid));
});

test("killTree with descendants stops a grandchild that leads its own process group", { timeout: 45000, skip: process.platform === "win32" }, async (t) => {
  // Antigravity's harness starts each command in a group of its own, outside the agent's.
  const script =
    'const { spawn } = require("node:child_process"); const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" }); console.log(String(grandchild.pid)); setInterval(() => {}, 1000);';
  const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const grandchildPid = Number(String(await waitForOutput(child)).trim());
  t.after(async () => {
    await killTree(child);
    if (isAlive(grandchildPid)) process.kill(grandchildPid, "SIGKILL");
  });
  assert.ok(isAlive(grandchildPid));

  await killTree(child, { graceMs: 500, descendants: true });

  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await waitUntil(() => !isAlive(grandchildPid));
});

test("killTree without descendants leaves a grandchild in its own group alone", { timeout: 45000, skip: process.platform === "win32" }, async (t) => {
  const script =
    'const { spawn } = require("node:child_process"); const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" }); console.log(String(grandchild.pid)); setInterval(() => {}, 1000);';
  const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const grandchildPid = Number(String(await waitForOutput(child)).trim());
  t.after(() => {
    if (isAlive(grandchildPid)) process.kill(grandchildPid, "SIGKILL");
  });

  await killTree(child, { graceMs: 500 });

  assert.ok(isAlive(grandchildPid));
});

test("killTree resolves for a process that already exited", { timeout: 30000 }, async (t) => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  t.after(() => killTree(child));
  await new Promise((resolve) => child.once("exit", resolve));
  await killTree(child);
  await killTree(null);
});
