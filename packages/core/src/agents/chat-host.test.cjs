const assert = require("node:assert/strict");
const test = require("node:test");
const { ChatHost } = require("./chat-host.cjs");
const { SessionManager } = require("./session-manager.cjs");
const { ProjectStates } = require("../project-states.cjs");
const { applyRunEvent } = require("@milagre/shared/agent-runs");
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

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
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
function harness({ failStart = null, focused = true, now = () => NOW, handoverTools = { writeTranscript: async ({ sessionId }) => `/tmp/handovers/${sessionId}.md`, brief: async ({ transcriptPath }) => `BRIEF ${transcriptPath}` } } = {}) {
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
    now,
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
  await host.states.flush();
  assert.equal(saved.get(ALPHA).messages.length, 1, "the note waits for the turn");
  session(ALPHA).emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 3);

  assert.deepEqual(saved.get(ALPHA).messages.map(({ role, body, context }) => ({ role, body, context })), [
    { role: "user", body: "commit it", context: null },
    { role: "assistant", body: "Committing.", context: null },
    { role: "assistant", body: "Committed abc123", context: { kind: "git-action" } },
  ]);
});

test("a note for an idle chat is published immediately and saved by flush", async () => {
  const { host, saved, broadcasts } = harness({ failStart: "no agent" });
  const chat = await host.send(message(BETA, "hi"));
  await waitUntil(() => saved.get(BETA)?.messages.length === 2);
  await host.addNote(`${BETA}#${chat.sessionId}`, { body: "Pushed to origin", context: { kind: "git-action" } });
  await host.states.flush();

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
  await host.states.flush();
  assert.deepEqual(chatMessages(saved.get(ALPHA), chat.sessionId), [
    { role: "user", body: "plan it" },
    { role: "assistant", body: "Which layout?" },
    { role: "user", body: "Layout: grid" },
  ]);
  assert.equal(host.runs[chatId].text, "");
  assert.equal(published.at(-1).event.type, "answers-sent");

  await host.takeBack(chatId, messageId);
  await host.states.flush();
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
  await host.states.flush();
  assert.notEqual(target, source);
  assert.equal(saved.get(ALPHA).sessions[source].handedOverTo, target);
  const linked = saved.get(ALPHA).sessions[target];
  assert.deepEqual({ worktree_id: linked.worktree_id, provider: linked.provider, handedOverFrom: linked.handedOverFrom }, { worktree_id: 1, provider: "codex", handedOverFrom: source });

  await host.pendingHandovers.get(`${ALPHA}#${target}`);
  await host.states.flush();
  const state = saved.get(ALPHA);
  assert.equal(state.sessions[target].handoverPending, undefined);
  assert.equal(state.sessions[target].handoverDraft, "BRIEF");
  assert.deepEqual(chatMessages(state, target), []);
  assert.deepEqual(briefs.map(({ provider, lastUserMessage, cwd, transcriptPath }) => ({ provider, lastUserMessage, cwd, transcriptPath })), [{ provider: "claude", lastUserMessage: "fix the login redirect", cwd: ALPHA, transcriptPath: `/tmp/handovers/${source}.md` }]);
  assert.equal(created.some((item) => item.provider === "codex"), false);
  assert.equal(state.sessions[target].generatedTitle, "Codex · fix the login redirect");
});

async function handedOver(host, session, saved) {
  const source = await chatWithReply(host, session, saved);
  const { sessionId: target } = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6", permissionMode: "ask" });
  await host.states.flush();
  await host.pendingHandovers.get(`${ALPHA}#${target}`);
  await host.states.flush();
  return { source, target };
}

test("sending in a handed-over chat attaches the brief, prompts with it and the typed text, and clears the draft", async (t) => {
  const { host, manager, saved, session, created } = harness({ handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: async () => "BRIEF" } });
  t.after(() => manager.closeAll());
  const { target } = await handedOver(host, session, saved);

  await host.send({ projectPath: ALPHA, sessionId: target, body: "Start with the tests.", prompt: "Start with the tests.", provider: "codex", model: "gpt-6", permissionMode: "auto", effort: "high", replies: "concise", images: [], files: [] });
  const state = saved.get(ALPHA);
  assert.equal(state.sessions[target].handoverDraft, undefined);
  const sent = state.messages.find((item) => item.session_id === target);
  assert.deepEqual({ body: sent.body, handoverBrief: sent.handoverBrief }, { body: "Start with the tests.", handoverBrief: "BRIEF" });
  await waitUntil(() => created.find((item) => item.provider === "codex")?.turns.length);
  const codex = created.find((item) => item.provider === "codex");
  assert.equal(codex.options.cwd, ALPHA);
  const turn = codex.turns[0];
  assert.equal(turn.prompt, "BRIEF\n\nStart with the tests.");
  assert.deepEqual({ effort: turn.effort, permissionMode: turn.permissionMode, replies: turn.replies }, { effort: "high", permissionMode: "auto", replies: "concise" });
});

test("sending the brief as is in a handed-over chat prompts with the brief alone", async (t) => {
  const { host, manager, saved, session, created } = harness({ handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: async () => "BRIEF" } });
  t.after(() => manager.closeAll());
  const { target } = await handedOver(host, session, saved);

  await host.send({ projectPath: ALPHA, sessionId: target, body: "", prompt: "", provider: "codex", model: "gpt-6", permissionMode: "auto", images: [], files: [] });
  const sent = saved.get(ALPHA).messages.find((item) => item.session_id === target);
  assert.deepEqual({ body: sent.body, handoverBrief: sent.handoverBrief }, { body: "", handoverBrief: "BRIEF" });
  await waitUntil(() => created.find((item) => item.provider === "codex")?.turns.length);
  assert.equal(created.find((item) => item.provider === "codex").turns[0].prompt, "BRIEF");
  // A later message is a plain one.
  await host.send({ projectPath: ALPHA, sessionId: target, body: "and then?", prompt: "and then?", provider: "codex", model: "gpt-6", images: [], files: [] });
  assert.equal(saved.get(ALPHA).messages.filter((item) => item.session_id === target).at(-1).handoverBrief, undefined);
});

test("the brief can be edited while it is a draft, and not after the first message", async (t) => {
  const { host, manager, saved, session, broadcasts } = harness({ handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: async () => "BRIEF" } });
  t.after(() => manager.closeAll());
  const { source, target } = await handedOver(host, session, saved);

  const before = broadcasts.length;
  assert.equal(await host.setHandoverDraft(ALPHA, target, "BRIEF, edited"), true);
  await host.states.flush();
  assert.equal(saved.get(ALPHA).sessions[target].handoverDraft, "BRIEF, edited");
  assert.equal(broadcasts.length, before + 1);
  // A chat that never held a draft is left alone.
  assert.equal(await host.setHandoverDraft(ALPHA, source, "nope"), false);
  await host.states.flush();
  assert.equal(saved.get(ALPHA).sessions[source].handoverDraft, undefined);

  await host.send({ projectPath: ALPHA, sessionId: target, body: "", prompt: "", provider: "codex", model: "gpt-6", images: [], files: [] });
  assert.equal(saved.get(ALPHA).messages.find((item) => item.session_id === target).handoverBrief, "BRIEF, edited");
  assert.equal(await host.setHandoverDraft(ALPHA, target, "too late"), false);
  await host.states.flush();
  assert.equal(saved.get(ALPHA).sessions[target].handoverDraft, undefined);
});

test("a second handover while the first holds its draft returns the same chat", async (t) => {
  const { host, manager, saved, session } = harness({ handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: async () => "BRIEF" } });
  t.after(() => manager.closeAll());
  const { source, target } = await handedOver(host, session, saved);
  const again = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6" });
  await host.states.flush();
  assert.equal(again.sessionId, target);
  assert.equal(Object.values(saved.get(ALPHA).sessions).filter((item) => item.handedOverFrom === source).length, 1);
  assert.equal(saved.get(ALPHA).sessions[target].handoverDraft, "BRIEF");
});

test("a new-chat send does not reuse a handover chat that holds a draft", async (t) => {
  const { host, manager, states, saved } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({ ...state, next_id: 9, sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", handedOverFrom: 3, handoverDraft: "BRIEF" } } }));
  await host.states.flush();
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
  await host.states.flush();
  const second = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6" });
  await host.states.flush();
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(Object.values(saved.get(ALPHA).sessions).filter((item) => item.handedOverFrom === source).length, 1);
  await waitUntil(() => release);
  release("BRIEF");
  await host.pendingHandovers.get(`${ALPHA}#${first.sessionId}`);
  await host.states.flush();
});

test("a handover that fails leaves a note with the transcript path and keeps the links", async (t) => {
  const { host, manager, saved, session } = harness({ handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: async () => { throw new Error("disk full."); } } });
  t.after(() => manager.closeAll());
  const source = await chatWithReply(host, session, saved);
  const { sessionId: target } = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6" });
  await host.states.flush();
  await host.pendingHandovers.get(`${ALPHA}#${target}`);
  await host.states.flush();
  const state = saved.get(ALPHA);
  assert.equal(state.sessions[target].handoverPending, undefined);
  assert.equal(state.sessions[source].handedOverTo, target);
  assert.deepEqual(chatMessages(state, target), [{ role: "assistant", body: "Couldn't hand over: disk full. The transcript is at /tmp/t.md." }]);
});

test("a handover left pending by a quit is closed with a note on the next open", async (t) => {
  const { host, manager, states, saved } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({ ...state, next_id: 9, sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", handedOverFrom: 3, handoverPending: true } } }));
  await host.states.flush();
  await host.recoverHandovers(ALPHA, saved.get(ALPHA));
  await host.states.flush();
  const state = saved.get(ALPHA);
  assert.equal(state.sessions[7].handoverPending, undefined);
  assert.deepEqual(chatMessages(state, 7), [{ role: "assistant", body: "Milagre closed before this handover finished. Hand over again from the original chat." }]);
});

test("a handover that finished with a draft is not interrupted on the next open", async (t) => {
  const { host, manager, states, saved } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({ ...state, next_id: 9, sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", handedOverFrom: 3, handoverDraft: "BRIEF" } } }));
  await host.states.flush();
  await host.recoverHandovers(ALPHA, saved.get(ALPHA));
  await host.states.flush();
  const state = saved.get(ALPHA);
  assert.equal(state.sessions[7].handoverDraft, "BRIEF");
  assert.deepEqual(chatMessages(state, 7), []);
});

test("recovery from a stale state adds no note to a handover that has since finished", async (t) => {
  const { host, manager, states, saved } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({ ...state, next_id: 9, sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", handedOverFrom: 3 } } }));
  await host.states.flush();
  const stale = { ...saved.get(ALPHA), sessions: { 7: { ...saved.get(ALPHA).sessions[7], handoverPending: true } } };
  await host.recoverHandovers(ALPHA, stale);
  await host.states.flush();
  assert.deepEqual(chatMessages(saved.get(ALPHA), 7), []);
});

test("a new chat sent while a handover is pending doesn't land in the handover chat", async (t) => {
  let release;
  const { host, manager, saved, session } = harness({ handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: () => new Promise((resolve) => { release = resolve; }) } });
  t.after(() => manager.closeAll());
  const source = await chatWithReply(host, session, saved);
  const { sessionId: target } = await host.handover({ projectPath: ALPHA, sessionId: source, provider: "codex", model: "gpt-6" });
  await host.states.flush();
  await waitUntil(() => release);
  const fresh = await host.send(message(ALPHA, "new work"));
  assert.notEqual(fresh.sessionId, target);
  release("BRIEF");
  await host.pendingHandovers.get(`${ALPHA}#${target}`);
  await host.states.flush();
  const state = saved.get(ALPHA);
  assert.deepEqual(chatMessages(state, target), []);
  assert.equal(state.sessions[target].handoverDraft, "BRIEF");
  assert.equal(state.sessions[target].provider, "codex");
});

test("a quit saves each running chat to resume, and its cancelled turn says so", async (t) => {
  const { host, manager, saved, session } = harness();
  t.after(() => manager.closeAll());
  const running = await host.send(message(ALPHA, "fix the api", { effort: "high" }));
  const idle = await host.send(message(BETA, "wire the frontend"));
  await waitUntil(() => session(ALPHA) && session(BETA));
  session(ALPHA).emit({ type: "session-started", nativeId: "native-1" });
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  session(ALPHA).emit({ type: "text-delta", messageId: "m1", text: "Halfway." });
  session(BETA).emit({ type: "turn-started", turnId: "t1" });
  session(BETA).emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(BETA)?.messages.length === 2 && saved.get(ALPHA)?.sessions[running.sessionId].native_session_id);

  await host.suspendRunning();
  await host.states.flush();
  session(ALPHA).emit({ type: "turn-cancelled" });
  await waitUntil(() => saved.get(ALPHA).messages.length === 2);

  const alpha = saved.get(ALPHA);
  // The provider session holds the prompt, so only the turn's options are kept.
  assert.deepEqual(alpha.sessions[running.sessionId].resumeTurn, { provider: "claude", model: "claude-opus-5-5", permissionMode: "auto", effort: "high", stoppedAt: NOW, ultracode: undefined, fastMode: undefined, replies: undefined, tldrEnabled: undefined });
  assert.deepEqual(chatMessages(alpha, running.sessionId).at(-1), { role: "assistant", body: "Halfway.\n\nStopped when Milagre closed.", outcome: "cancelled" });
  assert.equal(saved.get(BETA).sessions[idle.sessionId].resumeTurn, undefined);
});

test("a chat a quit stopped continues once on its saved session when its project opens", async (t) => {
  const { host, manager, states, saved, session } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({ ...state, next_id: 9, sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", native_session_id: "thread-1", resumeTurn: { provider: "codex", model: "gpt-6", permissionMode: "auto", effort: "high", stoppedAt: NOW - 60_000 } } } }));
  await host.states.flush();
  const stale = saved.get(ALPHA);
  await host.resumeInterrupted(ALPHA, stale);
  await host.states.flush();
  await host.resumeInterrupted(ALPHA, stale);
  await host.states.flush();
  await waitUntil(() => session(ALPHA)?.turns.length === 1);

  const state = saved.get(ALPHA);
  assert.equal(state.sessions[7].resumeTurn, undefined);
  assert.deepEqual(chatMessages(state, 7), [{ role: "user", body: "Milagre restarted. Continue where you left off." }]);
  assert.equal(session(ALPHA).provider, "codex");
  assert.equal(session(ALPHA).options.resumeId, "thread-1");
  assert.match(session(ALPHA).turns[0].prompt, /closed while you were working/);
  assert.deepEqual([session(ALPHA).turns[0].model, session(ALPHA).turns[0].effort], ["gpt-6", "high"]);
  assert.equal(manager.sessions.size, 1);
});

test("a chat whose agent hadn't started when Milagre quit is sent its prompt again", async (t) => {
  const { host, manager, saved, session } = harness();
  t.after(() => manager.closeAll());
  const chat = await host.send(message(ALPHA, "fix the api"));
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  await host.suspendRunning();
  await host.states.flush();
  assert.equal(saved.get(ALPHA).sessions[chat.sessionId].resumeTurn.prompt, "fix the api");
});

test("a chat stopped more than a day ago waits for Continue, and a message sent by hand drops the mark", async (t) => {
  const { host, manager, states, saved, session } = harness();
  t.after(() => manager.closeAll());
  const old = { provider: "codex", model: "gpt-6", permissionMode: "auto", stoppedAt: NOW - 2 * DAY };
  await states.update(ALPHA, (state) => ({ ...state, next_id: 9, sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", native_session_id: "thread-1", resumeTurn: old }, 8: { id: 8, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex", native_session_id: "thread-2", resumeTurn: old } } }));
  await host.states.flush();
  await host.resumeInterrupted(ALPHA, saved.get(ALPHA));
  await host.states.flush();
  assert.deepEqual(chatMessages(saved.get(ALPHA), 7), []);
  assert.equal(saved.get(ALPHA).sessions[7].resumeTurn.stoppedAt, NOW - 2 * DAY);

  // Continue resumes it once; a second click has nothing left to continue.
  assert.equal(await host.resumeChat(ALPHA, 7), true);
  await host.states.flush();
  assert.equal(await host.resumeChat(ALPHA, 7), false);
  await host.states.flush();
  await waitUntil(() => session(ALPHA)?.turns.length === 1);
  assert.match(session(ALPHA).turns[0].prompt, /closed while you were working/);
  assert.equal(saved.get(ALPHA).sessions[7].resumeTurn, undefined);

  // The user's own message replaces the resume.
  await host.send(message(ALPHA, "never mind, do this instead", { sessionId: 8, provider: "codex", model: "gpt-6" }));
  assert.equal(saved.get(ALPHA).sessions[8].resumeTurn, undefined);
  assert.deepEqual(chatMessages(saved.get(ALPHA), 8), [{ role: "user", body: "never mind, do this instead" }]);
});

test('streaming child updates publish only the child, never save, and late readers see the transcript', async t => {
  const { host, manager, states, saved, published } = harness(); t.after(() => manager.closeAll());
  const sent = await host.send(message(ALPHA, 'review')); await states.flush();
  const before = saved.get(ALPHA);
  const chatId = `${ALPHA}#${sent.sessionId}`;
  const child = { id: 'child', title: 'Review', status: 'running', startedAt: 1, updatedAt: 2, transcript: [{ id: 'one', kind: 'message', text: 'Working on it' }] };
  await host.receive(chatId, { type: 'subagent-update', agent: child }); await states.flush();
  await host.states.flush();
  assert.equal(saved.get(ALPHA), before, 'child streaming must not schedule a save');
  assert.equal(published.at(-1).state, undefined);
  assert.equal(published.at(-1).event.agent.transcript[0].text, 'Working on it');
  assert.equal((await states.get(ALPHA)).sessions[sent.sessionId].subagents[0].transcript[0].text, 'Working on it');
  await host.receive(chatId, { type: 'turn-completed' }); await states.flush();
  await host.states.flush();
  assert.equal(saved.get(ALPHA).sessions[sent.sessionId].subagents[0].transcript[0].text, 'Working on it');
});

test('sending an image stores its bytes before the provider starts and keeps original provider input',async t=>{
 const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
 const {saveProjectState,readProjectState}=require('../project-store.cjs');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'milagre-chat-image-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const image={id:'png',name:'photo.png',dataUrl:'data:image/png;base64,'+(await fs.readFile(path.join(__dirname,'../../../../scripts/fixtures/photo.png'))).toString('base64')};
 let started;const began=new Promise(resolve=>started=resolve);
 const states=new ProjectStates({read:async()=>projectState(root),save:saveProjectState});t.after(()=>states.close());
 const host=new ChatHost({states,startTurn:async request=>{started(request);return {turnId:'one'};},publish:()=>{},broadcast:()=>{}});
 await host.send(message(root,'Describe it',{images:[image]}));const request=await began;
 const saved=await readProjectState(root);const stored=saved.messages[0].images[0];
 assert.equal(stored.dataUrl,undefined);assert.equal(path.dirname(stored.path),path.join(root,'.milagre','images'));
 assert.ok((await fs.stat(stored.path)).size>0);assert.deepEqual(request.images,[image]);
});

function durableHarness() {
 let fail=false,blocked=null;const saved=[];const published=[];const started=[];
 const states=new ProjectStates({read:async p=>projectState(p),save:async(_p,state)=>{if(blocked)await blocked;if(fail)throw new Error('disk full');saved.push(state);}});
 const host=new ChatHost({states,startTurn:async r=>{started.push(r);},publish:(chatId,event,state,seq)=>published.push({chatId,event,state,seq}),broadcast:(path,state)=>published.push({path,state})});
 return {host,states,saved,published,started,fail:value=>fail=value,block:value=>blocked=value};
}

test('a slow send does not publish old state after a concurrent turn finishes',async()=>{
 const h=durableHarness();const first=await h.host.send(message(ALPHA,'First'));const chatId=ALPHA+'#'+first.sessionId;
 await h.host.receive(chatId,{type:'turn-started',turnId:'t'});await h.host.receive(chatId,{type:'text-delta',text:'First reply'});
 let release;h.block(new Promise(resolve=>release=resolve));const send=h.host.send(message(ALPHA,'Follow-up',{sessionId:first.sessionId}));
 for(let i=0;i<20;i++)await Promise.resolve();
 await h.host.receive(chatId,{type:'text-delta',text:' complete.'});await h.host.receive(chatId,{type:'turn-completed'});
 h.block(null);release();await send;
 const seq=h.published.filter(x=>x.seq!==undefined).map(x=>x.seq);assert.deepEqual(seq,[...seq].sort((a,b)=>a-b));
 const latest=h.published.filter(x=>x.state).at(-1).state;assert.ok(latest.messages.some(m=>m.body==='First reply complete.'));
 assert.equal(h.started.length,2);await h.states.close();
});

test('a rejected send removes its undelivered message and never leaves a phantom run',async()=>{
 const h=durableHarness();h.fail(true);await assert.rejects(h.host.send(message(ALPHA,'Retry me')),/disk full/);
 assert.deepEqual(h.host.runs,{});assert.deepEqual((await h.states.get(ALPHA)).messages,[]);assert.equal(h.started.length,0);
 h.fail(false);await h.host.send(message(ALPHA,'Retry me'));assert.equal((await h.states.get(ALPHA)).messages.length,1);assert.equal(h.started.length,1);await h.states.close();
});

test('a rejected answer preserves the question, current reply and concurrent tokens',async()=>{
 const h=durableHarness();const {sessionId}=await h.host.send(message(ALPHA,'Ask me'));const chatId=ALPHA+'#'+sessionId;
 await h.host.receive(chatId,{type:'text-delta',text:'Question'});await h.host.receive(chatId,{type:'question-request',requestId:'q',questions:[]});
 let release;h.block(new Promise(resolve=>release=resolve));h.fail(true);const answer=h.host.recordAnswers(chatId,'My answer');
 for(let i=0;i<20;i++)await Promise.resolve();await h.host.receive(chatId,{type:'text-delta',text:' details'});
 h.block(null);release();await assert.rejects(answer,/disk full/);assert.equal(h.host.runs[chatId].text,'Question details');assert.equal(h.host.runs[chatId].questions[0].requestId,'q');
 assert.equal((await h.states.get(ALPHA)).messages.length,1);h.fail(false);await h.states.close();
});
