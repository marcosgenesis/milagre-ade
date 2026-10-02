import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage, ChatStep } from "../model";
import { GH_MISSING, NO_ORIGIN, dialogMode, gitChatContext, gitRunNote, hookFailureMessage, testCommandsFrom } from "./git-dialog.ts";

const READY = { hasChanges: true, unpushed: 0, prOpen: false, onBase: false, hasOrigin: true, ghReady: true };

test("changes on a worktree branch commit, push and open a PR", () => {
  const mode = dialogMode(READY);
  assert.equal(mode.showCommit, true);
  assert.equal(mode.showPrFields, true);
  assert.equal(mode.prOpen, false);
  assert.equal(mode.prBlocked, null);
  assert.deepEqual(mode.primary, { label: "Commit, push and open PR", steps: ["commit", "push", "pr"], disabledReason: null });
  assert.deepEqual(mode.secondary, { label: "Commit only", steps: ["commit"], disabledReason: null });
  assert.equal(mode.idle, null);
});

test("with an open PR the dialog commits and pushes, which updates it", () => {
  const mode = dialogMode({ ...READY, prOpen: true });
  assert.equal(mode.showPrFields, false);
  assert.equal(mode.prOpen, true);
  assert.deepEqual(mode.primary, { label: "Commit and push", steps: ["commit", "push"], disabledReason: null });
  assert.deepEqual(mode.secondary?.label, "Commit only");
  const pushOnly = dialogMode({ ...READY, prOpen: true, hasChanges: false, unpushed: 2 });
  assert.equal(pushOnly.showCommit, false);
  assert.deepEqual(pushOnly.primary, { label: "Push", steps: ["push"], disabledReason: null });
  assert.equal(pushOnly.secondary, null);
});

test("nothing to commit but unpushed commits: push and open a PR, with no commit field", () => {
  const mode = dialogMode({ ...READY, hasChanges: false, unpushed: 1, ahead: 1 });
  assert.equal(mode.showCommit, false);
  assert.equal(mode.showPrFields, true);
  assert.deepEqual(mode.primary, { label: "Push and open PR", steps: ["push", "pr"], disabledReason: null });
  assert.equal(mode.secondary, null);
});

test("a pushed branch without a PR can still open one", () => {
  assert.deepEqual(dialogMode({ ...READY, hasChanges: false, ahead: 3 }).primary, { label: "Open PR", steps: ["pr"], disabledReason: null });
  const idle = dialogMode({ ...READY, hasChanges: false });
  assert.equal(idle.primary, null);
  assert.equal(idle.idle, "Nothing to commit or push.");
  assert.equal(dialogMode({ ...READY, hasChanges: false, prOpen: true }).idle, "Everything is committed and pushed.");
});

test("on the base branch the PR step is disabled with a reason", () => {
  const mode = dialogMode({ ...READY, onBase: true, base: "main" });
  assert.equal(mode.prBlocked, "You're on main. Open a PR from a worktree branch.");
  assert.equal(mode.showPrFields, false);
  assert.deepEqual(mode.primary, { label: "Commit and push", steps: ["commit", "push"], disabledReason: null });
  assert.deepEqual(dialogMode({ ...READY, onBase: true, hasChanges: false, unpushed: 1 }).primary, { label: "Push", steps: ["push"], disabledReason: null });
});

test("without origin, push and PR are disabled and only the commit runs", () => {
  const mode = dialogMode({ ...READY, hasOrigin: false, ghReady: false });
  assert.equal(mode.prBlocked, NO_ORIGIN);
  assert.deepEqual(mode.primary, { label: "Commit and push", steps: ["commit", "push"], disabledReason: NO_ORIGIN });
  assert.deepEqual(mode.secondary, { label: "Commit only", steps: ["commit"], disabledReason: null });
  assert.equal(dialogMode({ ...READY, hasOrigin: false, hasChanges: false, unpushed: 1 }).primary?.disabledReason, NO_ORIGIN);
});

test("when gh can't open PRs, the dialog says why and still commits and pushes", () => {
  const missing = dialogMode({ ...READY, ghReady: false, ghMessage: GH_MISSING });
  assert.equal(missing.prBlocked, GH_MISSING);
  assert.equal(missing.showPrFields, false);
  assert.deepEqual(missing.primary, { label: "Commit and push", steps: ["commit", "push"], disabledReason: null });
  assert.equal(dialogMode({ ...READY, ghReady: false, ghMessage: "Run `gh auth login` in a terminal." }).prBlocked, "Run `gh auth login` in a terminal.");
});

const step = (title: string, status: ChatStep["status"] = "done", kind: ChatStep["kind"] = "shell"): ChatStep => ({ id: title, kind, title, status });
const message = (id: number, role: "user" | "assistant", body: string, steps?: ChatStep[]): ChatMessage => ({ id, session_id: 1, body, context: null, role, steps });

test("testCommandsFrom keeps the test commands the agent ran, last run of each", () => {
  const messages = [
    message(1, "user", "Fix it"),
    message(2, "assistant", "Done", [step("Ran `npm test`", "failed"), step("Ran `ls -la`"), step("Edited `cart.js`", "done", "edit"), step("Ran `npm run build`")]),
    message(3, "assistant", "Fixed", [step("Ran `npm test`"), step("Ran `pytest -q tests/`"), step("Ran `npm run test:agent`", "running")]),
  ];
  assert.deepEqual(testCommandsFrom(messages), [
    { command: "npm test", status: "done" },
    { command: "pytest -q tests/", status: "done" },
  ]);
  assert.deepEqual(testCommandsFrom([message(1, "user", "hi")]), []);
});

test("gitChatContext takes the first and the last few user messages", () => {
  const messages = [1, 2, 3, 4, 5].flatMap((index) => [message(index * 2, "user", `ask ${index}`), message(index * 2 + 1, "assistant", `reply ${index}`)]);
  assert.deepEqual(gitChatContext("Fix the cart", messages), {
    chatTitle: "Fix the cart",
    firstMessage: "ask 1",
    recentMessages: ["ask 3", "ask 4", "ask 5"],
    testCommands: [],
  });
});

test("hookFailureMessage asks the agent to fix the hook's problem", () => {
  assert.equal(hookFailureMessage("lint: missing semicolon"), "The commit failed in a git hook. Fix the problem and tell me when it's ready:\n\nlint: missing semicolon");
});

test("gitRunNote records what the dialog did", () => {
  const url = "https://github.com/example/shop/pull/12";
  assert.equal(gitRunNote({ shortSha: "abc1234", pushedBranch: "milagre/cart", pr: { url, number: 12, created: true } }), `Committed abc1234, pushed milagre/cart and opened PR #12: ${url}`);
  assert.equal(gitRunNote({ shortSha: "abc1234", pushedBranch: "milagre/cart", pr: { url, number: 12, created: false } }), `Committed abc1234 and pushed milagre/cart. PR #12 is updated: ${url}`);
  assert.equal(gitRunNote({ shortSha: "abc1234" }), "Committed abc1234.");
  assert.equal(gitRunNote({ pushedBranch: "milagre/cart", pr: { url, number: 12, created: true } }), `Pushed milagre/cart and opened PR #12: ${url}`);
  assert.equal(gitRunNote({ pr: { url, number: null, created: true } }), `Opened the PR: ${url}`);
  assert.equal(gitRunNote({}), null);
});
