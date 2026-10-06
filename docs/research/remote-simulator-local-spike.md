# Local simulator validation spike

October 6, 2026. Follow-up to [the research recommendation](remote-simulator-control.md).

The video architecture passes a local feasibility check: Expo's helper streams H.264 to Chrome and to Expo's existing native DOM WebView, including a bundled `file://` receiver with signaling through React Native. Input is not ready for integration: startup delivery and text entry need further investigation. Rotation works in the upstream viewer; the minimal phone receiver needs orientation metadata support.

No product implementation, native compilation, EAS build, OTA publication, deployment or dependency change in this Worktree was made. Throwaway code, installed test dependencies, screenshots and measurements are under `/private/tmp/milagre-simulator-spike`. An existing simulator app was copied and given a replacement JavaScript bundle and HTML asset; its native executable stayed byte-for-byte identical.

## Environment and method

| Item | Tested value |
| --- | --- |
| Mac | arm64, macOS 27.0, build `26A428` |
| Xcode | 27.0 |
| Host helper | `expo-device-hub@0.15.1`, installed only in the temporary probe directory |
| Host runtimes | Installed Milagre Electron 44.5.1 / Node 24.21.0 with `ELECTRON_RUN_AS_NODE=1`; standalone Node 24.13.0 for comparison |
| Source simulators | iPhone 17 Pro profiles on iOS 27.0 and a fresh iOS 26.2 simulator |
| Desktop receiver | Headless installed Google Chrome, automated through Playwright 1.58.2; not Milagre's renderer |
| Native receiver | Copied existing Milagre simulator binary, running on iOS 26.2; Expo 57.0.26, React Native 0.86.3, React 19.2.3, `@expo/dom-webview@57.0.1` JavaScript |

The helper bound to `127.0.0.1:13470`. Initial capture settings were H.264, 30 fps, 1280 maximum dimension and 2 Mbps target. The upstream viewer can adjust stream settings: later samples included 45 fps and a smaller capture size. Configured bitrate and frame rate are not measurements.

The test page ran in simulator Safari and recorded pointer and text events to a loopback server on port 13471. A moving square supplied continuous visual changes. Taps changed a large red/green area. The Chrome receiver sampled the decoded video using a canvas and `requestVideoFrameCallback`, measuring from immediately before the automated click to the first detected color change. This includes automation overhead. All media stayed on this Mac; the numbers do not predict phone or cellular performance.

## Results

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Native helper in installed Milagre's Node mode | PASS | Native addon loaded and streamed under the installed Electron executable. This does not test bundling the addon inside Milagre's signed distribution. |
| Chrome WebRTC video | PASS | Initial sample: H.264, 588 x 1280, 30 fps, 130 decoded frames and zero dropped frames. Longer exploratory runs reported brief freezes, so the initial sample is not a sustained-performance claim. |
| Existing Expo DOM WebView, HTTP page | PASS | First frame in 1,052 ms. Approximately 87 seconds of playback; the last sample reported 3,775 frames, 45 fps, zero dropped frames and zero freezes. |
| Bundled `file://` page, direct HTTP signaling | FAIL | `RTCPeerConnection` was available in a secure context, but the offer fetch failed. The helper's preflight response for `Origin: null` omitted `Access-Control-Allow-Origin`. |
| Bundled `file://` page, native signaling bridge | PASS | DOM posts the SDP offer to React Native; native `fetch` sends it to the helper and injects the answer. First frame in 628 ms. Last sample at 84.5 seconds: 588 x 1280, 2,526 decoded frames, 30 fps, zero dropped frames and zero freezes. No video crossed the native JavaScript bridge. |
| Rapid taps, iOS 26.2 | MIXED | 9 of 10 attempts produced a detected color change. Successful attempts had a 51.9 ms median and 405 ms maximum; one exceeded the three-second detection window. Excluding the timeout must not hide the failed attempt. |
| Spaced taps, iOS 27.0 after restart | PASS, with latency outlier | 10 of 10 changed the fixture. Median 63.9 ms; range 33.4 to 1,135.5 ms. The first attempt was the slowest. Only ten samples. |
| Drag, held touch, two contacts | PARTIAL PASS | The iOS 26.2 fixture recorded move/end events and two distinct pointer contacts from the viewer's Alt-drag. Safari zoomed during gesture testing. No claim of accurate pinch scale or every native gesture is made. |
| Typing | FAIL | An iOS 26.2 attempt to type `milagre123` produced `ilagre123`. An initial iOS 27 attempt was confounded by keyboard onboarding. After restarting, with the normal keyboard visibly open, both a browser attempt and a direct admitted HID socket sending `abc123` produced no fixture text events. Keyboard routing/native delivery remain unresolved. |
| Rotation | PASS in upstream viewer | Screenshot review shows the source and upstream viewer rotated to landscape. The encoded video stayed 588 x 1280, so the width/height-swap assertion was invalid. The minimal phone receiver displayed the raw portrait buffer sideways because it does not consume orientation metadata. |
| Scrolling | INCONCLUSIVE | A swipe produced no recorded scroll event while the keyboard/onboarding UI was involved. This does not establish a backend scrolling failure. |
| Viewer reload | PASS | Reload produced video dimensions again in 738 ms. |
| Helper stop and relaunch | PASS for upstream viewer | After terminating the Node helper and relaunching through Milagre's Electron executable, the viewer created a new connected peer. At the check about 31 seconds after termination it had decoded 802 frames with zero drops/freezes. This is a recovery upper bound, not a measured reconnection time. |

### Startup input failure is not an established iOS 27 incompatibility

The first iOS 27 session ignored taps, Home and rotation even though the browser emitted input packets and the helper recorded native HID injection. Switching the host process from Electron to standalone Node did not resolve it. A fresh iOS 26.2 simulator accepted taps.

After shutting down and booting the iOS 27 simulator again, a fixture on that simulator received taps, including the ten-attempt spaced run. Therefore, the initial failure cannot support a blanket claim that iOS 27 input is unsupported. The exact cause remains unproven. First-input readiness, simulator startup and recovery state need explicit diagnostics and observable readiness before enabling controls.

Some pointer events reached the fixture close together despite spaced sends. Safari zoom and delayed delivery complicate the rapid-tap test. The report preserves those failures rather than treating all packet sends as successful interactions.

Reviewing the real screenshots also caught two test-harness errors: rotation must be checked against orientation metadata and displayed output, not encoded dimensions alone; and first-use keyboard onboarding must be cleared before assessing typing. A follow-up typing run used the visible normal keyboard. The final direct-HID check received input admission and sent key-down/key-up messages at 100 ms intervals, but the fixture recorded no text. This narrows the failing path without establishing its exact cause.

### SimDeck did not provide an immediate fallback

The published `simdeck@0.2.0` service started locally, but a tap request returned HTTP 500:

```text
Unable to load SimulatorKit from /Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit.
```

On this Xcode 27 installation the framework is under `Contents/SharedFrameworks`. Expo's loader handles that location. XcodeBuildMCP's independent tap utility also failed on the old framework path. No Xcode installation files or upstream native binaries were patched to bypass this failure. The temporary SimDeck service was stopped.

## What the mobile experiment proves

The existing copied simulator executable already contains the native DOM WebView required to receive WebRTC. Its SHA-256 before and after replacing only the JavaScript payload was:

```text
b287e19838bd99b7e7cd1d42129a55ea7a81fa7016d8e136c48905302c4e8d20
```

The bundled HTML page reported `scheme: "file:"`, `secure: true` and `peer: "function"`. Routing offer/answer messages through the native bridge fixed the direct-fetch failure without changing native code. This supports the proposed separation between media and authenticated native transport. The experiment used a fixed loopback endpoint; it did not connect through Milagre's encrypted relay or implement controller leases.

This copy has the older cached simulator runtime described in the research report, not the current physical TestFlight installation. Its existing configuration already disabled Expo Updates. No update settings were changed. Manually placing an HTML asset in this temporary app does not prove that Expo's DOM export and EAS Update will package and deliver that asset correctly. Production OTA fingerprint matching, the installed phone runtime and release asset delivery remain gates.

## Evidence and reproduction

All paths below are within `/private/tmp/milagre-simulator-spike` and may be removed by operating-system cleanup.

| Artifact | Purpose |
| --- | --- |
| `initial-stats.json`, `exercise-results.json`, `spaced-taps.json` | Peer statistics, input packets and color-response samples |
| `fixture-events.json`, `ios27-input-retest.json`, `typing-retest.json`, `direct-hid-typing.json` | Delivered events and typing failure evidence |
| `mobile-http-events.json`, `mobile-events.json` | Native WebView capability, first-frame and playback samples; `transport: "native-bridge"` identifies the final bundled-file experiment |
| `reload-test.json`, `helper-restart.json` | Viewer and helper recovery observations |
| `mobile-file-viewer.jpg`, `mobile-http-viewer.jpg`, `rotation-test.png`, `typing-audit-focused.png` | Real screenshots. `rotation-test.json` retains the invalid dimension-based assertion for comparison with the screenshot. |

Probe sources are `inspect.cjs`, `control.cjs`, `exercise.cjs`, `spaced.cjs`, `typing-audit.cjs`, `fixture-server.cjs`, `receiver.html`, and `mobile-probe/`. `MilagreDomProbe.app` is the temporary app copy. They are deliberately not product code or a production viewer.

The helper invocation was:

```sh
ELECTRON_RUN_AS_NODE=1 /Applications/Milagre.app/Contents/MacOS/Milagre \
  /private/tmp/milagre-simulator-spike/node_modules/expo-device-hub/dist/server/cli.mjs \
  --host 127.0.0.1 --port 13470 --platform ios --transport webrtc \
  --video-fps 30 --max-dimension 1280 --video-bitrate 2000000
```

The borrowed `Milagre Agents Preview` simulator was initially shut down and is returned to that state. The newly created `Milagre Stream Spike 26.2` simulator is retained, shut down, for further diagnosis. Other pre-existing simulators were not shut down. Temporary helper, browser, fixture and probe-specific agent-device processes are stopped at the end of this spike.

## Decision after local validation

Keep Expo + WebRTC + native signaling as the implementation candidate. The native WebView experiment substantially reduces uncertainty about the receiving path, while control reliability now has concrete failing cases.

Before building the feature, isolate startup input readiness and keyboard delivery using the existing fixture. Include orientation metadata in the receiver contract. After that, test the current physical TestFlight runtime, mobile input through the native bridge, encrypted relay signaling/control, and forced TURN over cellular. Android had no installed emulator system image available and was not tested. Signed helper distribution, controller ownership, background/network recovery, and a 15-minute CPU/thermal run remain untested.
