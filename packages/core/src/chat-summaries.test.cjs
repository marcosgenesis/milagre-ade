const assert = require("node:assert/strict");
const test = require("node:test");
const { withChatSummaries } = require("./chat-summaries.cjs");

const reply = (id, session_id, extra = {}) => ({ id, session_id, role: "assistant", body: "Done", context: null, ...extra });
const ask = (id, session_id, body) => ({ id, session_id, role: "user", body, context: null });
const state = () => ({
  next_id: 5,
  sessions: { 1: { id: 1, agent_name: "a" }, 2: { id: 2, agent_name: "b" }, 3: { id: 3, agent_name: "empty" } },
  messages: [ask(1, 1, "First chat"), ask(2, 2, "Second chat"), reply(3, 1, { outcome: "completed" }), reply(4, 2, { outcome: "failed" })],
});

test("a state read without summaries gets one for every Chat, an empty one included", () => {
  const next = withChatSummaries(state(), null);
  assert.deepEqual(next.sessions[1].summary, { count: 2, firstId: 1, lastId: 3, titleLine: "First chat", lastOutcome: "completed" });
  assert.deepEqual(next.sessions[2].summary, { count: 2, firstId: 2, lastId: 4, titleLine: "Second chat", lastOutcome: "failed" });
  assert.deepEqual(next.sessions[3].summary, { count: 0 });
  assert.equal(withChatSummaries(next, next), next, "an unchanged state comes back as is");
});

test("a reply updates its own Chat's summary only, and a rename keeps every summary", () => {
  const before = withChatSummaries(state(), null);
  const after = withChatSummaries({ ...before, next_id: 6, messages: [...before.messages, reply(5, 2, { outcome: "completed" })] }, before);
  assert.equal(after.sessions[1], before.sessions[1]);
  assert.equal(after.sessions[3], before.sessions[3]);
  assert.deepEqual(after.sessions[2].summary, { count: 3, firstId: 2, lastId: 5, titleLine: "Second chat", lastOutcome: "completed" });
  const renamed = { ...after, sessions: { ...after.sessions, 1: { ...after.sessions[1], title: "Named" } } };
  const kept = withChatSummaries(renamed, after);
  assert.equal(kept, renamed);
  assert.equal(kept.sessions[1].summary, after.sessions[1].summary);
});

test("a Chat whose messages are gone, or a session rebuilt without its summary, is summarized again", () => {
  const before = withChatSummaries(state(), null);
  const without = withChatSummaries({ ...before, messages: before.messages.filter((message) => message.session_id !== 1) }, before);
  assert.deepEqual(without.sessions[1].summary, { count: 0 });
  const rebuilt = { ...without, sessions: { ...without.sessions, 2: { id: 2, agent_name: "b" } } };
  assert.equal(withChatSummaries(rebuilt, without).sessions[2].summary.count, 2);
});
