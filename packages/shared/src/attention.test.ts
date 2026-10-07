import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent, CoordinatorState } from "./model.ts";
import { attentionContext, attentionLabel, attentionNotice, chatsNeedingAttention, waitingFor } from "./attention.mjs";

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
  const command: AgentEvent = {
    type: "permission-request",
    requestId: "p1",
    kind: "command",
    tool: "Bash",
    title: "Run this command?",
    command: "npm test\n--watch",
    allowForChat: true,
  };
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

test("the context names a chat's worktree, title and agent, or only its project when the chat is gone", () => {
  const state = {
    worktrees: { 1: { id: 1, project_id: 1, path: "/work/shop-login", name: "fix-login" } },
    sessions: { 2: { id: 2, worktree_id: 1, agent_name: "fix-login", status: "Created", provider: "codex" } },
    messages: [{ id: 3, session_id: 2, body: "Fix the login redirect\nand more", context: null, role: "user" }],
  } as unknown as CoordinatorState;
  assert.deepEqual(attentionContext(state, "shop", 2), {
    projectName: "shop",
    worktreeName: "fix-login",
    chatTitle: "Fix the login redirect",
    provider: "codex",
  });
  assert.deepEqual(attentionContext(state, "shop", 9), { projectName: "shop" });
});

test("other Projects' chats that wait on the user need attention; the open Project and Links don't", () => {
  const run = (approvals: number, questions: number) => ({
    approvals: Array.from({ length: approvals }, () => ({})),
    questions: Array.from({ length: questions }, () => ({})),
  });
  const runs = {
    "/a#1": run(1, 0),
    "/ab#2": run(0, 1),
    "/b#3": run(0, 0),
    "/c#4": run(1, 0),
    "milagre-link:12345678-1234-1234-1234-123456789abc#5": run(1, 0),
  } as never;
  assert.deepEqual(chatsNeedingAttention(runs, "/a"), ["/ab#2", "/c#4"]);
  assert.deepEqual(chatsNeedingAttention(undefined), []);
});

test("the attention button names one or two projects and counts the rest", () => {
  assert.equal(attentionLabel(["shop"]), "shop needs attention");
  assert.equal(attentionLabel(["shop", "api"]), "shop and api need attention");
  assert.equal(attentionLabel(["shop", "api", "web", "docs"]), "shop and 3 more need attention");
});

test("a waiting run reads as its command, its approval title, or its first question", () => {
  assert.equal(waitingFor({ approvals: [{ title: "Run?", command: "git log --oneline\ngit status" }], questions: [] } as never), "git log --oneline");
  assert.equal(waitingFor({ approvals: [{ title: "Edit README.md" }], questions: [] } as never), "Edit README.md");
  assert.equal(waitingFor({ approvals: [], questions: [{ questions: [{ question: "Which branch?" }] }] } as never), "Which branch?");
});
