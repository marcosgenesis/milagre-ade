# Question Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agent asks the user to choose between options, Milagre shows a card in the chat. The card has the question, the options as tappable rows (several where the agent allows it), and a field for the user's own answer. The answer goes back to the agent and the same turn continues.

**Architecture:**

- **Shared question code.** A new `electron/agents/questions.cjs` holds:
  - `PendingQuestions`, the bookkeeping both providers share, mirroring `PendingPermissions`;
  - pure functions that turn each agent's question into a `question-request` event, and the user's answers into the reply that agent expects;
  - the check the main process runs on answers from the renderer.
- **Claude.** `AskUserQuestion` is no longer disallowed. `canUseTool` sends it to a new `askQuestion`, which waits on the card the way `askPermission` waits on an approval.
- **Codex.** Threads start and resume with `config: { features: { default_mode_request_user_input: true } }`, which gives Codex its question tool outside Plan mode. The server request `item/tool/requestUserInput` is answered from the card.
- **Steering.** A message sent while a question is open dismisses the question, then steers the turn as before.
- **IPC.** `agent:answer-question { chatId, requestId, answers }`, where `answers` is `{ [questionId]: string[] }` or `null` to dismiss.
- **Renderer.**
  - Each chat's run keeps `questions` next to `approvals`.
  - A new `QuestionCard` takes the approval card's slot when no approval waits. Its answer rules live in a tested `app/src/lib/question-answers.ts`.
  - Escape denies an approval, otherwise dismisses a question, otherwise stops the turn.
- **Recommendation cards** (`recommendation-card.tsx`) are left as they are. They cover agents that ask in their reply, after the turn has ended; question cards answer a tool call during the turn. They share no code.

**Tech Stack:** Electron main process in CommonJS (`.cjs`), `@anthropic-ai/claude-agent-sdk@0.3.286` with Claude Code 2.1.287, `codex app-server` (codex-cli 0.158.0), React 19 + TypeScript renderer, `node --test`.

**Spec:** `docs/specs/002-agent-sessions.md`, delivery step 5 ("Question cards"). The spec was amended on this branch (commit `docs: bring agent questions into the agent sessions spec`). Read "Questions" first, then "Event stream", "IPC contract", "Claude provider", "Codex provider" and "Renderer".

## Probe findings this plan relies on

Probes ran against the real CLIs (Claude with `claude-haiku-4-5`, Codex with `gpt-6-sol`). Scripts and logs are in the session scratchpad under `probe/` (`claude-questions*.mjs`, `codex-questions*.mjs`, `questions/*.log`).

- **Claude.**
  - `AskUserQuestion` reached `canUseTool` in `default`, `acceptEdits` and `bypassPermissions`, with options `{ displayName: "AskUserQuestion", toolUseID, requestId, requiresUserInteraction: true }`. In `bypassPermissions` the SDK printed a warning that `canUseTool` would not be invoked, and invoked it anyway.
  - Answering `{ behavior: "allow", updatedInput: { ...input, answers: { "<question text>": "Green" } } }` gave the reply `CHOSEN=Green`. Multi-select `"Apple, Cherry"` and two questions in one call worked the same way.
  - A typed answer ("Purple with yellow dots") worked too. Claude Code told the model: "Read the answers carefully".
  - An answer under any other key, or `allow` with no answers, reached Claude as "The user did not answer the questions."
  - Deny with the dismissal message made Claude ask in its reply, not with the tool again (two runs).
  - Interrupt aborted `canUseTool`'s signal, and the turn ended with `error_during_execution`.
  - A message pushed while the question waited was held until the question was settled. After a dismissal, "Green. Also end your reply with the word BANANA." gave `CHOSEN=Green BANANA`.
  - `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS=3000` did not settle a question held for 15 s.
  - With Milagre's settings sources and the new instructions, "help me pick JSON, YAML or TOML" made Claude ask with `AskUserQuestion` on its own.
- **Codex.**
  - Without the feature, Codex replied `NO_TOOL`: no question tool outside Plan mode.
  - With `config: { features: { default_mode_request_user_input: true } }` on `thread/start`, Codex sent `item/tool/requestUserInput` with `isBlocking: false`. The same config on `thread/resume` of an older thread worked too.
  - An unknown feature name in `config` was ignored. `--enable no_such_feature` made `codex app-server` exit with "Unknown feature flag".
  - `{ answers: { color: { answers: ["Green"] } } }` gave `CHOSEN=Green`; a typed answer worked too. `{ answers: {} }` made Codex carry on ("I didn't receive a color choice"), and so did a JSON-RPC error.
  - `isBlocking: false` did not auto-resolve: the request waited 60 s with no answer.
  - On interrupt, Codex sent `turn/completed` (`interrupted`) and then `serverRequest/resolved` for the open request. It also sends `serverRequest/resolved` after every answer.
  - Answering `{ answers: {} }` and then sending `turn/steer` with "Green. Also end your reply with the word BANANA." gave `CHOSEN=Green BANANA`.

## Global Constraints

- **Main process.**
  - It stays CommonJS.
  - `@anthropic-ai/claude-agent-sdk` stays pinned to exactly `0.3.286`.
  - No new dependencies.
- **Event shapes**, exactly:
  - `{ type: "question-request", requestId, questions: [{ id, header, question, options: [{ label, description? }], multiSelect, allowOther, secret }] }`
  - `{ type: "question-resolved", requestId, outcome }`, where `outcome` is `"answered"`, `"dismissed"` or `"cancelled"`.
- **Question ids.** Claude's are positions: `"0"`, `"1"`, and so on. Codex's are its own `id`s.
- **Answers.**
  - `{ [questionId]: string[] }`: the labels picked in option order, then the typed answer. `null` dismisses the question.
  - The main process accepts only `null` or an object with at most 10 ids, each with an array of at most 20 strings of at most 10,000 characters. Anything else throws `Invalid answers to an agent question.`
  - Unknown ids and blank strings are dropped in the main process. Nothing left counts as a dismissal.
- **Claude replies.**
  - Answered: `{ behavior: "allow", updatedInput: { ...input, answers: { [question text]: values.join(", ") } } }`
  - Dismissed: `{ behavior: "deny", message: "The user closed the question without picking an answer. If they sent a message instead, follow it; otherwise carry on without the answer, or ask in your reply if you can't." }`
  - Cancelled: `{ behavior: "deny", message: "The turn was cancelled in Milagre.", interrupt: true }`
  - Unshowable input: `{ behavior: "deny", message: "Milagre couldn't show this question. Ask it in your reply instead." }`
- **Codex replies.**
  - Answered: `{ answers: { [id]: { answers: values } } }`.
  - Anything else: `{ answers: {} }`.
  - Codex threads get `config: { features: { default_mode_request_user_input: true } }` on both `thread/start` and `thread/resume`. Never pass `--enable` to `codex app-server`.
- **Steering** dismisses open questions before the message joins the turn. It never touches approvals.
- **No time limit.** Question waits have no timeout.
- **Card.**
  - The approval card wins the slot; a question shows only when no approval waits.
  - Copy, exactly:
    - Header line: `The agent has a question`, or `The agent has N questions`.
    - Queue line: `1 more question is waiting after this one.`, or `N more questions are waiting after this one.`
    - Status chip: `Needs your answer`, `Sending` or `Dismissed`.
    - Multi-select hint: `Pick any that apply.`
    - Field placeholder: `Or type your own answer`, or `Type your answer` when there are no options.
    - Buttons: `Dismiss`, and `Send answer` or `Send answers` for several questions.
  - A card with exactly one single-choice question sends on the first tap.
- **Escape.** It denies an unanswered approval first, otherwise dismisses an unanswered question, otherwise interrupts. In the card's text field, Escape clears a typed answer before anything else.
- **Instructions.** `MILAGRE_INSTRUCTIONS` becomes exactly: `You are an agent inside Milagre, an agent development environment. Answer the user concisely and humanly. Do not claim to have changed files unless you actually did. When you need the user to choose between options, ask with your question tool if you have one (AskUserQuestion or request_user_input); otherwise ask in your reply as a short numbered list.`
- **Untouched.**
  - `recommendation-card.tsx` and `ChatComposer.tsx`. The `approval` slot prop keeps its name and carries either card, to stay clear of the other streams' edits.
  - `coordination.json`: answers are not saved.
- **Tests.**
  - Agent tests live next to the code (`electron/agents/*.test.cjs`). Renderer logic tests are `app/src/lib/*.test.ts`.
  - `npm run test:agent` runs them all: 202 tests when this plan is done.
  - `npm run build` must stay clean (it includes `tsc --noEmit`).
- **Commits.** Every commit message ends with the paragraph `Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5`.

## Review Focus

1. **A message sent while a question is open.** Claude Code holds a steering message until the question settles, so the message could sit unseen behind the card.
   - Expected: the question is dismissed first, the agent gets the message in the same turn, and the card goes away.
   - Pinned in Task 2 ("a steering message dismisses Claude's open question and reaches Claude") and Task 3 ("a steering message dismisses Codex's open question, then steers the turn": the empty answer goes out before `turn/steer`).
2. **Answers under the wrong key.** Claude reads answers only under the exact question text. Anything else reaches it as "The user did not answer the questions."
   - Expected: positions map back to question text; several picks are joined with `", "`; unanswered questions are left out.
   - Pinned in Task 1 ("Claude: answers are keyed by question text…") and Task 2 ("Claude's question becomes a card, and the answers go back keyed by question text").
3. **A question left open when its turn stops.** Causes: interrupt, reload, turn end, session close, withdrawal, or a question that arrives after Stop.
   - Expected: the card goes away, the agent gets a cancelled or empty answer exactly once, and nothing waits forever.
   - Pinned in:
     - Task 1: `cancelAll`, `forget`, and settling once.
     - Task 2: "interrupting cancels Claude's open question" and "a question asked after the turn was stopped is cancelled at once".
     - Task 3: "interrupting cancels Codex's open question", "a question Codex withdraws…" and "a question asked after the turn was stopped gets no answers at once".
     - Task 5: a resolved question leaves the run, and the run ends with its turn.
4. **Codex never asks in a resumed chat.** The feature lives in the thread's config, so a resume without it silently loses the tool.
   - Expected: `thread/start` and `thread/resume` both carry the config.
   - Pinned in Task 3 (the two config assertions) and Task 7 Step 6 (a real resume after a restart).
5. **Malformed answers from the renderer.** The renderer is untrusted input.
   - Expected: anything but `null` or short string arrays is refused in the main process before a session sees it, and a stale request id returns `false`.
   - Pinned in Task 1 (`validAnswers`) and Task 4 ("routes question answers to the chat's session and refuses malformed ones").

---

### Task 1: Question bookkeeping and mapping

**Files:**
- Create: `electron/agents/questions.cjs`
- Test: `electron/agents/questions.test.cjs`

**Interfaces:**
- Consumes: `CANCELLED_MESSAGE` from `electron/agents/permissions.cjs`.
- Produces, in `electron/agents/questions.cjs`:
  - `class PendingQuestions`:
    - `constructor(emit)`
    - `add(request, settle)` emits `{ type: "question-request", ...request }`. `settle(outcome, answers)` is called exactly once.
    - `answer(requestId, answers): boolean`. `answers` is `{ [id]: string[] }` or `null`. It settles `"answered"` with the kept answers, or `"dismissed"` when nothing is kept, and emits `question-resolved`.
    - `cancel(requestId): boolean` settles `"cancelled"`.
    - `settle(requestId, outcome, answers = {}): boolean`
    - `forget(requestId): boolean` emits a `cancelled` resolution without settling.
    - `dismissAll()` and `cancelAll()`
    - `size` getter.
  - `claudeQuestionRequest(input, options) → QuestionRequest | null`
  - `claudeQuestionResult(outcome, input, answers) → SDK PermissionResult`, where `outcome` is `"answered" | "dismissed" | "cancelled" | "unshown"`.
  - `codexQuestionRequest(id, params) → QuestionRequest | null`
  - `codexQuestionResponse(outcome, answers) → { answers }`
  - `validAnswers(answers) → boolean`
  - Constants: `DISMISSED_MESSAGE`, `UNSHOWN_MESSAGE`.
- A `QuestionRequest` is `{ requestId, questions: [{ id, header, question, options: [{ label, description? }], multiSelect, allowOther, secret }] }`. An option has no `description` key when the agent gave none.

- [ ] **Step 1: Write the failing tests**

Create `electron/agents/questions.test.cjs`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");
const { CANCELLED_MESSAGE } = require("./permissions.cjs");
const {
  DISMISSED_MESSAGE,
  UNSHOWN_MESSAGE,
  PendingQuestions,
  claudeQuestionRequest,
  claudeQuestionResult,
  codexQuestionRequest,
  codexQuestionResponse,
  validAnswers,
} = require("./questions.cjs");

const colors = { id: "0", header: "Color", question: "Which color?", options: [{ label: "Red" }, { label: "Green" }], multiSelect: false, allowOther: true, secret: false };
const sizes = { id: "1", header: "Size", question: "Which size?", options: [{ label: "S" }, { label: "L" }], multiSelect: true, allowOther: true, secret: false };

function pending() {
  const events = [];
  const settled = [];
  const questions = new PendingQuestions((event) => events.push(event));
  const ask = (requestId, asked = [colors, sizes]) => questions.add({ requestId, questions: asked }, (outcome, answers) => settled.push({ requestId, outcome, answers }));
  return { questions, events, settled, ask };
}

test("each question is announced, then settled exactly once with the answers it asked for", () => {
  const { questions, events, settled, ask } = pending();
  ask("a");
  assert.equal(questions.size, 1);
  assert.equal(questions.answer("a", { "0": [" Green "], "1": ["S", "", "  "], other: ["x"] }), true);
  assert.equal(questions.answer("a", { "0": ["Red"] }), false);
  assert.equal(questions.answer("missing", null), false);
  assert.deepEqual(settled, [{ requestId: "a", outcome: "answered", answers: { "0": ["Green"], "1": ["S"] } }]);
  assert.deepEqual(events, [
    { type: "question-request", requestId: "a", questions: [colors, sizes] },
    { type: "question-resolved", requestId: "a", outcome: "answered" },
  ]);
  assert.equal(questions.size, 0);
});

test("no answers, or only blank ones, dismiss the question", () => {
  const { questions, settled, ask } = pending();
  ask("a");
  ask("b");
  questions.answer("a", null);
  questions.answer("b", { "0": ["  "], other: ["Green"] });
  assert.deepEqual(settled.map(({ outcome, answers }) => ({ outcome, answers })), [{ outcome: "dismissed", answers: {} }, { outcome: "dismissed", answers: {} }]);
});

test("dismissAll and cancelAll settle every open question", () => {
  const { questions, events, settled, ask } = pending();
  ask("a");
  ask("b");
  questions.dismissAll();
  ask("c");
  questions.cancel("c");
  assert.equal(questions.cancel("c"), false);
  ask("d");
  questions.cancelAll();
  assert.deepEqual(settled.map(({ requestId, outcome }) => `${requestId}:${outcome}`), ["a:dismissed", "b:dismissed", "c:cancelled", "d:cancelled"]);
  assert.deepEqual(events.filter((event) => event.type === "question-resolved").map((event) => event.outcome), ["dismissed", "dismissed", "cancelled", "cancelled"]);
  assert.equal(questions.size, 0);
});

test("forget drops a withdrawn question without settling it", () => {
  const { questions, events, settled, ask } = pending();
  ask("a");
  assert.equal(questions.forget("a"), true);
  assert.equal(questions.forget("a"), false);
  assert.deepEqual(settled, []);
  assert.deepEqual(events.at(-1), { type: "question-resolved", requestId: "a", outcome: "cancelled" });
});

const claudeInput = {
  questions: [
    { question: "Which color?", header: "Color", options: [{ label: "Red", description: "Warm" }, { label: "Green", description: "" }], multiSelect: false },
    { question: "Which sizes?", header: "Size", options: [{ label: "S", description: "Small" }, { label: "L", description: "Large" }], multiSelect: true },
  ],
};

test("Claude: AskUserQuestion becomes a request with one id per position", () => {
  assert.deepEqual(claudeQuestionRequest(claudeInput, { requestId: "r1", toolUseID: "t1" }), {
    requestId: "r1",
    questions: [
      { id: "0", header: "Color", question: "Which color?", options: [{ label: "Red", description: "Warm" }, { label: "Green" }], multiSelect: false, allowOther: true, secret: false },
      { id: "1", header: "Size", question: "Which sizes?", options: [{ label: "S", description: "Small" }, { label: "L", description: "Large" }], multiSelect: true, allowOther: true, secret: false },
    ],
  });
  assert.equal(claudeQuestionRequest(claudeInput, { toolUseID: "t1" }).requestId, "t1");
  assert.equal(claudeQuestionRequest({ questions: [] }, { requestId: "r" }), null);
  assert.equal(claudeQuestionRequest({}, { requestId: "r" }), null);
  assert.equal(claudeQuestionRequest({ questions: [{ header: "x", options: [] }] }, { requestId: "r" }), null);
});

test("Claude: answers are keyed by question text, several picks joined as Claude's own dialog does", () => {
  assert.deepEqual(claudeQuestionResult("answered", claudeInput, { "0": ["Purple"], "1": ["S", "L"] }), {
    behavior: "allow",
    updatedInput: { ...claudeInput, answers: { "Which color?": "Purple", "Which sizes?": "S, L" } },
  });
  assert.deepEqual(claudeQuestionResult("answered", claudeInput, { "1": ["L"] }).updatedInput.answers, { "Which sizes?": "L" });
  assert.deepEqual(claudeQuestionResult("dismissed", claudeInput), { behavior: "deny", message: DISMISSED_MESSAGE });
  assert.deepEqual(claudeQuestionResult("cancelled", claudeInput), { behavior: "deny", message: CANCELLED_MESSAGE, interrupt: true });
  assert.deepEqual(claudeQuestionResult("unshown", claudeInput), { behavior: "deny", message: UNSHOWN_MESSAGE });
});

test("Codex: requestUserInput becomes a request keyed by Codex's own ids", () => {
  const params = {
    threadId: "th", turnId: "tu", itemId: "call-1", isBlocking: false, autoResolutionMs: null,
    questions: [
      { id: "color", header: "Color", question: "Which color?", isOther: false, isSecret: false, options: [{ label: "Red", description: "Warm" }, { label: "Green", description: "" }] },
      { id: "token", header: "Token", question: "Paste your token", isOther: false, isSecret: true, options: null },
      { id: "", header: "Broken", question: "No id", isOther: true, isSecret: false, options: null },
    ],
  };
  assert.deepEqual(codexQuestionRequest(7, params), {
    requestId: "7",
    questions: [
      { id: "color", header: "Color", question: "Which color?", options: [{ label: "Red", description: "Warm" }, { label: "Green" }], multiSelect: false, allowOther: false, secret: false },
      { id: "token", header: "Token", question: "Paste your token", options: [], multiSelect: false, allowOther: true, secret: true },
    ],
  });
  assert.equal(codexQuestionRequest(8, { questions: [] }), null);
  assert.equal(codexQuestionRequest(9, {}), null);
});

test("Codex: answers go back per question id, and anything else is no answer", () => {
  assert.deepEqual(codexQuestionResponse("answered", { color: ["Green"], token: ["abc"] }), { answers: { color: { answers: ["Green"] }, token: { answers: ["abc"] } } });
  assert.deepEqual(codexQuestionResponse("dismissed"), { answers: {} });
  assert.deepEqual(codexQuestionResponse("cancelled"), { answers: {} });
});

test("only null or a few short strings per question id count as answers", () => {
  assert.equal(validAnswers(null), true);
  assert.equal(validAnswers({}), true);
  assert.equal(validAnswers({ "0": ["Green", "my own answer"] }), true);
  for (const bad of [undefined, "Green", ["Green"], { "0": "Green" }, { "0": [1] }, { "0": ["x".repeat(10_001)] }, { "0": Array(21).fill("x") }, Object.fromEntries(Array.from({ length: 11 }, (_, index) => [String(index), ["x"]]))]) {
    assert.equal(validAnswers(bad), false, JSON.stringify(bad)?.slice(0, 40));
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/questions.test.cjs`
Expected: FAIL with `Cannot find module './questions.cjs'`.

- [ ] **Step 3: Implement `questions.cjs`**

Create `electron/agents/questions.cjs`:

```js
const { CANCELLED_MESSAGE } = require("./permissions.cjs");

// Questions an agent asks the user mid-turn, in the shape of the `question-request` event, and the
// replies each agent expects. A request is
//   { requestId, questions: [{ id, header, question, options: [{ label, description? }],
//     multiSelect, allowOther, secret }] }
// The user's answers map each question id to the labels picked and any typed answer,
//   { [questionId]: string[] }
// or are null to dismiss the question. A question ends "answered", "dismissed", or "cancelled"
// when its turn stops first.

const DISMISSED_MESSAGE = "The user closed the question without picking an answer. If they sent a message instead, follow it; otherwise carry on without the answer, or ask in your reply if you can't.";
const UNSHOWN_MESSAGE = "Milagre couldn't show this question. Ask it in your reply instead.";
const MAX_QUESTIONS = 10;
const MAX_VALUES = 20;
const MAX_ANSWER = 10_000;

const text = (value) => (typeof value === "string" ? value.trim() : "");
const list = (value) => (Array.isArray(value) ? value : []);

function option(raw) {
  const label = text(raw?.label);
  if (!label) return [];
  const description = text(raw?.description);
  return [description ? { label, description } : { label }];
}

// AskUserQuestion input -> request. Claude reads answers keyed by question text, so the ids are
// positions. Claude always offers an answer of the user's own.
function claudeQuestionRequest(input, options = {}) {
  const questions = list(input?.questions).map((raw, index) => ({
    id: String(index),
    header: text(raw?.header),
    question: text(raw?.question),
    options: list(raw?.options).flatMap(option),
    multiSelect: raw?.multiSelect === true,
    allowOther: true,
    secret: false,
  }));
  if (!questions.length || questions.some((question) => !question.question)) return null;
  return { requestId: String(options.requestId ?? options.toolUseID), questions };
}

// The question's outcome -> the SDK's PermissionResult. Answers go back as Claude's own question
// dialog sends them: keyed by question text, several picks joined with ", ".
function claudeQuestionResult(outcome, input, answers = {}) {
  if (outcome === "answered") {
    const given = list(input.questions).flatMap((question, index) => (answers[String(index)]?.length ? [[question.question, answers[String(index)].join(", ")]] : []));
    return { behavior: "allow", updatedInput: { ...input, answers: Object.fromEntries(given) } };
  }
  if (outcome === "cancelled") return { behavior: "deny", message: CANCELLED_MESSAGE, interrupt: true };
  if (outcome === "unshown") return { behavior: "deny", message: UNSHOWN_MESSAGE };
  return { behavior: "deny", message: DISMISSED_MESSAGE };
}

// item/tool/requestUserInput params -> request. Codex keys answers by its own question ids, has no
// multi-select, and says per question whether a typed answer is allowed.
function codexQuestionRequest(id, params = {}) {
  const questions = list(params.questions).flatMap((raw) => {
    const questionId = text(raw?.id);
    const question = text(raw?.question);
    if (!questionId || !question) return [];
    const options = list(raw.options).flatMap(option);
    return [{ id: questionId, header: text(raw.header), question, options, multiSelect: false, allowOther: raw.isOther === true || !options.length, secret: raw.isSecret === true }];
  });
  return questions.length ? { requestId: String(id), questions } : null;
}

// The question's outcome -> Codex's ToolRequestUserInputResponse. No answers tells Codex to carry on
// without them.
function codexQuestionResponse(outcome, answers = {}) {
  if (outcome !== "answered") return { answers: {} };
  return { answers: Object.fromEntries(Object.entries(answers).map(([questionId, values]) => [questionId, { answers: values }])) };
}

// The renderer is untrusted input: answers are null, or a few question ids each mapped to a few short strings.
function validAnswers(answers) {
  if (answers === null) return true;
  if (typeof answers !== "object" || Array.isArray(answers)) return false;
  const entries = Object.values(answers);
  return entries.length <= MAX_QUESTIONS && entries.every((values) => Array.isArray(values) && values.length <= MAX_VALUES && values.every((value) => typeof value === "string" && value.length <= MAX_ANSWER));
}

// The questions a session is waiting on. Each is settled exactly once: answered or dismissed by the
// user, dismissed when a steering message arrives, or cancelled when its turn stops. `forget` drops
// one the agent withdrew without replying to it.
class PendingQuestions {
  constructor(emit) {
    this.emit = emit;
    // requestId -> { settle, ids }
    this.open = new Map();
  }

  get size() {
    return this.open.size;
  }

  add(request, settle) {
    this.open.set(request.requestId, { settle, ids: new Set(request.questions.map((question) => question.id)) });
    this.emit({ type: "question-request", ...request });
  }

  // Answers to questions the request didn't ask, and blank answers, are dropped; nothing left is a dismissal.
  answer(requestId, answers) {
    const open = this.open.get(requestId);
    if (!open) return false;
    const given = Object.entries(answers ?? {}).flatMap(([id, values]) => {
      const kept = values.map((value) => value.trim()).filter(Boolean);
      return open.ids.has(id) && kept.length ? [[id, kept]] : [];
    });
    return given.length ? this.settle(requestId, "answered", Object.fromEntries(given)) : this.settle(requestId, "dismissed");
  }

  cancel(requestId) {
    return this.settle(requestId, "cancelled");
  }

  settle(requestId, outcome, answers = {}) {
    const open = this.open.get(requestId);
    if (!open) return false;
    this.open.delete(requestId);
    open.settle(outcome, answers);
    this.emit({ type: "question-resolved", requestId, outcome });
    return true;
  }

  forget(requestId) {
    if (!this.open.delete(requestId)) return false;
    this.emit({ type: "question-resolved", requestId, outcome: "cancelled" });
    return true;
  }

  dismissAll() {
    for (const requestId of [...this.open.keys()]) this.settle(requestId, "dismissed");
  }

  cancelAll() {
    for (const requestId of [...this.open.keys()]) this.settle(requestId, "cancelled");
  }
}

module.exports = {
  DISMISSED_MESSAGE,
  UNSHOWN_MESSAGE,
  PendingQuestions,
  claudeQuestionRequest,
  claudeQuestionResult,
  codexQuestionRequest,
  codexQuestionResponse,
  validAnswers,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/agents/questions.test.cjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/questions.cjs electron/agents/questions.test.cjs
git commit -m "feat: map agent questions and answers" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 2: Claude questions

**Files:**
- Modify: `electron/agents/claude-provider.cjs`
- Test: `electron/agents/claude-provider.test.cjs`

**Interfaces:**
- Consumes: `PendingQuestions`, `claudeQuestionRequest`, `claudeQuestionResult`, `DISMISSED_MESSAGE` and `UNSHOWN_MESSAGE` from Task 1.
- Produces:
  - `ClaudeSession#askQuestion(input, options): Promise<PermissionResult>`, called by `canUseTool` for `AskUserQuestion`.
  - `ClaudeSession#answerQuestion(requestId, answers): boolean`
  - `ClaudeSession#questions`, a `PendingQuestions`.
  - The query options no longer have `disallowedTools`.
  - A steering message dismisses open questions before it is pushed.

- [ ] **Step 1: Write the failing tests**

In `electron/agents/claude-provider.test.cjs`:

1. Add after the `./events.cjs` require:

```js
const { DISMISSED_MESSAGE, UNSHOWN_MESSAGE } = require("./questions.cjs");
```

2. Add after the `success` constant:

```js
const COLOR_QUESTION = { questions: [{ question: "Which color?", header: "Color", options: [{ label: "Red", description: "Warm" }, { label: "Green", description: "Calm" }], multiSelect: false }] };
```

3. Inside the `scripts` object, add these two scripts before `async *sdkAbortsAlready`:

```js
  async *questions({ options, signal }) {
    yield init;
    const result = await options.canUseTool("AskUserQuestion", COLOR_QUESTION, { signal, requestId: "q-1", toolUseID: "tool-q", displayName: "AskUserQuestion", requiresUserInteraction: true });
    yield delta(JSON.stringify(result));
    yield success;
  },
  async *questionThenSteer({ options, signal, next }) {
    yield init;
    const result = await options.canUseTool("AskUserQuestion", COLOR_QUESTION, { signal, requestId: "q-1", toolUseID: "tool-q" });
    const steer = await next();
    yield delta(`${JSON.stringify(result)}|${steer.message.content[0].text}`);
    yield success;
  },
```

4. In "starts with Milagre's options and streams a reply", replace `assert.deepEqual(calls.options.disallowedTools, ["AskUserQuestion"]);` with:

```js
  assert.equal("disallowedTools" in calls.options, false);
```

5. Append:

```js
const questioned = (events) => waitUntil(() => events.some((event) => event.type === "question-request"));

test("Claude's question becomes a card, and the answers go back keyed by question text", async (t) => {
  const { session, events, calls } = claude(t, { script: scripts.questions });
  await session.startTurn({ ...TURN, permissionMode: "full" });
  await questioned(events);
  assert.equal(calls.options.permissionMode, "bypassPermissions");
  assert.deepEqual(events.find((event) => event.type === "question-request"), {
    type: "question-request",
    requestId: "q-1",
    questions: [{ id: "0", header: "Color", question: "Which color?", options: [{ label: "Red", description: "Warm" }, { label: "Green", description: "Calm" }], multiSelect: false, allowOther: true, secret: false }],
  });
  assert.equal(session.answerQuestion("q-1", { "0": ["Green"] }), true);
  assert.equal(session.answerQuestion("q-1", { "0": ["Red"] }), false);
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "allow", updatedInput: { ...COLOR_QUESTION, answers: { "Which color?": "Green" } } });
  assert.deepEqual(events.find((event) => event.type === "question-resolved"), { type: "question-resolved", requestId: "q-1", outcome: "answered" });
  assert.deepEqual(events.at(-1), { type: "turn-completed" });
});

test("dismissing Claude's question tells Claude the user closed it", async (t) => {
  const { session, events } = claude(t, { script: scripts.questions });
  await session.startTurn(TURN);
  await questioned(events);
  assert.equal(session.answerQuestion("q-1", null), true);
  await ended(events);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: DISMISSED_MESSAGE });
  assert.equal(events.find((event) => event.type === "question-resolved").outcome, "dismissed");
});

test("interrupting cancels Claude's open question", async (t) => {
  const { session, events } = claude(t, { script: scripts.questions });
  await session.startTurn(TURN);
  await questioned(events);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "question-resolved"), { type: "question-resolved", requestId: "q-1", outcome: "cancelled" });
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal(session.answerQuestion("q-1", { "0": ["Green"] }), false);
});

test("a steering message dismisses Claude's open question and reaches Claude", async (t) => {
  const { session, events } = claude(t, { script: scripts.questionThenSteer });
  const first = await session.startTurn(TURN);
  await questioned(events);
  assert.deepEqual(await session.startTurn({ ...TURN, prompt: "Green, please" }), { turnId: first.turnId, steered: true });
  await ended(events);
  const [result, steer] = replyText(events).split("|");
  assert.deepEqual(JSON.parse(result), { behavior: "deny", message: DISMISSED_MESSAGE });
  assert.equal(steer, "Green, please");
  assert.equal(events.find((event) => event.type === "question-resolved").outcome, "dismissed");
});

test("a question Milagre can't show is turned down without a card", async (t) => {
  const script = async function* ({ options }) {
    yield init;
    yield delta(JSON.stringify(await options.canUseTool("AskUserQuestion", { questions: [] }, { requestId: "q-bad", toolUseID: "tool-bad" })));
    yield success;
  };
  const { session, events } = claude(t, { script });
  await session.startTurn(TURN);
  await ended(events);
  assert.equal(events.some((event) => event.type === "question-request"), false);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: UNSHOWN_MESSAGE });
});

test("a question asked after the turn was stopped is cancelled at once", async (t) => {
  const script = async function* ({ interrupted, options }) {
    yield init;
    await interrupted;
    yield delta(JSON.stringify(await options.canUseTool("AskUserQuestion", COLOR_QUESTION, { requestId: "q-late", toolUseID: "tool-late" })));
    yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["Request was aborted."] };
  };
  const { session, events } = claude(t, { script });
  await session.startTurn(TURN);
  await waitUntil(() => events.length > 0);
  await session.interrupt();
  await ended(events);
  assert.equal(events.some((event) => event.type === "question-request" || event.type === "question-resolved"), false);
  assert.deepEqual(JSON.parse(replyText(events)), { behavior: "deny", message: "The turn was cancelled in Milagre.", interrupt: true });
  assert.equal(session.answerQuestion("q-late", null), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/claude-provider.test.cjs`
Expected: FAIL, 7 of 34 tests: the `disallowedTools` assertion, `session.answerQuestion is not a function`, and timeouts waiting for `question-request`.

- [ ] **Step 3: Route `AskUserQuestion` to a question**

In `electron/agents/claude-provider.cjs`:

1. Add after the `./permissions.cjs` require:

```js
const { PendingQuestions, claudeQuestionRequest, claudeQuestionResult } = require("./questions.cjs");
```

2. In the constructor, after `this.permissions = new PendingPermissions((event) => this.emit(event));`, add:

```js
    this.questions = new PendingQuestions((event) => this.emit(event));
```

3. In `steer`, replace:

```js
    if (!this.turnActive || !this.inbox || this.closed) return this.startTurn(request);
    this.inbox.push(userMessage(request.prompt, request.images));
```

with:

```js
    if (!this.turnActive || !this.inbox || this.closed) return this.startTurn(request);
    // Claude Code holds a message until the question it waits on is settled. The message is the user's
    // reply, so the question is dismissed and the message reaches Claude right away.
    this.questions.dismissAll();
    this.inbox.push(userMessage(request.prompt, request.images));
```

4. In `start`, replace these three lines:

```js
        canUseTool: (toolName, input, options) => this.askPermission(toolName, input, options),
        // Questions to the user are out of scope for now; Claude asks in its reply instead.
        disallowedTools: ["AskUserQuestion"],
```

with:

```js
        canUseTool: (toolName, input, options) => (toolName === "AskUserQuestion" ? this.askQuestion(input, options) : this.askPermission(toolName, input, options)),
```

5. Add after `respondToPermission`:

```js
  // AskUserQuestion reaches canUseTool in every mode, Full included. Claude Code waits on this promise
  // until the user answers or dismisses the card, a steering message dismisses it, the turn stops, or
  // the SDK aborts the request.
  askQuestion(input, options = {}) {
    if (!this.turnActive || this.cancelRequested || this.closed) return Promise.resolve(claudeQuestionResult("cancelled", input));
    const request = claudeQuestionRequest(input, options);
    if (!request) return Promise.resolve(claudeQuestionResult("unshown", input));
    return new Promise((resolve) => {
      const abort = () => this.questions.cancel(request.requestId);
      this.questions.add(request, (outcome, answers) => {
        options.signal?.removeEventListener("abort", abort);
        resolve(claudeQuestionResult(outcome, input, answers));
      });
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  }

  answerQuestion(requestId, answers) {
    return this.questions.answer(requestId, answers);
  }
```

6. The file has three `this.permissions.cancelAll();` lines, in `finishTurn`, `interrupt` and `close`. Add this line right after each of them:

```js
    this.questions.cancelAll();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test electron/agents/claude-provider.test.cjs`
Expected: PASS, 34 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/claude-provider.cjs electron/agents/claude-provider.test.cjs
git commit -m "feat: show Claude's AskUserQuestion as a question and pass the answers back" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 3: Codex questions

**Files:**
- Modify: `electron/agents/codex-provider.cjs`
- Modify: `electron/agents/fixtures/fake-app-server.cjs`
- Test: `electron/agents/codex-provider.test.cjs`

**Interfaces:**
- Consumes: `PendingQuestions`, `codexQuestionRequest` and `codexQuestionResponse` from Task 1.
- Produces:
  - `CodexSession#askQuestion(id, params)`, called for the server request `item/tool/requestUserInput`.
  - `CodexSession#answerQuestion(requestId, answers): boolean`
  - `CodexSession#questions`, a `PendingQuestions`.
  - `thread/start` and `thread/resume` params gain `config: { features: { default_mode_request_user_input: true } }`.
  - `serverRequest/resolved` also withdraws an open question. A steering message dismisses open questions before `turn/steer`.
  - New fake app-server scenarios: `question`, `question-steer`, `question-withdrawn`, `late-question`.

- [ ] **Step 1: Teach the fake app-server to ask questions**

In `electron/agents/fixtures/fake-app-server.cjs`:

1. In the header comment, replace the line:

```js
// late-approval (like slow-stop, and Codex asks for a command approval while the turn is stopping).
```

with:

```js
// late-approval (like slow-stop, and Codex asks for a command approval while the turn is stopping),
// question (Codex asks a question and ends the turn on the answer), question-steer (Codex asks a question
// and the turn waits for turn/steer), question-withdrawn (a question Codex takes back), late-question
// (like late-approval, with a question).
```

2. Add after the `completeTurn` constant:

```js
const QUESTIONS = [{ id: "color", header: "Color", question: "Which color?", isOther: true, isSecret: false, options: [{ label: "Red", description: "Warm" }, { label: "Green", description: "Calm" }] }];
const askQuestion = (id, threadId, turnId) => send({ id, method: "item/tool/requestUserInput", params: { threadId, turnId, itemId: "call-1", questions: QUESTIONS, isBlocking: false, autoResolutionMs: null } });
```

3. In `turn/start`, replace:

```js
      if ((scenario === "slow-stop" || scenario === "late-approval") && turnId === "turn-1") {
```

with:

```js
      if ((scenario === "slow-stop" || scenario === "late-approval" || scenario === "late-question") && turnId === "turn-1") {
```

4. In `turn/start`, add before `if (scenario === "permissions") {`:

```js
      if (scenario === "question") {
        pendingTurn = { threadId, turnId, approvalId: "srv-q" };
        return askQuestion("srv-q", threadId, turnId);
      }
      if (scenario === "question-steer") {
        pendingTurn = { threadId, turnId };
        return askQuestion("srv-q", threadId, turnId);
      }
      if (scenario === "question-withdrawn") {
        askQuestion("srv-q", threadId, turnId);
        notify("serverRequest/resolved", { threadId, requestId: "srv-q" });
        return completeTurn(threadId, turnId, "completed");
      }
```

5. In `turn/interrupt`, replace:

```js
      if (scenario === "slow-stop" || scenario === "late-approval") {
```

with:

```js
      if (scenario === "slow-stop" || scenario === "late-approval" || scenario === "late-question") {
```

6. In the same block, add after the `if (scenario === "late-approval") send(…);` line:

```js
          if (scenario === "late-question") askQuestion("srv-late", stopping.threadId, stopping.turnId);
```

The existing reply handler already answers `approvalId` requests: a reply without `decision` becomes the text `answer:<JSON of the result>` and ends the turn.

- [ ] **Step 2: Write the failing tests**

In `electron/agents/codex-provider.test.cjs`:

1. In "starts threads and turns with Milagre's identity, instructions and policy", add after the `developerInstructions` assertion:

```js
  assert.deepEqual(find("thread/start").config, { features: { default_mode_request_user_input: true } });
```

2. In "resumes a saved thread without announcing it again", replace:

```js
  assert.equal((await received(session)).find((message) => message.method === "thread/resume").params.threadId, "thread-9");
```

with:

```js
  const resume = (await received(session)).find((message) => message.method === "thread/resume").params;
  assert.equal(resume.threadId, "thread-9");
  assert.deepEqual(resume.config, { features: { default_mode_request_user_input: true } });
```

3. Append:

```js
const questioned = (events) => waitUntil(() => events.some((event) => event.type === "question-request"));
// Polls until the fake app-server has received the client's reply to one of its own requests.
async function replyTo(session, id) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const reply = (await received(session)).find((message) => message.id === id && !message.method);
    if (reply) return reply;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for the reply to ${id}`);
}

test("Codex's question becomes a card, and the answers go back per question id", async (t) => {
  const { session, events } = codex(t, { scenario: "question" });
  await session.startTurn(TURN);
  await questioned(events);
  assert.deepEqual(events.find((event) => event.type === "question-request"), {
    type: "question-request",
    requestId: "srv-q",
    questions: [{ id: "color", header: "Color", question: "Which color?", options: [{ label: "Red", description: "Warm" }, { label: "Green", description: "Calm" }], multiSelect: false, allowOther: true, secret: false }],
  });
  assert.equal(session.answerQuestion("srv-q", { color: ["Green"] }), true);
  await ended(events);
  assert.equal(replyText(events), 'answer:{"answers":{"color":{"answers":["Green"]}}}');
  assert.deepEqual(events.find((event) => event.type === "question-resolved"), { type: "question-resolved", requestId: "srv-q", outcome: "answered" });
});

test("dismissing Codex's question sends no answers", async (t) => {
  const { session, events } = codex(t, { scenario: "question" });
  await session.startTurn(TURN);
  await questioned(events);
  session.answerQuestion("srv-q", null);
  await ended(events);
  assert.equal(replyText(events), 'answer:{"answers":{}}');
  assert.equal(events.find((event) => event.type === "question-resolved").outcome, "dismissed");
});

test("interrupting cancels Codex's open question", async (t) => {
  const { session, events } = codex(t, { scenario: "question" });
  await session.startTurn(TURN);
  await questioned(events);
  await session.interrupt();
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "question-resolved"), { type: "question-resolved", requestId: "srv-q", outcome: "cancelled" });
  assert.equal(replyText(events), 'answer:{"answers":{}}');
  assert.deepEqual(events.at(-1), { type: "turn-cancelled" });
  assert.equal(session.answerQuestion("srv-q", { color: ["Green"] }), false);
});

test("a question Codex withdraws is dropped without an answer", async (t) => {
  const { session, events } = codex(t, { scenario: "question-withdrawn" });
  await session.startTurn(TURN);
  await ended(events);
  assert.deepEqual(events.find((event) => event.type === "question-resolved"), { type: "question-resolved", requestId: "srv-q", outcome: "cancelled" });
  assert.equal((await received(session)).some((message) => message.id === "srv-q"), false);
  assert.equal(session.answerQuestion("srv-q", null), false);
});

test("a steering message dismisses Codex's open question, then steers the turn", async (t) => {
  const { session, events } = codex(t, { scenario: "question-steer" });
  await session.startTurn(TURN);
  await questioned(events);
  assert.deepEqual(await session.startTurn({ ...TURN, prompt: "Green, please" }), { turnId: "turn-1", steered: true });
  await ended(events);
  assert.equal(events.find((event) => event.type === "question-resolved").outcome, "dismissed");
  assert.equal(replyText(events), "steered:Green, please");
  const messages = await received(session);
  const answer = messages.findIndex((message) => message.id === "srv-q");
  assert.deepEqual(messages[answer].result, { answers: {} });
  assert.ok(answer < messages.findIndex((message) => message.method === "turn/steer"));
});

test("a question asked after the turn was stopped gets no answers at once", async (t) => {
  const { session, events } = codex(t, { scenario: "late-question" });
  await session.startTurn(TURN);
  await session.interrupt();
  await ended(events);
  assert.deepEqual((await replyTo(session, "srv-late")).result, { answers: {} });
  assert.equal(events.some((event) => event.type === "question-request" || event.type === "question-resolved"), false);
  assert.equal(session.questions.size, 0);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test electron/agents/codex-provider.test.cjs`
Expected: FAIL, 8 of 36 tests: the two `config` assertions, timeouts waiting for `question-request`, and `session.answerQuestion is not a function`.

- [ ] **Step 4: Answer Codex's questions**

In `electron/agents/codex-provider.cjs`:

1. Add after the `./permissions.cjs` require:

```js
const { PendingQuestions, codexQuestionRequest, codexQuestionResponse } = require("./questions.cjs");

// Outside Plan mode, Codex offers its question tool (request_user_input) only behind this feature.
// It is set per thread, where an unknown feature is ignored; `--enable` would refuse to start instead.
const THREAD_CONFIG = { features: { default_mode_request_user_input: true } };
```

2. In the constructor, after `this.permissions = new PendingPermissions((event) => this.emit(event));`, add:

```js
    this.questions = new PendingQuestions((event) => this.emit(event));
```

3. In `steer`, replace:

```js
    const turnId = this.state.turnId;
    const files = request.images?.length ? await writeImages(request.images) : null;
```

with:

```js
    const turnId = this.state.turnId;
    // An open question waits for its answer; the message is the user's reply, so the question is dismissed.
    this.questions.dismissAll();
    const files = request.images?.length ? await writeImages(request.images) : null;
```

4. In `start`, replace the `threadParams` line with:

```js
    const threadParams = { cwd: this.cwd, model, approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox, developerInstructions: MILAGRE_INSTRUCTIONS, config: THREAD_CONFIG };
```

`resume` already spreads `threadParams`, so `thread/resume` gets the config too.

5. In `handleNotification`, replace:

```js
    if (method === "serverRequest/resolved") this.permissions.forget(String(params.requestId));
```

with:

```js
    if (method === "serverRequest/resolved") {
      this.permissions.forget(String(params.requestId));
      this.questions.forget(String(params.requestId));
    }
```

6. In `handleServerRequest`, add after the `item/fileChange/requestApproval` branch:

```js
    else if (method === "item/tool/requestUserInput") this.askQuestion(id, params);
```

7. Add after `respondToPermission`:

```js
  // Codex waits on its question until the user answers or dismisses the card, a steering message
  // dismisses it, or the turn stops. A question it can't show, or one asked once its turn has
  // stopped, gets no answers, which Codex reads as "carry on without them".
  askQuestion(id, params) {
    const request = codexQuestionRequest(id, params);
    if (!request || !this.turnActive || this.cancelRequested || this.closed) {
      this.reply(id, codexQuestionResponse("cancelled"));
      return;
    }
    this.questions.add(request, (outcome, answers) => this.reply(id, codexQuestionResponse(outcome, answers)));
  }

  answerQuestion(requestId, answers) {
    return this.questions.answer(requestId, answers);
  }
```

8. The file has three `this.permissions.cancelAll();` lines, in `finishTurn`, `interrupt` and `close`. Add this line right after each of them:

```js
    this.questions.cancelAll();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test electron/agents/codex-provider.test.cjs`
Expected: PASS, 36 tests.

- [ ] **Step 6: Commit**

```bash
git add electron/agents/codex-provider.cjs electron/agents/codex-provider.test.cjs electron/agents/fixtures/fake-app-server.cjs
git commit -m "feat: give Codex threads the question tool and answer its questions" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 4: Session manager, IPC and instructions

**Files:**
- Modify: `electron/agents/session-manager.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `electron/agents/events.cjs`
- Test: `electron/agents/session-manager.test.cjs`
- Test: `electron/agents/events.test.cjs`

**Interfaces:**
- Consumes: `validAnswers` from Task 1; `answerQuestion` on both sessions from Tasks 2–3.
- Produces:
  - `SessionManager#answerQuestion(chatId, requestId, answers): boolean`. It throws `Invalid answers to an agent question.` on anything `validAnswers` refuses.
  - IPC `agent:answer-question { chatId, requestId, answers }`, exposed as `window.milagre.answerQuestion(chatId, requestId, answers)`.
  - The new `MILAGRE_INSTRUCTIONS` text (see Global Constraints) and the question events in `events.cjs`'s header comment.

- [ ] **Step 1: Write the failing tests**

In `electron/agents/session-manager.test.cjs`:

1. In `FakeSession`, add after `respondToPermission`:

```js
  answerQuestion(requestId, answers) {
    this.replies = [...(this.replies ?? []), { requestId, answers }];
    return true;
  }
```

2. Append:

```js
test("routes question answers to the chat's session and refuses malformed ones", async (t) => {
  const { manager, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  assert.equal(manager.answerQuestion("1", "q-1", { color: ["Green", "a darker one"] }), true);
  assert.equal(manager.answerQuestion("1", "q-2", null), true);
  assert.deepEqual(created[0].replies, [{ requestId: "q-1", answers: { color: ["Green", "a darker one"] } }, { requestId: "q-2", answers: null }]);
  assert.equal(manager.answerQuestion("9", "q-1", null), false);
  for (const bad of [undefined, "Green", ["Green"], { color: "Green" }, { color: [7] }, { color: ["x".repeat(10_001)] }]) {
    assert.throws(() => manager.answerQuestion("1", "q-1", bad), /Invalid answers to an agent question/);
  }
  assert.equal(created[0].replies.length, 2);
});

test("a question is sent right after the text before it", async (t) => {
  const { manager, sent, created } = harness();
  t.after(() => manager.closeAll());
  await manager.startTurn(request("1"));
  created[0].emit({ type: "text-delta", messageId: "t1", text: "One thing first" });
  created[0].emit({ type: "question-request", requestId: "q-1", questions: [] });
  created[0].emit({ type: "question-resolved", requestId: "q-1", outcome: "dismissed" });
  assert.deepEqual(sent.map((item) => item.event.type), ["text-delta", "question-request", "question-resolved"]);
});
```

In `electron/agents/events.test.cjs`:

1. Replace the require line with:

```js
const { MILAGRE_INSTRUCTIONS, isTerminal, mapClaudeMessage, mapCodexNotification } = require("./events.cjs");
```

2. Append:

```js
test("agents are told to ask with their question tool, and in a short list without one", () => {
  assert.match(MILAGRE_INSTRUCTIONS, /ask with your question tool if you have one \(AskUserQuestion or request_user_input\)/);
  assert.match(MILAGRE_INSTRUCTIONS, /otherwise ask in your reply as a short numbered list\.$/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test electron/agents/session-manager.test.cjs electron/agents/events.test.cjs`
Expected: FAIL, 2 of 30 tests: `manager.answerQuestion is not a function`, and the instruction text doesn't match.

- [ ] **Step 3: Route answers and update the instructions**

In `electron/agents/session-manager.cjs`:

1. Add after the `./permissions.cjs` require:

```js
const { validAnswers } = require("./questions.cjs");
```

2. Add before `async interruptAll() {`:

```js
  // Answers come from the renderer too: only null or a few short strings per question id reach a session.
  answerQuestion(chatId, requestId, answers) {
    if (!validAnswers(answers)) throw new Error("Invalid answers to an agent question.");
    return this.sessions.get(chatId)?.session.answerQuestion(requestId, answers) ?? false;
  }

```

In `electron/main.cjs`, add after the `agent:respond-permission` handler:

```js

ipcMain.handle("agent:answer-question", (_event, { chatId, requestId, answers }) => agents.answerQuestion(chatId, requestId, answers));
```

In `electron/preload.cjs`, add after the `respondToPermission` line:

```js
  answerQuestion: (chatId, requestId, answers) => ipcRenderer.invoke("agent:answer-question", { chatId, requestId, answers }),
```

In `electron/agents/events.cjs`:

1. In the header comment, add after the two `permission-request` lines:

```js
//   { type: "question-request", ...request } and { type: "question-resolved", requestId, outcome }
//                                           questions the turn waits on (see questions.cjs)
```

2. Replace the `MILAGRE_INSTRUCTIONS` line with:

```js
const MILAGRE_INSTRUCTIONS = "You are an agent inside Milagre, an agent development environment. Answer the user concisely and humanly. Do not claim to have changed files unless you actually did. When you need the user to choose between options, ask with your question tool if you have one (AskUserQuestion or request_user_input); otherwise ask in your reply as a short numbered list.";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:agent`
Expected: PASS. The claude-provider and codex-provider tests compare against `MILAGRE_INSTRUCTIONS` itself, so they stay green.

- [ ] **Step 5: Commit**

```bash
git add electron/agents/session-manager.cjs electron/agents/session-manager.test.cjs electron/agents/events.cjs electron/agents/events.test.cjs electron/main.cjs electron/preload.cjs
git commit -m "feat: route question answers over IPC and tell agents to ask with their question tool" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 5: Renderer state for questions

**Files:**
- Modify: `app/src/model.ts`
- Modify: `app/src/electron.d.ts`
- Modify: `app/src/lib/agent-runs.ts`
- Create: `app/src/lib/question-answers.ts`
- Test: `app/src/lib/agent-runs.test.ts`
- Test: `app/src/lib/question-answers.test.ts`

**Interfaces:**
- Consumes: the event shapes from Task 1 and the IPC call from Task 4.
- Produces:
  - In `model.ts`:
    - `QuestionOption`, `AgentQuestion`, `QuestionRequest`
    - `QuestionAnswers = Record<string, string[]>`
    - `QuestionOutcome = "answered" | "dismissed" | "cancelled"`
    - two new `AgentEvent` members: `question-request` and `question-resolved`.
  - In `electron.d.ts`: `answerQuestion(chatId, requestId, answers: QuestionAnswers | null): Promise<boolean>`.
  - In `agent-runs.ts`:
    - `SentAnswer = PermissionDecision | "answered" | "dismissed"`
    - `AgentRun.questions: QuestionRequest[]`, and `AgentRun.answered` becomes `Record<string, SentAnswer>`.
    - `markAnswered`'s last parameter becomes a `SentAnswer`.
    - `sentDecision(run, requestId) → PermissionDecision | null`
    - `sentReply(run, requestId) → "answered" | "dismissed" | null`
  - In `question-answers.ts`:
    - `QuestionDraft = { picked: string[]; typed: string }` and `QuestionDrafts = Record<string, QuestionDraft>`
    - `draftOf`, `pickOption`, `typeAnswer`, `draftAnswers`, `sendsOnPick`

- [ ] **Step 1: Add the types**

In `app/src/model.ts`, add after `export type PermissionDecision = "allow" | "allow-for-chat" | "deny";`:

```ts

/** One option on a question card. */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** One question an agent asks, as shown on the question card. */
export interface AgentQuestion {
  /** Unique within its request; answers are keyed by it. */
  id: string;
  /** A short tag such as "Library"; may be empty. */
  header: string;
  question: string;
  options: QuestionOption[];
  /** The user may pick several options. */
  multiSelect: boolean;
  /** The user may type an answer of their own. */
  allowOther: boolean;
  /** The typed answer is a secret, so the field hides it. */
  secret: boolean;
}

/** Questions a turn waits on, asked together. */
export interface QuestionRequest {
  requestId: string;
  questions: AgentQuestion[];
}

/** The labels picked and any typed answer, per question id. */
export type QuestionAnswers = Record<string, string[]>;

export type QuestionOutcome = "answered" | "dismissed" | "cancelled";
```

In the `AgentEvent` union, add after the `permission-resolved` member:

```ts
  | ({ type: "question-request" } & QuestionRequest)
  | { type: "question-resolved"; requestId: string; outcome: QuestionOutcome }
```

In `app/src/electron.d.ts`:

1. Add `QuestionAnswers` to the `./model` import, after `PermissionDecision`.

2. Add after the `respondToPermission` line:

```ts
      /** Sends the answers to a question card, or dismisses it (null). False when the question is gone. */
      answerQuestion: (chatId: string, requestId: string, answers: QuestionAnswers | null) => Promise<boolean>;
```

- [ ] **Step 2: Write the failing tests**

In `app/src/lib/agent-runs.test.ts`:

1. Replace the two import lines from `../model` and `./agent-runs.ts` (the value import) with:

```ts
import type { AgentEvent, CoordinatorState, ModelOption, PermissionRequest, QuestionRequest } from "../model";
import { applyAgentEvent, chatInProject, chatKey, clearAnswered, markAnswered, modelForChat, sentDecision, sentReply, sessionIdFromKey, startRun, splitRunForSteer } from "./agent-runs.ts";
```

2. Runs now always carry `questions`. Replace each of the 10 occurrences of `answered: {}` (with the colon) by `questions: [], answered: {}`. Leave `.answered, {}` in the assertions alone. For example:

```ts
  const runs = { [key(1)]: { text: "Half an answer", model: "gpt-6-sol", approvals: [], questions: [], answered: {} } };
```

3. Append:

```ts
const question = (requestId: string): QuestionRequest => ({ requestId, questions: [{ id: "0", header: "Color", question: "Which color?", options: [{ label: "Red" }, { label: "Green" }], multiSelect: false, allowOther: true, secret: false }] });

test("questions wait on the run, oldest first, until they're resolved", () => {
  const state = base();
  let runs = startRun({}, key(1), "claude-opus-5-5");
  for (const requestId of ["a", "b"]) runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "question-request", ...question(requestId) }).runs;
  assert.deepEqual(runs[key(1)].questions, [question("a"), question("b")]);
  assert.deepEqual(runs[key(1)].approvals, []);

  runs = markAnswered(runs, key(1), "a", "answered");
  runs = applyAgentEvent(state, runs, PROJECT, key(1), { type: "question-resolved", requestId: "a", outcome: "answered" }).runs;
  assert.deepEqual(runs[key(1)].questions.map((item) => item.requestId), ["b"]);
  assert.deepEqual(runs[key(1)].answered, {});

  const unchanged = applyAgentEvent(state, runs, PROJECT, key(1), { type: "question-resolved", requestId: "missing", outcome: "cancelled" });
  assert.equal(unchanged.runs, runs);
  assert.equal(applyAgentEvent(state, {}, PROJECT, key(1), { type: "question-request", ...question("c") }).runs[key(1)], undefined);
  assert.equal(applyAgentEvent(state, runs, PROJECT, key(1), { type: "turn-cancelled" }).runs[key(1)], undefined);
});

test("what was sent reads back as a decision for approvals and a reply for questions", () => {
  let runs = startRun({}, key(1), "gpt-6-sol");
  runs = markAnswered(markAnswered(markAnswered(runs, key(1), "p", "allow-for-chat"), key(1), "q", "dismissed"), key(1), "r", "answered");
  assert.equal(sentDecision(runs[key(1)], "p"), "allow-for-chat");
  assert.equal(sentDecision(runs[key(1)], "q"), null);
  assert.equal(sentReply(runs[key(1)], "q"), "dismissed");
  assert.equal(sentReply(runs[key(1)], "r"), "answered");
  assert.equal(sentReply(runs[key(1)], "p"), null);
  assert.equal(sentReply(undefined, "q"), null);
});
```

Create `app/src/lib/question-answers.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentQuestion } from "../model";
import { draftAnswers, pickOption, sendsOnPick, typeAnswer } from "./question-answers.ts";
import type { QuestionDrafts } from "./question-answers.ts";

const color: AgentQuestion = { id: "color", header: "Color", question: "Which color?", options: [{ label: "Red" }, { label: "Green" }, { label: "Blue" }], multiSelect: false, allowOther: true, secret: false };
const fruits: AgentQuestion = { id: "fruits", header: "Fruit", question: "Which fruits?", options: [{ label: "Apple" }, { label: "Banana" }, { label: "Cherry" }], multiSelect: true, allowOther: true, secret: false };
const strict: AgentQuestion = { ...color, id: "strict", allowOther: false };

test("a single-choice question keeps one option, and a typed answer replaces it", () => {
  let drafts: QuestionDrafts = {};
  drafts = pickOption(drafts, color, "Red");
  drafts = pickOption(drafts, color, "Green");
  assert.deepEqual(drafts.color, { picked: ["Green"], typed: "" });
  drafts = typeAnswer(drafts, color, "Purple");
  assert.deepEqual(drafts.color, { picked: [], typed: "Purple" });
  drafts = pickOption(drafts, color, "Blue");
  assert.deepEqual(drafts.color, { picked: ["Blue"], typed: "" });
  assert.deepEqual(typeAnswer(drafts, color, "   ").color, { picked: ["Blue"], typed: "   " });
});

test("a multi-select question toggles options and adds a typed answer", () => {
  let drafts: QuestionDrafts = {};
  for (const label of ["Cherry", "Apple", "Banana", "Banana"]) drafts = pickOption(drafts, fruits, label);
  drafts = typeAnswer(drafts, fruits, " Mango ");
  assert.deepEqual(drafts.fruits, { picked: ["Cherry", "Apple"], typed: " Mango " });
  assert.deepEqual(draftAnswers([fruits], drafts), { fruits: ["Apple", "Cherry", "Mango"] });
});

test("answers are ready only once every question has one", () => {
  const drafts = pickOption({}, color, "Red");
  assert.equal(draftAnswers([color, fruits], drafts), null);
  assert.deepEqual(draftAnswers([color, fruits], typeAnswer(drafts, fruits, "Kiwi")), { color: ["Red"], fruits: ["Kiwi"] });
  assert.equal(draftAnswers([color], typeAnswer({}, color, "  ")), null);
  assert.equal(draftAnswers([strict], typeAnswer({}, strict, "Purple")), null);
  assert.deepEqual(draftAnswers([strict], pickOption({}, strict, "Red")), { strict: ["Red"] });
});

test("only a lone single-choice question sends on the first pick", () => {
  assert.equal(sendsOnPick([color]), true);
  assert.equal(sendsOnPick([fruits]), false);
  assert.equal(sendsOnPick([color, strict]), false);
  assert.equal(sendsOnPick([]), false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test app/src/lib/agent-runs.test.ts app/src/lib/question-answers.test.ts`
Expected: FAIL. `agent-runs.test.ts` stops with `does not provide an export named 'sentDecision'`, and `question-answers.test.ts` with `Cannot find module …/question-answers.ts`.

- [ ] **Step 4: Fold questions into the run**

In `app/src/lib/agent-runs.ts`:

1. Replace the `../model` import with:

```ts
import type { AgentEvent, ChatMessage, CoordinatorState, ModelOption, ModelProvider, PermissionDecision, PermissionRequest, QuestionRequest } from "../model";

/** What the user sent for a request the turn waits on: an approval decision, or a question answered or dismissed. */
export type SentAnswer = PermissionDecision | "answered" | "dismissed";
```

2. In `AgentRun`, replace the `approvals` and `answered` members with:

```ts
  /** Approval requests the turn waits on, oldest first. */
  approvals: PermissionRequest[];
  /** Questions the turn waits on, oldest first. */
  questions: QuestionRequest[];
  /** What was sent for each approval or question (by request id) until the agent takes it. */
  answered: Record<string, SentAnswer>;
```

3. In `startRun`, return:

```ts
  return { ...runs, [chatId]: { text: "", model, approvals: [], questions: [], answered: {} } };
```

4. Replace `markAnswered`'s doc comment and signature with:

```ts
/** Records what the user sent for a chat's approval or question. Kept on the run, so another chat's request with the same id is untouched. */
export function markAnswered(runs: AgentRuns, chatId: string, requestId: string, decision: SentAnswer): AgentRuns {
```

5. Add before `clearAnswered`'s doc comment:

```ts
/** The decision sent for an approval, while the agent takes it. */
export function sentDecision(run: AgentRun | undefined, requestId: string): PermissionDecision | null {
  const sent = run?.answered[requestId];
  return sent === "allow" || sent === "allow-for-chat" || sent === "deny" ? sent : null;
}

/** Whether a question's answers were sent or it was dismissed, while the agent takes it. */
export function sentReply(run: AgentRun | undefined, requestId: string): "answered" | "dismissed" | null {
  const sent = run?.answered[requestId];
  return sent === "answered" || sent === "dismissed" ? sent : null;
}

```

6. In `applyAgentEvent`'s `switch`, add before `case "text-delta":`:

```ts
    case "question-request": {
      if (!run) return { state, runs, changed: false };
      const { type: _type, ...request } = event;
      const questions = [...run.questions.filter((item) => item.requestId !== request.requestId), request];
      return { state, runs: { ...runs, [chatId]: { ...run, questions } }, changed: false };
    }
    case "question-resolved": {
      if (!run) return { state, runs, changed: false };
      const questions = run.questions.filter((item) => item.requestId !== event.requestId);
      const { [event.requestId]: _answered, ...answered } = run.answered;
      if (questions.length === run.questions.length && !(event.requestId in run.answered)) return { state, runs, changed: false };
      return { state, runs: { ...runs, [chatId]: { ...run, questions, answered } }, changed: false };
    }
```

Create `app/src/lib/question-answers.ts`:

```ts
import type { AgentQuestion, QuestionAnswers } from "../model";

/** What the user has picked and typed for one question on a question card. */
export interface QuestionDraft {
  picked: string[];
  typed: string;
}

/** Drafts by question id. */
export type QuestionDrafts = Record<string, QuestionDraft>;

export function draftOf(drafts: QuestionDrafts, questionId: string): QuestionDraft {
  return drafts[questionId] ?? { picked: [], typed: "" };
}

/** Picks an option. A single-choice question keeps only that option and drops a typed answer; a multi-select one toggles it. */
export function pickOption(drafts: QuestionDrafts, question: AgentQuestion, label: string): QuestionDrafts {
  const draft = draftOf(drafts, question.id);
  if (!question.multiSelect) return { ...drafts, [question.id]: { picked: [label], typed: "" } };
  const picked = draft.picked.includes(label) ? draft.picked.filter((item) => item !== label) : [...draft.picked, label];
  return { ...drafts, [question.id]: { ...draft, picked } };
}

/** Types an answer of the user's own. On a single-choice question it replaces the picked option. */
export function typeAnswer(drafts: QuestionDrafts, question: AgentQuestion, typed: string): QuestionDrafts {
  const draft = draftOf(drafts, question.id);
  const picked = !question.multiSelect && typed.trim() ? [] : draft.picked;
  return { ...drafts, [question.id]: { picked, typed } };
}

/** The answers to send: picks in the agent's option order, then the typed answer. Null while a question has none. */
export function draftAnswers(questions: AgentQuestion[], drafts: QuestionDrafts): QuestionAnswers | null {
  const answers: QuestionAnswers = {};
  for (const question of questions) {
    const draft = draftOf(drafts, question.id);
    const picked = question.options.map((option) => option.label).filter((label) => draft.picked.includes(label));
    const typed = question.allowOther ? draft.typed.trim() : "";
    const values = typed ? [...picked, typed] : picked;
    if (!values.length) return null;
    answers[question.id] = values;
  }
  return answers;
}

/** A card with one single-choice question sends as soon as an option is picked. */
export function sendsOnPick(questions: AgentQuestion[]): boolean {
  return questions.length === 1 && !questions[0].multiSelect;
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `node --test app/src/lib/agent-runs.test.ts app/src/lib/question-answers.test.ts`
Expected: PASS, 17 and 4 tests.

Run: `npm run typecheck`
Expected: one error, in `app/src/App.tsx`, where `PermissionCard`'s `answering` gets a `SentAnswer`. Task 6 fixes it. Nothing else may fail.

- [ ] **Step 6: Commit**

```bash
git add app/src/model.ts app/src/electron.d.ts app/src/lib/agent-runs.ts app/src/lib/agent-runs.test.ts app/src/lib/question-answers.ts app/src/lib/question-answers.test.ts
git commit -m "feat: keep open questions on each chat's run and the card's answer rules" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 6: Question card, Escape and README

**Files:**
- Create: `app/src/components/agents/QuestionCard.tsx`
- Modify: `app/src/components/useAgentRuns.ts`
- Modify: `app/src/App.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes:
  - From Task 5: `QuestionRequest`, `QuestionAnswers`, `SentAnswer`, `sentDecision`, `sentReply` and `question-answers.ts`.
  - `window.milagre.answerQuestion` from Task 4.
- Produces:
  - `useAgentRuns(...)` returns `{ runs, start, interrupt, respond, answerQuestion, splitForSteer }`, where `answerQuestion(chatId, requestId, answers | null): Promise<boolean>`.
  - `QuestionCard({ request, waiting, answering, onAnswer })`, where `answering` is `"answered" | "dismissed" | null` and `onAnswer` is `(answers: QuestionAnswers | null) => void`.
  - `ChatComposer`'s existing `approval` slot carries the question card when no approval waits. `ChatComposer` itself does not change.

There is no renderer test harness. The card's rules are tested in Task 5; this task is checked by the typecheck and the build, then in Electron in Task 7.

- [ ] **Step 1: Create the card**

Create `app/src/components/agents/QuestionCard.tsx`:

```tsx
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, HelpCircleIcon, Loading03Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { AgentQuestion, QuestionAnswers, QuestionRequest } from "../../model";
import { draftAnswers, draftOf, pickOption, sendsOnPick, typeAnswer } from "../../lib/question-answers";
import type { QuestionDrafts } from "../../lib/question-answers";
import { SPRING_PRESS, SPRING_SWAP } from "../../lib/ease";

/** The open chat's oldest question: the agent's options as rows, an answer of the user's own, and Dismiss. */
export function QuestionCard({ request, waiting, answering, onAnswer }: {
  request: QuestionRequest;
  /** How many more questions are queued behind this one. */
  waiting: number;
  /** What was already sent for this question, while the agent takes it. */
  answering: "answered" | "dismissed" | null;
  /** The answers to send, or null to dismiss the question. */
  onAnswer: (answers: QuestionAnswers | null) => void;
}) {
  const reduce = useReducedMotion();
  const [drafts, setDrafts] = useState<QuestionDrafts>({});
  const answers = draftAnswers(request.questions, drafts);
  const pending = answering === null;
  const count = request.questions.length;
  const queued = waiting > 0 ? `${waiting} more ${waiting === 1 ? "question is" : "questions are"} waiting after this one.` : "";

  function pick(question: AgentQuestion, label: string) {
    const next = pickOption(drafts, question, label);
    setDrafts(next);
    // One single-choice question: the tap is the answer.
    const ready = draftAnswers(request.questions, next);
    if (sendsOnPick(request.questions) && ready) onAnswer(ready);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, question: AgentQuestion) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (answers) onAnswer(answers);
    }
    // Escape clears a typed answer first; on an empty field it reaches the window, which dismisses the question.
    if (event.key === "Escape" && draftOf(drafts, question.id).typed) {
      event.preventDefault();
      setDrafts(typeAnswer(drafts, question, ""));
    }
  }

  return (
    <motion.section
      role="dialog"
      aria-label="Agent question"
      aria-busy={answering === "answered"}
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? undefined : { opacity: 0, y: 6, scale: 0.985 }}
      transition={reduce ? { duration: 0 } : SPRING_SWAP}
      className="flex max-h-[min(72vh,620px)] w-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-overlay"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-ink-3">{count === 1 ? "The agent has a question" : `The agent has ${count} questions`}</p>
          {queued && <p className="mt-0.5 text-xs leading-5 text-ink-2">{queued}</p>}
        </div>
        <StatusChip answering={answering} reduce={Boolean(reduce)} />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain px-4 pt-3 pb-4 [scrollbar-width:thin]">
        {request.questions.map((question) => {
          const draft = draftOf(drafts, question.id);
          return (
            <div key={question.id} role={question.multiSelect ? "group" : "radiogroup"} aria-label={question.question} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline gap-2">
                {question.header && <span className="rounded-chip bg-inset px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">{question.header}</span>}
                <h2 className="text-sm font-semibold text-ink">{question.question}</h2>
              </div>
              {question.multiSelect && <p className="text-xs text-ink-3">Pick any that apply.</p>}
              {question.options.map((option, index) => {
                const picked = draft.picked.includes(option.label);
                return (
                  <motion.button
                    key={`${index}-${option.label}`}
                    type="button"
                    role={question.multiSelect ? "checkbox" : "radio"}
                    aria-checked={picked}
                    disabled={!pending}
                    onClick={() => pick(question, option.label)}
                    whileTap={reduce || !pending ? undefined : { scale: 0.99 }}
                    transition={SPRING_PRESS}
                    className={`flex w-full items-start gap-2.5 rounded-control border px-2.5 py-2 text-left transition-colors disabled:cursor-default ${picked ? "border-accent/40 bg-accent-tint" : "border-line bg-surface hover:border-line-strong hover:bg-hover disabled:hover:border-line disabled:hover:bg-surface"}`}
                  >
                    <span aria-hidden className={`mt-0.5 flex size-4 shrink-0 items-center justify-center border ${question.multiSelect ? "rounded-[5px]" : "rounded-full"} ${picked ? "border-accent bg-accent text-white" : "border-line-strong bg-surface"}`}>
                      {picked && <HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2.4} color="currentColor" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-5 text-ink">{option.label}</span>
                      {option.description && <span className="block text-xs leading-5 text-ink-2">{option.description}</span>}
                    </span>
                  </motion.button>
                );
              })}
              {question.allowOther && (
                <input
                  type={question.secret ? "password" : "text"}
                  value={draft.typed}
                  disabled={!pending}
                  onChange={(event) => setDrafts(typeAnswer(drafts, question, event.target.value))}
                  onKeyDown={(event) => handleKeyDown(event, question)}
                  placeholder={question.options.length ? "Or type your own answer" : "Type your answer"}
                  aria-label={`Your own answer to: ${question.question}`}
                  autoComplete="off"
                  className={`w-full rounded-control border bg-field px-2.5 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent/50 ${draft.typed.trim() ? "border-accent/40" : "border-line"}`}
                />
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {pending && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: 6 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="flex flex-wrap justify-end gap-2 border-t border-line bg-inset px-4 py-3"
          >
            <motion.button type="button" onClick={() => onAnswer(null)} whileTap={reduce ? undefined : { scale: 0.97 }} transition={SPRING_PRESS} className="rounded-control border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-hover">
              Dismiss
            </motion.button>
            <motion.button type="button" disabled={!answers} onClick={() => answers && onAnswer(answers)} whileTap={reduce || !answers ? undefined : { scale: 0.97 }} transition={SPRING_PRESS} className="rounded-control bg-ink px-3 py-2 text-xs font-medium text-surface transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-40">
              {count === 1 ? "Send answer" : "Send answers"}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function StatusChip({ answering, reduce }: { answering: "answered" | "dismissed" | null; reduce: boolean }) {
  if (answering === "dismissed") return <span className="inline-flex shrink-0 items-center gap-1 rounded-chip border border-line bg-inset px-2 py-1 text-[10px] font-semibold text-ink-3"><HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.8} color="currentColor" />Dismissed</span>;
  if (answering === "answered") return <span className="inline-flex shrink-0 items-center gap-1 rounded-chip border border-accent/30 bg-accent-tint px-2 py-1 text-[10px] font-semibold text-accent-ink"><span className={reduce ? undefined : "animate-spin"}><HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={1.8} color="currentColor" /></span>Sending</span>;
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-chip border border-orange/30 bg-orange-tint px-2 py-1 text-[10px] font-semibold text-orange"><HugeiconsIcon icon={HelpCircleIcon} size={14} strokeWidth={1.8} color="currentColor" />Needs your answer</span>;
}
```

- [ ] **Step 2: Let the hook send answers**

In `app/src/components/useAgentRuns.ts`:

1. Replace the three import lines from `../model` and `../lib/agent-runs` with:

```ts
import type { AgentEvent, AgentStartTurnRequest, CoordinatorState, PermissionDecision, QuestionAnswers } from "../model";
import { applyAgentEvent, chatInProject, clearAnswered, markAnswered, splitRunForSteer, startRun } from "../lib/agent-runs";
import type { AgentRuns, SentAnswer } from "../lib/agent-runs";
```

2. Replace the whole `respond` callback (from its doc comment to `}, []);`) and the `return` line with:

```ts
  /** Sends the user's answer. The card shows it as sent until the agent takes it, and goes back to pending if it doesn't arrive. */
  const send = useCallback(async (chatId: string, requestId: string, sent: SentAnswer, deliver: () => Promise<boolean>) => {
    const setAnswers = (next: AgentRuns) => {
      runsRef.current = next;
      setRuns(next);
    };
    setAnswers(markAnswered(runsRef.current, chatId, requestId, sent));
    try {
      const accepted = await deliver();
      if (!accepted) setAnswers(clearAnswered(runsRef.current, chatId, requestId));
      return accepted;
    } catch (error) {
      setAnswers(clearAnswered(runsRef.current, chatId, requestId));
      throw error;
    }
  }, []);

  const respond = useCallback((chatId: string, requestId: string, decision: PermissionDecision) => send(chatId, requestId, decision, () => window.milagre.respondToPermission(chatId, requestId, decision)), [send]);

  /** Sends the answers to a question, or dismisses it (null). */
  const answerQuestion = useCallback((chatId: string, requestId: string, answers: QuestionAnswers | null) => send(chatId, requestId, answers ? "answered" : "dismissed", () => window.milagre.answerQuestion(chatId, requestId, answers)), [send]);

  return { runs, start, interrupt, respond, answerQuestion, splitForSteer };
```

- [ ] **Step 3: Show the card and extend Escape in `App.tsx`**

1. Imports:
   - Add `QuestionAnswers,` to the `./model` import list, after `PermissionDecision,`.
   - Replace `import { chatKey, modelForChat } from "./lib/agent-runs";` with:

```ts
import { chatKey, modelForChat, sentDecision, sentReply } from "./lib/agent-runs";
```

   - Add after the `PermissionCard` import:

```ts
import { QuestionCard } from "./components/agents/QuestionCard";
```

2. Replace the `pendingApproval` line and `answerApproval` with:

```ts
  const pendingApproval = run?.approvals[0];
  // Approvals come first; a question shows once none is waiting.
  const pendingQuestion = pendingApproval ? undefined : run?.questions[0];

  function answerApproval(decision: PermissionDecision) {
    if (!project || !selectedSession || !pendingApproval) return;
    // The run keeps the answer; if it doesn't reach the agent, the card goes back to pending.
    void agentRuns.respond(chatKey(project.path, selectedSession.id), pendingApproval.requestId, decision).catch(() => {});
  }

  /** Sends the answers to the open question, or dismisses it (null). */
  function answerQuestion(answers: QuestionAnswers | null) {
    if (!project || !selectedSession || !pendingQuestion) return;
    void agentRuns.answerQuestion(chatKey(project.path, selectedSession.id), pendingQuestion.requestId, answers).catch(() => {});
  }
```

3. In the Escape effect, replace:

```ts
        // Escape denies the open approval; once that's answered, Escape stops the turn.
        const pending = run.approvals[0];
        if (pending && !run.answered[pending.requestId]) answerApproval("deny");
        else void agentRuns.interrupt(chatKey(project.path, selectedSession.id));
```

with:

```ts
        // Escape denies the open approval or dismisses the open question; once that's sent, Escape stops the turn.
        const approval = run.approvals[0];
        const question = approval ? undefined : run.questions[0];
        if (approval && !run.answered[approval.requestId]) answerApproval("deny");
        else if (question && !run.answered[question.requestId]) answerQuestion(null);
        else void agentRuns.interrupt(chatKey(project.path, selectedSession.id));
```

4. In the `approval={…}` prop of `<ChatComposer>`, replace:

```tsx
                answering={run?.answered[pendingApproval.requestId] ?? null}
                onAnswer={answerApproval}
              />
            ) : undefined}
```

with:

```tsx
                answering={sentDecision(run, pendingApproval.requestId)}
                onAnswer={answerApproval}
              />
            ) : pendingQuestion ? (
              <QuestionCard
                key={pendingQuestion.requestId}
                request={pendingQuestion}
                waiting={(run?.questions.length ?? 1) - 1}
                answering={sentReply(run, pendingQuestion.requestId)}
                onAnswer={answerQuestion}
              />
            ) : undefined}
```

- [ ] **Step 4: Update the README**

In `README.md`:

1. Add after the feature line that starts `- Approval cards that show the exact command`:

```markdown
- Question cards: when an agent asks you to choose, its options appear as a card. Tap one (or several, where the agent allows it), type your own answer, or dismiss the question; the agent carries on in the same turn.
```

2. Under `## Permission modes`, replace `Escape denies an open approval card.` with `Escape denies an open approval card and dismisses an open question card.`

3. Add a new paragraph after that one (the paragraph ending `…never changes your Claude or Codex settings files.`):

```markdown
Question cards appear in every mode, Full included. A message you send while a question is open dismisses it and reaches the agent as your reply. Codex asks with a card through a Codex feature that is still under development; without it, Codex asks in its reply.
```

- [ ] **Step 5: Typecheck, test and build**

Run: `npm run test:agent`
Expected: PASS, 202 tests.

Run: `npm run build`
Expected: no TypeScript errors, and `✓ built`.

Run: `grep -rn "not through a question tool" electron app/src; grep -n "disallowedTools" electron/agents/claude-provider.cjs`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add app/src README.md
git commit -m "feat: show agent questions as cards with Escape to dismiss" -m "Claude-Session: https://claude.ai/code/session_01GDihiFqscJmg9mChuRaTM5"
```

---

### Task 7: Verify with the real CLIs

**Files:** none committed. Scripts live in the session scratchpad.

This task is run by the controller, not a subagent. Use an isolated Electron instance:

- this branch's Vite dev server on a free port;
- `--remote-debugging-port` and `--user-data-dir` in the scratchpad;
- the working directory set to a throwaway git repository.

Drive it with Playwright over CDP. Use `claude-haiku-4-5` for Claude and `gpt-6-sol` for Codex. Take tap targets from the card's roles: `[role=radio]`, `[role=checkbox]`, the `Your own answer to: …` field, and the `Dismiss` and `Send answer` buttons. Every check below must pass, with no page errors.

Victor follows from his phone, so send each step's screenshots to him with `SendUserFile` as soon as they exist, including any failures.

- [ ] **Step 1: Claude, one question, Ask mode**
  - Ask: "Before doing anything else, use your AskUserQuestion tool to ask me which color I prefer: Red, Green or Blue. Then reply with exactly one line: CHOSEN=<my answer>."
  - Expected:
    - a card reading "The agent has a question" and "Needs your answer";
    - the question with its header chip, three radio rows, and the "Or type your own answer" field.
  - Tap **Green**. The card shows "Sending", then goes away, and the reply is `CHOSEN=Green`.

- [ ] **Step 2: Claude, several picks and a typed answer, Full mode**
  - Switch to Full. In a new chat, ask: "Use your AskUserQuestion tool once with two questions: which fruits I like (multiSelect true: Apple, Banana, Cherry) and which size I prefer (Small, Large). Then reply with two lines: FRUITS=<answer> and SIZE=<answer>."
  - Expected: one card reading "The agent has 2 questions", with checkbox rows and "Pick any that apply." under the fruit question.
  - "Send answers" stays disabled until both questions have an answer.
  - Pick **Apple** and **Cherry**, type "Mango", then pick **Large** and press **Send answers**.
  - Expected reply: `FRUITS=Apple, Cherry, Mango` and `SIZE=Large`. This also proves the card shows in Full mode.

- [ ] **Step 3: Typed answer and Escape**
  - Repeat Step 1's prompt. Type "Purple with yellow dots" in the field and press **Enter**.
  - Expected reply: `CHOSEN=Purple with yellow dots`.
  - Repeat the prompt again. Type "x" in the field and press **Escape**: the field clears and the card stays.
  - Press **Escape** again: the card shows "Dismissed" and goes away.
  - Expected: the reply asks in text, with no second card.

- [ ] **Step 4: Steering while a question is open**
  - Repeat Step 1's prompt. With the card open, send from the composer: "Green. Also end your reply with the word BANANA."
  - Expected: the card goes away. The chat reads: the first message, the steering message, then a reply containing `CHOSEN=Green` and `BANANA`.

- [ ] **Step 5: Reload with a question open**
  - Repeat Step 1's prompt. With the card open, reload the window.
  - Expected: no card and no "Working" state. The next message in that chat starts a turn normally.

- [ ] **Step 6: Codex, then resume**
  - In Auto, in a new Codex chat, ask: "Use your request_user_input tool to ask me which color I prefer (Red, Green, Blue). If you don't have that tool, say exactly NO_TOOL. Then reply with exactly one line: CHOSEN=<my answer>."
  - Expected: a card with three radio rows. Codex may add "(Recommended)" to a label. Tap **Green**; the reply is `CHOSEN=Green`.
  - Quit Milagre, relaunch it, open the same chat, and send the same message again.
  - Expected: a card again, not `NO_TOOL`. The resumed thread kept the question tool.
  - With the card open, press **Escape** twice. The first dismisses the question; the second stops the turn if it is still running. Expected: no card and no "Working" state.

- [ ] **Step 7: Nothing else changed**
  - In Ask mode, ask Claude to create `hello.txt` containing hi. Expected: the approval card as before, not a question card.
  - Ask Claude: "Without using any tools, ask me which of three project names I prefer, as a question line followed by a numbered list." Expected: the reply still shows as a recommendation card.

- [ ] **Step 8: Record the results** in the pull request's "How was it verified?" section, with screenshots of the Claude single-question card, the two-question card with picks, and the Codex card.
