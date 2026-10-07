import { test } from "node:test";
import assert from "node:assert/strict";
import { diffRows, splitFences } from "./message-fences.ts";

test("splits text and closed fences, dropping the newlines that hug a fence", () => {
  assert.deepEqual(splitFences("Intro:\n```tsx\n+a\n-b\n```\nNote\n\nNext"), [
    { kind: "text", text: "Intro:" },
    { kind: "code", fence: "tsx", code: "+a\n-b" },
    { kind: "text", text: "Note\n\nNext" },
  ]);
});

test("keeps an unclosed fence and inline backticks as text", () => {
  assert.deepEqual(splitFences("use `x`\n```js\nopen"), [{ kind: "text", text: "use `x`\n```js\nopen" }]);
  assert.deepEqual(splitFences("plain"), [{ kind: "text", text: "plain" }]);
});

test("reads diff rows only when every line has a marker and one changes", () => {
  assert.deepEqual(diffRows("+a\n b\n-c"), [
    { kind: "add", text: "a" },
    { kind: "context", text: "b" },
    { kind: "remove", text: "c" },
  ]);
  assert.equal(diffRows(" a\n b"), null);
  assert.equal(diffRows("+a\nb"), null);
});
