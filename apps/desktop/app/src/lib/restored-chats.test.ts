import assert from "node:assert/strict";
import test from "node:test";
import { restoredChatsNotice } from "./restored-chats.ts";

test("chats brought back from one worktree read as one line", () => {
  assert.equal(restoredChatsNotice([{ worktree: "agent-sessions-pr2", count: 7 }]), "Brought back 7 chats saved in agent-sessions-pr2.");
});

test("one chat is not called chats", () => {
  assert.equal(restoredChatsNotice([{ worktree: "feature", count: 1 }]), "Brought back 1 chat saved in feature.");
});

test("several worktrees still fit one line", () => {
  assert.equal(
    restoredChatsNotice([
      { worktree: "a", count: 2 },
      { worktree: "b", count: 1 },
    ]),
    "Brought back 3 chats saved in a and b.",
  );
  assert.equal(
    restoredChatsNotice([
      { worktree: "a", count: 1 },
      { worktree: "b", count: 1 },
      { worktree: "c", count: 1 },
    ]),
    "Brought back 3 chats saved in a, b and c.",
  );
});

test("nothing brought back shows nothing", () => {
  assert.equal(restoredChatsNotice(undefined), null);
  assert.equal(restoredChatsNotice([]), null);
});
