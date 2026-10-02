const assert = require("node:assert/strict");
const test = require("node:test");
const { ChatHost } = require("./chat-host.cjs");
const { SessionManager } = require("./session-manager.cjs");
const { ProjectStates } = require("../project-states.cjs");
const { applyRunEvent } = require("../shared/agent-runs.mjs");
const { waitUntil } = require("./test-helpers.cjs");

class FakeSession {
  constructor(provider, options) {
    Object.assign(this, { provider, options, turns: [], interrupts: 0, closed: false });
  }

  async startTurn(turn) {
    this.turns.push(turn);
    return { turnId: `t${this.turns.length}` };
  }

  emit(event) {
    this.options.emit(event);
  }

  async interrupt() {
    this.interrupts += 1;
  }

  async close() {
    this.closed = true;
  }
}

const ALPHA = "/projects/alpha";
const BETA = "/projects/beta";

function projectState(projectPath) {
  return {
    next_id: 2,
    projects: { 1: { id: 1, name: projectPath.split("/").at(-1) } },
    worktrees: { 1: { id: 1, name: "main", path: projectPath } },
    sessions: {},
    connections: {},
    events: [],
    messages: [],
    approvals: [],
    tasks: {},
    artifacts: {},
    outputs: [],
    conflicts: [],
  };
}

// The main process's chat wiring with fake agents and two projects saved in memory, as main.cjs builds it.
function harness({ failStart = null, focused = true, handoverTools = { writeTranscript: async ({ sessionId }) => `/tmp/handovers/${sessionId}.md`, brief: async ({ transcriptPath }) => `BRIEF ${transcriptPath}` } } = {}) {
  const saved = new Map();
  const published = [];
  const broadcasts = [];
  const created = [];
  const states = new ProjectStates({
    read: async (projectPath) => projectState(projectPath),
    save: async (projectPath, state) => void saved.set(projectPath, state),
  });
  const manager = new SessionManager({
    createSession: (provider, options) => {
      const session = new FakeSession(provider, options);
      created.push(session);
      return session;
    },
    send: (chatId, event) => void host.receive(chatId, event),
    batchMs: 5,
  });
  const host = new ChatHost({
    states,
    startTurn: (request) => (failStart ? Promise.reject(new Error(failStart)) : manager.startTurn({ ...request, command: "/bin/agent" })),
    publish: (chatId, event, state, seq) => published.push({ chatId, event, state, seq }),
    broadcast: (projectPath, state) => broadcasts.push({ projectPath, state }),
    isFocused: () => focused,
    handoverTools,
  });
  const session = (cwd) => created.find((item) => item.options.cwd === cwd);
  return { host, manager, states, saved, published, broadcasts, created, session };
}

const message = (projectPath, body, extra = {}) => ({ projectPath, sessionId: null, worktreeId: 1, body, images: [], provider: "claude", model: "claude-opus-5-5", permissionMode: "auto", ...extra });
const chatMessages = (state, sessionId) => state.messages.filter((item) => item.session_id === sessionId).map(({ role, body, outcome }) => ({ role, body, ...(outcome ? { outcome } : {}) }));

test("turns in two projects run side by side and each is saved in its own project", async (t) => {
  const { host, manager, saved, session } = harness();
  t.after(() => manager.closeAll());
  const alpha = await host.send(message(ALPHA, "fix the api"));
  const beta = await host.send(message(BETA, "wire the frontend"));
  // Only alpha's chat is on screen; beta's project isn't even open.
  host.setOpenChat(`${ALPHA}#${alpha.sessionId}`);
  await waitUntil(() => session(ALPHA) && session(BETA));

  for (const [cwd, reply] of [[ALPHA, "API fixed."], [BETA, "Frontend wired."]]) {
    session(cwd).emit({ type: "turn-started", turnId: "t1" });
    session(cwd).emit({ type: "text-delta", messageId: "m1", text: reply });
  }
  session(BETA).emit({ type: "turn-completed" });
  session(ALPHA).emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 2 && saved.get(BETA)?.messages.length === 2);

  assert.deepEqual(chatMessages(saved.get(ALPHA), alpha.sessionId), [{ role: "user", body: "fix the api" }, { role: "assistant", body: "API fixed.", outcome: "completed" }]);
  assert.deepEqual(chatMessages(saved.get(BETA), beta.sessionId), [{ role: "user", body: "wire the frontend" }, { role: "assistant", body: "Frontend wired.", outcome: "completed" }]);
  // A turn that ends off screen leaves its chat unread; nothing was interrupted.
  assert.equal(saved.get(ALPHA).sessions[alpha.sessionId].unread, undefined);
  assert.equal(saved.get(BETA).sessions[beta.sessionId].unread, true);
  assert.deepEqual([session(ALPHA).interrupts, session(BETA).interrupts], [0, 0]);
});

test("switching the open chat to another project leaves running turns running", async (t) => {
  const { host, manager, saved, session } = harness();
  t.after(() => manager.closeAll());
  const alpha = await host.send(message(ALPHA, "long task"));
  host.setOpenChat(`${ALPHA}#${alpha.sessionId}`);
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  session(ALPHA).emit({ type: "text-delta", messageId: "m1", text: "Halfway" });

  const beta = await host.send(message(BETA, "meanwhile"));
  host.setOpenChat(`${BETA}#${beta.sessionId}`);
  session(ALPHA).emit({ type: "text-delta", messageId: "m1", text: " and done." });
  session(ALPHA).emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 2);

  assert.equal(session(ALPHA).interrupts, 0);
  assert.deepEqual(chatMessages(saved.get(ALPHA), alpha.sessionId).at(-1), { role: "assistant", body: "Halfway and done.", outcome: "completed" });
  assert.equal(saved.get(ALPHA).sessions[alpha.sessionId].unread, true);
});

test("a chat keeps its session id, provider session and worktree across turns", async (t) => {
  const { host, manager, saved, session } = harness();
  t.after(() => manager.closeAll());
  const first = await host.send(message(ALPHA, "one"));
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "session-started", nativeId: "native-7" });
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  session(ALPHA).emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 2);

  // The worktree asked for is ignored for an existing chat: it runs where it always has.
  const second = await host.send(message(ALPHA, "two", { sessionId: first.sessionId, worktreeId: 99 }));
  await waitUntil(() => session(ALPHA).turns.length === 2);

  assert.equal(second.sessionId, first.sessionId);
  assert.equal(saved.get(ALPHA).sessions[first.sessionId].native_session_id, "native-7");
  assert.equal(saved.get(ALPHA).sessions[first.sessionId].provider, "claude");
});

test("a message sent mid-turn saves the reply so far above it and steers the turn", async (t) => {
  const { host, manager, saved, session } = harness();
  t.after(() => manager.closeAll());
  const chat = await host.send(message(ALPHA, "start"));
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  session(ALPHA).emit({ type: "text-delta", messageId: "m1", text: "Working on it." });
  await waitUntil(() => host.runs[`${ALPHA}#${chat.sessionId}`]?.text === "Working on it.");

  await host.send(message(ALPHA, "also add tests", { sessionId: chat.sessionId }));
  session(ALPHA).emit({ type: "text-delta", messageId: "m2", text: "Tests added." });
  session(ALPHA).emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 4);

  assert.deepEqual(chatMessages(saved.get(ALPHA), chat.sessionId), [
    { role: "user", body: "start" },
    { role: "assistant", body: "Working on it." },
    { role: "user", body: "also add tests" },
    { role: "assistant", body: "Tests added.", outcome: "completed" },
  ]);
  assert.equal(session(ALPHA).turns.length, 2);
});

test("a turn that can't start fails in its chat", async () => {
  const { host, saved } = harness({ failStart: "Claude Code isn't installed." });
  const chat = await host.send(message(BETA, "hello"));
  await waitUntil(() => saved.get(BETA)?.messages.length === 2);

  assert.deepEqual(chatMessages(saved.get(BETA), chat.sessionId).at(-1), { role: "assistant", body: "Agent error: Claude Code isn't installed.", outcome: "failed" });
});

test("a message for a chat or worktree that's gone is refused and saves nothing", async () => {
  const { host, saved } = harness();
  await assert.rejects(host.send(message(ALPHA, "hi", { sessionId: 42 })), /That chat is no longer in the project/);
  await assert.rejects(host.send(message(ALPHA, "hi", { worktreeId: 42 })), /That worktree is no longer in the project/);
  assert.equal(saved.has(ALPHA), false);
});

test("a window that loads mid-turn takes the runs and skips the events they hold", async (t) => {
  const { host, manager, published, session } = harness();
  t.after(() => manager.closeAll());
  const chat = await host.send(message(ALPHA, "go"));
  const chatId = `${ALPHA}#${chat.sessionId}`;
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  session(ALPHA).emit({ type: "text-delta", messageId: "m1", text: "Before reload. " });
  session(ALPHA).emit({ type: "permission-request", requestId: "r1", kind: "command", tool: "Shell", title: "Run this command?", command: "ls", allowForChat: true });
  await waitUntil(() => host.runs[chatId]?.approvals.length === 1);

  const snapshot = host.snapshot();
  assert.equal(snapshot.runs[chatId].text, "Before reload. ");
  assert.deepEqual(snapshot.runs[chatId].approvals.map((request) => request.requestId), ["r1"]);

  session(ALPHA).emit({ type: "text-delta", messageId: "m1", text: "After reload." });
  await waitUntil(() => host.runs[chatId]?.text.endsWith("After reload."));
  await waitUntil(() => published.some((item) => item.event.type === "text-delta" && item.event.text === "After reload."));

  // The reloaded window applies only the events numbered after its snapshot.
  const runs = published
    .filter((item) => item.seq > snapshot.seq)
    .reduce((current, item) => applyRunEvent(current, item.chatId, item.event), snapshot.runs);
  assert.equal(runs[chatId].text, "Before reload. After reload.");
  assert.ok(published.every((item) => typeof item.seq === "number"));
});

test("a turn that ends in the open chat while no window has focus leaves it unread", async (t) => {
  const { host, manager, saved, session } = harness({ focused: false });
  t.after(() => manager.closeAll());
  const chat = await host.send(message(ALPHA, "go"));
  host.setOpenChat(`${ALPHA}#${chat.sessionId}`);
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  session(ALPHA).emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 2);

  assert.equal(saved.get(ALPHA).sessions[chat.sessionId].unread, true);
});

test("a note added while the chat's turn runs lands after the reply", async (t) => {
  const { host, manager, saved, session } = harness();
  t.after(() => manager.closeAll());
  const chat = await host.send(message(ALPHA, "commit it"));
  const chatId = `${ALPHA}#${chat.sessionId}`;
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  session(ALPHA).emit({ type: "text-delta", messageId: "m1", text: "Committing." });
  await waitUntil(() => host.runs[chatId]?.text === "Committing.");

  await host.addNote(chatId, { body: "Committed abc123", context: { kind: "git-action" } });
  assert.equal(saved.get(ALPHA).messages.length, 1, "the note waits for the turn");
  session(ALPHA).emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 3);

  assert.deepEqual(saved.get(ALPHA).messages.map(({ role, body, context }) => ({ role, body, context })), [
    { role: "user", body: "commit it", context: null },
    { role: "assistant", body: "Committing.", context: null },
    { role: "assistant", body: "Committed abc123", context: { kind: "git-action" } },
  ]);
});

test("a note for a chat with no turn running is saved at once and sent to the windows", async () => {
  const { host, saved, broadcasts } = harness({ failStart: "no agent" });
  const chat = await host.send(message(BETA, "hi"));
  await waitUntil(() => saved.get(BETA)?.messages.length === 2);
  await host.addNote(`${BETA}#${chat.sessionId}`, { body: "Pushed to origin", context: { kind: "git-action" } });

  assert.equal(saved.get(BETA).messages.at(-1).body, "Pushed to origin");
  assert.equal(broadcasts.at(-1).state.messages.at(-1).body, "Pushed to origin");
});

test("answers to a question are saved as the user's message after the reply so far, and can be taken back", async (t) => {
  const { host, manager, saved, published, session } = harness();
  t.after(() => manager.closeAll());
  const chat = await host.send(message(ALPHA, "plan it"));
  const chatId = `${ALPHA}#${chat.sessionId}`;
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  session(ALPHA).emit({ type: "text-delta", messageId: "m1", text: "Which layout?" });
  await waitUntil(() => host.runs[chatId]?.text === "Which layout?");

  const messageId = await host.recordAnswers(chatId, "Layout: grid");
  assert.deepEqual(chatMessages(saved.get(ALPHA), chat.sessionId), [
    { role: "user", body: "plan it" },
    { role: "assistant", body: "Which layout?" },
    { role: "user", body: "Layout: grid" },
  ]);
  assert.equal(host.runs[chatId].text, "");
  assert.equal(published.at(-1).event.type, "answers-sent");

  await host.takeBack(chatId, messageId);
  assert.equal(saved.get(ALPHA).messages.some((item) => item.id === messageId), false);
});

async function chatWithReply(host, session, saved) {
  const { sessionId } = await host.send(message(ALPHA, "fix the login redirect"));
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  session(ALPHA).emit({ type: "text-delta", messageId: "m1", text: "Done." });
  session(ALPHA).emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 2);
  return sessionId;
}

test("handover opens a linked chat on the other provider in the same worktree and keeps the brief as a draft", async (t) => {
  const briefs = [];
  const { host, manager, saved, session, created } = harness({ handoverTools: {
    writeTranscript: async ({ sessionId, markdown }) => { assert.match(markdown, /fix the login redirect/); return `/tmp/handovers/${sessionId}.md`; },
    brief: async (input) => { briefs.push(input); return "BRIEF"; },
  } });
  t.after(() => manager.closeAll());
  const source = await chatWithReply(host, session, saved);

  const { sessionId: target } = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6", permissionMode: "auto", effort: "high", replies: "concise" });
  assert.notEqual(target, source);
  assert.equal(saved.get(ALPHA).sessions[source].handedOverTo, target);
  const linked = saved.get(ALPHA).sessions[target];
  assert.deepEqual({ worktree_id: linked.worktree_id, provider: linked.provider, handedOverFrom: linked.handedOverFrom }, { worktree_id: 1, provider: "codex", handedOverFrom: source });

  await host.pendingHandovers.get(`${ALPHA}#${target}`);
  const state = saved.get(ALPHA);
  assert.equal(state.sessions[target].handoverPending, undefined);
  assert.equal(state.sessions[target].handoverDraft, "BRIEF");
  assert.deepEqual(chatMessages(state, target), []);
  assert.deepEqual(briefs.map(({ provider, lastUserMessage, cwd, transcriptPath }) => ({ provider, lastUserMessage, cwd, transcriptPath })), [{ provider: "claude", lastUserMessage: "fix the login redirect", cwd: ALPHA, transcriptPath: `/tmp/handovers/${source}.md` }]);
  assert.equal(created.some((item) => item.provider === "codex"), false);
  assert.equal(state.sessions[target].generatedTitle, "Codex · fix the login redirect");
});

test("sending in a handed-over chat starts the turn with the given settings and clears the draft", async (t) => {
  const { host, manager, saved, session, created } = harness({ handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: async () => "BRIEF" } });
  t.after(() => manager.closeAll());
  const source = await chatWithReply(host, session, saved);
  const { sessionId: target } = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6", permissionMode: "ask" });
  await host.pendingHandovers.get(`${ALPHA}#${target}`);

  await host.send({ projectPath: ALPHA, sessionId: target, body: "BRIEF, edited", prompt: "BRIEF, edited", provider: "codex", model: "gpt-6", permissionMode: "auto", effort: "high", replies: "concise", images: [], files: [] });
  const state = saved.get(ALPHA);
  assert.equal(state.sessions[target].handoverDraft, undefined);
  assert.deepEqual(chatMessages(state, target), [{ role: "user", body: "BRIEF, edited" }]);
  await waitUntil(() => created.some((item) => item.provider === "codex"));
  assert.equal(created.find((item) => item.provider === "codex").options.cwd, ALPHA);
  const turn = created.find((item) => item.provider === "codex").turns[0];
  assert.deepEqual({ effort: turn.effort, permissionMode: turn.permissionMode, replies: turn.replies }, { effort: "high", permissionMode: "auto", replies: "concise" });
});

test("a new-chat send does not reuse a handover chat that holds a draft", async (t) => {
  const { host, manager, states, saved } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({ ...state, next_id: 9, sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", handedOverFrom: 3, handoverDraft: "BRIEF" } } }));
  const { sessionId } = await host.send(message(ALPHA, "hello"));
  assert.notEqual(sessionId, 7);
  assert.equal(saved.get(ALPHA).sessions[7].handoverDraft, "BRIEF");
});

test("handover refuses while the source turn runs and for the same provider", async (t) => {
  const { host, manager, session } = harness();
  t.after(() => manager.closeAll());
  const { sessionId } = await host.send(message(ALPHA, "long task"));
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  await waitUntil(() => host.runs[`${ALPHA}#${sessionId}`]);
  await assert.rejects(host.handover({ projectPath: ALPHA, sessionId, provider: "codex", model: "gpt-6" }), /Stop the turn or wait for it to finish to hand over\./);
  session(ALPHA).emit({ type: "turn-completed" });
  await waitUntil(() => !host.runs[`${ALPHA}#${sessionId}`]);
  await assert.rejects(host.handover({ projectPath: ALPHA, sessionId, provider: "claude", model: "claude-opus-5-5" }), /already runs on Claude/);
});

test("a second handover while the first is pending returns the same chat", async (t) => {
  let release;
  const { host, manager, saved, session } = harness({ handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: () => new Promise((resolve) => { release = resolve; }) } });
  t.after(() => manager.closeAll());
  const source = await chatWithReply(host, session, saved);
  const first = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6" });
  const second = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6" });
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(Object.values(saved.get(ALPHA).sessions).filter((item) => item.handedOverFrom === source).length, 1);
  await waitUntil(() => release);
  release("BRIEF");
  await host.pendingHandovers.get(`${ALPHA}#${first.sessionId}`);
});

test("a handover that fails leaves a note with the transcript path and keeps the links", async (t) => {
  const { host, manager, saved, session } = harness({ handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: async () => { throw new Error("disk full."); } } });
  t.after(() => manager.closeAll());
  const source = await chatWithReply(host, session, saved);
  const { sessionId: target } = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6" });
  await host.pendingHandovers.get(`${ALPHA}#${target}`);
  const state = saved.get(ALPHA);
  assert.equal(state.sessions[target].handoverPending, undefined);
  assert.equal(state.sessions[source].handedOverTo, target);
  assert.deepEqual(chatMessages(state, target), [{ role: "assistant", body: "Couldn't hand over: disk full. The transcript is at /tmp/t.md." }]);
});

test("a handover left pending by a quit is closed with a note on the next open", async (t) => {
  const { host, manager, states, saved } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({ ...state, next_id: 9, sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", handedOverFrom: 3, handoverPending: true } } }));
  await host.recoverHandovers(ALPHA, saved.get(ALPHA));
  const state = saved.get(ALPHA);
  assert.equal(state.sessions[7].handoverPending, undefined);
  assert.deepEqual(chatMessages(state, 7), [{ role: "assistant", body: "Milagre closed before this handover finished. Hand over again from the original chat." }]);
});

test("a handover that finished with a draft is not interrupted on the next open", async (t) => {
  const { host, manager, states, saved } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({ ...state, next_id: 9, sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", handedOverFrom: 3, handoverDraft: "BRIEF" } } }));
  await host.recoverHandovers(ALPHA, saved.get(ALPHA));
  const state = saved.get(ALPHA);
  assert.equal(state.sessions[7].handoverDraft, "BRIEF");
  assert.deepEqual(chatMessages(state, 7), []);
});

test("recovery from a stale state adds no note to a handover that has since finished", async (t) => {
  const { host, manager, states, saved } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({ ...state, next_id: 9, sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", handedOverFrom: 3 } } }));
  const stale = { ...saved.get(ALPHA), sessions: { 7: { ...saved.get(ALPHA).sessions[7], handoverPending: true } } };
  await host.recoverHandovers(ALPHA, stale);
  assert.deepEqual(chatMessages(saved.get(ALPHA), 7), []);
});

test("a new chat sent while a handover is pending doesn't land in the handover chat", async (t) => {
  let release;
  const { host, manager, saved, session } = harness({ handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: () => new Promise((resolve) => { release = resolve; }) } });
  t.after(() => manager.closeAll());
  const source = await chatWithReply(host, session, saved);
  const { sessionId: target } = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6" });
  await waitUntil(() => release);
  const fresh = await host.send(message(ALPHA, "new work"));
  assert.notEqual(fresh.sessionId, target);
  release("BRIEF");
  await host.pendingHandovers.get(`${ALPHA}#${target}`);
  const state = saved.get(ALPHA);
  assert.deepEqual(chatMessages(state, target), []);
  assert.equal(state.sessions[target].handoverDraft, "BRIEF");
  assert.equal(state.sessions[target].provider, "codex");
});
