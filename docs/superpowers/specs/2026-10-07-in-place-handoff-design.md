# In-place provider handoff

Date: 2026-10-07. Status: approved design, awaiting spec review.

## Goal

Switching a chat between Claude and Codex happens in the same chat, the way T3 Code does it. The user picks
the other provider in the model picker and sends. A divider in the transcript reads
`⇆ Context handoff [icon] Claude Opus 4.x → [icon] GPT-5.x`, and the conversation continues. No second chat, no
brief to review.

This replaces the current handover (PR #111, #116, #123), which opens a linked chat on the other provider and
parks a model-written brief in its composer for review.

## Decisions

| Question | Decision |
| --- | --- |
| Old "new chat with this chat's context" flow | Removed. In-place switch is the only handoff. |
| What the new provider receives | The existing small-model brief plus a pointer to the full markdown transcript, prepended to the user's message. |
| Brief review | None. The divider shows the brief read-only when tapped. |
| Switching back to a provider used earlier | Resume that provider's own native session and send a catch-up brief covering only the messages since it last ran. |
| Divider position | Before the user's message that triggered the switch: divider, then the message, then the new provider's reply. |
| Platforms | Desktop and mobile in the same change. All JS; ships OTA, no native build. |

## Data model (`packages/shared/src/model.ts`)

`AgentSession`:

- `provider`: the provider currently in use (now changeable). Doc comment updated.
- `native_session_id` keeps its meaning: the native session of the current `provider`. About 20 files and tests
  read it, so it is not renamed.
- New `native_sessions?: Partial<Record<ModelProvider, string>>` parks the session ids of the providers the chat
  is not on right now. On a switch, the current id moves into the map under the old provider, and the target's
  parked id (if any) becomes `native_session_id`. No migration: old chats simply have no parked ids.
- `handedOverFrom`, `handedOverTo`, `handoverPending`, `handoverDraft` stay readable on old data and are no longer
  written. Old linked chats render as two ordinary chats. A leftover `handoverDraft` is still sent with that
  chat's first message, as today, but has no UI.

`ChatContext` gains:

```ts
type HandoffContext = {
  kind: "handoff";
  from: { provider: ModelProvider; model?: string };
  to: { provider: ModelProvider; model?: string };
  status: "preparing" | "done" | "failed";
  brief?: string;           // exactly what was prepended to the prompt
  transcriptPath?: string;
};
```

The literal `"handover"` context stays in the union for old notes.

`ChatMessage.handoverBrief` is no longer written; the brief lives on the divider.

## Where a provider stopped reading

No new field. The dividers already record every switch. The catch-up for provider P covers the messages after
the last divider whose `from.provider` is P (the point where P was switched away). If there is none, or P has no
parked session id, P gets a brief of the whole chat. The reducer (`agent-runs.mjs`) is unchanged: `session-started`
and `session-reset` act on `native_session_id`, which is always the current provider's.

`lastTurnProvider(state, sessionId)` (new, `packages/shared/src/handoff.mjs`): the `to.provider` of the chat's
last divider, else `session.provider` if the chat has any message, else undefined.

## Send flow (`packages/core/src/agents/chat-host.cjs`)

`send()` today stages the user message, then starts the turn with `resumeId: session.native_session_id`.

New behavior, when the session has messages and `request.provider !== lastTurnProvider`:

1. In the same state update that stages the user message, append the divider message first:
   `role: "assistant"`, `body: ""`, `context: { kind: "handoff", from, to, status: "preparing" }`. Then append
   the user message. Set `session.provider` to the target, park the current `native_session_id` under the old
   provider in `native_sessions`, and make the target's parked id (or none) the new `native_session_id`. The run is marked running at this point, so the
   composer shows the stop button and a second send queues as usual.
2. `send()` returns as it does today. The rest runs as the start of the turn:
   a. `writeTranscript` (existing, `handover.cjs`) writes the whole chat to the handovers directory.
   b. `generateBrief` (existing) runs with the source provider's small model on the messages after
      the catch-up start (see "Where a provider stopped reading"). For a catch-up, the system prompt says the reader already
      knows everything before that point. 30s timeout and the existing git-status fallback brief.
   c. Update the divider to `status: "done"`, `brief`, `transcriptPath`.
   d. `startTurn` with `prompt = brief + "\n\n" + typed text` and `resumeId` = the new `native_session_id`.
3. If the user stops the turn while it's preparing (`agent:interrupt` calls the new `chats.cancelHandoff(chatId)`
   first, because no session of the target provider is running yet), abort the brief, mark the divider `failed`, and end the turn as
   `cancelled`. The user message stays, as with any cancelled turn.
4. If a resume fails, the existing path runs unchanged: `session-reset` clears `native_session_id` and the turn
   fails with "Send your message again to continue in a fresh session." The next send sees a chat that has a
   completed assistant reply but no native session for its provider, and restores context: it adds a divider with
   `from.provider === to.provider` (label "Context restored") and a whole-chat brief.

Same-provider model changes keep working as today: no divider, `setModel` / per-turn `model`.

`SessionManager` (`session-manager.cjs:56-102`) needs no change: its `sameChat` key includes the provider, and on
a provider change it closes the old session and starts the new one with the `resumeId` the turn passes.

Recovery (`recoverHandovers`, `:570-580`): it is replaced by a startup pass that marks any divider still
`preparing` as `failed`. The interrupted turn is already handled by the existing quit/resume logic (PR #118).

Removed: `handover()`, `completeHandover()`, `settleHandover()`, `setHandoverDraft()`, the `chat:handover` and
`chat:handover-draft` IPC (`runtime.cjs:723-730`, `preload.cjs:117-118`) and the mobile bridge's
`handoverDraft` scrubbing. `handover.cjs` keeps `renderTranscript`, `writeTranscript`, `generateBrief`,
`createHandoverModels`.

## Desktop UI (`apps/desktop/app/src`)

- `PromptComposer.tsx`: provider tabs stay visible after the first message. The "Start a new chat to use X" lock
  and `HandoverRow` are removed. A provider tab is disabled only by the existing CLI health blocker
  (`handoverBlocker` minus the running-turn check, since a switch while running just queues).
- `App.tsx`: drop `lockedProvider` and `handover()`. The chosen provider/model goes out with the send as it
  already does.
- `ChatComposer.tsx` `MessageTranscript`: a `context.kind === "handoff"` message renders `HandoffDivider` (new,
  in `components/Handover.tsx` replacing the old components): a hairline across the transcript, centered label
  `⇆ Context handoff`, provider icon + model label for `from` → `to`. A spinner while `preparing`, muted
  "Handoff failed" when `failed`. Clicking it opens a popover with the brief, read-only, and an "Open transcript"
  action for `transcriptPath`.
- Removed: `HandoverBriefChip`, `HandoverFromLabel`, `HandoverLinkBar`, the "Preparing handover…" indicator, the
  `LinkWorkspace.tsx:303-324` handover path.

## Mobile UI (`apps/mobile`)

- `app/model-sheet.tsx` / `app/chat.tsx`: drop the `locked` provider prop. The send uses the picked provider.
- `app/chat.tsx` transcript: a handoff message renders a native `HandoffDivider` (same copy, provider icons from
  the existing icon set). Tapping it opens a sheet with the brief.
- No native modules or config changes. Verify with `fingerprint:compare` before publishing an OTA.

## Errors

| Case | Behavior |
| --- | --- |
| Target CLI missing or signed out | Tab disabled with the existing tooltip / reason. |
| Brief model fails or times out | Fallback brief (last request + `git status` files), divider still `done`. |
| Resume of the target's old session fails | Turn fails as today; the next send restores context with a whole-chat brief. |
| User stops during preparing | Divider `failed`, turn `cancelled`. |
| Quit during preparing | Divider `failed` on next launch; the turn follows quit/resume rules. |

## Testing

- `packages/core/src/agents/chat-host.test.cjs`: first switch (whole-chat brief, fresh session); switch back
  (catch-up range, resume id from `native_sessions`); same-provider model change adds no divider; the send after
  a failed resume restores context; stop while preparing.
- `packages/shared/src/handoff.test.ts`: `lastTurnProvider` and the catch-up range.
- `apps/desktop/app/src/lib/handover.test.ts`: updated for the reduced helpers.
- `scripts/test-handover.cjs`: rewritten for the Electron in-place switch, saving screenshots of the preparing
  and done divider and the brief popover.
- Mobile: run the switch on a slim iOS simulator with argent and screenshot the divider and brief sheet.
- Before the PR: `npm run typecheck`, `npm run lint`, `npm test -- --unit`, `npm test -- --only handover`.

## Out of scope

- More than two providers (the design is keyed by provider, so a third works without schema changes).
- Editing the brief.
- Handoff across worktrees or into Link chats.
