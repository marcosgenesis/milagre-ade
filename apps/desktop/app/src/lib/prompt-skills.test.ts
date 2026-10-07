import test from "node:test";
import assert from "node:assert/strict";
import { promptSkillParts } from "./prompt-skills.ts";

test("recognizes complete skills anywhere in a draft and preserves the exact text", () => {
  const draft = "run /tldr, then\n/Plugin:review-code and /docs.v2.";
  const parts = promptSkillParts(draft, ["tldr", "plugin:review-code", "docs.v2"]);
  assert.deepEqual(
    parts.filter((part) => part.skill).map((part) => part.text),
    ["/tldr", "/Plugin:review-code", "/docs.v2"],
  );
  assert.equal(parts.map((part) => part.text).join(""), draft);
});

test("does not recognize partial skills, unknown commands, URLs or paths", () => {
  const draft = "/tl /tldr-extra /unknown https://example.com/tldr /tldr/file /tldr.md @/tldr";
  assert.deepEqual(promptSkillParts(draft, ["tldr"]), [{ text: draft, skill: false }]);
  assert.deepEqual(promptSkillParts("", ["tldr"]), []);
});

test("uses the current catalog, including repeated commands", () => {
  assert.deepEqual(promptSkillParts("/review /review", ["review"]), [
    { text: "/review", skill: true },
    { text: " ", skill: false },
    { text: "/review", skill: true },
  ]);
  assert.deepEqual(promptSkillParts("/review", ["tldr"]), [{ text: "/review", skill: false }]);
});
