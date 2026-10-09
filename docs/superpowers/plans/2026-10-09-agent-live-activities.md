# Agent Live Activities implementation plan

Spec: [approved design](../specs/2026-10-09-agent-live-activities-design.md).

1. Build the shared, bounded presentation projection and daemon question-action controller. Test secret redaction, oldest request order, subagent counts, multi-question drafts and rejected or duplicate actions.
2. Build the local iOS Expo module, SwiftUI extension and CNG config plugin. Register a separate React Native background component so LiveActivityIntent can start the existing encrypted client without opening a scene. Verify this path on the attached simulator before proceeding with production delivery.
3. Connect native state, deep links and tracking preferences to the mobile app. Add the Android ongoing notification counterpart and verify desktop question resolution through the same daemon actions.
4. Add authenticated relay APNs delivery, token rotation and removal. Keep signing secrets on the Worker. Run the unit and UI checks and capture real native screenshots. Show them in this Chat before a cloud build or upload.

The first acceptance gate is a real answer accepted by an isolated daemon while the iOS app has no foreground scene. A foreground-only button listener does not pass it.

## Native verification, October 9

- The isolated iOS simulator build compiles, installs and uses SecureStore with ad hoc signing.
- The XCTest cold-start answer test kept the app in the background. A separate daemon read found exactly one persisted `Next step: Read a Chat` answer.
- Long-question Open Chat reached a complete question card and full choices. Several QA apps on this simulator share the `milagre` URI scheme; isolate the native fixture scheme before final cold deep-link acceptance. Questions-only projection and answer responses pass focused tests.
- Current native screenshot: `/tmp/milagre-live-native-shots/question-chat-header.png`. The header uses the Chat title and the action row uses Open Chat.
- The native Settings selector passed XCTest after using the menu row's measured center. Both real gesture selection and SecureStore reads confirmed Questions only. With one running agent and no waiting requests, the Questions only content has zero counts and removes the native activity immediately.
- Remote APNs delivery, Android ongoing notifications and desktop-to-native resolution remain unfinished. No cloud build or upload has started.

## PR review, October 9

Astra reviewed the full implementation and the follow-up fixes. All four findings are resolved: accepted answers leave the next queued question actionable; forgetting a computer or disabling tracking reconciles native activities; rejected or unacknowledged submissions keep the complete draft; cancelled foreground refreshes cannot recreate a retired activity. Native sync checks retained-host eligibility, and answer completion can only update an existing activity.

The fixes have daemon draft-retention tests and mobile provider/headless-action race tests. The final iOS module compiles in the isolated native fixture. Sequential cold-background answers and the final cross-platform acceptance checks still need device verification. Keep the PR in draft until the unfinished delivery and platform work above is complete.
