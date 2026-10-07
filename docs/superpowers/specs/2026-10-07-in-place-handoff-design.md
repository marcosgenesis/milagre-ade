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
- `native_session_id` is replaced by `native_sessions?: Partial<Record<ModelProvider, string>>`.
- New `seen_through?: Partial<Record<ModelProvider, number>>`: the id of the last message that provider saw,
  either as its own turn or inside a brief.
- `handedOverFrom`, `handedOverTo`, `handoverPending`, `handoverDraft` stay readable on old data and are no longer
  written. Old linked chats render as two ordinary chats.

Migration on load (wherever project state is normalized): a session with `native_session_id` and `provider`
gets `native_sessions = { [provider]: native_session_id }`, and `seen_through[provider]` = its last message id.
The old field is dropped on the next write.

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

## Reducer (`packages/shared/src/agent-runs.mjs`)

- `session-started { nativeId }` writes `native_sessions[turn provider]`.
- `session-reset` clears only `native_sessions[turn provider]`.
- When a turn completes, set `seen_through[turn provider]` to the id of its last message.
- `lastUserModel` is unchanged. Add `lastTurnProvider(state, sessionId)`, the provider of the last
  non-handoff turn, which decides whether a send is a switch.

## Send flow (`packages/core/src/agents/chat-host.cjs`)

`send()` today stages the user message, then starts the turn with `resumeId: session.native_session_id`.

New behavior, when the session has messages and `request.provider !== lastTurnProvider`:

1. In the same state update that stages the user message, append the divider message first:
   `role: "assistant"`, `body: ""`, `context: { kind: "handoff", from, to, status: "preparing" }`. Then append
   the user message. Set `session.provider` to the target. The run is marked running at this point, so the
   composer shows the stop button and a second send queues as usual.
2. `send()` returns as it does today. The rest runs as the start of the turn:
   a. `writeTranscript` (existing, `handover.cjs`) writes the whole chat to the handovers directory.
   b. `generateBrief` (existing) runs with the source provider's small model on the messages after
      `seen_through[target]` (whole chat if unset). For a catch-up, the system prompt says the reader already
      knows everything before that point. 30s timeout and the existing git-status fallback brief.
   c. Update the divider to `status: "done"`, `brief`, `transcriptPath`.
   d. `startTurn` with `prompt = brief + "\n\n" + typed text` and `resumeId: native_sessions[target]`.
3. If the user stops the turn while it's preparing, abort the brief, mark the divider `failed`, and end the turn as
   `cancelled`. The user message stays, as with any cancelled turn.
4. If a resume fails (the existing `session-reset` path), clear `seen_through[target]`, regenerate the brief for
   the whole chat, and retry the turn once on a fresh session.

Same-provider model changes keep working as today: no divider, `setModel` / per-turn `model`.

`SessionManager` (`session-manager.cjs:56-102`) already restarts on a provider change. It must take `resumeId`
from the turn instead of assuming one id per chat. The `sameChat` key includes the provider.

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
| Resume of the target's old session fails | Fresh session with a whole-chat brief, one retry. |
| User stops during preparing | Divider `failed`, turn `cancelled`. |
| Quit during preparing | Divider `failed` on next launch; the turn follows quit/resume rules. |

## Testing

- `packages/core/src/agents/chat-host.test.cjs`: first switch (whole-chat brief, fresh session); switch back
  (catch-up range, resume id from `native_sessions`); same-provider model change adds no divider; resume failure
  retries with a whole-chat brief; stop while preparing.
- `agent-runs` reducer tests: `native_sessions`, `seen_through`, per-provider `session-reset`.
- State migration test from `native_session_id`.
- `apps/desktop/app/src/lib/handover.test.ts`: updated for the reduced helpers.
- `scripts/test-handover.cjs`: rewritten for the Electron in-place switch, saving screenshots of the preparing
  and done divider and the brief popover.
- Mobile: run the switch on a slim iOS simulator with argent and screenshot the divider and brief sheet.
- Before the PR: `npm run typecheck`, `npm run lint`, `npm test -- --unit`, `npm test -- --only handover`.

## Out of scope

- More than two providers (the design is keyed by provider, so a third works without schema changes).
- Editing the brief.
- Handoff across worktrees or into Link chats.
