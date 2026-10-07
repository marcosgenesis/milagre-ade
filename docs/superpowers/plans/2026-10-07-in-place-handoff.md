# In-place Provider Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switching a chat between Claude and Codex happens in the same chat, marked by a "Context handoff" divider, and the old "new chat with this chat's context" handover is removed, on desktop and mobile.

**Architecture:** A send whose provider differs from the chat's last turn adds a `handoff` divider message (a note nobody typed) before the user's message, parks the old provider's native session id, generates a brief with the existing `handover.cjs` brief generator, then starts the turn on the target provider with `brief + typed text`. Dividers double as the record of where each provider stopped reading, so switching back sends only a catch-up. Desktop and mobile render the divider and drop the provider lock in their pickers.

**Tech Stack:** Node (CommonJS) core, `node:test`, React + Tailwind (Electron renderer), Expo / React Native (mobile), shared ESM in `packages/shared`.

**Spec:** `docs/superpowers/specs/2026-10-07-in-place-handoff-design.md`

## Global Constraints

- Divider copy: `Context handoff` for a provider switch, `Context restored` when `from.provider === to.provider`. Icon `⇆` on desktop is the Hugeicons `ArrowDataTransferHorizontalIcon`; mobile uses the same icon through `src/icons.tsx`.
- Divider position: before the user message that triggered the switch.
- No brief review or edit step. The divider opens the brief read-only.
- `native_session_id` is not renamed. Parked ids live in `native_sessions`.
- Mobile changes are JS only (no native module, config plugin or `app.json` change), so they ship OTA. Do not start any EAS build.
- No Claude attribution in commits or PR text.
- Desktop and mobile change in the same branch (AGENTS.md sync rule).
- Checks before the PR: `npm run typecheck`, `npm run typecheck:mobile`, `npm run lint`, `npm test -- --unit`, `npm test -- --only handover`.

## Review Focus

1. A send while a turn is already running on the old provider (steer): it must not start a handoff mid-turn. Expected: a steer stays on the running provider; the handoff happens on the next new turn. Test in Task 3.
2. Switching providers twice before the first brief finishes (two quick sends). Expected: the second send queues behind the first like any send during a run, and doesn't add a second divider for the same switch. Test in Task 3.
3. A chat whose first turn failed before `session-started` (CLI missing) and is resent on the same provider. Expected: no "Context restored" divider, since there is no completed reply. Test in Task 3.
4. Old data: a chat with `handedOverFrom` / `handoverDraft` and no messages. Expected: it still lists, and its first send carries the draft as before. Test in Task 4.
5. Stopping during "preparing". Expected: divider `failed`, turn `cancelled`, the old provider's idle session untouched. Test in Task 3.

---

## File map

| File | Change |
| --- | --- |
| `packages/shared/src/model.ts` | `HandoffContext`, `native_sessions`, docs |
| `packages/shared/src/handoff.mjs`, `handoff.d.mts`, `handoff.test.ts` | New: `isHandoff`, `lastTurnProvider`, `catchUpStart`, `handoffKind` |
| `packages/shared/package.json` | Export `./handoff` and list its files |
| `packages/core/src/agents/handover.cjs` (+ test) | Transcript renders dividers and takes a range; brief takes `catchUp` |
| `packages/core/src/agents/chat-host.cjs` (+ test) | Handoff in `send`, `cancelHandoff`, `recoverHandoffs`; old handover methods removed |
| `packages/core/src/runtime.cjs`, `link-runtime.cjs` | Interrupt wiring, recovery rename, IPC removed |
| `apps/daemon/src/mobile-bridge.cjs` (+ test) | Drop `handoverDraft` scrub |
| `apps/desktop/electron/preload.cjs`, `app/src/electron.d.ts` | Remove `handover`, `setHandoverDraft` |
| `apps/desktop/app/src/components/Handover.tsx` | Replace with `HandoffDivider` + read-only brief dialog |
| `apps/desktop/app/src/lib/handover.ts` (+ test) | Trim to what remains |
| `apps/desktop/app/src/components/ChatComposer.tsx`, `PromptComposer.tsx`, `App.tsx`, `LinkWorkspace.tsx` | Render divider, unlock picker, remove old flow |
| `scripts/test-handover.cjs`, `scripts/test-desktop.cjs` | Electron check for the in-place switch |
| `apps/mobile/src/handoff-divider.tsx` | New: divider + brief sheet trigger |
| `apps/mobile/src/app/chat.tsx`, `src/app/model-sheet.tsx`, `src/chat-reply.tsx` | Render divider, unlock picker, send picked provider |

---

### Task 1: Shared handoff types and helpers

**Files:**
- Modify: `packages/shared/src/model.ts:93-96,180-197`
- Create: `packages/shared/src/handoff.mjs`, `packages/shared/src/handoff.d.mts`
- Test: `packages/shared/src/handoff.test.ts`
- Modify: `packages/shared/package.json` (exports + files)

**Interfaces:**
- Produces:
  - `type HandoffContext = { kind: "handoff"; from: { provider: ModelProvider; model?: string }; to: { provider: ModelProvider; model?: string }; status: "preparing" | "done" | "failed"; brief?: string; transcriptPath?: string }`
  - `AgentSession.native_sessions?: Partial<Record<ModelProvider, string>>`
  - `isHandoff(message): boolean`
  - `lastTurnProvider(state, sessionId): ModelProvider | undefined`
  - `catchUpStart(state, sessionId, provider): number | null`: id of the divider after which the provider's catch-up starts, or `null` for the whole chat.
  - `handoffKind(state, sessionId, provider): "switch" | "restore" | null`: what a send on `provider` needs.

- [ ] **Step 1: Write the failing test** in `packages/shared/src/handoff.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession, ChatMessage } from "./model.ts";
import { catchUpStart, handoffKind, isHandoff, lastTurnProvider } from "./handoff.mjs";

const session: AgentSession = { id: 1, worktree_id: 1, agent_name: "main", status: "Created", provider: "claude", native_session_id: "c1" };
const user = (id: number, body = "hi"): ChatMessage => ({ id, session_id: 1, body, context: null, role: "user" });
const reply = (id: number, outcome: ChatMessage["outcome"] = "completed"): ChatMessage => ({ id, session_id: 1, body: "ok", context: null, role: "assistant", outcome });
const divider = (id: number, from: "claude" | "codex", to: "claude" | "codex"): ChatMessage => ({
  id,
  session_id: 1,
  body: "",
  role: "assistant",
  context: { kind: "handoff", from: { provider: from }, to: { provider: to }, status: "done" },
});
const state = (messages: ChatMessage[], extra: Partial<AgentSession> = {}) => ({ sessions: { 1: { ...session, ...extra } }, messages });

test("a divider is recognized by its context kind", () => {
  assert.equal(isHandoff(divider(3, "claude", "codex")), true);
  assert.equal(isHandoff(reply(3)), false);
  assert.equal(isHandoff({ ...reply(3), context: "handover" }), false);
});

test("the last turn's provider is the last divider's target, else the chat's provider once it has messages", () => {
  assert.equal(lastTurnProvider(state([]), 1), undefined);
  assert.equal(lastTurnProvider(state([user(2), reply(3)]), 1), "claude");
  assert.equal(lastTurnProvider(state([user(2), reply(3), divider(4, "claude", "codex"), user(5)], { provider: "codex" }), 1), "codex");
});

test("catch-up starts after the divider where the provider was switched away, else the whole chat", () => {
  const messages = [user(2), reply(3), divider(4, "claude", "codex"), user(5), reply(6)];
  assert.equal(catchUpStart(state(messages, { provider: "codex", native_sessions: { claude: "c1" } }), 1, "claude"), 4);
  // Codex never ran before the divider into it: whole chat.
  assert.equal(catchUpStart(state(messages, { provider: "codex" }), 1, "codex"), null);
  // A parked id is required to resume; without one the provider gets the whole chat.
  assert.equal(catchUpStart(state(messages, { provider: "codex" }), 1, "claude"), null);
});

test("a send needs a switch when the provider changes, a restore when a replied chat lost its session, else nothing", () => {
  assert.equal(handoffKind(state([]), 1, "codex"), null);
  assert.equal(handoffKind(state([user(2), reply(3)]), 1, "claude"), null);
  assert.equal(handoffKind(state([user(2), reply(3)]), 1, "codex"), "switch");
  assert.equal(handoffKind(state([user(2), reply(3)], { native_session_id: undefined }), 1, "claude"), "restore");
  // A first turn that failed before its session started has nothing to restore.
  assert.equal(handoffKind(state([user(2), reply(3, "failed")], { native_session_id: undefined }), 1, "claude"), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test packages/shared/src/handoff.test.ts`
Expected: FAIL, cannot find module `./handoff.mjs`.

- [ ] **Step 3: Add the types to `packages/shared/src/model.ts`**

Replace the two `AgentSession` fields at `:93-96` with:

```ts
  /** The agent this chat runs on now. A send on the other provider hands the chat off in place (see handoff.mjs). */
  provider?: ModelProvider;
  /** Claude session id or Codex thread id of the current `provider`, used to resume the agent's memory. */
  native_session_id?: string;
  /** Session ids of the providers this chat is not on right now, so switching back resumes them. */
  native_sessions?: Partial<Record<ModelProvider, string>>;
```

Mark the old fields at `:113-119` as legacy in their comments: `/** Legacy (before in-place handoff): ... Read, never written. */`. Change `handoverBrief`'s comment at `:184` the same way.

Replace the `ChatContext` line at `:197` with:

```ts
/** A provider switch inside a chat, shown as a divider before the message that caused it. `brief` is what the new provider was sent. */
export type HandoffContext = {
  kind: "handoff";
  from: { provider: ModelProvider; model?: string };
  to: { provider: ModelProvider; model?: string };
  status: "preparing" | "done" | "failed";
  brief?: string;
  transcriptPath?: string;
};

/** What wrote a message nobody typed in this chat: a Link (see LinkedContext), the commit dialog, a handoff, or a legacy handover note. */
export type ChatContext = LinkedContext | { kind: "git-action" } | HandoffContext | "handover" | null;
```

Delete `ChatHandoverRequest` at `:437-441` (its users go in Tasks 4 and 5; typecheck catches stragglers then).

- [ ] **Step 4: Write `packages/shared/src/handoff.mjs`**

```js
// In-place provider handoff: a chat switches between Claude and Codex, and a divider message (context kind
// "handoff") marks each switch. Dividers also record where each provider stopped reading. Types: handoff.d.mts.

export function isHandoff(message) {
  return message?.context?.kind === "handoff";
}

const chatMessages = (state, sessionId) => state.messages.filter((message) => message.session_id === sessionId);

/** The provider the chat's last turn ran on: the last divider's target, else the chat's provider once it has messages. */
export function lastTurnProvider(state, sessionId) {
  const messages = chatMessages(state, sessionId);
  if (!messages.length) return undefined;
  const divider = messages.findLast(isHandoff);
  return divider ? divider.context.to.provider : state.sessions[sessionId]?.provider;
}

/**
 * The id of the divider after which `provider` needs catching up, or null for the whole chat. A provider resumes
 * only with a parked session id; it last read up to the divider that switched away from it.
 */
export function catchUpStart(state, sessionId, provider) {
  if (!state.sessions[sessionId]?.native_sessions?.[provider]) return null;
  return chatMessages(state, sessionId).findLast((message) => isHandoff(message) && message.context.from.provider === provider)?.id ?? null;
}

/**
 * What a send on `provider` needs first: "switch" when the provider changes, "restore" when a chat that has a
 * completed reply lost its native session (a failed resume), else null.
 */
export function handoffKind(state, sessionId, provider) {
  const last = lastTurnProvider(state, sessionId);
  if (!last) return null;
  if (last !== provider) return "switch";
  const session = state.sessions[sessionId];
  const replied = chatMessages(state, sessionId).some((message) => message.role === "assistant" && message.outcome === "completed");
  return replied && !session?.native_session_id ? "restore" : null;
}
```

- [ ] **Step 5: Write `packages/shared/src/handoff.d.mts`**

```ts
import type { ChatMessage, CoordinatorState, HandoffContext, ModelProvider } from "./model.ts";

type TranscriptState = Pick<CoordinatorState, "sessions" | "messages">;

export function isHandoff(message: ChatMessage | undefined): message is ChatMessage & { context: HandoffContext };
export function lastTurnProvider(state: TranscriptState, sessionId: number): ModelProvider | undefined;
export function catchUpStart(state: TranscriptState, sessionId: number, provider: ModelProvider): number | null;
export function handoffKind(state: TranscriptState, sessionId: number, provider: ModelProvider): "switch" | "restore" | null;
```

If `CoordinatorState.sessions` is typed so `Pick` fails for the test's literal, use `{ sessions: Record<number, AgentSession>; messages: ChatMessage[] }` instead (match `agent-runs.d.mts`'s `TranscriptState`).

- [ ] **Step 6: Export it** in `packages/shared/package.json`, next to `./chats`:

```json
    "./handoff": {
      "types": "./src/handoff.d.mts",
      "default": "./src/handoff.mjs"
    },
```

`src/*.mjs` and `src/*.d.mts` are already in `files`.

- [ ] **Step 7: Run tests and typecheck**

Run: `node --test packages/shared/src/handoff.test.ts && npm run typecheck --workspace @milagre/shared`
Expected: 4 tests pass; the shared typecheck passes. (The app typecheck fails on `ChatHandoverRequest` until Task 5; that's expected.)

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): handoff divider context and switch helpers"
```

---

### Task 2: Transcript ranges and catch-up briefs

**Files:**
- Modify: `packages/core/src/agents/handover.cjs:8-19,27-45,93-110`
- Test: `packages/core/src/agents/handover.test.cjs`

**Interfaces:**
- Consumes: `HandoffContext` (Task 1).
- Produces:
  - `renderTranscript(state, sessionId, { after?: number })`: `after` is a message id; only messages with a larger id are rendered, under a note that earlier messages are already known. Dividers render as `## Handoff: Claude → Codex`.
  - `generateBrief({ ..., catchUp?: boolean }, deps)`: with `catchUp`, the opening is `"You're back on this chat. Here is what happened on <Provider> since you last worked on it."` and the system prompt says the reader already knows earlier work.

- [ ] **Step 1: Write the failing tests** (append to `handover.test.cjs`)

```js
const divided = {
  ...state,
  messages: [
    ...state.messages.filter((message) => message.session_id === 3),
    {
      id: 7,
      session_id: 3,
      role: "assistant",
      body: "",
      context: { kind: "handoff", from: { provider: "claude" }, to: { provider: "codex" }, status: "done", brief: "B" },
    },
    { id: 8, session_id: 3, role: "user", body: "now add tests", context: null },
  ],
};

test("a divider renders as a handoff heading, not as a reply", () => {
  const text = renderTranscript(divided, 3);
  assert.match(text, /## Handoff: Claude → Codex\n/);
  assert.doesNotMatch(text, /## Assistant\n\n\n/);
});

test("a range renders only the messages after the given id, under a note", () => {
  const text = renderTranscript(divided, 3, { after: 7 });
  assert.match(text, /Earlier messages are left out: you already know them\./);
  assert.match(text, /## User\n\nnow add tests/);
  assert.doesNotMatch(text, /fix the login redirect|Handoff:/);
});

test("a catch-up brief opens by saying the reader is back, and asks only for what changed", async () => {
  const calls = [];
  const brief = await generateBrief(
    { transcript: "T", transcriptPath: "/x/3.md", provider: "codex", lastUserMessage: "", changedFiles: async () => [], catchUp: true },
    { models: { codex: async (input) => (calls.push(input), '{"brief":"B"}') } },
  );
  assert.match(brief, /^You're back on this chat\. Here is what happened on Codex since you last worked on it\.\n\nB\n\n/);
  assert.match(calls[0].system, /already knows the work before this transcript/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test packages/core/src/agents/handover.test.cjs`
Expected: the 3 new tests FAIL; existing ones pass.

- [ ] **Step 3: Implement**

In `handover.cjs`, replace the header comment at `:8-9` with:

```js
// Handing a chat off to the other provider in place: the chat as a markdown transcript on disk, and a short brief
// for the next agent written by the previous provider's small model, sent ahead of the user's message.
```

Add after `SYSTEM`:

```js
const CATCH_UP =
  " The next agent already knows the work before this transcript: cover only what happened in it, using the same sections.";
```

Replace `renderTranscript` with:

```js
/**
 * The chat as markdown: a header, then each message with its tool steps (not thinking) as one line each, and a
 * heading for each handoff. With `after`, only the messages after that id, for a provider catching up.
 */
function renderTranscript(state, sessionId, { after } = {}) {
  const session = state.sessions[sessionId];
  const all = state.messages.filter((message) => message.session_id === sessionId);
  const messages = after == null ? all : all.filter((message) => message.id > after);
  const worktree = state.worktrees[session.worktree_id];
  const parts = [
    `# Chat transcript: ${chatTitle(session, all)}`,
    `Provider: ${providerName(session.provider)} · Worktree: ${worktree?.path ?? "unknown"}`,
  ];
  if (after != null) parts.push("Earlier messages are left out: you already know them.");
  for (const message of messages) {
    if (message.context?.kind === "handoff") {
      parts.push(`## Handoff: ${providerName(message.context.from.provider)} → ${providerName(message.context.to.provider)}`);
    } else if (message.role === "assistant") {
      const steps = (message.steps ?? []).filter((step) => step.kind !== "thinking").map(stepLine);
      parts.push(`## Assistant${message.model ? ` (${message.model})` : ""}`, [steps.join("\n"), message.body].filter(Boolean).join("\n\n"));
    } else {
      // A legacy handed-over chat's first message was sent as its brief followed by what the user typed.
      parts.push("## User", [message.handoverBrief, message.body].filter((part) => part?.trim()).join("\n\n"));
    }
  }
  return `${parts.join("\n\n")}\n`;
}
```

In `generateBrief`, take `catchUp` from the first argument and change the opening and system prompt:

```js
async function generateBrief({ transcript, transcriptPath: file, provider, lastUserMessage, changedFiles, catchUp = false }, { models = {}, timeoutMs = TIMEOUT_MS } = {}) {
  const opening = catchUp
    ? `You're back on this chat. Here is what happened on ${providerName(provider)} since you last worked on it.`
    : `You're taking over a chat that ran on ${providerName(provider)}.`;
  // ...`shown` unchanged...
  const brief = models[provider]
    ? await ask(models[provider], { system: catchUp ? SYSTEM + CATCH_UP : SYSTEM, prompt: `<transcript>\n${shown}\n</transcript>` }, timeoutMs).then(parseBrief, () => null)
    : null;
  // ...rest unchanged...
}
```

Change the `pointer` wording from "the previous chat" to "this chat": `Full transcript of this chat: ${file}. Read it if you need details the brief leaves out.` Update the existing test that asserts the old pointer text (search the test file for `Full transcript of the previous chat`).

- [ ] **Step 4: Run tests**

Run: `node --test packages/core/src/agents/handover.test.cjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/handover.cjs packages/core/src/agents/handover.test.cjs
git commit -m "feat(core): handoff transcripts render dividers and catch-up ranges"
```

---

### Task 3: Handoff in `ChatHost.send`, stop and recovery

**Files:**
- Modify: `packages/core/src/agents/chat-host.cjs`
- Test: `packages/core/src/agents/chat-host.test.cjs`

**Interfaces:**
- Consumes: `handoffKind`, `catchUpStart`, `isHandoff` from `@milagre/shared/handoff` (Task 1); `renderTranscript(state, id, { after })` and the `handoverTools.brief({ ..., catchUp })` passthrough (Task 2).
- Produces:
  - `ChatHost.cancelHandoff(chatId): Promise<boolean>`: true when a handoff was preparing and is now cancelled.
  - `ChatHost.recoverHandoffs(projectPath, state)`: marks dividers still `preparing` as `failed`, and clears legacy `handoverPending`.
  - `this.preparing: Map<chatId, AbortController>`.

- [ ] **Step 1: Write the failing tests** (append to `chat-host.test.cjs`; reuse `harness`, `message`, `chatWithReply`, `chatMessages`, `waitUntil`)

```js
const dividers = (state, sessionId) =>
  state.messages.filter((item) => item.session_id === sessionId && item.context?.kind === "handoff").map((item) => item.context);

test("a send on the other provider adds a divider before the message, briefs the new provider and parks the old session", async (t) => {
  const briefs = [];
  const { host, manager, saved, created } = harness({
    handoverTools: {
      writeTranscript: async ({ sessionId }) => `/tmp/handovers/${sessionId}.md`,
      brief: async (input) => (briefs.push(input), "BRIEF"),
    },
  });
  t.after(() => manager.closeAll());
  const { sessionId } = await host.send(message(ALPHA, "fix the login redirect"));
  await waitUntil(() => created[0]);
  created[0].emit({ type: "session-started", nativeId: "claude-1" });
  created[0].emit({ type: "turn-started", turnId: "t1" });
  created[0].emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 2);

  await host.send(message(ALPHA, "add tests", { sessionId, provider: "codex", model: "gpt-6" }));
  const codex = await waitUntil(() => created.find((item) => item.provider === "codex" && item.turns.length));
  await host.states.flush();
  const state = saved.get(ALPHA);

  assert.deepEqual(
    state.messages.filter((item) => item.session_id === sessionId).map((item) => item.context?.kind ?? item.role),
    ["user", "assistant", "handoff", "user"],
  );
  assert.deepEqual(dividers(state, sessionId), [
    {
      kind: "handoff",
      from: { provider: "claude", model: "claude-opus-5-5" },
      to: { provider: "codex", model: "gpt-6" },
      status: "done",
      brief: "BRIEF",
      transcriptPath: `/tmp/handovers/${sessionId}.md`,
    },
  ]);
  assert.equal(codex.turns[0].prompt, "BRIEF\n\nadd tests");
  assert.equal(codex.options.resumeId, undefined);
  assert.deepEqual(
    { provider: state.sessions[sessionId].provider, parked: state.sessions[sessionId].native_sessions, current: state.sessions[sessionId].native_session_id },
    { provider: "codex", parked: { claude: "claude-1" }, current: undefined },
  );
  assert.deepEqual(briefs.map(({ provider, catchUp }) => ({ provider, catchUp })), [{ provider: "claude", catchUp: false }]);
});

test("switching back resumes the parked session with a catch-up of what happened since", async (t) => {
  const briefs = [];
  const { host, manager, saved, created } = harness({
    handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: async (input) => (briefs.push(input), "CATCH-UP") },
  });
  t.after(() => manager.closeAll());
  const { sessionId } = await host.send(message(ALPHA, "one"));
  await waitUntil(() => created[0]);
  created[0].emit({ type: "session-started", nativeId: "claude-1" });
  created[0].emit({ type: "turn-started", turnId: "t1" });
  created[0].emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 2);
  await host.send(message(ALPHA, "two", { sessionId, provider: "codex", model: "gpt-6" }));
  const codex = await waitUntil(() => created.find((item) => item.provider === "codex" && item.turns.length));
  codex.emit({ type: "session-started", nativeId: "codex-1" });
  codex.emit({ type: "turn-started", turnId: "t1" });
  codex.emit({ type: "turn-completed" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 5);

  await host.send(message(ALPHA, "three", { sessionId }));
  const back = await waitUntil(() => created.filter((item) => item.provider === "claude").at(-1)?.options.resumeId === "claude-1" && created.at(-1));
  await waitUntil(() => back.turns.length);
  const state = saved.get(ALPHA);
  assert.equal(back.turns[0].prompt, "CATCH-UP\n\nthree");
  assert.deepEqual(state.sessions[sessionId].native_sessions, { codex: "codex-1" });
  assert.equal(state.sessions[sessionId].native_session_id, "claude-1");
  assert.equal(briefs.at(-1).catchUp, true);
  assert.match(briefs.at(-1).transcript, /Earlier messages are left out/);
  assert.doesNotMatch(briefs.at(-1).transcript, /## User\n\none/);
});

test("a model change on the same provider adds no divider", async (t) => {
  const { host, manager, saved, session } = harness();
  t.after(() => manager.closeAll());
  const sessionId = await chatWithReply(host, session, saved);
  await host.send(message(ALPHA, "again", { sessionId, model: "claude-sonnet-5-5" }));
  await waitUntil(() => session(ALPHA).turns.length === 2);
  await host.states.flush();
  assert.deepEqual(dividers(saved.get(ALPHA), sessionId), []);
  assert.equal(session(ALPHA).turns[1].prompt, "again");
});

test("a message that steers a running turn stays on its provider and adds no divider", async (t) => {
  const { host, manager, saved, session } = harness();
  t.after(() => manager.closeAll());
  const sessionId = await chatWithReply(host, session, saved);
  await host.send(message(ALPHA, "next", { sessionId }));
  await waitUntil(() => session(ALPHA).turns.length === 2);
  session(ALPHA).emit({ type: "turn-started", turnId: "t2" });
  await host.send(message(ALPHA, "and use codex", { sessionId, provider: "codex", model: "gpt-6" }));
  await waitUntil(() => session(ALPHA).turns.length === 3);
  await host.states.flush();
  assert.deepEqual(dividers(saved.get(ALPHA), sessionId), []);
  assert.equal(saved.get(ALPHA).sessions[sessionId].provider, "claude");
});

test("a send after a failed resume restores context with a whole-chat brief", async (t) => {
  const { host, manager, saved, session, created } = harness({
    handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: async ({ catchUp }) => (catchUp ? "CATCH-UP" : "WHOLE") },
  });
  t.after(() => manager.closeAll());
  const sessionId = await chatWithReply(host, session, saved);
  session(ALPHA).emit({ type: "session-reset" });
  await host.states.flush();
  await host.send(message(ALPHA, "again", { sessionId }));
  await waitUntil(() => created.at(-1).turns.at(-1)?.prompt === "WHOLE\n\nagain");
  await host.states.flush();
  assert.deepEqual(
    dividers(saved.get(ALPHA), sessionId).map(({ from, to, status }) => [from.provider, to.provider, status]),
    [["claude", "claude", "done"]],
  );
});

test("a first turn that failed before its session started is resent with no restore", async (t) => {
  const { host, manager, saved, session } = harness();
  t.after(() => manager.closeAll());
  const { sessionId } = await host.send(message(ALPHA, "one"));
  await waitUntil(() => session(ALPHA));
  session(ALPHA).emit({ type: "turn-started", turnId: "t1" });
  session(ALPHA).emit({ type: "turn-failed", message: "claude not found" });
  await waitUntil(() => saved.get(ALPHA)?.messages.length === 2);
  await host.send(message(ALPHA, "one again", { sessionId }));
  await waitUntil(() => session(ALPHA).turns.length === 2);
  await host.states.flush();
  assert.deepEqual(dividers(saved.get(ALPHA), sessionId), []);
});

test("stopping while the brief is written fails the divider, cancels the turn and starts no agent", async (t) => {
  let release;
  const { host, manager, saved, session, created } = harness({
    handoverTools: { writeTranscript: async () => "/tmp/t.md", brief: () => new Promise((resolve) => (release = resolve)) },
  });
  t.after(() => manager.closeAll());
  const sessionId = await chatWithReply(host, session, saved);
  await host.send(message(ALPHA, "switch", { sessionId, provider: "codex", model: "gpt-6" }));
  await waitUntil(() => release);
  assert.equal(await host.cancelHandoff(`${ALPHA}#${sessionId}`), true);
  release("LATE");
  await waitUntil(() => saved.get(ALPHA).messages.some((item) => item.outcome === "cancelled"));
  await host.states.flush();
  assert.deepEqual(dividers(saved.get(ALPHA), sessionId).map(({ status }) => status), ["failed"]);
  assert.equal(created.some((item) => item.provider === "codex"), false);
  assert.equal(session(ALPHA).interrupts, 0);
});

test("a divider left preparing by a quit is marked failed on the next open", async (t) => {
  const { host, manager, states, saved } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({
    ...state,
    next_id: 9,
    sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "codex" } },
    messages: [{ id: 8, session_id: 7, role: "assistant", body: "", context: { kind: "handoff", from: { provider: "claude" }, to: { provider: "codex" }, status: "preparing" } }],
  }));
  await host.states.flush();
  await host.recoverHandoffs(ALPHA, saved.get(ALPHA));
  await host.states.flush();
  assert.deepEqual(dividers(saved.get(ALPHA), 7).map(({ status }) => status), ["failed"]);
});
```

Update `chatWithReply` so its chat has a native session like a real one, or every later send in a test that uses it would count as a restore. Add after its `turn-started` emit:

```js
  session(ALPHA).emit({ type: "session-started", nativeId: "claude-1" });
```

Delete the old handover tests: every `test(...)` from `"handover opens a linked chat..."` (`:347`) through `"a handover that finished with a draft is not interrupted on the next open"` (ends after `:605`), and the `handedOver` helper. Keep `chatWithReply`. Keep one legacy test, rewritten:

```js
test("a legacy handover draft is still sent with the chat's first message", async (t) => {
  const { host, manager, states, saved, session } = harness();
  t.after(() => manager.closeAll());
  await states.update(ALPHA, (state) => ({
    ...state,
    next_id: 9,
    sessions: { 7: { id: 7, worktree_id: 1, agent_name: "main", status: "Created", provider: "claude", handedOverFrom: 3, handoverDraft: "BRIEF" } },
  }));
  await host.send(message(ALPHA, "go", { sessionId: 7 }));
  await waitUntil(() => session(ALPHA)?.turns.length);
  await host.states.flush();
  assert.equal(session(ALPHA).turns[0].prompt, "BRIEF\n\ngo");
  assert.equal(saved.get(ALPHA).sessions[7].handoverDraft, undefined);
});
```

Note on the "steer" test: `waitUntil` returns the predicate's truthy value; if `test-helpers.cjs`'s `waitUntil` returns nothing, replace `const x = await waitUntil(() => y)` with `await waitUntil(() => y); const x = y;` throughout.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test packages/core/src/agents/chat-host.test.cjs`
Expected: the new handoff tests FAIL (no divider, `cancelHandoff` / `recoverHandoffs` undefined); the legacy-draft test passes.

- [ ] **Step 3: Implement in `chat-host.cjs`**

Imports (top of file):

```js
const { catchUpStart, handoffKind, isHandoff, lastTurnProvider } = require("@milagre/shared/handoff");
const { renderTranscript } = require("./handover.cjs");
```

(Drop `providerName` from the `handover.cjs` import and `chatTitle` from `@milagre/shared/chats` if nothing else uses them after the removals below.)

Constructor: replace `this.pendingHandovers = new Map();` with:

```js
    // Chats whose handoff brief is being written, by chat key; Stop aborts it (see cancelHandoff).
    this.preparing = new Map();
```

Update the `starterChat` comment and filter: keep the legacy checks (`!item.handoverPending && item.handoverDraft === undefined`) since old data may hold them.

In `send()`, inside the `states.update` callback, after `const started = ...; session = started.session;` and before building `message`, decide the handoff. A run already streaming means this message steers, so it never hands off:

```js
      const chatId = chatKey(projectPath, session.id);
      handoff = this.runs[chatId] ? null : handoffKind(latest, session.id, provider);
```

Declare `let handoff = null; let dividerId = null; let catchUp = null;` next to `let brief;`. Move the existing `const chatId = chatKey(projectPath, session.id);` up so it's computed once.

When `handoff` is set, build the divider and the session swap. Replace the `stagedSession = {...}` and the `return {...}` of that callback with:

```js
      const previous = handoff === "switch" ? lastTurnProvider(latest, session.id) : provider;
      if (handoff) {
        catchUp = handoff === "switch" ? catchUpStart(latest, session.id, provider) : null;
        dividerId = next.next_id;
        message.id = next.next_id + 1;
        pendingId = message.id;
      }
      const parked = { ...session.native_sessions };
      if (handoff === "switch" && session.native_session_id) parked[previous] = session.native_session_id;
      const resumeId = handoff === "switch" ? parked[provider] : session.native_session_id;
      if (handoff === "switch") delete parked[provider];
      stagedSession = {
        ...withoutDraft(session),
        provider,
        ...(handoff === "switch" ? { native_sessions: parked } : {}),
        ...(firstMessage && body?.trim() && !session.title && !session.generatedTitle ? { titlePending: true } : {}),
      };
      if (handoff === "switch") {
        if (resumeId) stagedSession.native_session_id = resumeId;
        else delete stagedSession.native_session_id;
        if (!Object.keys(parked).length) delete stagedSession.native_sessions;
      }
      target = { chatId, sessionId: session.id, cwd: worktree.path, resumeId };
      const divider = handoff && {
        id: dividerId,
        session_id: session.id,
        body: "",
        role: "assistant",
        context: { kind: "handoff", from: { provider: previous, model: lastUserModel(latest, session.id) || undefined }, to: { provider, model }, status: "preparing" },
      };
      return {
        ...next,
        next_id: message.id + 1,
        sessions: { ...next.sessions, [session.id]: stagedSession },
        messages: [...next.messages, ...(divider ? [divider] : []), message],
      };
```

(import `lastUserModel` from `@milagre/shared/agent-runs` alongside the existing names). Drop `undefined` model keys before saving so the test's `deepEqual` matches: build `from` as `{ provider: previous, ...(fromModel ? { model: fromModel } : {}) }`.

In the flush-failure rollback, also remove the divider and restore the swapped fields:

```js
        for (const field of ["provider", "titlePending", "handoverDraft", "resumeTurn", "native_session_id", "native_sessions"]) {
```

and filter `messages: latest.messages.filter((message) => message.id !== pendingId && message.id !== dividerId)`.

In the second `states.update` (the one that applies `message-sent`), the pending message is re-appended after the split; re-append the divider before it the same way:

```js
      const divider = latest.messages.find((item) => item.id === dividerId);
      const withoutPending = { ...latest, messages: latest.messages.filter((item) => item.id !== pendingId && item.id !== dividerId) };
      // ...applyAgentEvent unchanged...
      return { ...sent.state, messages: [...sent.state.messages, ...(divider ? [divider] : []), message] };
```

Then replace the block from `const turn = {` to the `startTurn(...)` call with:

```js
    const turn = {
      provider,
      model,
      permissionMode: request.permissionMode,
      effort: request.effort,
      ultracode: request.ultracode,
      fastMode: request.fastMode,
      replies: request.replies,
      tldrEnabled: request.tldrEnabled,
      prompt:
        brief !== undefined
          ? [brief, request.prompt || body].filter((part) => part?.trim()).join("\n\n")
          : request.prompt || body || "Describe the attached images.",
    };
    this.turns.set(target.chatId, turn);
    const ready = handoff ? this.prepareHandoff(projectPath, target, state, { dividerId, catchUp, from: state.messages.find((item) => item.id === dividerId).context.from.provider }) : Promise.resolve("");
    const started = ready
      .then((handoffBrief) => {
        if (handoffBrief === null) return null;
        const prompt = handoffBrief ? [handoffBrief, turn.prompt].filter((part) => part?.trim()).join("\n\n") : turn.prompt;
        this.turns.set(target.chatId, { ...turn, prompt });
        return this.startTurn({ ...turn, prompt, ...execution, chatId: target.chatId, cwd: target.cwd, images, resumeId: target.resumeId });
      })
      .catch((error) => {
        void this.receive(target.chatId, { type: "turn-failed", message: ipcErrorMessage(error) });
        return null;
      });
```

Add the methods (replacing `handover`, `completeHandover`, `settleHandover`, `setHandoverDraft`, `recoverHandovers`):

```js
  /**
   * Writes the transcript and the brief for a handoff, then marks its divider done. Resolves with the brief, or
   * null when Stop cancelled it (the divider is failed and the turn cancelled by then).
   */
  async prepareHandoff(projectPath, target, state, { dividerId, catchUp, from }) {
    const controller = new AbortController();
    this.preparing.set(target.chatId, controller);
    const aborted = new Promise((resolve) => controller.signal.addEventListener("abort", () => resolve(null), { once: true }));
    try {
      const session = state.sessions[target.sessionId];
      const transcriptPath = await this.handoverTools.writeTranscript({ projectPath, sessionId: target.sessionId, markdown: renderTranscript(state, target.sessionId) });
      const lastUserMessage =
        state.messages.filter((item) => item.session_id === target.sessionId && item.role === "user" && item.id < dividerId && item.body?.trim()).at(-1)?.body ?? "";
      const handoffBrief = await Promise.race([
        aborted,
        this.handoverTools.brief({
          projectPath,
          transcript: renderTranscript(state, target.sessionId, { after: catchUp ?? undefined }),
          transcriptPath,
          provider: from,
          catchUp: catchUp != null,
          lastUserMessage,
          worktrees: session.worktrees,
          cwd: target.cwd,
        }),
      ]);
      if (handoffBrief === null || controller.signal.aborted) return null;
      await this.updateDivider(projectPath, dividerId, { status: "done", brief: handoffBrief, transcriptPath });
      return handoffBrief;
    } finally {
      this.preparing.delete(target.chatId);
    }
  }

  async updateDivider(projectPath, dividerId, patch) {
    const { state, changed } = await this.states.update(projectPath, (latest) => {
      const divider = latest.messages.find((item) => item.id === dividerId);
      if (!isHandoff(divider)) return latest;
      return { ...latest, messages: latest.messages.map((item) => (item === divider ? { ...item, context: { ...item.context, ...patch } } : item)) };
    });
    if (changed) this.broadcast(projectPath, state);
  }

  /** Stop while a handoff brief is written: no agent session runs yet, so the turn is cancelled here. Resolves true when there was one. */
  async cancelHandoff(chatId) {
    const controller = this.preparing.get(chatId);
    if (!controller) return false;
    controller.abort();
    const projectPath = projectOfKey(chatId);
    const state = await this.states.get(projectPath);
    const divider = state.messages.findLast((item) => item.session_id === sessionIdFromKey(chatId) && isHandoff(item));
    if (divider) await this.updateDivider(projectPath, divider.id, { status: "failed" });
    await this.receive(chatId, { type: "turn-cancelled" });
    return true;
  }

  /** On open: a divider still preparing was cut off by a quit and is failed; a legacy handover still pending is settled. */
  async recoverHandoffs(projectPath, state) {
    const { state: next, changed } = await this.states.update(projectPath, (latest) => {
      let sessions = latest.sessions;
      for (const session of Object.values(latest.sessions)) {
        if (!session.handoverPending) continue;
        const { handoverPending: _pending, ...rest } = session;
        sessions = { ...sessions, [session.id]: rest };
      }
      const messages = latest.messages.map((item) =>
        isHandoff(item) && item.context.status === "preparing" && !this.preparing.has(chatKey(projectPath, item.session_id))
          ? { ...item, context: { ...item.context, status: "failed" } }
          : item,
      );
      const touched = sessions !== latest.sessions || messages.some((item, index) => item !== latest.messages[index]);
      return touched ? { ...latest, sessions, messages } : latest;
    });
    if (changed) this.broadcast(projectPath, next);
  }
```

`state` (the parameter of `recoverHandoffs`) is unused; keep it in the signature so call sites stay the same shape, prefixed `_state`.

`renderTranscript` needs `state.worktrees`; the state passed to `prepareHandoff` is the full project state from the `states.update` result, so that holds.

Does `ProjectStates` have `get`? It's used in `recoverSubagents` (`this.states.get(projectPath)`), so yes.

- [ ] **Step 4: Run tests**

Run: `node --test packages/core/src/agents/chat-host.test.cjs packages/core/src/agents/handover.test.cjs`
Expected: all pass. If "switching back" fails on `created.filter(...)` timing, check that `SessionManager.currentEntry` received `resumeId: "claude-1"` (it does when `provider` differs from the live entry).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/chat-host.cjs packages/core/src/agents/chat-host.test.cjs
git commit -m "feat(core): hand a chat off to the other provider in place"
```

---

### Task 4: Runtime wiring and removal of the old handover IPC

**Files:**
- Modify: `packages/core/src/runtime.cjs:296,723-730,783-787`
- Modify: `packages/core/src/link-runtime.cjs:33`
- Modify: `apps/daemon/src/mobile-bridge.cjs:139-140` (+ `mobile-bridge.test.cjs`)
- Modify: `packages/shared/src/chats.mjs` comment only; `packages/shared/src/chats.test.ts` unchanged (legacy chats still list)
- Test: `packages/core/src/runtime.test.cjs`

**Interfaces:**
- Consumes: `ChatHost.cancelHandoff`, `ChatHost.recoverHandoffs` (Task 3).

- [ ] **Step 1: Write the failing test** in `runtime.test.cjs`. Find the existing test that exercises `chat:handover` (`git grep -n "chat:handover" packages/core/src/runtime.test.cjs`) and replace it with:

```js
test("chat:handover is gone and agent:interrupt stops a handoff that is still preparing", async (t) => {
  // Use the file's existing runtime harness (the same one the replaced test used) to get `commands` and `chats`.
  const { commands, chats } = await runtimeHarness(t);
  assert.equal(commands.has("chat:handover"), false);
  assert.equal(commands.has("chat:handover-draft"), false);
  let cancelled = null;
  chats.cancelHandoff = async (chatId) => ((cancelled = chatId), true);
  await commands.invoke("agent:interrupt", "/projects/alpha#2");
  assert.equal(cancelled, "/projects/alpha#2");
});
```

Adapt `runtimeHarness`, `commands.has` and `commands.invoke` to the names the file already uses (read the replaced test first). If the file exposes no `chats` instance, assert only the two `has(...) === false` lines and cover interrupt in the Electron check (Task 6).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test packages/core/src/runtime.test.cjs`
Expected: FAIL, `chat:handover` still registered.

- [ ] **Step 3: Implement**

`runtime.cjs`:
- Delete the `chat:handover` and `chat:handover-draft` handlers (`:723-730`).
- In `agent:interrupt` (`:783`), first line: `if (await chats.cancelHandoff(chatId)) return;`
- `:296`: `void chats.recoverHandoffs(projectPath, state).catch((error) => console.warn("Milagre couldn't recover a handoff:", error.message));`

`link-runtime.cjs:33`: `void chats.recoverHandoffs(key, state).catch(() => {});`

`mobile-bridge.cjs:139-140`: the phone never edits drafts now; send sessions as they are, minus subagents:

```js
      const { subagents, ...metadata } = session;
      return [id, metadata];
```

Update `mobile-bridge.test.cjs`'s assertion on `handoverDraft: ""` to expect the field untouched (or absent in its fixture).

- [ ] **Step 4: Run tests**

Run: `npm test -- --unit --only runtime && npm test -- --unit --only mobile-bridge && npm test -- --unit --only chat-host`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core apps/daemon
git commit -m "feat(core): stop a preparing handoff and drop the handover IPC"
```

---

### Task 5: Desktop: divider, unlocked picker, old UI removed

**Files:**
- Rewrite: `apps/desktop/app/src/components/Handover.tsx`
- Modify: `apps/desktop/app/src/lib/handover.ts`, `apps/desktop/app/src/lib/handover.test.ts`
- Modify: `apps/desktop/app/src/components/ChatComposer.tsx:31-33,138-163,301-316,364-371,603-607,652-656,722-749,805,826-847`
- Modify: `apps/desktop/app/src/components/PromptComposer.tsx:14-15,53-59,150-153,185-192,256,503-521,675,729-730`
- Modify: `apps/desktop/app/src/App.tsx:75,235-240,450-451,1092-1122,1195,1222,1233-1258,1870-1908`
- Modify: `apps/desktop/app/src/components/LinkWorkspace.tsx:31,262,303-324,466-484`
- Modify: `apps/desktop/electron/preload.cjs:117-118`, `apps/desktop/app/src/electron.d.ts:24,224-226`
- Modify: `apps/desktop/app/src/components/Attachments.tsx:12`, `apps/desktop/app/src/lib/modal.ts:3` (comments)

**Interfaces:**
- Consumes: `HandoffContext`, `isHandoff` (Task 1).
- Produces: `HandoffDivider({ context, models })` component; `handoffLabel(context, models): { from: string; to: string; restored: boolean }` in `lib/handover.ts`.

- [ ] **Step 1: Write the failing test** — replace `apps/desktop/app/src/lib/handover.test.ts` with:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { HandoffContext, ModelOption } from "../model";
import { handoffLabel, providerLabel } from "./handover.ts";

const models: ModelOption[] = [
  { id: "claude-opus-5-5", name: "Opus 5.5", provider: "claude", description: "" },
  { id: "gpt-6", name: "GPT-6", provider: "codex", description: "" },
];
const context = (from: HandoffContext["from"], to: HandoffContext["to"]): HandoffContext => ({ kind: "handoff", from, to, status: "done" });

test("a divider names each side by model when the catalog knows it, else by provider", () => {
  assert.deepEqual(handoffLabel(context({ provider: "claude", model: "claude-opus-5-5" }, { provider: "codex", model: "gpt-6" }), models), {
    from: "Opus 5.5",
    to: "GPT-6",
    restored: false,
  });
  assert.deepEqual(handoffLabel(context({ provider: "claude", model: "gone" }, { provider: "codex" }), models), { from: "Claude", to: "Codex", restored: false });
});

test("a divider on one provider is a restore", () => {
  assert.equal(handoffLabel(context({ provider: "claude" }, { provider: "claude" }), models).restored, true);
  assert.equal(providerLabel("codex"), "Codex");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test apps/desktop/app/src/lib/handover.test.ts`
Expected: FAIL, `handoffLabel` not exported.

- [ ] **Step 3: Rewrite `apps/desktop/app/src/lib/handover.ts`**

```ts
import { providerName } from "@milagre/shared/providers";
import type { HandoffContext, ModelOption } from "../model";

export const providerLabel = providerName;

/** The two sides of a handoff divider: each side's model name from the catalog, else its provider's name. */
export function handoffLabel(context: HandoffContext, models: ModelOption[]): { from: string; to: string; restored: boolean } {
  const side = ({ provider, model }: HandoffContext["from"]) => models.find((item) => item.id === model)?.name ?? providerName(provider);
  return { from: side(context.from), to: side(context.to), restored: context.from.provider === context.to.provider };
}
```

(`isHandoverChat`, `handoverLinks`, `handoverModel`, `handoverBlocker`, `otherProvider`, `handoverNotes` go. Keep `isHandoverChat` imported directly from `@milagre/shared/chats` wherever chat lists still need it: `git grep -n isHandoverChat apps/desktop`.)

- [ ] **Step 4: Rewrite `apps/desktop/app/src/components/Handover.tsx`**

Keep `HandoverBriefDialog` as is but read-only only: delete the `onSave` / edit tab / Save+Cancel branches, keep Preview and Close, rename it `HandoffBriefDialog`, title `Handoff brief`, keep `data-brief-dialog`. Delete `HandoverRow`, `HandoverLinkBar`, `HandoverFromLabel`, `HandoverNote`, `HandoverBriefChip`. Add:

```tsx
/**
 * A provider switch inside the chat: a hairline with "Context handoff  Opus 5.5 → GPT-6" centred on it. It spins while
 * the brief is written, and opens the brief the new provider was sent.
 */
export function HandoffDivider({ context, models }: { context: HandoffContext; models: ModelOption[] }) {
  const [open, setOpen] = useState(false);
  const label = handoffLabel(context, models);
  const canOpen = context.status === "done" && Boolean(context.brief);
  return (
    <div data-handoff-divider data-status={context.status} className="flex w-full items-center gap-3 py-1 text-[12px] text-ink-3" role="separator">
      <span className="h-px flex-1 bg-line" />
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => setOpen(true)}
        aria-label={canOpen ? "Open the handoff brief" : undefined}
        className="flex items-center gap-1.5 rounded-control px-2 py-0.5 enabled:hover:bg-hover enabled:hover:text-ink disabled:cursor-default"
      >
        {context.status === "preparing" ? (
          <SpinnerRing size={12} />
        ) : (
          <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} size={13} strokeWidth={1.8} color="currentColor" />
        )}
        <span>{label.restored ? "Context restored" : "Context handoff"}</span>
        {!label.restored && (
          <>
            <ProviderLogo provider={context.from.provider} size={13} />
            <span>{label.from}</span>
            <span aria-hidden="true">→</span>
          </>
        )}
        <ProviderLogo provider={context.to.provider} size={13} />
        <span className="font-medium text-ink-2">{label.to}</span>
        {context.status === "failed" && <span className="text-orange">· Handoff failed</span>}
      </button>
      <span className="h-px flex-1 bg-line" />
      {open && context.brief && <HandoffBriefDialog brief={context.brief} transcriptPath={context.transcriptPath} onClose={() => setOpen(false)} />}
    </div>
  );
}
```

Imports: `ArrowDataTransferHorizontalIcon` from `@hugeicons/core-free-icons` (verify the name with `grep -o "ArrowDataTransferHorizontalIcon" node_modules/@hugeicons/core-free-icons/dist/esm/index.js | head -1`; if absent use `ArrowDataTransferHorizontalIcon`'s nearest match `ArrowLeftRightIcon`). `SpinnerRing`: use the spinner the sidebar uses for running chats (`git grep -n "export function SpinnerRing\|SpinnerRing" apps/desktop/app/src | head -3`); if there is none, use `ThinkingIndicator`'s dot from `ChatComposer`. In the dialog footer, add a secondary "Show transcript" button when `transcriptPath` is set that calls `window.milagre.revealPath(transcriptPath)` (check the preload for the existing reveal-in-Finder call: `git grep -n "reveal" apps/desktop/electron/preload.cjs`; use that name).

- [ ] **Step 5: Render it in `ChatComposer.tsx`**

In `MessageSection`, before the `<article>` return:

```tsx
  if (isHandoff(message)) return <HandoffDivider context={message.context} models={models} />;
```

Thread a `models: ModelOption[]` prop into `MessageSection` and `MessageTranscript` from `ChatComposer`'s existing `models` prop (it already passes models to `PromptComposer`). Delete: the `HandoverBriefChip` `leading` prop on `Attachments` (`:163`), `HandoverFromLabel` (`:722`), the "Preparing handover…" indicator (`:744-747`), `HandoverLinkBar` (`:749`), `HandoverNote` and `showHandoverNote` / `noteKey` (`:655-656,826-834`), and the props `lockedProvider`, `onHandover`, `canHandover`, `handoverBrief`, `handover` (`:364-371,603-607,844-847`). `isNewChat` becomes `messages.length === 0`. `provider={lockedProvider ?? selectedModel.provider}` (`:805`) becomes `provider={selectedModel.provider}`.

- [ ] **Step 6: Unlock `PromptComposer.tsx`**

- Remove props `lockedProvider`, `onHandover`, `canHandover`, `handoverBrief` and their imports.
- `useState<ModelProvider>(selectedModel.provider)`; the two `setProvider(lockedProvider ?? ...)` become `setProvider(selectedModel.provider)`; drop `lockedProvider` from the effect deps.
- `canSend` drops `|| handoverBrief !== undefined`.
- The picker `header` is always the provider tabs. Each tab is disabled only by its CLI problem:

```tsx
                    disabled={Boolean(cliMessage(cliStatus?.[item]))}
                    title={cliMessage(cliStatus?.[item]) ?? undefined}
```

- Placeholder at `:729-730`: drop the `handoverBrief && lockedProvider` branch.

- [ ] **Step 7: Clean up `App.tsx` and `LinkWorkspace.tsx`**

`App.tsx`: remove `lockedProviderRef` and its use in `nextSelection` (`:235-240,451`), `handoverDraft` and `briefAttached` (`:450,1092,1122,1195,1222`), the `handover()` function (`:1233-1258`), `sendBlocked`'s `handoverPending` term, and the props at `:1885-1908`. Keep the import of `isHandoverChat` only if the chat list still uses it.

When the selected chat changes, the picker should show the chat's current provider and model. `nextSelection` handled that through `lockedProvider`; replace it by passing the chat's provider as the preferred provider:

```ts
nextSelection(models, current, { defaultId: getSettings().defaultModelId, applyDefault, preferredProvider: selectedSessionRef.current?.provider })
```

Read `nextSelection` (`git grep -n "export function nextSelection" apps/desktop/app/src`) and rename its `lockedProvider` option to `preferredProvider` with the same behavior (pick that provider's model when the current selection is on another provider and the chat has messages). Update its unit test's option name.

`LinkWorkspace.tsx`: remove the `handover` import, `handover()` (`:303-324`), the `handoverDraft` term at `:262`, and the props at `:466-484`.

`preload.cjs:117-118` and `electron.d.ts:24,224-226`: delete `handover`, `setHandoverDraft`, `ChatHandoverRequest`.

Comments in `Attachments.tsx:12` and `modal.ts:3`: drop the handover examples.

- [ ] **Step 8: Typecheck, lint, unit tests**

Run: `npm run typecheck && npm run lint && npm test -- --unit`
Expected: all pass. Fix every remaining reference typecheck reports.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): context handoff divider and an unlocked provider picker"
```

---

### Task 6: Desktop Electron check

**Files:**
- Rewrite: `scripts/test-handover.cjs`
- Modify: `scripts/test-desktop.cjs:129-130,313-315`

**Interfaces:**
- Consumes: the desktop UI from Task 5 (`[data-handoff-divider]`, `[data-brief-dialog]`).

- [ ] **Step 1: Read the current check** (`scripts/test-handover.cjs`) for its harness: how it launches Electron with a fake agent, seeds a project, sends, and saves screenshots with `MILAGRE_SCREENSHOT_DIR`. Keep that harness.

- [ ] **Step 2: Rewrite the scenario**

1. Seed a chat with one Claude user message and a completed reply.
2. Open the model picker, assert both provider tabs are enabled, click Codex, pick its first model, close.
3. Type "add tests" and send.
4. Assert `[data-handoff-divider][data-status="preparing"]` appears before the "add tests" message (compare `compareDocumentPosition`), screenshot `preparing.png`. The fake brief should resolve after ~500ms so the state is visible.
5. Wait for `[data-status="done"]`, assert its text contains `Context handoff` and both model names, screenshot `done.png`.
6. Click it, assert `[data-brief-dialog]` shows the fake brief, screenshot `brief.png`, press Escape.
7. Assert the fake agent's last turn was on `codex` with a prompt starting with the brief.

`scripts/test-desktop.cjs:129-130,313-315`: drop the `handoverDraft` fixture and assertion (keep `native_session_id`).

- [ ] **Step 3: Run it**

Run: `MILAGRE_SCREENSHOT_DIR=$TMPDIR/in-place-handoff npm test -- --only handover && npm test -- --only desktop`
Expected: PASS, three PNGs in `$TMPDIR/in-place-handoff`. Look at each screenshot before moving on.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-handover.cjs scripts/test-desktop.cjs
git commit -m "test(desktop): Electron check for the in-place handoff"
```

---

### Task 7: Mobile: divider, unlocked picker, picked provider sent

**Files:**
- Create: `apps/mobile/src/handoff-divider.tsx`
- Modify: `apps/mobile/src/app/chat.tsx:270-276,338-346,682-697,962-975`
- Modify: `apps/mobile/src/app/model-sheet.tsx:17-23,64-85`
- Test: `apps/mobile/src/chat-presentation.test.ts` (or a new `handoff-divider.test.ts` if `chat-presentation.ts` is the wrong home)

**Interfaces:**
- Consumes: `isHandoff` from `@milagre/shared/handoff`; `HandoffContext`.
- Produces: `HandoffDivider({ context, models, onOpen })`; `handoffSides(context, models)` (pure, tested).

- [ ] **Step 1: Write the failing test** in `apps/mobile/src/handoff-divider.test.ts`

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { handoffSides } from "./handoff-sides.ts";

const models = [
  { id: "claude-opus-5-5", name: "Opus 5.5", provider: "claude" as const },
  { id: "gpt-6", name: "GPT-6", provider: "codex" as const },
];

test("each side shows its model name, else its provider", () => {
  assert.deepEqual(
    handoffSides({ kind: "handoff", from: { provider: "claude", model: "claude-opus-5-5" }, to: { provider: "codex", model: "nope" }, status: "done" }, models),
    { from: "Opus 5.5", to: "Codex", restored: false },
  );
});
```

Check the shape of `session.models` on mobile first (`git grep -n "models:" apps/mobile/src/client.ts | head`) and match the test's model objects to it.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test apps/mobile/src/handoff-divider.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `apps/mobile/src/handoff-sides.ts`**

```ts
import { providerName } from "@milagre/shared/providers";
import type { HandoffContext } from "@milagre/shared/model";

/** The two sides of a handoff divider: each side's model name, else its provider's. Same rule as desktop's handoffLabel. */
export function handoffSides(context: HandoffContext, models: { id: string; name: string }[]) {
  const side = ({ provider, model }: HandoffContext["from"]) => models.find((item) => item.id === model)?.name ?? providerName(provider);
  return { from: side(context.from), to: side(context.to), restored: context.from.provider === context.to.provider };
}
```

- [ ] **Step 4: Implement `apps/mobile/src/handoff-divider.tsx`**

```tsx
import { Pressable, Text, View } from "react-native";
import type { HandoffContext } from "@milagre/shared/model";
import { ArrowDataTransferHorizontalIcon } from "@hugeicons/core-free-icons";
import { colors } from "./theme";
import { Icon, ProviderLogo, SpinnerRing } from "./icons";
import { handoffSides } from "./handoff-sides";

/** A provider switch inside the Chat, as on desktop. Tapping it opens the brief the new provider was sent. */
export function HandoffDivider({ context, models, onOpen }: { context: HandoffContext; models: { id: string; name: string }[]; onOpen: (brief: string) => void }) {
  const sides = handoffSides(context, models);
  const canOpen = context.status === "done" && !!context.brief;
  return (
    <Pressable
      accessibilityRole={canOpen ? "button" : undefined}
      accessibilityLabel={sides.restored ? `Context restored on ${sides.to}` : `Context handoff from ${sides.from} to ${sides.to}`}
      disabled={!canOpen}
      onPress={() => context.brief && onOpen(context.brief)}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {context.status === "preparing" ? <SpinnerRing size={12} /> : <Icon icon={ArrowDataTransferHorizontalIcon} tone="ink3" size={12} />}
        <Text style={{ color: colors.ink3, fontSize: 12 }}>{sides.restored ? "Context restored" : "Context handoff"}</Text>
        {!sides.restored && (
          <>
            <ProviderLogo provider={context.from.provider} size={12} />
            <Text style={{ color: colors.ink3, fontSize: 12 }}>{sides.from} →</Text>
          </>
        )}
        <ProviderLogo provider={context.to.provider} size={12} />
        <Text style={{ color: colors.ink2, fontSize: 12, fontWeight: "500" }}>{sides.to}</Text>
        {context.status === "failed" && <Text style={{ color: colors.orange, fontSize: 12 }}>· Failed</Text>}
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
    </Pressable>
  );
}
```

Match `colors` key names and the `theme` import path to what `chat-reply.tsx` imports (`git grep -n "^import" apps/mobile/src/chat-reply.tsx`). `SpinnerRing` and `ProviderLogo` are in `src/icons.tsx` (used by `usage-section.tsx`).

- [ ] **Step 5: Wire it into `chat.tsx`**

- Transcript map (`:682-697`): inside the `<View key=... nativeID=...>`, render `isHandoff(message) ? <HandoffDivider context={message.context} models={session.models} onOpen={openBrief} /> : <ChatReply ... />`.
- `openBrief`: push a sheet showing the brief as Markdown. Reuse the activity sheet route if it takes text; otherwise add `src/app/handoff-brief.tsx` as a form-sheet route rendering `<Markdown text={brief} />` inside a `ScrollView`, with the brief passed through a module-level store (the way `composer` stores are used) rather than route params, since briefs run to 400 words.
- Provider (`:274`): `const actualProvider = composer.preferences[chatId]?.provider ?? chat?.provider ?? composer.defaults.provider;` and keep `model` derived as now.
- Model sheet push (`:971`): drop `...(chat?.provider ? { locked: chat.provider } : {})`.

`model-sheet.tsx`: delete `locked` from params and `initial`, and the `off` logic in the provider tabs (no `disabled`, no `accessibilityHint`).

- [ ] **Step 6: Typecheck and test**

Run: `npm run typecheck:mobile && node --test apps/mobile/src/handoff-divider.test.ts && npm test -- --unit --workspace @milagre/mobile`
Expected: all pass.

- [ ] **Step 7: Verify on a simulator**

1. Load the `argent-ios-simulator-setup` and `argent-device-interact` skills. `simslim list`, then pick a booted slim simulator, `simslim on <udid> --except widgets,icloud,web` if it isn't, and attach it with milagre `simulator_attach`.
2. Run the mobile dev app against the dev desktop from this worktree (`apps/mobile/AGENTS.md` has the command).
3. Open a chat with a Claude reply, open the model sheet, pick Codex, send "add tests".
4. Screenshot the preparing divider, then the done divider, then the brief sheet.

- [ ] **Step 8: Check the fingerprint is unchanged**

Run the fingerprint check from `apps/mobile/AGENTS.md`. Expected: same fingerprint as the TestFlight build. If it changed, stop and ask before going further.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): context handoff divider and switching provider in a chat"
```

---

### Task 8: Full checks and PR

- [ ] **Step 1:** `npm run typecheck && npm run typecheck:mobile && npm run lint && npm test -- --unit && npm test -- --only handover`. All must pass.
- [ ] **Step 2:** Push the screenshots from Tasks 6 and 7 to the `screenshots` branch under `in-place-handoff/` via a temporary worktree, per AGENTS.md, and note the commit SHA.
- [ ] **Step 3:** Push the branch and open the PR with `gh pr create`. The body says what changed, that the old new-chat handover is removed, that mobile ships OTA (fingerprint unchanged), and links each screenshot as `https://raw.githubusercontent.com/the-ptf/milagre-ade/<sha>/in-place-handoff/<name>.png`. No Claude attribution.
