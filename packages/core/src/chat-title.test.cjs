const assert = require("node:assert/strict");
const test = require("node:test");
const { generateChatTitle } = require("./chat-title.cjs");

test("summarizes the first message with the selected provider", async () => {
  const title = await generateChatTitle(
    { prompt: "when i navigate between chats the scroll jumps", provider: "codex" },
    {
      models: {
        codex: async ({ prompt }) => {
          assert.match(prompt, /scroll jumps/);
          return '{"title":"Preserve chat scroll position"}';
        },
        claude: async () => {
          throw new Error("Wrong provider");
        },
      },
    },
  );
  assert.equal(title, "Preserve chat scroll position");
});

test("unavailable, malformed and overlong answers keep the initial title", async () => {
  for (const answer of ["", "I will inspect the repository", '{"title":""}', JSON.stringify({ title: "a".repeat(90) }), '{"title":"One\\nTwo"}']) {
    assert.equal(await generateChatTitle({ prompt: "fix login" }, { models: { claude: async () => answer } }), null);
  }
  assert.equal(
    await generateChatTitle(
      { prompt: "fix login" },
      {
        models: {
          claude: async () => {
            throw Error("offline");
          },
        },
      },
    ),
    null,
  );
});

test("a stuck provider times out and is aborted", async () => {
  let signal;
  const title = await generateChatTitle(
    { prompt: "fix login" },
    {
      timeoutMs: 10,
      models: {
        claude: async (request) => {
          signal = request.signal;
          return new Promise(() => {});
        },
      },
    },
  );
  assert.equal(title, null);
  assert.equal(signal.aborted, true);
});

const { ChatTitles } = require("./chat-title.cjs");
const { ProjectStates } = require("./project-states.cjs");
const { ChatHost } = require("./agents/chat-host.cjs");
const { chatTitle } = require("@milagre/shared/chats");

function namingHarness() {
  const saved = new Map();
  const calls = [];
  const replies = [];
  const broadcasts = [];
  const states = new ProjectStates({
    read: async (path) => ({ next_id: 2, sessions: {}, messages: [], worktrees: { 1: { id: 1, path, name: "main" } } }),
    save: async (path, state) => saved.set(path, JSON.parse(JSON.stringify(state))),
  });
  const titles = new ChatTitles({
    states,
    update: async (path, change) => {
      const result = await states.update(path, change);
      if (result.changed) broadcasts.push({ path, state: result.state });
    },
    generate: (request) => {
      calls.push(request);
      return new Promise((resolve) => replies.push(resolve));
    },
  });
  const host = new ChatHost({ states, startTurn: async () => {}, publish: () => {}, broadcast: () => {}, nameChat: (path, id) => titles.name(path, id) });
  const send = (path, body = "when I switch chats the scroll jumps", sessionId) =>
    host.send({ projectPath: path, worktreeId: 1, sessionId, body, provider: "codex", model: "gpt-6" });
  return { states, saved, titles, calls, replies, broadcasts, send };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("main process names first messages once, persists and broadcasts across projects", async () => {
  const h = namingHarness();
  const first = await h.send("/alpha");
  await tick();
  await h.send("/alpha", "also preserve the selection", first.sessionId);
  await h.send("/beta", "fix authentication");
  await tick();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[0], { prompt: "when I switch chats the scroll jumps", provider: "codex", projectPath: "/alpha" });
  h.replies[0]("Preserve chat scroll position");
  h.replies[1]("Fix authentication");
  await Promise.all([...h.titles.pending.values()]);
  await h.states.flush();
  const session = h.saved.get("/alpha").sessions[first.sessionId];
  assert.equal(chatTitle(session, []), "Preserve chat scroll position");
  assert.equal(session.titlePending, undefined);
  assert.equal(h.saved.get("/alpha").messages.length, 2);
  assert.deepEqual(h.broadcasts.map((item) => item.path).sort(), ["/alpha", "/beta"]);
});

test("late generated title preserves a manual rename and concurrent state", async () => {
  const h = namingHarness();
  const { sessionId } = await h.send("/alpha");
  await tick();
  await h.states.update("/alpha", (state) => ({
    ...state,
    sessions: { ...state.sessions, [sessionId]: { ...state.sessions[sessionId], title: "My title", unread: true } },
  }));
  h.replies[0]("Automatic title");
  await h.titles.name("/alpha", sessionId);
  await h.states.flush();
  const session = h.saved.get("/alpha").sessions[sessionId];
  assert.equal(session.title, "My title");
  assert.equal(session.generatedTitle, undefined);
  assert.equal(session.titlePending, undefined);
  assert.equal(session.unread, true);
});

test("failed naming keeps the prompt and persisted pending names resume after restart", async () => {
  const h = namingHarness();
  const { sessionId } = await h.send("/alpha");
  await tick();
  h.replies[0](null);
  await h.titles.name("/alpha", sessionId);
  await h.states.flush();
  const saved = h.saved.get("/alpha");
  assert.equal(chatTitle(saved.sessions[sessionId], saved.messages), "when I switch chats the scroll jumps");
  assert.equal(saved.sessions[sessionId].titlePending, undefined);
  saved.sessions[sessionId].titlePending = true;
  const states = new ProjectStates({
    read: async () => saved,
    save: async (_path, state) => {
      h.saved.set("/restarted", state);
    },
  });
  const titles = new ChatTitles({ states, update: (path, change) => states.update(path, change), generate: async () => "Recovered title" });
  titles.resume("/restarted", await states.get("/restarted"));
  await titles.name("/restarted", sessionId);
  await states.flush();
  assert.equal(h.saved.get("/restarted").sessions[sessionId].generatedTitle, "Recovered title");
});
