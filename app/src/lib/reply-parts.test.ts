import assert from "node:assert/strict";
import test from "node:test";
import type { ChatStep } from "../model";
import { replyParts, titleSpans } from "./reply-parts.ts";

const step = (id: string, offset?: number): ChatStep => ({ id, kind: "shell", title: `Ran \`${id}\``, status: "done", ...(offset === undefined ? {} : { offset }) });

test("steps sit between the text around them, in order", () => {
  const body = "Checking.\n\nNow editing.\n\nDone.";
  assert.deepEqual(replyParts(body, [step("a", 9), step("b", 9), step("c", 23)]), [
    { type: "text", text: "Checking." },
    { type: "steps", steps: [step("a", 9), step("b", 9)] },
    { type: "text", text: "\n\nNow editing." },
    { type: "steps", steps: [step("c", 23)] },
    { type: "text", text: "\n\nDone." },
  ]);
});

test("a reply without steps is its text; steps alone are one group", () => {
  assert.deepEqual(replyParts("Hello"), [{ type: "text", text: "Hello" }]);
  assert.deepEqual(replyParts("", [step("a", 0), step("b", 0)]), [{ type: "steps", steps: [step("a", 0), step("b", 0)] }]);
  assert.deepEqual(replyParts("", []), []);
});

test("whitespace between steps doesn't split their group", () => {
  assert.deepEqual(replyParts("Go.\n\n", [step("a", 3), step("b", 5)]), [{ type: "text", text: "Go." }, { type: "steps", steps: [step("a", 3), step("b", 5)] }]);
});

test("offsets past the text, missing or out of order still keep every step once", () => {
  assert.deepEqual(replyParts("Hi", [step("a", 99), step("b")]), [{ type: "text", text: "Hi" }, { type: "steps", steps: [step("a", 99), step("b")] }]);
  assert.deepEqual(replyParts("abcdef", [step("a", 4), step("b", 1)]), [{ type: "text", text: "abcd" }, { type: "steps", steps: [step("a", 4), step("b", 1)] }, { type: "text", text: "ef" }]);
});

test("titles split into text and code", () => {
  assert.deepEqual(titleSpans("Ran `npm test`"), [{ text: "Ran ", code: false }, { text: "npm test", code: true }]);
  assert.deepEqual(titleSpans("Searched for `greet` in `src`"), [{ text: "Searched for ", code: false }, { text: "greet", code: true }, { text: " in ", code: false }, { text: "src", code: true }]);
  assert.deepEqual(titleSpans("Updated the to-do list"), [{ text: "Updated the to-do list", code: false }]);
});
