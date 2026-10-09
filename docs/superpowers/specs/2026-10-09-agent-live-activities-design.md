# Agent Live Activities

## Intent and approved appearance

Show running agents and pending questions without requiring the person to keep Milagre open. A person can select a short answer from the Lock Screen or expanded Dynamic Island. A typed answer opens the corresponding Chat.

The user approved the previews in this Chat and asked to build them. The approved artifacts are `live-activity-running`, `live-activity-waiting`, and `live-activity-island`, version 2. They are layout references, not evidence that the native feature exists. Native screenshots must be posted in this Chat before another TestFlight upload.

## Presentation

Use one activity per tracked Computer, summarizing its active Chats across Projects and Named Links. Cap visible agent rows at three and show the total separately. Each row contains the Chat title, a status dot and the current state. Count an active main agent once; include active subagents in the total and indicate them in their owning Chat's row. Finished subagents do not remain in the running count.

An unanswered question takes priority over running rows. Show its Chat title, the question and at most two complete, readable option labels in their original order, plus the pencil control. Label the question position and total within the current request. The compact Dynamic Island shows the Milagre mark and the number of waiting requests, or running agent count when nothing needs an answer. Use the existing dark palette, green running state and orange waiting state. Keep the default Lock Screen and expanded presentations within 160 points; large text or longer content reduces visible detail and offers Open Chat rather than clipping an answer label.

The pencil and activity body deep-link to the paired Computer, Project or Named Link and Chat. Links contain routing identifiers, never pairing credentials. Resolve them against the current saved pairing before navigation. Secret questions show only that input is needed and open Chat. Permissions show Needs approval and open the existing approval card, which contains the full command or change.

## Question behavior

Questions use the daemon's request IDs, question IDs and original option labels. The displayed label may omit the Recommended suffix; the submitted answer retains the original label. Buttons submit only eligible single-choice questions. Requests with several questions collect choices in request order and submit the complete answer set when all questions are answered. Multi-select, free text, secret questions and choices that cannot fit use Open Chat.

An intermediate choice in a multi-question request advances to the next question as a draft. Submitting a complete request first shows Sending. Show Answer sent only after the daemon confirms acceptance. A rejection, timeout or unreachable Computer preserves the question with a readable failure and Open Chat. Do not silently retry an answer after losing its acknowledgement; direct the person to check Chat. A duplicate tap while sending is ignored. A question answered from desktop or another phone disappears from every surface. A request ID from an ended turn cannot answer a later request.

Keep partial choices scoped to the Computer, Chat and request. Clear them on cancellation, resolution, pairing removal or disabling tracking. Opening Chat carries partial choices into its existing question card so the person can finish or correct them there. Do not display a local selection as an accepted answer.

## Native implementation

Use a local Expo module with ActivityKit, a SwiftUI widget extension and a custom LiveActivityIntent for answer actions. Generate the extension, App Group, entitlements and target membership through a config plugin. Keep maintained sources outside generated ios directories. This provides the native action handling required beyond expo-widgets' foreground JS interaction listener, and avoids patching its renderer.

The answer intent executes in the app process and initializes the app's React Native runtime when needed. An app-independent answer controller reads the saved pairing, reconnects through the existing encrypted client and invokes `agent:answer-question`. The controller registers at app startup and also drains actions received before JS initialization. The native intent waits for the explicit result, with a bounded deadline. Widget storage contains presentation data and routing IDs; pairing credentials remain in the existing secure store.

Verify the cold-start runtime path first using the actual generated Expo SDK 57 scene-based app. Success requires an accepted answer while the app has no foreground scene. If that path cannot meet the requirement, stop and revise the transport design rather than replace the action with a foreground-only listener.

iOS interaction requires iOS 17 or later. APNs push-to-start requires iOS 17.2 or later. Older supported versions retain normal Chat notifications and navigation. Reconcile active activities and token rotation after app relaunch. Respect system Live Activity authorization and user dismissal.

## Daemon and push delivery

The daemon remains the sole writer and source of accepted answers, as in ADR-0003. A shared projection derives bounded activity content from current runs, pending requests and Chat metadata. Re-read current state when sending a queued update so an earlier event cannot overwrite a later answer or completion. Track when a pending request was first observed to select the oldest consistently.

Register per-activity and push-to-start tokens through authenticated mobile RPC. Scope each registration to its paired Device and Computer. Replacing tokens invalidates the old registration. Disabling tracking or removing a Device invalidates registrations and ends its activities where delivery is possible. Recheck the current pairing before delivering queued work. Bound registrations, payload size and update queues. Coalesce ordinary status changes; prioritize questions, answers and terminal updates. Each update includes a stale deadline so a disconnected Computer cannot appear current indefinitely. Show Updated earlier with Open Chat when stale; do not present stale choices as actionable. Finish the activity when all tracked work ends. Observe ActivityKit's duration and update limits rather than promise indefinite tracking.

Send ActivityKit pushes through the existing relay's authenticated Computer connection, with an APNs signer running in the Worker. Apple signing material is a Worker secret and never ships in the desktop app, phone, repository or push payload. Use the Live Activity topic for `com.victorlucas.milagre`, the correct signing environment and distinct per-activity tokens. Invalidate tokens on APNs terminal responses. A Mac must remain online for new agent updates and answer acceptance.

The existing Expo push channel continues to deliver ordinary Chat alerts. ActivityKit updates use direct APNs, not an Expo push token. Activity content can include Chat titles and non-secret question previews, consistent with the existing notification disclosure. Offer an explicit Live Activities preference in Notifications. Hide secret question contents and credentials from push payloads, widget content and logs.

## Platform sync

Desktop and mobile consume the shared queue order and answer validation. A phone answer updates desktop's existing question card and persisted answer card through the daemon's ordinary events. Desktop answers update the native activity from the same events. Verify both directions, including questions in a different Project or Named Link.

Android provides the corresponding running-agent and question state in an ongoing notification, with the same short choices and Open Chat action. It uses the same projection, request identity and accepted-answer rules. Native action delivery must also work when its foreground screen is closed. Existing desktop and mobile question cards retain full choice descriptions, multi-select and typed-answer controls.

## Verification and delivery

Use meaningful unit tests for queue order, projection bounds, subagent counts, secret redaction, partial answer accumulation, request invalidation, duplicate actions and races with other Devices. Test actual daemon RPC acceptance and persisted answer behavior, not just a mocked success. Test registration removal, token rotation, coalescing, stale updates, APNs payloads and Worker authentication. An unpaired Device cannot register or answer.

On the attached iOS simulator, capture real Lock Screen, compact and expanded Dynamic Island states, Sending, accepted answer and unreachable-Computer behavior. Test a tap with the app foregrounded, backgrounded and terminated. Check that cold-start answering opens no foreground Chat, ordinary navigation still works and a complete answer reaches the fixture daemon once. Use simulated ActivityKit pushes for deterministic simulator verification. Verify real APNs delivery on a signed physical iPhone before claiming background push delivery works on TestFlight.

Verify the Android ongoing notification and answer action on an attached emulator. Run the desktop question-card check for the corresponding state and cross-platform resolution. Run root typecheck, lint and unit tests, mobile typecheck and lint, and the mobile UI suite. Compare the new native fingerprint with build 26 and record it before release. Native additions are authorized by the user's build instruction; provide native screenshots before starting the next cloud build or upload.

## Sources checked

- [Expo SDK 57 widgets](https://docs.expo.dev/versions/v57.0.0/sdk/widgets/): isolated widget runtime, foreground listener limits, configuration and per-activity push tokens.
- [Apple widget and Live Activity interaction](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities): authenticated actions and LiveActivityIntent execution in the app process.
- [Apple Live Activity layout and lifecycle](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities): layout size, authorization and activity updates.
- [Expo's client and APNs backend walkthrough](https://expo.dev/blog/live-activities-with-expo-end-to-end-client-and-backend): direct APNs delivery, token reconciliation and push environments.
