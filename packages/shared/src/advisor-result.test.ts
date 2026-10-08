import assert from "node:assert/strict";
import { test } from "node:test";
import { advisorResultLabel } from "./advisor-result.ts";
test("advisor context identifies the provider and outcome as app-owned input", () => {
  assert.equal(
    advisorResultLabel({ kind: "advisor-result", advisorId: "advisor:a", completionId: "1", title: "Review", provider: "codex", outcome: "completed" }),
    "Codex advisor result: Review",
  );
  assert.match(
    advisorResultLabel({ kind: "advisor-result", advisorId: "advisor:a", completionId: "1", title: "Review", provider: "claude", outcome: "failed" }),
    /^Claude advisor failed:/,
  );
});
