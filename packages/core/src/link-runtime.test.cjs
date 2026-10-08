const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { createRuntime } = require("./runtime.cjs");
const { scopeKey, chatKeyForScope } = require("@milagre/shared/chat-scopes");
async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-link-runtime-")));
  const events = [],
    created = [],
    runtimes = [];
  const options = {
    dataDir: path.join(dir, "profile"),
    worktreeRoot: path.join(dir, "worktrees"),
    registryRoots: [],
    version: "test",
    environmentReady: Promise.resolve(),
    titleModels: {},
    agentCli: async () => ({ command: "/fake" }),
    emit: (channel, payload) => events.push({ channel, payload }),
    createSession: (provider, context) => {
      created.push(context);
      return {
        turnActive: false,
        startTurn() {
          context.emit({ type: "session-started", nativeId: "native" });
          context.emit({ type: "turn-started", turnId: randomUUID() });
          context.emit({ type: "text-delta", messageId: "reply", text: "Changed both" });
          context.emit({ type: "turn-completed" });
          return { turnId: "turn" };
        },
        close() {},
        interrupt() {},
      };
    },
  };
  t.after(async () => {
    for (const runtime of runtimes) await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const make = () => {
    const runtime = createRuntime(options);
    runtimes.push(runtime);
    return runtime;
  };
  const runtime = make();
  for (const name of ["api", "web"]) {
    const folder = path.join(dir, name);
    await fs.mkdir(folder);
    execFileSync("git", ["init", "-qb", "main", folder]);
    execFileSync("git", ["-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "Initial"]);
    await runtime.openProject(folder);
  }
  const projects = await runtime.invoke("project:registry");
  return { dir, runtime, make, projects, events, created };
}
test("shared Chat keeps one canonical transcript and exact Worktrees across retries and restart", async (t) => {
  const { runtime, make, projects, events, created } = await fixture(t);
  assert.ok(runtime.methods.includes("link:create"));
  const link = await runtime.invoke("link:create", [{ name: "Food", projectIds: projects.map((p) => p.id) }]);
  const opened = await runtime.invoke("link:open", [link.id]);
  assert.deepEqual(opened.state.sessions, {});
  const request = { linkId: link.id, sessionId: null, operationId: randomUUID(), body: "Edit both", provider: "codex", model: "test", permissionMode: "auto" };
  const sent = await runtime.invoke("link:send", [request]);
  await runtime.flush();
  const state = (await runtime.invoke("link:snapshot", [link.id])).state;
  const session = state.sessions[sent.sessionId];
  assert.equal(session.worktrees.length, 2);
  assert.equal(created[0].workspaceRoots.length, 2);
  assert.equal(created[0].cwd, session.workspacePath);
  assert.equal(state.messages.filter((m) => m.body === "Changed both").length, 1);
  assert.deepEqual(await runtime.invoke("link:send", [request]), sent);
  await runtime.close();
  const next = make();
  const reopened = await next.invoke("link:open", [link.id]);
  assert.deepEqual(reopened.state.sessions[sent.sessionId].worktrees, session.worktrees);
  const owner = scopeKey({ kind: "link", linkId: link.id });
  await next.invoke("chat:patch", [owner, sent.sessionId, { title: "Shared saved", archived: true }]);
  assert.equal((await next.invoke("link:snapshot", [link.id])).state.sessions[sent.sessionId].title, "Shared saved");
  assert.ok(events.some((event) => event.channel === "link:state"));
  for (const project of projects) {
    const view = await next.openProject(project.path);
    const shared = Object.values(view.state.worktrees).find((w) => w.sharedChat);
    assert.ok(shared);
    assert.equal(
      Object.values(view.state.sessions).some((s) => s.worktree_id === shared.id),
      false,
    );
  }
});
test("missing Project leaves shared history readable but blocks sends", async (t) => {
  const { runtime, projects } = await fixture(t);
  assert.ok(runtime.methods.includes("link:create"));
  const link = await runtime.invoke("link:create", [{ name: "Food", projectIds: projects.map((p) => p.id) }]);
  await runtime.invoke("link:open", [link.id]);
  await fs.rename(projects[0].path, projects[0].path + "-moved");
  try {
    assert.ok((await runtime.invoke("link:open", [link.id])).state);
    await assert.rejects(runtime.invoke("link:send", [{ linkId: link.id, operationId: randomUUID(), body: "Edit" }]), /unavailable/);
  } finally {
    await fs.rename(projects[0].path + "-moved", projects[0].path);
  }
});

test("Git accepts a selected member and refuses the aggregate workspace; editor roots are explicitly validated", async (t) => {
  const { runtime, projects } = await fixture(t);
  const link = await runtime.invoke("link:create", [{ name: "Food", projectIds: projects.map((p) => p.id) }]);
  await runtime.invoke("link:open", [link.id]);
  const sent = await runtime.invoke("link:send", [
    { linkId: link.id, operationId: randomUUID(), sessionId: null, body: "Edit", provider: "codex", model: "test", permissionMode: "auto" },
  ]);
  const session = (await runtime.invoke("link:snapshot", [link.id])).state.sessions[sent.sessionId];
  await assert.rejects(runtime.invoke("git:changes", [{ cwd: session.workspacePath }]), /folder/);
  assert.ok((await runtime.invoke("git:changes", [{ cwd: session.worktrees[1].worktreePath }])).isRepo);
  assert.deepEqual(
    await runtime.invoke("link:workspace-roots", [session.workspacePath]),
    session.worktrees.map((member) => member.worktreePath),
  );
  await assert.rejects(runtime.invoke("link:workspace-roots", ["/"]), /workspace/);
});
test("a plain directory replacing a registered member Worktree cannot start a provider", async (t) => {
  const { runtime, projects, created } = await fixture(t);
  const link = await runtime.invoke("link:create", [{ name: "Food", projectIds: projects.map((project) => project.id) }]);
  await runtime.invoke("link:open", [link.id]);
  const request = { linkId: link.id, sessionId: null, operationId: randomUUID(), body: "Edit", provider: "codex", model: "test", permissionMode: "auto" };
  const sent = await runtime.invoke("link:send", [request]);
  await runtime.flush();
  const session = (await runtime.invoke("link:snapshot", [link.id])).state.sessions[sent.sessionId];
  const member = session.worktrees[0];
  execFileSync("git", ["-C", member.projectPath, "worktree", "remove", member.worktreePath]);
  await fs.mkdir(member.worktreePath);
  const count = created.length;
  await assert.rejects(runtime.invoke("link:send", [{ ...request, sessionId: session.id, operationId: randomUUID() }]), /Worktree.*unavailable/);
  assert.equal(created.length, count);
});
test("unavailable owned Worktrees keep an interrupted turn resumable after repair", async (t) => {
  const { runtime, projects, dir, make } = await fixture(t);
  const link = await runtime.invoke("link:create", [{ name: "Food", projectIds: projects.map((project) => project.id) }]);
  await runtime.invoke("link:open", [link.id]);
  const sent = await runtime.invoke("link:send", [
    { linkId: link.id, sessionId: null, operationId: randomUUID(), body: "Edit", provider: "codex", model: "test", permissionMode: "auto" },
  ]);
  await runtime.flush();
  const owner = scopeKey({ kind: "link", linkId: link.id });
  const resumeTurn = { stoppedAt: Date.now(), provider: "codex", model: "test", permissionMode: "auto", prompt: "Continue" };
  const session = (await runtime.invoke("link:snapshot", [link.id])).state.sessions[sent.sessionId];
  const root = session.worktrees[0].worktreePath;
  await runtime.close();
  const file = path.join(dir, "profile", "links", link.id, ".milagre", "coordination.json");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  saved.sessions[sent.sessionId].resumeTurn = resumeTurn;
  await fs.writeFile(file, JSON.stringify(saved));
  const next = make();
  await fs.rename(root, root + "-moved");
  try {
    await next.invoke("link:open", [link.id]);
    assert.deepEqual((await next.invoke("link:snapshot", [link.id])).state.sessions[sent.sessionId].resumeTurn, resumeTurn);
  } finally {
    await fs.rename(root + "-moved", root);
  }
  assert.equal(await next.invoke("chat:resume", [owner, sent.sessionId]), true);
});
test("shared Chats retain canvas reads and external readers see the canonical transcript", async (t) => {
  const { runtime, projects, created } = await fixture(t);
  const link = await runtime.invoke("link:create", [{ name: "Food", projectIds: projects.map((project) => project.id) }]);
  await runtime.invoke("link:open", [link.id]);
  const request = { linkId: link.id, sessionId: null, operationId: randomUUID(), body: "Edit", provider: "codex", model: "test", permissionMode: "auto" };
  const sent = await runtime.invoke("link:send", [request]);
  await runtime.flush();
  const session = (await runtime.invoke("link:snapshot", [link.id])).state.sessions[sent.sessionId];
  const member = session.worktrees[0],
    external = projects.find((project) => project.id !== member.projectId);
  await runtime.invoke("canvas:link-add", [
    { project_id: member.projectId, worktree_path: member.worktreePath },
    { project_id: external.id, worktree_path: external.path },
  ]);
  const tools = created[0].linked.tools;
  assert.ok((await tools.find((tool) => tool.name === "linked_overview").run()).includes(external.path));
  const current = await runtime.openProject(external.path),
    starter = Object.values(current.state.sessions)[0];
  await runtime.invoke("chat:send", [
    { projectPath: external.path, sessionId: starter.id, body: "Read shared work", provider: "codex", model: "test", permissionMode: "auto" },
  ]);
  await runtime.flush();
  for (let i = 0; i < 100 && created.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(created.length, 2, "External provider started");
  const ordinaryTools = created.at(-1).linked.tools;
  const ref = chatKeyForScope({ kind: "link", linkId: link.id }, session.id);
  assert.match(await ordinaryTools.find((tool) => tool.name === "linked_overview").run(), new RegExp(ref));
  assert.match(await ordinaryTools.find((tool) => tool.name === "read_linked_chat").run({ chat: ref }), /Changed both/);
  await assert.rejects(
    ordinaryTools.find((tool) => tool.name === "delegate").run({ worktree: member.worktreePath, chat: ref, message: "Edit this" }),
    /Delegation into a shared Link Chat is not supported/,
  );
});
test("editing a Link adds and removes member Projects for new Chats; existing Chats keep their Worktrees", async (t) => {
  const { dir, runtime, projects } = await fixture(t);
  const folder = path.join(dir, "admin");
  await fs.mkdir(folder);
  execFileSync("git", ["init", "-qb", "main", folder]);
  execFileSync("git", ["-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "Initial"]);
  await runtime.openProject(folder);
  const admin = (await runtime.invoke("project:registry")).find((project) => project.path === folder);
  const link = await runtime.invoke("link:create", [{ name: "Food", projectIds: projects.map((project) => project.id) }]);
  await runtime.invoke("link:open", [link.id]);
  const request = { linkId: link.id, sessionId: null, provider: "codex", model: "test", permissionMode: "auto", body: "Edit" };
  const first = await runtime.invoke("link:send", [{ ...request, operationId: randomUUID() }]);
  await runtime.flush();
  assert.ok(runtime.methods.includes("link:update"), "Link membership can be edited");
  const edited = await runtime.invoke("link:update", [{ id: link.id, name: " Food v2 ", projectIds: [projects[1].id, admin.id] }]);
  assert.deepEqual(edited, { ...link, name: "Food v2", projectIds: [projects[1].id, admin.id] });
  assert.deepEqual(await runtime.invoke("link:list"), [edited]);
  await assert.rejects(runtime.invoke("link:update", [{ id: link.id, name: "Food", projectIds: [admin.id] }]), /two/);
  const second = await runtime.invoke("link:send", [{ ...request, operationId: randomUUID() }]);
  await runtime.flush();
  const state = (await runtime.invoke("link:snapshot", [link.id])).state;
  assert.deepEqual(
    state.sessions[second.sessionId].worktrees.map((member) => member.projectId),
    [projects[1].id, admin.id],
  );
  assert.deepEqual(
    state.sessions[first.sessionId].worktrees.map((member) => member.projectId),
    projects.map((project) => project.id),
  );
  await runtime.invoke("link:send", [{ ...request, sessionId: first.sessionId, operationId: randomUUID() }]);
});
