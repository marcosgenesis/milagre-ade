import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "../model";
import { chatMark, dropIntent, folderName, formatLineCount, orderChats } from "./chat-list.ts";

test("chatMark: a question beats waiting beats running beats unread", () => {
  assert.equal(chatMark({ asking: true, waiting: true, running: true, unread: true }), "question");
  assert.equal(chatMark({ waiting: true, running: true, unread: true }), "waiting");
  assert.equal(chatMark({ waiting: false, running: true, unread: true }), "running");
  assert.equal(chatMark({ waiting: false, running: false, unread: true }), "unread");
  assert.equal(chatMark({ waiting: false, running: false, unread: false }), "idle");
});

test("chatMark: a Delegation working in the chat shows over running, under anything that waits on the user", () => {
  assert.equal(chatMark({ waiting: false, delegated: true, running: true, unread: true }), "delegated");
  assert.equal(chatMark({ waiting: true, delegated: true, running: true, unread: false }), "waiting");
});

test("formatLineCount and folderName", () => {
  assert.equal(formatLineCount(0), "0");
  assert.equal(formatLineCount(980), "980");
  assert.equal(formatLineCount(1000), "1k");
  assert.equal(formatLineCount(2140), "2.1k");
  assert.equal(formatLineCount(14_400), "14k");
  assert.equal(formatLineCount(2_100_000), "2.1m");
  assert.equal(folderName("/Users/v/.milagre/worktrees/app/fix-login-ab12/"), "fix-login-ab12");
  assert.equal(folderName("/"), "/");
});

test("orderChats sorts newest first by start, or by latest message", () => {
  const chat = (name: string, ids: number[]) => ({
    name,
    session: {},
    sessionMessages: ids.map((id) => ({ id, session_id: 1, body: "", context: null })) as ChatMessage[],
  });
  const chats = [chat("old but active", [1, 9]), chat("newest", [7, 8]), chat("middle", [4, 5])];
  assert.deepEqual(
    orderChats(chats, "created").map((c) => c.name),
    ["newest", "middle", "old but active"],
  );
  assert.deepEqual(
    orderChats(chats, "recent").map((c) => c.name),
    ["old but active", "newest", "middle"],
  );
  assert.deepEqual(
    chats.map((c) => c.name),
    ["old but active", "newest", "middle"],
  );
});

test("orderChats keeps pinned chats on top in their own order, whatever their activity", () => {
  const chat = (name: string, ids: number[], session = {}) => ({
    name,
    session,
    sessionMessages: ids.map((id) => ({ id, session_id: 1, body: "", context: null })) as ChatMessage[],
  });
  const chats = [
    chat("busy", [1, 99]),
    chat("second pin", [2], { pinned: true, pin_order: 1 }),
    chat("first pin", [3, 98], { pinned: true, pin_order: 0 }),
    chat("quiet", [4]),
  ];
  assert.deepEqual(
    orderChats(chats, "recent").map((c) => c.name),
    ["first pin", "second pin", "busy", "quiet"],
  );
  assert.deepEqual(
    orderChats(chats, "created").map((c) => c.name),
    ["first pin", "second pin", "quiet", "busy"],
  );
});

test("dropIntent: between rows pins, unpins or reorders; on a row links other Worktrees", () => {
  const pinned = { pinned: true, worktree: "/a" };
  const recent = { worktree: "/b" };
  assert.equal(dropIntent(recent, null, "before"), "pin");
  assert.equal(dropIntent(pinned, null, "before"), "none");
  assert.equal(dropIntent(recent, pinned, "after"), "pin");
  assert.equal(dropIntent(pinned, { pinned: true, worktree: "/c" }, "before"), "reorder");
  assert.equal(dropIntent(pinned, recent, "before"), "unpin");
  assert.equal(dropIntent(recent, { worktree: "/c" }, "after"), "none");
  assert.equal(dropIntent(recent, pinned, "on"), "link");
  assert.deepEqual(dropIntent(recent, pinned, "on", true), { invalid: "linked" });
  assert.deepEqual(dropIntent(recent, { worktree: "/b" }, "on"), { invalid: "same-worktree" });
});
