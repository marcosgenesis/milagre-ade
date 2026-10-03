import assert from "node:assert/strict";
import test from "node:test";
import { loadChatPreferences, saveChatPreferences } from "./chat-preferences.ts";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test("remembers isolation and keeps branch choices separate by project", () => {
  const storage = memory();
  saveChatPreferences(storage, "/a", { isolation: "worktree", worktreePath: "/a/checkout", baseBranch: "develop" });
  saveChatPreferences(storage, "/b", { worktreePath: "/b/checkout", baseBranch: "main" });
  assert.deepEqual(loadChatPreferences(storage, "/a"), { isolation: "worktree", worktreePath: "/a/checkout", baseBranch: "develop" });
  assert.deepEqual(loadChatPreferences(storage, "/b"), { isolation: "worktree", worktreePath: "/b/checkout", baseBranch: "main" });
});

test("invalid or inaccessible storage falls back safely", () => {
  const storage = memory();
  storage.setItem("milagre.chat-preferences", '{"isolation":"invalid","projects":{"/a":{"baseBranch":42}}}');
  assert.deepEqual(loadChatPreferences(storage, "/a"), { isolation: "local" });
  const unavailable = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  assert.deepEqual(loadChatPreferences(unavailable, "/a"), { isolation: "local" });
  assert.doesNotThrow(() => saveChatPreferences(unavailable, "/a", { isolation: "worktree" }));
});
