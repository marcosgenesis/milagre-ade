import assert from "node:assert/strict";
import test from "node:test";
import { delegatedChats, NO_LINKED_WORK } from "./linked-work.ts";

test("delegatedChats: the project's Chats a Delegation is queued or running for", () => {
  const delegation = (to_chat: string | null) => ({
    id: to_chat ?? "new",
    link_id: "l",
    from_chat: "/web#1",
    to_chat,
    from_label: "web",
    to_label: "api",
    status: "queued" as const,
    message: "Do it",
  });
  const work = { ...NO_LINKED_WORK, delegations: [delegation("/api#3"), delegation("/api-other#4"), delegation(null), delegation("/api#7")] };
  assert.deepEqual([...delegatedChats(work, "/api")], [3, 7]);
  assert.deepEqual([...delegatedChats(NO_LINKED_WORK, "/api")], []);
});
