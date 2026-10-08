import test from "node:test";
import assert from "node:assert/strict";
import { applyAgentEvent } from "./agent-runs.mjs";
import { TRANSCRIPT_TAIL, mergeTranscript, sessionWithTranscriptTails, withTranscriptTail } from "./subagent-transcript.mjs";
import type { CoordinatorState, Subagent, SubagentTranscriptEntry } from "./model.ts";

const entries = (from: number, to: number): SubagentTranscriptEntry[] =>
  Array.from({ length: to - from + 1 }, (_, index) => ({ id: `e${from + index}`, kind: "message", text: `Entry ${from + index}` }));
const agent = (transcript: SubagentTranscriptEntry[], extra: Partial<Subagent> = {}): Subagent => ({
  id: "child",
  title: "Review",
  status: "running",
  startedAt: 1,
  updatedAt: 2,
  transcript,
  ...extra,
});
const state = (subagents: Subagent[]): CoordinatorState => ({
  next_id: 10,
  sessions: { 1: { id: 1, worktree_id: 2, agent_name: "main", status: "Created", provider: "claude", subagents } },
  projects: {},
  worktrees: {},
  messages: [],
  connections: {},
  events: [],
  approvals: [],
  tasks: {},
  artifacts: {},
  outputs: [],
  conflicts: [],
});

test("a subagent goes with the end of its transcript and how long it is, the same object each time", () => {
  const long = agent(entries(1, 40));
  const tail = withTranscriptTail(long);
  assert.deepEqual(
    tail.transcript.map((entry) => entry.id),
    entries(37, 40).map((entry) => entry.id),
  );
  assert.equal(tail.transcript.length, TRANSCRIPT_TAIL);
  assert.equal(tail.transcriptLength, 40);
  assert.equal(withTranscriptTail(long), tail);
  // A short transcript goes whole, as it is.
  const short = agent(entries(1, 3));
  assert.equal(withTranscriptTail(short), short);
  const session = { subagents: [short] };
  assert.equal(sessionWithTranscriptTails(session), session);
  const mixed = { subagents: [short, long] };
  assert.deepEqual(sessionWithTranscriptTails(mixed).subagents, [short, tail]);
  assert.equal(sessionWithTranscriptTails(mixed), sessionWithTranscriptTails(mixed));
});

test("a whole transcript follows the tails of later updates, and says when it can't", () => {
  const held = entries(1, 40);
  // One new entry and the last one rewritten (a streaming reply), as the host merges them.
  const host = [...held.slice(0, 39), { ...held[39], text: "Entry 40, finished" }, ...entries(41, 41)];
  const merged = mergeTranscript(held, withTranscriptTail(agent(host)));
  assert.deepEqual(merged, host);
  // At the limit, the oldest entries go as new ones come.
  const full = entries(1, 100);
  assert.deepEqual(mergeTranscript(full, withTranscriptTail(agent(entries(3, 102)))), entries(3, 102));
  // More came than the tail holds: the whole has a gap, so it is read again.
  assert.equal(mergeTranscript(held, withTranscriptTail(agent(entries(1, 50)))), null);
  // An advisor's transcript is replaced, not extended: the entries it dropped make the counts differ.
  const advisor = [...held.slice(0, 29), ...held.slice(30, 39), { id: "done", kind: "message" as const, text: "Result" }];
  assert.equal(mergeTranscript(held, withTranscriptTail(agent(advisor))), null);
  // A transcript that comes whole is the whole.
  assert.deepEqual(mergeTranscript(held, agent(entries(1, 2))), entries(1, 2));
});

test("a client that holds tails keeps each update's as it comes", () => {
  const whole = agent(entries(1, 40));
  let current = state([withTranscriptTail(whole)]);
  const next = withTranscriptTail(agent(entries(1, 41), { updatedAt: 3 }));
  current = applyAgentEvent(current, {}, "/project", "/project#1", { type: "subagent-update", agent: next }).state;
  assert.deepEqual(current.sessions[1].subagents?.[0].transcript, next.transcript);
  assert.equal(current.sessions[1].subagents?.[0].transcriptLength, 41);
  // A host that sends the whole transcript again (it is short) clears the count.
  const short = agent(entries(1, 2), { updatedAt: 4 });
  current = applyAgentEvent(current, {}, "/project", "/project#1", { type: "subagent-update", agent: short }).state;
  assert.deepEqual(current.sessions[1].subagents?.[0].transcript, short.transcript);
  assert.equal("transcriptLength" in current.sessions[1].subagents![0], false);
  // A client with whole transcripts still merges a provider's update into the one it has.
  const host = applyAgentEvent(state([whole]), {}, "/project", "/project#1", {
    type: "subagent-update",
    agent: agent(entries(41, 41), { updatedAt: 3 }),
  }).state;
  assert.deepEqual(host.sessions[1].subagents?.[0].transcript, entries(1, 41));
  assert.equal("transcriptLength" in host.sessions[1].subagents![0], false);
});
