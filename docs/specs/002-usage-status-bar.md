# Usage Status Bar — Specification

## Problem Statement

Milagre runs Claude and Codex agents on the user's own subscriptions. Both providers cap usage in rolling windows (a 5-hour session, a weekly limit, and per-model weekly limits such as Fable). Today the user only finds out a window is nearly spent when an agent run fails, or by switching to a terminal and running `/usage` or `/status`.

## Solution

A thin status bar along the bottom of the main column, under the chat, shows each provider's two most important windows as a mini bar plus a percentage. Hovering or focusing a provider opens a card with every window, how much is used, and when it resets.

```
                                   ✳ ▬▬▭▭ 73% 5h  ▬▬▭▭ 61% wk    ⊛ ▬▬▬▭ 88% wk
```

```
┌──────────────────────────────────┐
│ ✳ Claude                      ⟳ │
│ Updated just now                 │
├──────────────────────────────────┤
│ Session                          │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭           │
│ 73% used        Resets in 1h 17m │
│ Weekly                           │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭▭▭           │
│ 61% used        Resets in 5d 0h  │
│ Fable                            │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭▭           │
│ 66% used        Resets in 5d 0h  │
└──────────────────────────────────┘
```

All numbers come from the providers' own live sources. Nothing is estimated from local token counts.

## User Stories

1. As a developer, I want to see at a glance how much of my Claude and Codex limits I have used, so that I don't start a long agent run on an almost-empty window.
2. As a developer, I want to hover a provider and see every window with its reset time, so that I know when capacity comes back.
3. As a developer, I want the numbers to update after my agent runs and periodically, so that I can trust them without refreshing by hand.
4. As a developer, I want a provider I don't use to stay out of the way, so that the bar only shows what's relevant.
5. As a keyboard user, I want to open the same details by focusing the provider, so that the card isn't hover-only.

## Data Sources (verified 2026-10-01)

### Claude

- **Credentials:** the OAuth token Claude Code already stores. On macOS run `/usr/bin/security find-generic-password -s "Claude Code-credentials" -w`. If that fails, or on other platforms, read `~/.claude/.credentials.json`. Both contain `{ claudeAiOauth: { accessToken, expiresAt, subscriptionType } }`. The `security` binary is on the item's access list, so no Keychain prompt appears.
- **Endpoint:** `GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <accessToken>` and `anthropic-beta: oauth-2025-04-20`.
- **Shape used:** the `limits` array:
  - `{ kind: "session", percent, resets_at }` becomes **Session** (`5h`)
  - `{ kind: "weekly_all", ... }` becomes **Weekly** (`wk`)
  - `{ kind: "weekly_scoped", scope.model.display_name }` becomes a row named after the model, e.g. **Fable**
  - If `limits` is absent, fall back to `five_hour.utilization` and `seven_day.utilization`.

### Codex

- **Source:** the local `codex app-server` over stdio JSON-RPC. Send `initialize`, then the `initialized` notification, then `account/rateLimits/read`, read the matching response, and kill the process.
- **Shape used:** `result.rateLimits.primary` and `.secondary`, each `{ usedPercent, windowDurationMins, resetsAt (unix seconds) }`, either may be `null`.
- **Window labels:**
  - `300` minutes becomes **Session** (`5h`)
  - `10080` minutes becomes **Weekly** (`wk`)
  - any other duration becomes a generic `Nh` / `Nd` label
- Today this account reports only a weekly window (88%).

## Implementation Decisions

### Main process: `electron/usage.cjs`

- Exports `readClaudeUsage(deps)`, `readCodexUsage(deps)` and `readUsage(deps)`. All I/O (`execFile`, `fs`, `fetch`, `spawn`, `now`) is injected so tests run without a network, a Keychain or a Codex binary.
- Each reader returns a `ProviderUsage` and never throws:

  ```ts
  interface UsageWindow {
    id: string;            // "session" | "weekly" | "weekly:fable" | ...
    label: string;         // "Session", "Weekly", "Fable"
    shortLabel: string;    // "5h", "wk"
    usedPercent: number;   // 0–100
    resetsAt: string | null; // ISO timestamp
  }
  interface ProviderUsage {
    provider: "claude" | "codex";
    status: "ok" | "unavailable" | "error";
    windows: UsageWindow[]; // display order; the bar shows the first two
    updatedAt: string;      // ISO timestamp of this read
    message?: string;       // human reason for unavailable / error
  }
  ```

- **Status rules:**
  - **unavailable:** the provider isn't set up (no Claude credentials, `codex` not on PATH / `ENOENT`, Codex not logged in). The segment is hidden.
  - **error:** set up, but the read failed: expired Claude token, HTTP error, 429, timeout, or a malformed response.
  - An expired Claude token (`expiresAt` in the past) returns **error** with "Claude sign-in expired. Running any Claude agent refreshes it." without calling the endpoint.
- **Credentials:** Milagre never refreshes or writes Claude credentials. Rotating the refresh token could sign Claude Code out. The access token stays in the main process. It is never logged, never sent over IPC, and never included in an error message.
- **Timeouts:** 10 s per provider. The Codex child is always killed, on success, error or timeout.
- **Fetching:** `readUsage` runs both readers in parallel and returns `{ providers: ProviderUsage[] }`. Concurrent calls share one in-flight promise.
- **IPC:** `ipcMain.handle("usage:read", ...)`. Preload exposes `readUsage()`. `electron.d.ts` and `model.ts` get the types above.

### Renderer

- **`useUsage()` hook** (`app/src/components/usage/useUsage.ts`):
  - Reads on mount and every 5 minutes.
  - Exposes `refresh()` and `refreshIfStale(60_000)`.
  - If a refresh returns `error` for a provider that previously had `ok` data, keep the old windows and show the error next to the "Updated …" line instead of blanking the card.
- **Refresh triggers:** `App.tsx` calls `refresh()` after every agent run settles (success, error or cancel). The card calls `refreshIfStale` when it opens.
- **`UsageStatusBar`** (`app/src/components/usage/UsageStatusBar.tsx`):
  - A 28 px row under the chat, inside `<main>`, right-aligned, `text-[12px] text-ink-2 tabular-nums`.
  - One segment per provider whose status is not `unavailable`. If none are left, the bar is not rendered and the chat keeps its full height.
  - A segment is: a 12 px provider mark, then for each of the first two windows a 36×4 px bar and `NN% <shortLabel>`.
  - Each segment is a `<button aria-expanded>`.
- **`UsageCard`** (`app/src/components/usage/UsageCard.tsx`):
  - Portaled, fixed above its segment, 288 px wide, `bg-surface shadow-overlay rounded-[14px]`, with the existing `pop-in` animation.
  - Header: provider mark and name, "Updated just now / 3m ago", and a refresh icon button that spins while loading.
  - One row per window: the label, a full-width 6 px bar, then "NN% used" on the left and "Resets in 1h 17m / 5d 0h" on the right. When the reset time has passed, show "Resetting…".
  - The `error` message appears under the header.
- **Bar colours:**
  - Fill: `ink-2` below 80%, `orange` from 80%, `red` from 95%.
  - Track: `line-strong`.
  - Works in both themes through the existing tokens.
- **Opening and closing:**
  - Opens after 120 ms of hover, or immediately on keyboard focus.
  - Stays open while the pointer is over the segment or the card.
  - Closes 150 ms after the pointer leaves, or on Escape or blur.
- **Provider marks:** small inline SVGs (Claude spark, OpenAI blossom) in `currentColor`, kept in `usage/ProviderMark.tsx`. Hugeicons has no brand marks.

## Testing Decisions

- **`electron/usage.test.cjs`** (`node --test`, run by `npm run test:agent`), using injected fakes. It covers:
  - Claude: `limits` mapped to Session / Weekly / Fable in order, with percent and reset time.
  - Claude: falls back to `five_hour` / `seven_day` when `limits` is missing.
  - Claude: Keychain miss falls through to the credentials file; both missing gives `unavailable`.
  - Claude: an expired token gives `error`, and `fetch` is never called.
  - Claude: HTTP 401 / 429 / 500 and malformed JSON give `error`.
  - Claude: the access token never appears in `JSON.stringify(result)` for any outcome.
  - Codex: a response with only a weekly primary gives one `Weekly` / `wk` window; 300-minute windows map to `Session` / `5h`.
  - Codex: `ENOENT` gives `unavailable`; a timeout gives `error` and the child is killed.
  - `readUsage` shares one in-flight read between concurrent callers.
- **Checks:** `npm run typecheck` and `npm run test:agent` pass.
- **Visual check:**
  - Run the app in dev with a CDP port and drive it with argent's Chromium tools.
  - Hover and focus each segment.
  - Screenshot the bar and both cards in light and dark themes.
  - Confirm the numbers match the live values.

## Out of Scope

- The account section ("System default", "Manage Accounts…") and multi-account switching.
- Refreshing Claude tokens, and anything that writes credentials.
- Extra-usage credits, spend, Codex credit balance, and Codex reset credits.
- Reading Codex session logs as a fallback source.
- Threshold notifications or blocking runs when a window is full.
