const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { createRuntime } = require("./runtime.cjs");

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check(), "Expected runtime event did not arrive");
}

async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-account-routing-")));
  const dataDir = path.join(dir, "profile");
  const accountFile = path.join(dataDir, "accounts", "accounts.json");
  const ids = { personal: randomUUID(), work: randomUUID(), shared: randomUUID() };
  const projects = [];
  for (const name of ["api", "web"]) {
    const folder = path.join(dir, name);
    await fs.mkdir(folder);
    execFileSync("git", ["init", "-qb", "main", folder]);
    execFileSync("git", [
      "-C",
      folder,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--allow-empty",
      "-qm",
      "Initial",
    ]);
    projects.push(folder);
  }
  const saved = {
    accounts: Object.entries(ids).map(([label, id]) => ({ id, provider: "claude", label })),
    selected: { claude: ids.personal, codex: "default" },
    scopes: { [projects[0]]: { claude: ids.work }, [projects[1]]: { claude: ids.personal } },
  };
  await fs.mkdir(path.dirname(accountFile), { recursive: true, mode: 0o700 });
  const save = () => fs.writeFile(accountFile, JSON.stringify(saved));
  await save();
  const cli = path.join(dir, "fake-claude");
  await fs.writeFile(cli, '#!/bin/sh\nprintf \'%s\\n\' \'{"loggedIn":true,"email":"fixture@example.test","subscriptionType":"pro"}\'\n', { mode: 0o700 });
  const events = [],
    created = [],
    runtimes = [];
  t.after(async () => {
    try {
      for (const runtime of runtimes) await runtime.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  const make = () => {
    const runtime = createRuntime({
      dataDir,
      cwd: projects[0],
      registryRoots: [],
      worktreeRoot: path.join(dir, "worktrees"),
      environmentReady: Promise.resolve(),
      titleModels: {},
      agentCli: async (provider) => (provider === "claude" ? { command: cli } : { problem: "Codex is not installed in this fixture" }),
      emit: (channel, payload) => events.push({ channel, payload }),
      createSession(provider, context) {
        const session = {
          provider,
          context,
          turns: [],
          turnActive: false,
          closed: false,
          nativeId: randomUUID(),
          startTurn(turn) {
            this.turns.push(turn);
            this.turnActive = true;
            context.emit({ type: "session-started", nativeId: this.nativeId });
            context.emit({ type: "turn-started", turnId: randomUUID() });
            return { turnId: "fixture-turn" };
          },
          finish() {
            this.turnActive = false;
            context.emit({ type: "turn-completed" });
          },
          close() {
            this.closed = true;
            if (this.turnActive) {
              this.turnActive = false;
              context.emit({ type: "turn-cancelled" });
            }
          },
        };
        created.push(session);
        return session;
      },
    });
    runtimes.push(runtime);
    return runtime;
  };
  const profile = (id) => path.join(dataDir, "accounts", id);
  const send = (runtime, projectPath, sessionId, body = "Use this account") =>
    runtime.invoke("chat:send", [{ projectPath, sessionId, body, provider: "claude", model: "test", permissionMode: "auto" }]);
  return { make, projects, saved, save, ids, profile, created, events, send, dataDir };
}

test("concurrent Projects route by their own scope and reuse accounts after switching the viewed Project", async (t) => {
  const { make, projects, ids, profile, created, send } = await fixture(t);
  const runtime = make();
  const a = await runtime.openProject(projects[0]);
  const b = await runtime.openProject(projects[1]);
  const aId = Object.values(a.state.sessions)[0].id,
    bId = Object.values(b.state.sessions)[0].id;
  await Promise.all([send(runtime, a.path, aId), send(runtime, b.path, bId)]);
  await until(() => created.length === 2);
  const forA = created.find((session) => session.context.cwd === a.path);
  const forB = created.find((session) => session.context.cwd === b.path);
  assert.equal(forA.context.env.CLAUDE_CONFIG_DIR, profile(ids.work));
  assert.equal(forB.context.env.CLAUDE_CONFIG_DIR, profile(ids.personal));
  assert.equal(forA.turnActive && forB.turnActive, true);
  forA.finish();
  forB.finish();
  await runtime.flush();
  await runtime.openProject(a.path);
  await send(runtime, b.path, bId, "Continue B");
  await send(runtime, a.path, aId, "Continue A");
  await until(() => forA.turns.length === 2 && forB.turns.length === 2);
  assert.equal(created.length, 2, "Changing the viewed Project must not replace provider sessions");
});

test("a named Link has its own account, independent of members and viewed Project", async (t) => {
  const { make, projects, saved, save, ids, profile, created } = await fixture(t);
  const first = make();
  for (const project of projects) await first.openProject(project);
  const registry = await first.invoke("project:registry");
  const link = await first.invoke("link:create", [{ name: "API and Web", projectIds: registry.map((project) => project.id) }]);
  await first.close();
  saved.scopes[`milagre-link:${link.id}`] = { claude: ids.shared };
  await save();
  const runtime = make();
  await runtime.invoke("link:open", [link.id]);
  await runtime.openProject(projects[0]);
  const request = { linkId: link.id, operationId: randomUUID(), sessionId: null, body: "Edit both", provider: "claude", model: "test", permissionMode: "auto" };
  const sent = await runtime.invoke("link:send", [request]);
  await until(() => created.length === 1);
  assert.equal(created[0].context.env.CLAUDE_CONFIG_DIR, profile(ids.shared));
  assert.equal(created[0].context.workspaceRoots.length, 2);
  created[0].finish();
  await runtime.flush();
  await runtime.openProject(projects[1]);
  await runtime.invoke("link:send", [{ ...request, sessionId: sent.sessionId, operationId: randomUUID(), body: "Continue both" }]);
  await until(() => created[0].turns.length === 2);
  assert.equal(created.length, 1);
});

test("a removed explicitly assigned account fails the Chat without starting the computer default", async (t) => {
  const { make, projects, saved, save, created, events, send } = await fixture(t);
  saved.scopes[projects[0]].claude = randomUUID();
  await save();
  const runtime = make();
  const opened = await runtime.openProject(projects[0]);
  const id = Object.values(opened.state.sessions)[0].id;
  await send(runtime, opened.path, id);
  await until(() => events.some(({ channel, payload }) => channel === "agent:event" && payload.event.type === "turn-failed") || created.length > 0);
  assert.equal(created.length, 0, "A stale explicit assignment must never fall back");
  const failure = events.find(({ channel, payload }) => channel === "agent:event" && payload.event.type === "turn-failed");
  assert.equal(failure.payload.chatId, `${opened.path}#${id}`);
  assert.match(failure.payload.event.message, /account/i);
});

test("account scope RPCs enumerate Projects and Links, validate scope, and persist independent assignments", async (t) => {
  const { make, projects, ids } = await fixture(t);
  const runtime = make();
  for (const project of projects) await runtime.openProject(project);
  const registry = await runtime.invoke("project:registry");
  const link = await runtime.invoke("link:create", [{ name: "Together", projectIds: registry.map((project) => project.id) }]);
  const linkKey = `milagre-link:${link.id}`;
  const scopes = await runtime.invoke("accounts:scopes");
  for (const project of registry) {
    const entry = scopes.find((scope) => scope.key === project.path);
    assert.equal(entry.kind, "project");
    assert.deepEqual(
      entry.projects.map((member) => member.id),
      [project.id],
    );
  }
  const entry = scopes.find((scope) => scope.key === linkKey);
  assert.equal(entry.name, "Together");
  assert.equal(entry.kind, "link");
  assert.deepEqual(entry.projects.map((project) => project.id).sort(), registry.map((project) => project.id).sort());
  const claude = (snapshot) => snapshot.providers.find((provider) => provider.provider === "claude");
  assert.equal(claude(await runtime.invoke("accounts:scope", [projects[0], true])).effectiveId, ids.work);
  // The saved file predates Antigravity: Antigravity follows its Milagre-owned default profile.
  const antigravity = (await runtime.invoke("accounts:scope", [projects[0]])).providers.find((provider) => provider.provider === "antigravity");
  assert.equal(antigravity.effectiveId, "default");
  assert.equal(antigravity.accounts[0].label, "Default account");
  await runtime.invoke("accounts:assign", [linkKey, "claude", ids.shared]);
  assert.equal(claude(await runtime.invoke("accounts:scope", [linkKey])).accountId, ids.shared);
  assert.equal(claude(await runtime.invoke("accounts:scope", [projects[0]])).accountId, ids.work);
  await runtime.invoke("accounts:assign", [projects[0], "claude", null]);
  const cleared = claude(await runtime.invoke("accounts:scope", [projects[0]]));
  assert.equal(cleared.accountId, null);
  assert.equal(cleared.effectiveId, ids.personal);
  assert.equal(cleared.defaultId, ids.personal);
  for (const invalid of [path.join(path.dirname(projects[0]), "unregistered"), `milagre-link:${randomUUID()}`]) {
    await assert.rejects(runtime.invoke("accounts:scope", [invalid]));
    await assert.rejects(runtime.invoke("accounts:assign", [invalid, "claude", null]));
  }
  await assert.rejects(runtime.invoke("accounts:assign", [projects[0], "unknown", null]));
  await assert.rejects(runtime.invoke("accounts:assign", [projects[0], "claude", randomUUID()]));
  await runtime.close();
  const restored = make();
  assert.equal(claude(await restored.invoke("accounts:scope", [linkKey])).accountId, ids.shared);
  assert.equal(claude(await restored.invoke("accounts:scope", [projects[0]])).accountId, null);
});

test("cached usage resolves the requested account pair without leaking the viewed Project usage", async (t) => {
  const { make, projects, ids, dataDir } = await fixture(t);
  for (const [id, usedPercent] of [
    [ids.work, 17],
    [ids.personal, 81],
  ]) {
    await fs.writeFile(
      path.join(dataDir, `usage-${id}-default.json`),
      JSON.stringify({
        claude: {
          last: { updatedAt: new Date().toISOString(), windows: [{ id: "session", label: "Session", shortLabel: "5h", usedPercent, resetsAt: null }] },
          blocked: null,
        },
      }),
    );
  }
  const runtime = make();
  for (const project of projects) await runtime.openProject(project);
  const usage = async (scope) =>
    (await runtime.invoke("usage:cached", scope ? [scope] : [])).providers.find((provider) => provider.provider === "claude").windows[0].usedPercent;
  const workUsage = await runtime.invoke("usage:cached", [projects[0]]);
  assert.deepEqual(workUsage.providers[0].account, { id: ids.work, label: "work", email: "fixture@example.test" });
  const personalUsage = await runtime.invoke("usage:cached", [projects[1]]);
  assert.equal(personalUsage.providers[0].account.id, ids.personal);
  assert.equal(personalUsage.providers[0].account.label, "personal");
  assert.equal(await usage(projects[0]), 17);
  assert.equal(await usage(projects[1]), 81);
  assert.equal(await usage(), 81);
  await runtime.openProject(projects[0]);
  assert.equal(await usage(projects[1]), 81);
  await assert.rejects(runtime.invoke("usage:cached", [path.join(dataDir, "unregistered")]));
});
