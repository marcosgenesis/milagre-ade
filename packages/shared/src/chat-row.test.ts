import assert from "node:assert/strict";
import test from "node:test";
import { DESKTOP_CHAT_ROW_SHOW, PHONE_CHAT_ROW_SHOW, activityAgo, parseChatRowShow } from "./chat-row.ts";

test("a saved choice keeps its booleans and falls back field by field", () => {
  assert.deepEqual(parseChatRowShow(undefined, PHONE_CHAT_ROW_SHOW), PHONE_CHAT_ROW_SHOW);
  assert.deepEqual(parseChatRowShow({ branch: true, diff: "yes", extra: true }, DESKTOP_CHAT_ROW_SHOW), { ...DESKTOP_CHAT_ROW_SHOW, branch: true });
});

test("last activity reads short", () => {
  const now = 10 * 7 * 24 * 3_600_000;
  assert.equal(activityAgo(now - 30_000, now), "now");
  assert.equal(activityAgo(now - 5 * 60_000, now), "5m");
  assert.equal(activityAgo(now - 3 * 3_600_000, now), "3h");
  assert.equal(activityAgo(now - 2 * 24 * 3_600_000, now), "2d");
  assert.equal(activityAgo(now - 15 * 24 * 3_600_000, now), "2w");
  assert.equal(activityAgo(now + 5000, now), "now");
});
