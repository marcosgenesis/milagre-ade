import assert from "node:assert/strict";
import test from "node:test";
import { applyStatePatch, diffState } from "./state-patch.mjs";

const state = () => ({
  next_id: 4,
  sessions: {
    1: { id: 1, title: "One", subagents: [{ id: "a", status: "running", transcript: [{ id: "t1", text: "x".repeat(1000) }] }] },
    2: { id: 2, title: "Two" },
  },
  worktrees: { 1: { id: 1, path: "/repo" } },
  messages: [
    { id: 1, body: "hi" },
    { id: 2, body: "hello", steps: [{ id: "s1", title: "Ran" }] },
  ],
});

test("an unchanged state needs no patch", () => {
  const before = state();
  assert.equal(diffState(before, before), undefined);
});

test("a changed title sends only that session's field, and everything else stays the same object", () => {
  const before = state();
  const after = { ...before, sessions: { ...before.sessions, 2: { ...before.sessions[2], title: "Renamed" } } };
  const patch = diffState(before, after);
  assert.deepEqual(patch, { o: { sessions: { o: { 2: { o: { title: { v: "Renamed" } } } } } } });
  const applied = applyStatePatch(before, patch);
  assert.deepEqual(applied, after);
  assert.equal(applied.messages, before.messages);
  assert.equal(applied.sessions[1], before.sessions[1]);
});

test("a new message sends the message alone, and a removed chat its key", () => {
  const before = state();
  const message = { id: 3, body: "done" };
  const { 2: _removed, ...sessions } = before.sessions;
  const after = { ...before, next_id: 5, sessions, messages: [...before.messages, message] };
  const patch = diffState(before, after);
  assert.deepEqual(patch, { o: { next_id: { v: 5 }, sessions: { o: {}, d: ["2"] }, messages: { a: 3, s: { 2: { v: message } } } } });
  const applied = applyStatePatch(before, patch);
  assert.deepEqual(applied, after);
  assert.equal(applied.messages[0], before.messages[0]);
});

test("a deep change goes whole below the depth, and a mostly rewritten list goes whole", () => {
  const before = state();
  const subagent = { ...before.sessions[1].subagents[0], transcript: [...before.sessions[1].subagents[0].transcript, { id: "t2", text: "more" }] };
  const after = { ...before, sessions: { ...before.sessions, 1: { ...before.sessions[1], subagents: [subagent] } } };
  assert.deepEqual(applyStatePatch(before, diffState(before, after)), after);
  assert.deepEqual(diffState(before, after, 2), { o: { sessions: { o: { 1: { v: after.sessions[1] } } } } });
  const many = Array.from({ length: 20 }, (_, id) => ({ id }));
  const rewritten = many.map((item) => ({ ...item }));
  assert.deepEqual(diffState(many, rewritten), { v: rewritten });
});

test("an array that shrinks keeps the items before the cut", () => {
  const before = [1, 2, 3, 4].map((id) => ({ id }));
  const after = before.slice(0, 2);
  const applied = applyStatePatch(before, diffState(before, after));
  assert.deepEqual(applied, after);
  assert.equal(applied[1], before[1]);
});
