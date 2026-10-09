import test from "node:test";
import assert from "node:assert/strict";

test("scope keys preserve Project paths and separate named Link Chats", async () => {
  const helpers = await import("./chat-scopes.mjs").catch(() => null);
  assert.equal(typeof helpers?.chatKeyForScope, "function", "scope keys are available");
  if (!helpers) return;
  const project = { kind: "project" as const, projectPath: "/code/my#project" };
  assert.equal(helpers.chatKeyForScope(project, 7), "/code/my#project#7");
  assert.deepEqual(helpers.scopeFromChatKey("/code/my#project#7"), project);
  const link = { kind: "link" as const, linkId: "f1713d69-569d-405b-a0b2-19bfdf565a76" };
  assert.equal(helpers.chatKeyForScope(link, 7), "milagre-link:f1713d69-569d-405b-a0b2-19bfdf565a76#7");
  assert.deepEqual(helpers.scopeFromChatKey("milagre-link:f1713d69-569d-405b-a0b2-19bfdf565a76#7"), link);
  assert.throws(() => helpers.chatKeyForScope(link, Number.NaN));
  assert.throws(() => helpers.scopeKey({ kind: "link", linkId: "../../outside" }));
});
