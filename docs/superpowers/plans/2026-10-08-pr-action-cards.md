# PR action cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four PR-blocker pills (Resolve conflicts, Address review, Fix CI, Update branch) send a structured message that renders as a card on desktop and phone, and the agent gets a bundled Milagre skill instead of a long inline prompt.

**Architecture:** A new `ChatContext` kind, `pr-action`, carries `{ action, pr, url }`. The renderer asks `chat:send` for a PR action with a `prAction` field; the runtime validates it, then writes the stored body, the agent prompt (ending in a `/milagre-<action>` skill token that the existing skill expansion turns into the SKILL.md for every provider) and the context itself. Both platforms render messages with that context as a static card.

**Tech Stack:** Node 24 (`node:test`), Electron + React + Tailwind (desktop), Expo / React Native (mobile), shared `.mjs` + `.d.mts` modules in `packages/shared`.

**Spec:** No spec file; the user approved the in-chat design on 2026-10-08 and chose to skip it. Decisions: Update branch is the "sync" pill; scope is the 4 PR-blocker pills; structured context, not parsed text; skills bundled in Milagre; static card (no live state line).

## Global Constraints

- Desktop and mobile change together (AGENTS.md "Desktop and mobile stay in sync").
- Mobile change is JS only: no native dependency, config plugin or `app.json` change. It ships by OTA; never start an EAS build.
- `chat:send` keeps dropping any renderer-supplied `context`; `pr-action` is built only by the runtime from a validated `prAction`.
- Skill names: `milagre-fix-ci`, `milagre-address-review`, `milagre-resolve-conflicts`, `milagre-update-branch`, in `packages/core/src/bundled-skills/<name>/SKILL.md`.
- Pill labels stay as in `BLOCKERS` today: "Resolve conflicts", "Address review", "Fix CI", "Update branch".
- No em or en dashes in skill text or user-facing copy.
- No Claude attribution in commits or the PR.
- Before the PR: `npm run typecheck`, `npm run typecheck:mobile`, `npm run lint`, `npm test -- --unit`, `npm test -- --only chat-layout`.
- PR screenshots go on the orphan `screenshots` branch, never in the PR commits.

## Review Focus

1. **A PR on GitHub Enterprise or a fork** (`https://github.example.com/org/repo/pull/12`): the action must still validate. Pinned by a `pullRequestActionContext` test in Task 1.
2. **A PR with no number yet** (`number` undefined in the poll result): the pill must not show, instead of sending "pull request #undefined". Pinned in Task 4 by gating `pullRequestAction` on a non-null action, and by the Task 1 test that rejects a missing `pr`.
3. **A forged request from the phone or renderer** (`prAction` whose URL number differs from `pr`, an unknown action, or a raw `context: { kind: "pr-action" }`): rejected or stripped. Pinned by Task 3 tests.
4. **Clicking the pill while a turn runs** (steering): the message must still be stored with its card context and still expand the skill. Covered because `chats.send` keeps `context` for steering messages (`chat-host.cjs:405`) and skill expansion runs in `startAgentTurn` for both; Task 3 asserts the stored context and the expanded prompt on the first send.
5. **A project that has its own `milagre-fix-ci` skill**: it overrides the bundled one, as other bundled skills do. Pinned by a Task 2 test.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/shared/src/model.ts` | modify | `PullRequestBlocker` moves here; new `PullRequestActionContext`; `ChatContext` union; `ChatSendRequest.prAction` |
| `packages/shared/src/pr-action.mjs` + `.d.mts` | create | Action table (label, sentence, skill), validation, body and prompt builders, type guard |
| `packages/shared/src/pr-action.test.ts` | create | Unit tests for the above |
| `packages/shared/src/pr-blockers.ts` | modify | Labels come from `PR_ACTIONS`; `blockerPrompt` removed; re-export `PullRequestBlocker` |
| `packages/shared/package.json` | modify | Export `./pr-action` |
| `packages/shared/src/chats.mjs` + `.d.mts` | modify | `createPendingChat` takes an optional `context` |
| `packages/core/src/bundled-skills/milagre-*/SKILL.md` | create ×4 | The procedures |
| `packages/core/src/skills.test.cjs` | modify | Bundled list and expansion cover the new skills |
| `packages/core/src/runtime.cjs` | modify | `chat:send` builds PR action messages |
| `packages/core/src/runtime-pr-action.test.cjs` | create | Runtime tests |
| `apps/desktop/app/src/components/agents/PullRequestActionCard.tsx` | create | Desktop card |
| `apps/desktop/app/src/components/ChatComposer.tsx` | modify | Render the card |
| `apps/desktop/app/src/App.tsx` | modify | Pill sends a PR action |
| `apps/desktop/app/src/lib/pr-blockers.test.ts` | modify | Drop `blockerPrompt` assertions |
| `scripts/test-chat-layout.cjs` | modify | Electron check for the card |
| `apps/mobile/src/pr-action-card.tsx` | create | Mobile card |
| `apps/mobile/src/chat-reply.tsx` | modify | Render the card |
| `apps/mobile/src/app/chat.tsx` | modify | Pill sends a PR action |

---

### Task 1: Shared PR action module and context type

**Files:**
- Create: `packages/shared/src/pr-action.mjs`, `packages/shared/src/pr-action.d.mts`, `packages/shared/src/pr-action.test.ts`
- Modify: `packages/shared/src/model.ts:251` (ChatContext), `packages/shared/src/model.ts:489-513` (ChatSendRequest), `packages/shared/src/pr-blockers.ts`, `packages/shared/package.json`, `packages/shared/src/chats.mjs:56-75`, `packages/shared/src/chats.d.mts:23-32`, `apps/desktop/app/src/lib/pr-blockers.test.ts:65-79`

**Interfaces:**
- Produces (from `@milagre/shared/model`):
  - `type PullRequestBlocker = "conflicts" | "changes-requested" | "checks-failed" | "behind"`
  - `type PullRequestActionContext = { kind: "pr-action"; action: PullRequestBlocker; pr: number; url: string }`
  - `ChatSendRequest.prAction?: { action: PullRequestBlocker; pr: number; url: string }`
- Produces (from `@milagre/shared/pr-action`):
  - `PR_ACTIONS: Record<PullRequestBlocker, { label: string; sentence: string; skill: string }>`
  - `pullRequestActionContext(request: unknown): PullRequestActionContext | null`
  - `pullRequestActionBody(context: PullRequestActionContext): string`
  - `pullRequestActionPrompt(context: PullRequestActionContext): string`
  - `isPullRequestAction(context: unknown): context is PullRequestActionContext`
- Produces: `createPendingChat({ ..., context?: ChatContext })`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/pr-action.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { PR_ACTIONS, isPullRequestAction, pullRequestActionBody, pullRequestActionContext, pullRequestActionPrompt } from "./pr-action.mjs";
import { BLOCKERS } from "./pr-blockers.ts";

const url = "https://github.com/the-ptf/milagre-ade/pull/77";

test("a valid request becomes a pr-action context", () => {
  assert.deepEqual(pullRequestActionContext({ action: "checks-failed", pr: 77, url }), { kind: "pr-action", action: "checks-failed", pr: 77, url });
});

test("GitHub Enterprise pull request URLs are accepted", () => {
  const enterprise = "https://github.example.com/org/repo/pull/12";
  assert.equal(pullRequestActionContext({ action: "behind", pr: 12, url: enterprise })?.url, enterprise);
});

test("malformed requests are refused", () => {
  for (const request of [
    null,
    "checks-failed",
    { action: "deploy", pr: 77, url },
    { action: "checks-failed", url },
    { action: "checks-failed", pr: 0, url },
    { action: "checks-failed", pr: 7.5, url },
    { action: "checks-failed", pr: 78, url },
    { action: "checks-failed", pr: 77, url: "http://github.com/a/b/pull/77" },
    { action: "checks-failed", pr: 77, url: "https://github.com/a/b/pull/77/files" },
    { action: "toString", pr: 77, url },
  ]) {
    assert.equal(pullRequestActionContext(request), null, JSON.stringify(request));
  }
});

test("body is the short line the chat shows; prompt adds the URL and the skill token", () => {
  const context = pullRequestActionContext({ action: "checks-failed", pr: 77, url })!;
  assert.equal(pullRequestActionBody(context), "Fix CI on pull request #77");
  assert.equal(pullRequestActionPrompt(context), `Fix CI on pull request #77 (${url}). /milagre-fix-ci`);
});

test("every blocker has an action whose pill label is the one BLOCKERS shows", () => {
  for (const blocker of Object.keys(BLOCKERS) as (keyof typeof BLOCKERS)[]) {
    assert.equal(BLOCKERS[blocker].action, PR_ACTIONS[blocker].label);
    assert.match(PR_ACTIONS[blocker].skill, /^milagre-[a-z-]+$/);
  }
});

test("isPullRequestAction tells a pr-action context from the others", () => {
  assert.equal(isPullRequestAction({ kind: "pr-action", action: "behind", pr: 1, url }), true);
  assert.equal(isPullRequestAction({ kind: "git-action" }), false);
  assert.equal(isPullRequestAction(null), false);
  assert.equal(isPullRequestAction("handover"), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/shared/src/pr-action.test.ts`
Expected: FAIL, cannot find module `./pr-action.mjs`.

- [ ] **Step 3: Implement**

`packages/shared/src/pr-action.mjs`:

```js
/** What each PR-blocker pill asks for: its label, the line the chat keeps, and the bundled skill with the procedure. */
export const PR_ACTIONS = {
  conflicts: { label: "Resolve conflicts", sentence: "Resolve the conflicts on pull request", skill: "milagre-resolve-conflicts" },
  "changes-requested": { label: "Address review", sentence: "Address the review on pull request", skill: "milagre-address-review" },
  "checks-failed": { label: "Fix CI", sentence: "Fix CI on pull request", skill: "milagre-fix-ci" },
  behind: { label: "Update branch", sentence: "Update the branch of pull request", skill: "milagre-update-branch" },
};

// Any https host, so GitHub Enterprise works; the path must end at the pull request itself.
const PULL_REQUEST_URL = /^https:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/(\d+)$/;

/** A renderer's PR action, checked: null unless the action is known and the URL is that pull request's. */
export function pullRequestActionContext(request) {
  if (!request || typeof request !== "object") return null;
  const { action, pr, url } = request;
  if (typeof action !== "string" || !Object.hasOwn(PR_ACTIONS, action)) return null;
  if (!Number.isSafeInteger(pr) || pr <= 0 || typeof url !== "string") return null;
  const match = PULL_REQUEST_URL.exec(url);
  if (!match || Number(match[1]) !== pr) return null;
  return { kind: "pr-action", action, pr, url };
}

export function pullRequestActionBody(context) {
  return `${PR_ACTIONS[context.action].sentence} #${context.pr}`;
}

/** What the agent is sent: the line, the URL, then the skill token the runtime expands into the skill's instructions. */
export function pullRequestActionPrompt(context) {
  return `${pullRequestActionBody(context)} (${context.url}). /${PR_ACTIONS[context.action].skill}`;
}

export function isPullRequestAction(context) {
  return typeof context === "object" && context !== null && context.kind === "pr-action";
}
```

`packages/shared/src/pr-action.d.mts`:

```ts
import type { PullRequestActionContext, PullRequestBlocker } from "./model.ts";

export const PR_ACTIONS: Record<PullRequestBlocker, { label: string; sentence: string; skill: string }>;
export function pullRequestActionContext(request: unknown): PullRequestActionContext | null;
export function pullRequestActionBody(context: PullRequestActionContext): string;
export function pullRequestActionPrompt(context: PullRequestActionContext): string;
export function isPullRequestAction(context: unknown): context is PullRequestActionContext;
```

`packages/shared/package.json`: add next to the `./prompt-skills` export, in the same shape:

```json
    "./pr-action": {
      "types": "./src/pr-action.d.mts",
      "default": "./src/pr-action.mjs"
    },
```

If the `files`-style list near line 14 lists `src/pr-blockers.ts`, add `"src/pr-action.mjs"` and `"src/pr-action.d.mts"` beside it.

`packages/shared/src/model.ts`: above `ChatContext` (line 251) add, and extend the union:

```ts
/** Something on GitHub that stops an open PR from merging and that the agent can fix. */
export type PullRequestBlocker = "conflicts" | "changes-requested" | "checks-failed" | "behind";

/** A PR-blocker pill the user clicked. Milagre wrote the message and the skill prompt the agent got. */
export type PullRequestActionContext = { kind: "pr-action"; action: PullRequestBlocker; pr: number; url: string };

export type ChatContext =
  | AdvisorResultContext
  | LinkedContext
  | { kind: "git-action" }
  | HandoffContext
  | PullRequestActionContext
  | "handover"
  | null;
```

In `ChatSendRequest` (after `tldrEnabled`):

```ts
  /** A PR-blocker pill's action. Milagre checks it and writes the body, prompt and context itself, ignoring the ones sent. */
  prAction?: { action: PullRequestBlocker; pr: number; url: string };
```

`packages/shared/src/pr-blockers.ts`:
- Replace the `PullRequestBlocker` declaration with `export type { PullRequestBlocker } from "./model.ts";` and change the first import to `import type { PullRequest, PullRequestBlocker } from "./model.ts";`.
- Add `import { PR_ACTIONS } from "./pr-action.mjs";` and make each `action:` in `BLOCKERS` read from it, e.g. `checks-failed: { short: "CI failed", long: "CI checks failed", action: PR_ACTIONS["checks-failed"].label, tone: "red" }`.
- Delete `blockerPrompt` (lines 70-82). Its procedure moves into the skills in Task 2.

`packages/shared/src/chats.mjs` `createPendingChat`: add `context = null` to the destructured params and use `context,` instead of `context: null,` in `message`. In `chats.d.mts` add `context?: ChatContext;` to the input type (import `ChatContext` from `./model.ts` alongside the existing model imports).

`apps/desktop/app/src/lib/pr-blockers.test.ts`: remove `blockerPrompt` from the import, delete the test "the review prompt names the PR so the agent can read its comments" (lines 65-68), and delete the last assertion line of "a failed CI action clears..." (line 78).

- [ ] **Step 4: Run the tests and typecheck**

Run: `node --test packages/shared/src/pr-action.test.ts apps/desktop/app/src/lib/pr-blockers.test.ts && npm run typecheck --workspace @milagre/shared`
Expected: PASS, no type errors. (`App.tsx` and mobile `chat.tsx` still import `blockerPrompt`; Tasks 4 and 5 fix them, so run the full `npm run typecheck` only after Task 5.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared apps/desktop/app/src/lib/pr-blockers.test.ts
git commit -m "feat: pr-action chat context and shared PR action helpers"
```

---

### Task 2: Four bundled skills

**Files:**
- Create: `packages/core/src/bundled-skills/milagre-fix-ci/SKILL.md`, `.../milagre-address-review/SKILL.md`, `.../milagre-resolve-conflicts/SKILL.md`, `.../milagre-update-branch/SKILL.md`
- Modify: `packages/core/src/skills.test.cjs:189-238`

**Interfaces:**
- Consumes: skill names from `PR_ACTIONS[*].skill` (Task 1).
- Produces: skills discoverable as `/milagre-fix-ci` and the rest, scope `bundled`, provider `milagre`.

- [ ] **Step 1: Write the failing test**

In `skills.test.cjs`, the test "bundles tldr with its checklist..." lists every bundled skill sorted by name. Replace its `milagre` spread line with:

```js
      ...[
        "milagre",
        "milagre-address-review",
        "milagre-advisor",
        "milagre-committee",
        "milagre-fix-ci",
        "milagre-help",
        "milagre-resolve-conflicts",
        "milagre-update-branch",
      ].map((name) => ({ name, scope: "bundled", provider: "milagre" })),
```

Append a new test:

```js
test("PR action skills expand from a pill's prompt, and a project skill overrides them", async (t) => {
  const { project, home, skill } = await fixture(t);
  const { skills } = await discoverSkills(project, { home });
  for (const name of ["milagre-fix-ci", "milagre-address-review", "milagre-resolve-conflicts", "milagre-update-branch"]) {
    const info = skills.find((s) => s.name === name);
    assert.ok(info, name);
    const prompt = `Fix CI on pull request #77 (https://github.com/o/r/pull/77). /${name}`;
    const expanded = await expandSkillPrompt(project, prompt, { home });
    assert.ok(expanded.startsWith(prompt));
    const content = await fs.readFile(info.path, "utf8");
    assert.ok(expanded.includes(content));
    assert.doesNotMatch(content, /[–—]/, `${name} has no em or en dashes`);
    for (const match of content.matchAll(/\]\(([^)]+\.md)\)/g)) await fs.access(path.resolve(path.dirname(info.path), match[1]));
  }
  const custom = await skill(project, ".claude", "milagre-fix-ci", "Our own CI steps");
  assert.equal((await discoverSkills(project, { home })).skills.find((s) => s.name === "milagre-fix-ci").path, custom);
  assert.ok((await expandSkillPrompt(project, "Fix CI. /milagre-fix-ci", { home })).includes("Our own CI steps"));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/core/src/skills.test.cjs`
Expected: FAIL; the bundled list doesn't match and `milagre-fix-ci` isn't found.

- [ ] **Step 3: Write the skills**

`packages/core/src/bundled-skills/milagre-fix-ci/SKILL.md`:

```markdown
---
name: milagre-fix-ci
description: Fix the failing CI checks on a GitHub pull request and push the fix. Milagre's Fix CI action invokes it with the pull request's number and URL; also usable as /milagre-fix-ci with a pull request number.
---

# Fix CI

The message names the pull request. The user clicking Fix CI is their request to fix it and push, so commit and push without asking again.

1. List the checks with `gh pr checks <number>`. Note each failing check and its run id.
2. Read each failure with `gh run view <run-id> --log-failed`. Find the first real error, not the errors that cascade from it.
3. Decide whether the failure is this branch's. A check that also fails on the base branch, or a timeout or network error with no code cause, is not: rerun it once with `gh run rerun <run-id> --failed`, and if it fails again, report it instead of changing code.
4. Reproduce the failure locally with the command the workflow runs (read it in `.github/workflows/`). Fix the cause. Never skip, disable or loosen a check, and never mark a test as skipped to get green.
5. Run that command again, plus the repo's own pre-push checks, until it passes.
6. Commit with a message that names the fix, and push to the pull request's branch. Never force-push.
7. Report each failing check, its cause, your fix and the local command that now passes. Name any check you left alone and why.
```

`packages/core/src/bundled-skills/milagre-address-review/SKILL.md`:

```markdown
---
name: milagre-address-review
description: Address the changes a reviewer requested on a GitHub pull request, then push. Milagre's Address review action invokes it with the pull request's number and URL; also usable as /milagre-address-review with a pull request number.
---

# Address review

The message names the pull request. The user clicking Address review is their request to make the changes and push, so commit and push without asking again.

1. Read the reviews with `gh pr view <number> --comments`, and the inline comments with `gh api repos/{owner}/{repo}/pulls/<number>/comments`. Only unresolved comments from the latest review round need action.
2. Write a list with one line per comment: its `file:line` and what the reviewer asked.
3. Address each one. When a comment is wrong or already out of date, leave the code as it is and note why.
4. Run the checks for the code you changed.
5. Commit and push. Never force-push. Don't reply to or resolve threads on GitHub; the user does that.
6. Report the list: each comment, and what you changed for it or why you didn't.
```

`packages/core/src/bundled-skills/milagre-resolve-conflicts/SKILL.md`:

```markdown
---
name: milagre-resolve-conflicts
description: Resolve a GitHub pull request's merge conflicts with its base branch, keeping the intent of both sides, then push. Milagre's Resolve conflicts action invokes it with the pull request's number and URL; also usable as /milagre-resolve-conflicts with a pull request number.
---

# Resolve conflicts

The message names the pull request. The user clicking Resolve conflicts is their request to resolve them and push, so commit and push without asking again.

1. Find the base branch with `gh pr view <number> --json baseRefName --jq .baseRefName`, then `git fetch origin <base>`.
2. Merge it: `git merge origin/<base>`. Don't rebase; the branch is already pushed and may be reviewed.
3. For each conflicted file, read both sides and the commits behind them (`git log --oneline HEAD...origin/<base> -- <file>`) to learn what each side meant. Keep both intents. When they truly contradict, keep the base branch's behavior and say so in the report.
4. Regenerate lockfiles and generated files with their own tools instead of merging them by hand.
5. Run the typecheck, the linter and the tests that cover the conflicted files.
6. Commit the merge and push. Never force-push.
7. Report each conflicted file and how you resolved it.
```

`packages/core/src/bundled-skills/milagre-update-branch/SKILL.md`:

```markdown
---
name: milagre-update-branch
description: Bring a GitHub pull request's branch up to date with its base branch, fix what the update breaks, then push. Milagre's Update branch action invokes it with the pull request's number and URL; also usable as /milagre-update-branch with a pull request number.
---

# Update branch

The message names the pull request. The user clicking Update branch is their request to update it and push, so commit and push without asking again.

1. Find the base branch with `gh pr view <number> --json baseRefName --jq .baseRefName`, then `git fetch origin <base>`.
2. Merge it: `git merge origin/<base>`. Don't rebase. If the merge conflicts, resolve it as [milagre-resolve-conflicts](../milagre-resolve-conflicts/SKILL.md) describes.
3. Run the typecheck, the linter and the tests. Fix whatever the new base commits broke on this branch, such as a renamed module or a changed API.
4. Push. Never force-push.
5. Report how many commits came in from the base branch and any fixes you made.
```

- [ ] **Step 4: Run the tests**

Run: `node --test packages/core/src/skills.test.cjs packages/core/src/agents/events.test.cjs`
Expected: PASS. (`events.test.cjs` mentions bundled skills; if it lists them, add the four names the same way.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bundled-skills packages/core/src/skills.test.cjs packages/core/src/agents/events.test.cjs
git commit -m "feat: bundle Fix CI, review, conflict and update-branch skills"
```

---

### Task 3: Runtime builds PR action messages

**Files:**
- Modify: `packages/core/src/runtime.cjs:885-890` (and its requires near line 7)
- Create: `packages/core/src/runtime-pr-action.test.cjs`

**Interfaces:**
- Consumes: `pullRequestActionContext`, `pullRequestActionBody`, `pullRequestActionPrompt` from `@milagre/shared/pr-action` (Task 1); bundled skills (Task 2).
- Produces: `chat:send` with `prAction` stores `{ body: <sentence #N>, context: PullRequestActionContext }` and starts a turn whose prompt begins with `pullRequestActionPrompt(context)` followed by the expanded skill. An invalid `prAction` rejects with `"That pull request action isn't valid."`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/runtime-pr-action.test.cjs`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRuntime } = require("./runtime.cjs");
const { waitUntil } = require("./agents/test-helpers.cjs");

const url = "https://github.com/the-ptf/milagre-ade/pull/77";

async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-pr-action-")));
  const project = path.join(dir, "project");
  await fs.mkdir(project);
  execFileSync("git", ["init", "-b", "main", project], { stdio: "ignore" });
  const turns = [];
  const runtime = createRuntime({
    dataDir: path.join(dir, "data"),
    cwd: project,
    environmentReady: Promise.resolve(),
    titleModels: {},
    agentCli: async () => ({ command: "fixture" }),
    createSession(_provider, options) {
      return {
        turnActive: false,
        startTurn: async (request) => {
          turns.push(request);
          options.emit({ type: "turn-started", turnId: "turn" });
          return { turnId: "turn" };
        },
        interrupt: async () => options.emit({ type: "turn-cancelled" }),
        close: async () => {},
      };
    },
  });
  t.after(async () => {
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const opened = await runtime.openProject(project);
  const sessionId = Object.values(opened.state.sessions)[0].id;
  const send = (extra) =>
    runtime.invoke("chat:send", [
      { projectPath: project, sessionId, body: "typed", prompt: "typed", images: [], files: [], provider: "codex", model: "test", permissionMode: "full", ...extra },
    ]);
  const messages = async () => (await runtime.invoke("project:snapshot", [project])).state.messages.filter((m) => m.role === "user");
  return { send, turns, messages };
}

test("a PR action is stored as a card and the agent gets the bundled skill", async (t) => {
  const f = await fixture(t);
  await f.send({ prAction: { action: "checks-failed", pr: 77, url } });
  await waitUntil(() => f.turns.length === 1);
  const [message] = await f.messages();
  assert.equal(message.body, "Fix CI on pull request #77");
  assert.deepEqual(message.context, { kind: "pr-action", action: "checks-failed", pr: 77, url });
  assert.ok(f.turns[0].prompt.startsWith(`Fix CI on pull request #77 (${url}). /milagre-fix-ci`));
  assert.match(f.turns[0].prompt, /Skill \/milagre-fix-ci/);
  assert.match(f.turns[0].prompt, /gh run view <run-id> --log-failed/);
  assert.doesNotMatch(f.turns[0].prompt, /^typed/);
});

test("an invalid PR action is refused and nothing is stored", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.send({ prAction: { action: "checks-failed", pr: 78, url } }), /pull request action isn't valid/);
  await assert.rejects(f.send({ prAction: { action: "deploy", pr: 77, url } }), /pull request action isn't valid/);
  assert.deepEqual(await f.messages(), []);
  assert.equal(f.turns.length, 0);
});

test("a renderer can't set a pr-action context directly", async (t) => {
  const f = await fixture(t);
  await f.send({ context: { kind: "pr-action", action: "behind", pr: 77, url } });
  await waitUntil(() => f.turns.length === 1);
  const [message] = await f.messages();
  assert.equal(message.context, null);
  assert.equal(message.body, "typed");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/core/src/runtime-pr-action.test.cjs`
Expected: FAIL; the first test stores body `"typed"` with `context: null`, and the second doesn't reject.

- [ ] **Step 3: Implement**

`runtime.cjs` near the other `@milagre/shared` requires (line 7-8):

```js
const { pullRequestActionBody, pullRequestActionContext, pullRequestActionPrompt } = require("@milagre/shared/pr-action");
```

Replace the `chat:send` handler (lines 885-890):

```js
  commands.handle("chat:send", (_event, request) => {
    if (isLinkScopeKey(request?.projectPath) || !scopeStates.has(request?.projectPath)) throw new Error("Open the project before sending to its chats.");
    // Only Milagre marks a message as coming from another Chat. A PR-blocker pill is the one context a renderer can ask
    // for, and Milagre checks it and writes its message and skill prompt itself.
    const { prAction, ...rest } = request;
    const action = prAction === undefined ? null : pullRequestActionContext(prAction);
    if (prAction !== undefined && !action) throw new Error("That pull request action isn't valid.");
    const message = action
      ? { ...rest, body: pullRequestActionBody(action), prompt: pullRequestActionPrompt(action), images: [], files: [], context: action }
      : { ...rest, context: undefined };
    return chats.send(message).then(({ sessionId }) => ({ sessionId }));
  });
```

- [ ] **Step 4: Run the tests**

Run: `node --test packages/core/src/runtime-pr-action.test.cjs packages/core/src/runtime.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/runtime.cjs packages/core/src/runtime-pr-action.test.cjs
git commit -m "feat: chat:send writes PR action messages from a checked prAction"
```

---

### Task 4: Desktop pill and card

**Files:**
- Create: `apps/desktop/app/src/components/agents/PullRequestActionCard.tsx`
- Modify: `apps/desktop/app/src/components/ChatComposer.tsx:149-190`, `apps/desktop/app/src/App.tsx:54`, `App.tsx:1180-1252` (executeSend), `App.tsx:2003-2013` (pullRequestAction), `scripts/test-chat-layout.cjs`

**Interfaces:**
- Consumes: `PullRequestActionContext`, `isPullRequestAction`, `pullRequestActionContext`, `pullRequestActionBody` (Task 1); `chat:send` `prAction` (Task 3).
- Produces: `<PullRequestActionCard action={PullRequestActionContext} />` rendering `[data-slot=pr-action][data-action=<blocker>]` with a link `a[href=<url>]`.

- [ ] **Step 1: Write the failing Electron check**

In `scripts/test-chat-layout.cjs` fixture:
- After `const [sending, setSending] = useState(false);` add `const [extra, setExtra] = useState([]);` and `window.setExtraMessages = setExtra;`.
- Change `<ChatComposer findOpen messages={messages}` to `<ChatComposer findOpen messages={[...messages, ...extra]}`.

In `browserChecks`, after the conflict-pill block (after the `capturePage` line), add:

```js
    await evaluate(`window.setExtraMessages([{ id: 999999, session_id: 1, role: "user", body: "Fix CI on pull request #77",
      context: { kind: "pr-action", action: "checks-failed", pr: 77, url: "https://github.com/the-ptf/milagre-ade/pull/77" } }])`);
    await waitFor('!!document.querySelector("[data-slot=pr-action][data-action=checks-failed]")');
    assert.ok(await evaluate('document.querySelector("[data-slot=pr-action]").textContent.includes("Fix CI")'));
    assert.equal(
      await evaluate('document.querySelector("[data-slot=pr-action] a").getAttribute("href")'),
      "https://github.com/the-ptf/milagre-ade/pull/77",
    );
    assert.equal(
      await evaluate('[...document.querySelectorAll("[data-slot=message] .bg-field")].some((el) => el.textContent.includes("pull request #77"))'),
      false,
      "A PR action renders as a card, not a bubble",
    );
    if (process.env.MILAGRE_SCREENSHOT_DIR) {
      await evaluate('document.querySelector("[data-slot=pr-action]").scrollIntoView({ block: "center" })');
      await delay(250);
      const shot = await window.webContents.capturePage();
      require("node:fs").mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
      require("node:fs").writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, "desktop-card.png"), shot.toPNG());
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --only chat-layout`
Expected: FAIL with `Timed out: !!document.querySelector("[data-slot=pr-action]...`.

- [ ] **Step 3: Implement the card and render it**

`apps/desktop/app/src/components/agents/PullRequestActionCard.tsx`:

```tsx
import { HugeiconsIcon } from "@hugeicons/react";
import { GitPullRequestIcon } from "@hugeicons/core-free-icons";
import type { PullRequestActionContext } from "../../model";
import { BLOCKERS } from "../../lib/pr-blockers";

/** A PR-blocker pill the user clicked, shown as what it asked for instead of the skill prompt the agent read. */
export function PullRequestActionCard({ action }: { action: PullRequestActionContext }) {
  const blocker = BLOCKERS[action.action];
  return (
    <div data-slot="pr-action" data-action={action.action} className="flex w-full max-w-md items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[13px]">
      <HugeiconsIcon icon={GitPullRequestIcon} size={16} className={`shrink-0 ${blocker.tone === "orange" ? "text-orange" : "text-red"}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium">{blocker.action}</span>
      <a href={action.url} target="_blank" rel="noreferrer" className="shrink-0 text-[12px] text-ink-3 hover:text-ink">
        Pull request #{action.pr}
      </a>
    </div>
  );
}
```

`ChatComposer.tsx`:
- Imports: `import { PullRequestActionCard } from "./agents/PullRequestActionCard";` and `import { isPullRequestAction } from "@milagre/shared/pr-action";`.
- After `const advisor = ...` (line 151) add:
  ```tsx
  // A PR-blocker pill's message shows as a card, not as the skill prompt the agent read.
  const prAction = isUser && isPullRequestAction(message.context) ? message.context : null;
  ```
- Change `const feedback = isUser && !linked && !advisor ? ...` to `const feedback = isUser && !linked && !advisor && !prAction ? ...`, and `const bubble = isUser && !linked && !advisor && !feedback && !answered;` to `... && !answered && !prAction;`.
- In the `<article>` className and the inner `<div>` className, treat `prAction` like `feedback`: `bubble || feedback || answered || prAction ? "items-end pl-12" : ""` and `feedback || answered || prAction ? "w-full max-w-md" : ...`.
- In the render chain, put `prAction ? (<PullRequestActionCard action={prAction} />) : feedback ? ...` first.

- [ ] **Step 4: Send a PR action from the pill**

`App.tsx`:
- Line 54: `import { BLOCKERS, isBlockerDismissed, pullRequestBlockers } from "./lib/pr-blockers";` and add `import { pullRequestActionBody, pullRequestActionContext } from "@milagre/shared/pr-action";` plus `PullRequestActionContext` to the existing type import from `./model`.
- `executeSend`: add a sixth parameter `prAction?: PullRequestActionContext`. Pass `context: prAction ?? null` to `createPendingChat({...})`, and add `...(prAction ? { prAction: { action: prAction.action, pr: prAction.pr, url: prAction.url } } : {}),` to the `agentRuns.send({...})` object, after `...options`.
- Before the JSX (next to where `pullRequestBlocker` is computed, ~line 521) add:
  ```tsx
  const pullRequestActionRequest =
    selectedPullRequest && pullRequestBlocker
      ? pullRequestActionContext({ action: pullRequestBlocker, pr: selectedPullRequest.number, url: selectedPullRequest.url })
      : null;
  ```
- Replace the `pullRequestAction={...}` prop (lines 2003-2013):
  ```tsx
  pullRequestAction={
    selectedSession && selectedPullRequest && pullRequestBlocker && pullRequestActionRequest
      ? {
          label: BLOCKERS[pullRequestBlocker].action,
          tone: BLOCKERS[pullRequestBlocker].tone,
          onRun: () => {
            dismissBlockerAction(selectedPullRequest, pullRequestBlocker);
            void executeSend(pullRequestActionBody(pullRequestActionRequest), permissionMode, [], [], true, pullRequestActionRequest);
          },
        }
      : undefined
  }
  ```

- [ ] **Step 5: Run checks**

Run: `npm test -- --only chat-layout && npm run typecheck --workspace milagre`
Expected: PASS. The typecheck may still fail only on `apps/mobile` references if the workspace includes them; it must not fail on desktop files.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/app/src scripts/test-chat-layout.cjs
git commit -m "feat(desktop): PR blocker pills send a PR action shown as a card"
```

---

### Task 5: Mobile pill and card

**Files:**
- Create: `apps/mobile/src/pr-action-card.tsx`
- Modify: `apps/mobile/src/chat-reply.tsx:213-235`, `apps/mobile/src/app/chat.tsx:26`, `chat.tsx:378-460` (send), `chat.tsx:832`

**Interfaces:**
- Consumes: Task 1 helpers and types; Task 3 `chat:send` `prAction`.
- Produces: `<PullRequestActionCard action={PullRequestActionContext} />` (mobile), with `accessibilityLabel` `"<label>, pull request #<n>"`.

- [ ] **Step 1: Write the card**

`apps/mobile/src/pr-action-card.tsx`:

```tsx
import { Linking, Pressable, Text, View } from "react-native";
import { GitPullRequestIcon } from "@hugeicons/core-free-icons";
import type { PullRequestActionContext } from "@milagre/shared/model";
import { BLOCKERS } from "@milagre/shared/pr-blockers";
import { Icon } from "./icons";
import { colors } from "./ui";

/** A PR-blocker pill the user tapped, shown as what it asked for instead of the skill prompt the agent read. Tapping opens the PR. */
export function PullRequestActionCard({ action }: { action: PullRequestActionContext }) {
  const blocker = BLOCKERS[action.action];
  const red = blocker.tone === "red";
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${blocker.action}, pull request #${action.pr}`}
      onPress={() => void Linking.openURL(action.url).catch(() => {})}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          minWidth: 240,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 18,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface,
        }}
      >
        <Icon icon={GitPullRequestIcon} tone={red ? "red" : "orange"} size={16} />
        <Text style={{ flex: 1, color: colors.ink, fontSize: 15, fontWeight: "500" }} numberOfLines={1}>
          {blocker.action}
        </Text>
        <Text style={{ color: colors.ink3, fontSize: 13 }}>#{action.pr}</Text>
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 2: Render it**

`chat-reply.tsx`:
- Imports: `import { PullRequestActionCard } from "./pr-action-card";` and `import { isPullRequestAction } from "@milagre/shared/pr-action";`.
- After `const feedback = ...` (line 213) add:
  ```tsx
  const prAction = message?.role === "user" && isPullRequestAction(message.context) ? message.context : null;
  ```
- In the user branch, make the chain start with `{prAction ? (<PullRequestActionCard action={prAction} />) : feedback ? ( ...`.

- [ ] **Step 3: Send a PR action from the pill**

`chat.tsx`:
- Line 26: `import { pullRequestBlockers } from "@milagre/shared/pr-blockers";` and add `import { pullRequestActionBody, pullRequestActionContext } from "@milagre/shared/pr-action";` and `import type { PullRequestActionContext } from "@milagre/shared/model";` (merge into the existing model type import if there is one).
- `send` signature: `async function send(body = draft, withAttachments = true, prAction?: PullRequestActionContext): Promise<boolean | "busy">`.
- `createPendingChat({...})`: add `context: prAction ?? null,`.
- In the `chat:send` request object only (not `link:send`; the pill is hidden on Link chats because `usePullRequest` gets no worktree there), add after `...options`: `...(prAction ? { prAction: { action: prAction.action, pr: prAction.pr, url: prAction.url } } : {}),`.
- Next to `const blockers = pullRequestBlockers(pr);` (line 610) add:
  ```tsx
  const prActionRequest = pr && blockers[0] ? pullRequestActionContext({ action: blockers[0], pr: pr.number, url: pr.url }) : null;
  ```
- Line 832: render only when the action is valid:
  ```tsx
  {prActionRequest && (
    <PullRequestAction pr={pr} disabled={busy || !!run} onRun={() => void send(pullRequestActionBody(prActionRequest), false, prActionRequest)} />
  )}
  ```
  Keep whatever condition already wraps line 832 (e.g. `pr &&`), combined with `prActionRequest`.

- [ ] **Step 4: Typecheck, lint and unit tests**

Run: `npm run typecheck && npm run typecheck:mobile && npm run lint && npm test -- --unit`
Expected: PASS. `knip` may flag nothing new; `blockerPrompt` no longer exists anywhere (`rg blockerPrompt` returns nothing).

- [ ] **Step 5: Verify on the phone simulator**

1. Read the `argent-device-interact` skill, `list-devices`, and pick the booted "Designs QA" simulator (its debug build pins Metro 8790). Check `simslim list` shows it slim; attach it with `simulator_attach`.
2. Start Metro for `apps/mobile` on 8790 and the dev host (`npm run mobile:host`), then open a Chat whose worktree has an open PR with a blocker. If none exists, send a `chat:send` with `prAction` for a real PR of this repo from a Node script against the dev host, then open that Chat.
3. Confirm the card shows the label, `#<n>`, the red or orange icon, and that tapping opens the PR URL. Save a screenshot to `$TMPDIR/pr-action-cards/mobile-card.png`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): PR blocker pill sends a PR action shown as a card"
```

---

### Task 6: PR

- [ ] **Step 1: Desktop screenshot**

Run: `MILAGRE_SCREENSHOT_DIR=$TMPDIR/pr-action-cards npm test -- --only chat-layout`
Expected: PASS and `$TMPDIR/pr-action-cards/desktop-card.png` exists.

- [ ] **Step 2: Push screenshots to the `screenshots` branch**

```bash
git fetch origin screenshots
git worktree add $TMPDIR/shots origin/screenshots --detach
mkdir -p $TMPDIR/shots/pr-action-cards && cp $TMPDIR/pr-action-cards/*.png $TMPDIR/shots/pr-action-cards/
git -C $TMPDIR/shots add pr-action-cards && git -C $TMPDIR/shots commit -m "screenshots: pr-action-cards"
git -C $TMPDIR/shots push origin HEAD:screenshots
git -C $TMPDIR/shots rev-parse HEAD   # SHA for the image links
git worktree remove $TMPDIR/shots
```

- [ ] **Step 3: Push and open the PR**

Push the branch and open the PR with `gh pr create`. Body: what changed (cards, skills, `prAction`), the test commands run, and both images linked as `https://raw.githubusercontent.com/the-ptf/milagre-ade/<sha>/pr-action-cards/<name>.png`. No Claude attribution. After merge, publish the mobile OTA per `apps/mobile/AGENTS.md` (fingerprint unchanged).
