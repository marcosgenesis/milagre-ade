import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage, WorktreeLinkedContext } from "./model.ts";
import { summarizeChat } from "./chat-summary.mjs";
import { linkedSummaryText, worktreeLinkLabel, worktreeLinkText } from "./worktree-link.mjs";

const line = (extra: Partial<WorktreeLinkedContext>): WorktreeLinkedContext => ({
  kind: "worktree-linked",
  linkId: "l1",
  project: { name: "web", path: "/code/web" },
  sameProject: false,
  branches: ["main"],
  ...extra,
});

test("another Project's Worktree is named by Project and branch", () => {
  assert.deepEqual(worktreeLinkLabel(line({})), { lead: null, project: "web", detail: "main" });
  assert.equal(worktreeLinkText(line({})), "Linked to web main");
});

test("a whole-Project Link names how many Worktrees it reached", () => {
  const context = line({ project: { name: "mobile", path: "/code/mobile" }, branches: ["main", "upload-sheet", "fix"] });
  assert.deepEqual(worktreeLinkLabel(context), { lead: null, project: "mobile", detail: "· 3 Worktrees" });
});

test("a Worktree of the Chat's own Project is named by its branch", () => {
  const context = line({ project: { name: "api", path: "/code/api" }, sameProject: true, branches: ["upload-retries"] });
  assert.deepEqual(worktreeLinkLabel(context), { lead: "Worktree", project: null, detail: "upload-retries" });
  assert.equal(worktreeLinkText(context), "Linked to Worktree upload-retries in this Project");
});

test("the summary opens without the tags that wrap it for the agent", () => {
  assert.equal(linkedSummaryText("<linked_worktrees>\nMilagre attached this.\n\n## web\n</linked_worktrees>"), "Milagre attached this.\n\n## web");
});

test("a link line is not the Chat's last reply", () => {
  const messages: ChatMessage[] = [
    { id: 1, session_id: 1, body: "hi", context: null, role: "user" },
    { id: 2, session_id: 1, body: "done", context: null, role: "assistant", outcome: "completed" },
    { id: 3, session_id: 1, body: "Linked to web main", context: line({}), role: "assistant" },
  ];
  assert.equal(summarizeChat(messages).lastOutcome, "completed");
});
