import assert from "node:assert/strict";
import test from "node:test";
import { editDistance, searchMessages } from "./message-search.ts";

const message = (id: number, body: string, session_id = 1) => ({ id, session_id, body });
const messages = [
  message(1, "Fix the simulator taps after Xcode Device Hub"),
  message(2, "The relay worker deploys from apps/relay with wrangler", 2),
  message(3, "Simulator viewer docks on the right", 3),
  message(4, "Nothing related here"),
];

test("matches a word prefix and ranks the typed phrase first", () => {
  const found = searchMessages(messages, "simulator taps");
  assert.deepEqual(
    found.map((match) => match.message.id),
    [1],
  );
  assert.equal(found[0].term, "simulator taps");
  const [start, end] = found[0].highlight;
  assert.equal(found[0].snippet.slice(start, end), "simulator taps");
  assert.deepEqual(
    searchMessages(messages, "simul").map((match) => match.message.id),
    [3, 1],
  );
});

test("tolerates a typo in longer words but not in short ones", () => {
  assert.deepEqual(
    searchMessages(messages, "wrangelr").map((match) => match.message.id),
    [2],
  );
  assert.deepEqual(
    searchMessages(messages, "simulatr viewer").map((match) => match.message.id),
    [3],
  );
  assert.deepEqual(
    searchMessages(messages, "tap xcod").map((match) => match.message.id),
    [1],
  );
  assert.deepEqual(searchMessages(messages, "hbu"), []);
});

test("every query word must match and the term is the body's own text", () => {
  assert.deepEqual(searchMessages(messages, "relay simulator"), []);
  const [match] = searchMessages(messages, "WRANGLER");
  assert.equal(match.term, "wrangler");
});

test("ignores queries too short to mean anything", () => {
  assert.deepEqual(searchMessages(messages, ""), []);
  assert.deepEqual(searchMessages(messages, "a"), []);
  assert.deepEqual(searchMessages(messages, "  ...  "), []);
});

test("snippets stay short and mark where the body was cut", () => {
  const long = `${"word ".repeat(60)}needle ${"tail ".repeat(60)}`;
  const [match] = searchMessages([message(9, long)], "needle");
  assert.ok(match.snippet.startsWith("…") && match.snippet.endsWith("…"));
  assert.ok(match.snippet.length < 120);
  assert.equal(match.snippet.slice(...match.highlight), "needle");
});

test("edit distance counts a transposition as one edit and reads prefixes", () => {
  assert.equal(editDistance("wrangelr", "wrangler", 2), 1);
  assert.equal(editDistance("simulatr", "simulators", 2, true), 1);
  assert.equal(editDistance("abc", "xyz", 1), Infinity);
});
