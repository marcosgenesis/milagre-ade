import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent } from "../model";
import { attentionNotice } from "./attention.ts";

const context = { projectName: "rd-events", worktreeName: "new-events-structure", chatTitle: "Split the events table", provider: "claude" as const };
const question = (text: string) => ({ id: text, header: "", question: text, options: [], multiSelect: false, allowOther: true, secret: false });

test("a question names the project, worktree and agent, and shows what it asks", () => {
  const event: AgentEvent = { type: "question-request", requestId: "q1", questions: [question("Which table layout?"), question("Keep the old view?")] };
  assert.deepEqual(attentionNotice(event, context), {
    title: "rd-events / new-events-structure - Claude needs input",
    subtitle: "Split the events table",
    body: "Which table layout? (+1 more)",
  });
});

test("an approval shows the command's first line, or the request's title", () => {
  const command: AgentEvent = { type: "permission-request", requestId: "p1", kind: "command", tool: "Bash", title: "Run this command?", command: "npm test\n--watch", allowForChat: true };
  assert.deepEqual(attentionNotice(command, { ...context, provider: "codex" }), {
    title: "rd-events / new-events-structure - Codex needs approval",
    subtitle: "Split the events table",
    body: "Run: npm test",
  });
  const edit: AgentEvent = { type: "permission-request", requestId: "p2", kind: "edit", tool: "Edit", title: "Edit App.tsx?", allowForChat: false };
  assert.equal(attentionNotice(edit, context)?.body, "Edit App.tsx?");
});

test("a chat on the project's own checkout is named by the project alone", () => {
  const event: AgentEvent = { type: "question-request", requestId: "q1", questions: [question("Ship it?")] };
  assert.equal(attentionNotice(event, { projectName: "shop", worktreeName: "shop" })?.title, "shop - Agent needs input");
});

test("other events need no notification", () => {
  assert.equal(attentionNotice({ type: "turn-completed" }, context), null);
});
