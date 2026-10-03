import assert from "node:assert/strict";
import test from "node:test";
import { closeOpenMarkdown } from "./streaming-markdown.ts";

test("finished text is left alone", () => {
  assert.equal(closeOpenMarkdown("Some **bold** and `code`."), "Some **bold** and `code`.");
  assert.equal(closeOpenMarkdown(""), "");
});

test("bold that is still streaming renders as bold", () => {
  assert.equal(closeOpenMarkdown("This demonstrates **bold te"), "This demonstrates **bold te**");
  assert.equal(closeOpenMarkdown("- item\n- **Claude:** done and **more"), "- item\n- **Claude:** done and **more**");
});

test("inline code that is still streaming renders as code, and bold inside it is not closed", () => {
  assert.equal(closeOpenMarkdown("Run `npm run"), "Run `npm run`");
  assert.equal(closeOpenMarkdown("Run `a **b"), "Run `a **b`");
  assert.equal(closeOpenMarkdown("Use `x` and **y"), "Use `x` and **y**");
});

test("a marker with nothing after it yet is dropped instead of closed", () => {
  assert.equal(closeOpenMarkdown("This is **"), "This is ");
  assert.equal(closeOpenMarkdown("Run `"), "Run ");
  assert.equal(closeOpenMarkdown("This is a **bold statement** with *"), "This is a **bold statement** with ");
  assert.equal(closeOpenMarkdown("**open text *"), "**open text**");
  assert.equal(closeOpenMarkdown("Now **bold "), "Now **bold**");
  assert.equal(closeOpenMarkdown("- a\n*"), "- a\n");
  assert.equal(closeOpenMarkdown("2 * 3"), "2 * 3");
});

test("open code fences are left for the renderer, and fenced code is never counted", () => {
  assert.equal(closeOpenMarkdown("```ts\nconst a = `x"), "```ts\nconst a = `x");
  assert.equal(closeOpenMarkdown("```\na ** b\n```\nNow **bold"), "```\na ** b\n```\nNow **bold**");
});

test("only the paragraph being written is considered", () => {
  assert.equal(closeOpenMarkdown("Odd ** in an old paragraph\n\nNew text"), "Odd ** in an old paragraph\n\nNew text");
});

test("thematic breaks and list bullets are not bold markers", () => {
  assert.equal(closeOpenMarkdown("Above\n***\nBelow"), "Above\n***\nBelow");
  assert.equal(closeOpenMarkdown("* one\n* two"), "* one\n* two");
});
