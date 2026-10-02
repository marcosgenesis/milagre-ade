import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "../model";
import { chatMark, folderName, formatLineCount, orderChats } from "./chat-list.ts";

test("chatMark: a question beats waiting beats running beats unread", () => {
  assert.equal(chatMark({ asking: true, waiting: true, running: true, unread: true }), "question");
  assert.equal(chatMark({ waiting: true, running: true, unread: true }), "waiting");
  assert.equal(chatMark({ waiting: false, running: true, unread: true }), "running");
  assert.equal(chatMark({ waiting: false, running: false, unread: true }), "unread");
  assert.equal(chatMark({ waiting: false, running: false, unread: false }), "idle");
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
  const chat = (name: string, ids: number[]) => ({ name, sessionMessages: ids.map((id) => ({ id, session_id: 1, body: "", context: null })) as ChatMessage[] });
  const chats = [chat("old but active", [1, 9]), chat("newest", [7, 8]), chat("middle", [4, 5])];
  assert.deepEqual(orderChats(chats, "created").map((c) => c.name), ["newest", "middle", "old but active"]);
  assert.deepEqual(orderChats(chats, "recent").map((c) => c.name), ["old but active", "newest", "middle"]);
  assert.deepEqual(chats.map((c) => c.name), ["old but active", "newest", "middle"]);
});
