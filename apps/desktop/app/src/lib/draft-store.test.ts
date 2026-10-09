import assert from "node:assert/strict";
import test from "node:test";
import { createDraftStore, draftKey } from "./draft-store.ts";

test("each key keeps its own draft", () => {
  const store = createDraftStore(draftKey("/p", 1));
  store.set("one");
  store.select(draftKey("/p", 2));
  assert.equal(store.get(), "");
  store.set("two");
  store.select(draftKey("/p", null));
  store.set("new");
  store.select(draftKey("/p", 1));
  assert.equal(store.get(), "one");
  store.select(draftKey("/p", null));
  assert.equal(store.get(), "new");
  store.select(draftKey("/other", null));
  assert.equal(store.get(), "");
});

test("selecting another draft notifies subscribers", () => {
  const store = createDraftStore("a");
  let calls = 0;
  store.subscribe(() => calls++);
  store.select("a");
  store.set("");
  assert.equal(calls, 0);
  store.select("b");
  store.set("text");
  assert.equal(calls, 2);
});

test("the same path on this Mac and on a paired computer keeps two drafts", () => {
  const remote = "6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7|/p";
  const store = createDraftStore(draftKey("/p", 1));
  store.set("here");
  store.select(draftKey(remote, 1));
  assert.equal(store.get(), "");
  store.set("there");
  store.select(draftKey("/p", 1));
  assert.equal(store.get(), "here");
  store.select(draftKey(remote, 1));
  assert.equal(store.get(), "there");
});
