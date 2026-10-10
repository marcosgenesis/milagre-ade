import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "./model.ts";
import { COMPACT_COMMAND, compactionLabel, compactionMessage, compactionText, isCompaction } from "./compaction.mjs";

test("a compaction message is the /compact command with a preparing divider that knows the gauge", () => {
  assert.deepEqual(compactionMessage({ used: 897_000, size: 1_000_000 }), {
    body: COMPACT_COMMAND,
    prompt: COMPACT_COMMAND,
    images: [],
    files: [],
    context: { kind: "compaction", status: "preparing", before: 897_000, size: 1_000_000 },
  });
  assert.deepEqual(compactionMessage(undefined).context, { kind: "compaction", status: "preparing" });
  assert.deepEqual(compactionMessage({ used: 0, size: 0 }).context, { kind: "compaction", status: "preparing" });
});

test("the divider names its status and the tokens around the compaction", () => {
  assert.deepEqual(compactionLabel({ kind: "compaction", status: "preparing", before: 897_000 }), { title: "Compacting context", before: "897k", after: null });
  assert.deepEqual(compactionLabel({ kind: "compaction", status: "done", before: 897_000, after: 42_000 }), {
    title: "Context compacted",
    before: "897k",
    after: "42k",
  });
  assert.deepEqual(compactionLabel({ kind: "compaction", status: "failed", before: 897_000, after: 42_000 }), {
    title: "Compaction failed",
    before: "897k",
    after: null,
  });
  assert.equal(compactionText({ kind: "compaction", status: "done", before: 897_000, after: 42_000 }), "Context compacted: 897k → 42k");
  assert.equal(compactionText({ kind: "compaction", status: "preparing", before: 897_000 }), "Compacting context: 897k");
  assert.equal(compactionText({ kind: "compaction", status: "done" }), "Context compacted");
});

const message = (context: ChatMessage["context"]): ChatMessage => ({ id: 1, session_id: 1, body: "/compact", context, role: "user" });

test("isCompaction tells the divider from other messages", () => {
  assert.equal(isCompaction(message({ kind: "compaction", status: "done" })), true);
  assert.equal(isCompaction(message(null)), false);
  assert.equal(isCompaction(message({ kind: "handoff", from: { provider: "claude" }, to: { provider: "codex" }, status: "done" })), false);
  assert.equal(isCompaction(undefined), false);
});
