const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTerminals, terminalEnvironment, terminalShell } = require("./terminals.cjs");

function fakePty(file, args, options) {
  const data = new Set(),
    exits = new Set();
  const pty = {
    file,
    args,
    options,
    pid: 4242,
    process: path.basename(file),
    written: [],
    sizes: [],
    killed: false,
    onData: (listener) => data.add(listener),
    onExit: (listener) => exits.add(listener),
    write: (text) => pty.written.push(text),
    resize: (cols, rows) => pty.sizes.push([cols, rows]),
    kill: () => {
      pty.killed = true;
    },
    emit: (text) => {
      for (const listener of data) listener(text);
    },
    exit: () => {
      for (const listener of exits) listener({ exitCode: 0 });
    },
  };
  return pty;
}

function fixture(t, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-terminals-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-terminals-"));
  t.after(() => {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  });
  const ptys = [],
    changes = [];
  let shellChanges = 0;
  const chats = {
    "/p#1": [{ path: folder, label: "one" }],
    "link:abc#2": [
      { path: folder, label: "api" },
      { path: second, label: "web" },
    ],
  };
  const terminals = createTerminals({
    resolveChat: async (chatId) => {
      if (!chats[chatId]) throw new Error("This Chat is archived.");
      return chats[chatId];
    },
    spawn: (file, args, spawnOptions) => {
      const pty = fakePty(file, args, spawnOptions);
      ptys.push(pty);
      return pty;
    },
    shell: () => ({ file: "/bin/zsh", args: ["-l"] }),
    environment: () => ({ TERM: "xterm-256color" }),
    onChange: (chatId) => changes.push(chatId),
    onShellsChanged: () => shellChanges++,
    readWaitMs: 50,
    titlePollMs: 10,
    ...options,
  });
  t.after(() => terminals.dispose());
  return { terminals, ptys, changes, folder, second, shellChanges: () => shellChanges };
}

test("a Terminal opens a login shell in the Chat's Worktree", async (t) => {
  const f = fixture(t);
  const opened = await f.terminals.open({ chatId: "/p#1", cols: 120, rows: 30 });
  assert.equal(f.ptys[0].file, "/bin/zsh");
  assert.deepEqual(f.ptys[0].args, ["-l"]);
  assert.equal(f.ptys[0].options.cwd, f.folder);
  assert.equal(f.ptys[0].options.cols, 120);
  assert.equal(opened.cwd, f.folder);
  assert.equal(opened.title, "zsh");
  assert.equal(opened.busy, false);
  assert.deepEqual(f.changes, ["/p#1"]);
  assert.equal(f.shellChanges(), 1);
  assert.deepEqual(
    (await f.terminals.list({ chatId: "/p#1" })).terminals.map((item) => item.id),
    [opened.id],
  );
  assert.deepEqual((await f.terminals.list({ chatId: "/p#9" })).terminals, []);
});

test("a shared Chat's Terminal opens only in one of its Worktrees", async (t) => {
  const f = fixture(t);
  const web = await f.terminals.open({ chatId: "link:abc#2", cwd: f.second });
  assert.equal(web.cwd, f.second);
  assert.equal(web.label, "web");
  await assert.rejects(f.terminals.open({ chatId: "link:abc#2", cwd: os.homedir() }), /Choose one of this Chat's Worktrees/);
  await assert.rejects(f.terminals.open({ chatId: "/p#404" }), /archived/);
});

test("reads return output after the viewer's offset, and all kept output to a new viewer", async (t) => {
  const f = fixture(t);
  const { id } = await f.terminals.open({ chatId: "/p#1" });
  f.ptys[0].emit("hello ");
  f.ptys[0].emit("world");
  const first = await f.terminals.read({ terminalId: id, after: 0 });
  assert.deepEqual([first.data, first.offset, first.reset, first.ended], ["hello world", 11, false, false]);
  f.ptys[0].emit("!");
  const next = await f.terminals.read({ terminalId: id, after: first.offset });
  assert.deepEqual([next.data, next.offset], ["!", 12]);
  const late = await f.terminals.read({ terminalId: id, after: 99 });
  assert.deepEqual([late.data, late.reset], ["hello world!", true]);
});

test("a read waits for output instead of returning nothing at once", async (t) => {
  const f = fixture(t, { readWaitMs: 5000 });
  const { id } = await f.terminals.open({ chatId: "/p#1" });
  const pending = f.terminals.read({ terminalId: id, after: 0 });
  setTimeout(() => f.ptys[0].emit("late"), 20);
  assert.equal((await pending).data, "late");
});

test("the buffer keeps only the newest lines", async (t) => {
  const f = fixture(t, { maxBufferLines: 3 });
  const { id } = await f.terminals.open({ chatId: "/p#1" });
  for (const line of ["a\n", "b\n", "c\n", "d\n"]) f.ptys[0].emit(line);
  const read = await f.terminals.read({ terminalId: id, after: 0 });
  assert.equal(read.reset, true);
  assert.equal(read.data, "b\nc\nd\n");
  assert.equal(read.offset, 8);
});

test("a single chunk larger than the buffer keeps its tail", async (t) => {
  const f = fixture(t, { maxBufferChars: 4 });
  const { id } = await f.terminals.open({ chatId: "/p#1" });
  f.ptys[0].emit("abcdefgh");
  const read = await f.terminals.read({ terminalId: id, after: 0 });
  assert.deepEqual([read.data, read.offset], ["efgh", 8]);
});

test("input, resize and close reach the shell", async (t) => {
  const f = fixture(t);
  const { id } = await f.terminals.open({ chatId: "/p#1" });
  assert.deepEqual(await f.terminals.input({ terminalId: id, data: "ls\r" }), { accepted: true });
  assert.deepEqual(f.ptys[0].written, ["ls\r"]);
  await f.terminals.resize({ terminalId: id, cols: 100, rows: 40 });
  await f.terminals.resize({ terminalId: id, cols: 100, rows: 40 });
  assert.deepEqual(f.ptys[0].sizes, [[100, 40]]);
  await assert.rejects(f.terminals.resize({ terminalId: id, cols: 0, rows: 40 }), /Invalid Terminal size/);
  await assert.rejects(f.terminals.input({ terminalId: id, data: 5 }), /Invalid Terminal input/);
  await f.terminals.close({ terminalId: id });
  assert.equal(f.ptys[0].killed, true);
  assert.deepEqual((await f.terminals.list({ chatId: "/p#1" })).terminals, []);
  await assert.rejects(f.terminals.input({ terminalId: id, data: "x" }), /ended/);
  assert.equal((await f.terminals.read({ terminalId: id, after: 0 })).ended, true);
});

test("a shell that exits ends its Terminal and answers a waiting read", async (t) => {
  const f = fixture(t, { readWaitMs: 5000 });
  const { id } = await f.terminals.open({ chatId: "/p#1" });
  const pending = f.terminals.read({ terminalId: id, after: 0 });
  f.ptys[0].emit("bye");
  const first = await pending;
  const waiting = f.terminals.read({ terminalId: id, after: first.offset });
  f.ptys[0].exit();
  assert.equal((await waiting).ended, true);
  assert.deepEqual((await f.terminals.list({ chatId: "/p#1" })).terminals, []);
});

test("archiving a Chat ends only its own Terminals", async (t) => {
  const f = fixture(t);
  await f.terminals.open({ chatId: "/p#1" });
  const other = await f.terminals.open({ chatId: "link:abc#2" });
  f.terminals.closeChat("/p#1");
  assert.equal(f.ptys[0].killed, true);
  assert.equal(f.ptys[1].killed, false);
  assert.deepEqual([...f.terminals.shells().keys()], ["link:abc#2"]);
  assert.equal((await f.terminals.list({ chatId: "link:abc#2" })).terminals[0].id, other.id);
});

test("a Terminal running a command is busy and titled after it", async (t) => {
  const f = fixture(t);
  const { id } = await f.terminals.open({ chatId: "/p#1" });
  f.ptys[0].process = "npm";
  await new Promise((resolve) => setTimeout(resolve, 40));
  const [listed] = (await f.terminals.list({ chatId: "/p#1" })).terminals;
  assert.equal(listed.id, id);
  assert.deepEqual([listed.title, listed.busy], ["npm", true]);
  assert.ok(f.changes.filter((chatId) => chatId === "/p#1").length >= 2);
});

test("a shell at its prompt is idle even when it reports another shell's name", async (t) => {
  const f = fixture(t, { shell: () => ({ file: "/bin/sh", args: [] }) });
  await f.terminals.open({ chatId: "/p#1" });
  // macOS's /bin/sh runs bash; a shell started inside the Terminal is a prompt as well.
  for (const name of ["bash", "-zsh", "fish"]) {
    f.ptys[0].process = name;
    assert.equal((await f.terminals.list({ chatId: "/p#1" })).terminals[0].busy, false, name);
  }
  f.ptys[0].process = "vim";
  assert.equal((await f.terminals.list({ chatId: "/p#1" })).terminals[0].busy, true);
});

test("a Chat's Terminals are limited", async (t) => {
  const f = fixture(t, { maxPerChat: 1 });
  await f.terminals.open({ chatId: "/p#1" });
  await assert.rejects(f.terminals.open({ chatId: "/p#1" }), /at most 1 Terminals/);
});

test("the shell is the user's own and the environment drops the host's Electron mode", () => {
  const exists = (file) => ["/opt/homebrew/bin/fish", "/bin/zsh"].includes(file);
  // The account's login shell wins over a $SHELL the host inherited from whatever started it.
  assert.deepEqual(terminalShell({ platform: "darwin", env: { SHELL: "/bin/zsh" }, exists, userShell: () => "/opt/homebrew/bin/fish" }), {
    file: "/opt/homebrew/bin/fish",
    args: ["-l"],
  });
  assert.equal(terminalShell({ platform: "darwin", env: { SHELL: "/opt/homebrew/bin/fish" }, exists, userShell: () => null }).file, "/opt/homebrew/bin/fish");
  assert.equal(terminalShell({ platform: "darwin", env: { SHELL: "/tmp/evil" }, exists, userShell: () => "/tmp/missing" }).file, "/bin/zsh");
  const windows = terminalShell({
    platform: "win32",
    env: { Path: "C:\\Tools", SystemRoot: "C:\\Windows" },
    exists: (file) => file === "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  });
  assert.equal(windows.file, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  const env = terminalEnvironment({ ELECTRON_RUN_AS_NODE: "1", MILAGRE_BUNDLED_BIN_DIR: "/x", PATH: "/bin", LANG: "pt_BR.UTF-8" });
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.MILAGRE_BUNDLED_BIN_DIR, undefined);
  assert.deepEqual([env.PATH, env.TERM, env.TERM_PROGRAM, env.LANG], ["/bin", "xterm-256color", "Milagre", "pt_BR.UTF-8"]);
});

// node-pty's native part is missing where npm skipped its install script and no prebuilt binary fits (Linux).
const ptyLoads = (() => {
  try {
    return typeof require("node-pty").spawn === "function";
  } catch {
    return false;
  }
})();

test(
  "a real PTY runs the shell and echoes input",
  { skip: process.platform === "win32" ? "POSIX shell" : !ptyLoads && "node-pty is not built here" },
  async (t) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-terminals-"));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const terminals = createTerminals({
      resolveChat: async () => [{ path: folder, label: "real" }],
      shell: () => ({ file: "/bin/sh", args: [] }),
      environment: () => terminalEnvironment({ PATH: "/usr/bin:/bin", HOME: folder, PS1: "$ " }),
    });
    t.after(() => terminals.dispose());
    const { id } = await terminals.open({ chatId: "/p#1" });
    await terminals.input({ terminalId: id, data: "echo milagre-$((40+2)); pwd\r" });
    let output = "",
      offset = 0;
    const deadline = Date.now() + 5000;
    while (!/milagre-42[\s\S]*milagre-terminals-/.test(output) && Date.now() < deadline) {
      const read = await terminals.read({ terminalId: id, after: offset });
      output = read.reset ? read.data : output + read.data;
      offset = read.offset;
    }
    assert.match(output, /milagre-42/);
    assert.match(output, new RegExp(path.basename(folder)));
  },
);
