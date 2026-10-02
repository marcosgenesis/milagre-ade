const assert = require("node:assert/strict");
const test = require("node:test");
const { PortWatcher, adoptOrphans, chatPorts, chatProcesses, parseCwds, parseLsof, parsePs } = require("./ports.cjs");

// The agent (100) leads group 100 with its MCP server (101); its command shells lead their own groups.
const PS = `
    1     0     1 /sbin/launchd
  100    50   100 /Users/me/.local/bin/claude
  101   100   100 node
  110   100   110 /bin/zsh
  111   110   110 node
  112   111   110 esbuild
  200    50   200 /Applications/Codex.app/codex
  210   200   210 /usr/bin/sandbox-exec
  211   210   210 python3
`;

const LSOF = ["p101", "cnode", "f20", "n127.0.0.1:4545", "p111", "cnode", "f21", "n*:5173", "f22", "n[::1]:5173", "f23", "n127.0.0.1:24678", "p211", "cPython", "f3", "n*:8000", ""].join("\n");

test("reads ps and lsof output", () => {
  assert.deepEqual(parsePs(PS)[1], { pid: 100, ppid: 50, pgid: 100, command: "/Users/me/.local/bin/claude" });
  assert.deepEqual(parseLsof(LSOF), [
    { pid: 101, command: "node", port: 4545, address: "127.0.0.1" },
    { pid: 111, command: "node", port: 5173, address: "*" },
    { pid: 111, command: "node", port: 24678, address: "127.0.0.1" },
    { pid: 211, command: "Python", port: 8000, address: "*" },
  ]);
});

test("a chat owns what its command shells started, not the agent's MCP servers", () => {
  const groups = new Map();
  const byChat = chatProcesses(parsePs(PS), new Map([["/a#1", { pid: 100 }], ["/b#2", { pid: 200 }]]), groups);
  assert.deepEqual([...byChat.get("/a#1")].sort(), [110, 111, 112]);
  assert.deepEqual([...byChat.get("/b#2")].sort(), [210, 211]);
  assert.deepEqual(chatPorts(parseLsof(LSOF), byChat), {
    "/a#1": [{ port: 5173, pid: 111, command: "node", address: "*" }, { port: 24678, pid: 111, command: "node", address: "127.0.0.1" }],
    "/b#2": [{ port: 8000, pid: 211, command: "Python", address: "*" }],
  });
});

test("a server that outlived its shell and its agent stays with the chat until it stops", () => {
  const groups = new Map();
  chatProcesses(parsePs(PS), new Map([["/a#1", { pid: 100 }]]), groups);
  // The shell exited and the server was reparented to launchd; then the agent's session closed.
  const orphaned = parsePs("    1     0     1 /sbin/launchd\n  111     1   110 node\n");
  assert.deepEqual([...chatProcesses(orphaned, new Map(), groups).get("/a#1")], [111]);
  assert.equal(chatProcesses(parsePs("    1     0     1 /sbin/launchd\n"), new Map(), groups).size, 0);
  assert.equal(groups.size, 0);
});

test("the watcher publishes changes and stops once nothing runs", async () => {
  let roots = new Map([["/a#1", { pid: 100 }]]);
  let ps = PS;
  const published = [];
  const calls = [];
  const watcher = new PortWatcher({
    roots: () => roots,
    publish: (ports) => published.push(ports),
    pollMs: 60_000,
    exec: async (command, args) => {
      calls.push(command);
      if (command === "ps") return ps;
      assert.equal(args[args.indexOf("-p") + 1], "110,111,112");
      return LSOF;
    },
  });
  await watcher.poll();
  assert.deepEqual(Object.keys(published[0]), ["/a#1"]);
  await watcher.poll();
  assert.equal(published.length, 1, "an unchanged poll publishes nothing");
  roots = new Map();
  ps = "    1     0     1 /sbin/launchd\n";
  await watcher.poll();
  assert.deepEqual(published.at(-1), {});
  assert.deepEqual(watcher.snapshot(), {});
  assert.equal(watcher.timer, null, "no agents and no servers left: polling stops");
  calls.length = 0;
  await watcher.poll();
  assert.deepEqual(calls, [], "nothing to watch runs nothing");
});

test("a server whose shell exited unseen is adopted by the chats in its worktree", () => {
  // npm (300) and the server it started (301) were left by a shell (299) that is gone.
  const ps = parsePs(PS + "  300     1   299 npm\n  301   300   299 node\n  400     1   399 node\n");
  const cwds = parseCwds(["p300", "fcwd", "n/repo/worktree/web", "p400", "fcwd", "n/elsewhere", ""].join("\n"));
  assert.deepEqual([...cwds], [[300, "/repo/worktree/web"], [400, "/elsewhere"]]);
  const groups = new Map();
  const roots = new Map([["/a#1", { pid: 100, cwd: "/repo/worktree" }], ["/b#2", { pid: 200, cwd: "/repo/worktree-two" }]]);
  adoptOrphans(ps, cwds, roots, groups);
  assert.deepEqual([...groups], [["/a#1", new Set([299])]]);
  assert.deepEqual([...chatProcesses(ps, roots, groups).get("/a#1")].sort(), [110, 111, 112, 300, 301]);
});

test("stopping a port ends its command's group, and only a pid the chat shows", async () => {
  const signals = [];
  let alive = true;
  const watcher = new PortWatcher({
    roots: () => new Map([["/a#1", { pid: 100 }]]),
    publish: () => {},
    pollMs: 60_000,
    graceMs: 200,
    exec: async (command) => (command === "ps" ? (alive ? PS : PS.replace(/^.*\b11[012]\b.*$/gm, "")) : alive ? LSOF : ""),
    kill: (target, signal) => {
      signals.push([target, signal]);
      if (signal === "SIGTERM") alive = false;
      if (signal === 0 && !alive) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    },
  });
  await watcher.poll();
  assert.equal(await watcher.stopPort("/a#1", 101), false, "the agent's own MCP server isn't the chat's to stop");
  assert.equal(await watcher.stopPort("/b#2", 111), false, "another chat can't stop it");
  assert.deepEqual(signals, []);
  assert.equal(await watcher.stopPort("/a#1", 111), true);
  assert.deepEqual(signals[0], [-110, "SIGTERM"], "the whole command's group gets SIGTERM");
  assert.ok(!signals.some(([, signal]) => signal === "SIGKILL"), "no SIGKILL when SIGTERM was enough");
  assert.deepEqual(watcher.snapshot(), {}, "the list is fresh once it resolves");
  watcher.close();
});

test("a port that ignores SIGTERM gets SIGKILL", async () => {
  const signals = [];
  const watcher = new PortWatcher({
    roots: () => new Map([["/a#1", { pid: 100 }]]),
    publish: () => {},
    pollMs: 60_000,
    graceMs: 100,
    exec: async (command) => (command === "ps" ? PS : LSOF),
    kill: (target, signal) => signals.push([target, signal]),
  });
  await watcher.poll();
  await watcher.stopPort("/a#1", 111);
  assert.deepEqual(signals.at(-1), [-110, "SIGKILL"]);
  watcher.close();
});
