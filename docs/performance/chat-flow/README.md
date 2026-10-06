# Chat flow measurements

Measured on 2026-10-06, macOS arm64, Node 26.8.1, headless Chromium 153.0.8010.12, 1100 × 760 viewport, development React. The Electron harness ran through a local Playwright adapter because Electron stalled before startup on this machine. No product dependency was added.

These synthetic workloads establish costs and compare the fixes. They do not guarantee a particular send latency on a phone or a busy user's computer.

## Desktop

Each history alternates user and assistant messages. Each assistant has eight paragraphs and eight tool steps. The real App runs against a held IPC fixture. Three trials per history size; values below are medians of React Profiler durations, not elapsed network or paint time. Background work emits 40 text updates into a different chat, 50 ms apart.

| History | Rendering while opening, before → after | Rendering during background updates, before → after |
| --- | --- | --- |
| 40 messages | 107.1 → 99.9 ms | 157.0 → 75.2 ms |
| 300 messages | 317.1 → 116.5 ms | 299.9 → 83.1 ms |
| 1,000 messages | 718.4 → 110.3 ms | 546.7 → 84.5 ms |

The 1,000-message case mounts 2,739 DOM nodes instead of 64,658. It initially renders the newest 40 messages, matching mobile. Earlier pages load on request with the reading position retained. Opening Find loads all history and keeps it mounted after closing Find.

Isolating the transcript alone produced little overall improvement. Instrumentation then found 12,000 navigation-item renders during 40 background updates with 300 messages. Reusing the rail's unchanged navigation removed those renders. The regression checks exercise both an idle chat and one with an active reply.

The baseline uses `ChatComposer.tsx` and `PreviewRail.tsx` from `9e72cbf929b8279b3707f09eb936877e8f7def5b`, with the current App, including the earlier stable linked-chat callback fix. Both sides use the same fixture and viewport.

Raw trials: [before](desktop-before.json), [after](desktop-after.json).

## Mobile drawer and relay

The synthetic project has 10 chats and 1,000 messages, with a client message ID on each of its 500 user inputs. Five trials use the production full/summary projections and the shared relay base64 encoder and assembler. These are Node CPU measurements, not Hermes measurements. Encryption and network transit are excluded.

| Measure | Full snapshot | Drawer projection |
| --- | --- | --- |
| JSON | 2,629,456 bytes | 51,520 bytes |
| Base64 payload | 3,505,968 bytes | 68,696 bytes |
| Relay chunks | 11 | 1 |
| Projection, serialization and encoding, median | 36.30 ms | 0.803 ms |
| Assembly, decoding and parsing, median | 102.38 ms | 1.030 ms |

HTTP compression is not the relay payload size: the host reads the decoded HTTP body before framing it into the encrypted channel.

`view=chats` preserves the stored title fields exactly (it does not synthesize a title from the message body or agent name), flags, failure state, every client input identity and running/approval/question marks. Keeping every identity lets an outstanding send match its saved message even if another user or linked Chat sends a later input. The typed `previewOnly` marker and separate cache prevent its empty message bodies from reaching a readable transcript. Previously opened full transcripts stay cached. First opening an unread project still fetches its full snapshot. Older hosts ignore the query parameter and return a full snapshot, which remains supported.

Raw trials: [mobile projection](mobile-preview.json), rerun after the review fixes. These timings vary with host load; payload sizes are deterministic.

## Repeat

```sh
MILAGRE_BENCHMARK_OUTPUT=/tmp/chat-after.json npm run benchmark:chat-flow
MILAGRE_BENCHMARK_OUTPUT=/tmp/mobile-preview.json npm run benchmark:mobile-preview
mkdir -p /tmp/chat-before-components
git show 9e72cbf929b8279b3707f09eb936877e8f7def5b:apps/desktop/app/src/components/ChatComposer.tsx > /tmp/chat-before-components/ChatComposer.tsx
git show 9e72cbf929b8279b3707f09eb936877e8f7def5b:apps/desktop/app/src/components/motion/PreviewRail.tsx > /tmp/chat-before-components/PreviewRail.tsx
MILAGRE_BENCHMARK_COMPONENTS=/tmp/chat-before-components MILAGRE_BENCHMARK_OUTPUT=/tmp/chat-before.json npm run benchmark:chat-flow
```

Use the same engine and an idle machine for both desktop runs. The temporary Chromium adapter is not included, so the exact browser setup above cannot be reproduced from this repository alone. The committed harness defaults to Electron, so its timings will differ from the Chromium measurements above. Timings are observations, not CI thresholds; regression tests assert bounded mounts, retained content, cache separation and skipped rendering work.

## T3 Code reference

Reviewed T3 Code at `9bd1d8009a6b7c50f9dd9458e2bf27d481ff3b43`. Its [MessagesTimeline](https://github.com/pingdotgg/t3code/blob/9bd1d8009a6b7c50f9dd9458e2bf27d481ff3b43/apps/web/src/components/chat/MessagesTimeline.tsx) uses LegendList virtualization, stable row callbacks and visible-position preservation. Its [ChatView](https://github.com/pingdotgg/t3code/blob/9bd1d8009a6b7c50f9dd9458e2bf27d481ff3b43/apps/web/src/components/ChatView.tsx) uses scoped store selectors. Those patterns informed the comparison; no T3 source or dependency was copied. The measured fixes here use Milagre's existing scroller and mobile paging pattern.

## Review fixes and verification

The independent Claude review identified three defects, now covered by regressions:

- Legacy hosts without client message IDs: after a successful send response, a new untagged user input with matching body in the returned session can retire the preview. Inputs from before the send, other sessions, and differently tagged clients cannot match. Stop, approvals and questions no longer wait on preview retirement. Legacy hosts cannot disambiguate concurrent identical untagged inputs perfectly; current hosts still match exact client IDs.
- Opening a linked Chat in the current project no longer cancels that project's in-flight refresh.
- Compact drawer snapshots retain the same stored title fields as full snapshots.

Shared tests (128), mobile UI tests (81), bridge tests, the desktop/mobile cache browser check, both typechecks and mobile lint pass. The browser check used the same temporary Chromium adapter. No native build or release was performed.

The review's suggestion to truncate acknowledged client IDs was not applied: a delayed acknowledgement can outlive later inputs and replies. The projection remains proportional to the number of tagged inputs. Background saves and all-project search concurrency remain unmeasured follow-up opportunities; the desktop benchmark covers streaming updates. Source instrumentation asserts its replacement markers, so a refactor fails the test rather than silently disabling counters.
