# Local daemon

Desktop starts or connects to a persistent `@milagre/core` daemon through a private Unix socket on macOS or Linux. It uses the same Electron userData directory and existing Project files, so Chat history and provider IDs do not move. Closing desktop leaves agents running. The mobile bridge attaches to the same profile and owner. Desktop Settings > Devices manages phone access through the public encrypted relay or a configured Cloudflare tunnel; see [mobile setup](mobile-local.md).

For the first upgrade from an embedded-runtime desktop, close that older app before launching the new build. Never open the same Projects through an older desktop while the new host owns them. The running app is not automatically replaced by development checks.

The host writes `daemon.log` in its profile. `daemon:status` reports its PID and profile path. A separate Node installation is only needed for the source CLI below; packaged desktop starts the bundled daemon using its own executable.

Use Node 24+ and install from the repository root with `npm ci`. Start the daemon in a terminal with an explicit, separate profile:

```sh
npm run daemon -- serve --data-dir /absolute/path/to/daemon-profile
```

From another terminal:

```sh
npm run daemon -- status --data-dir /absolute/path/to/daemon-profile
npm run daemon -- request project:open '["/absolute/path/to/project"]' --data-dir /absolute/path/to/daemon-profile
npm run daemon -- request chat:runs --data-dir /absolute/path/to/daemon-profile
npm run daemon -- stop --data-dir /absolute/path/to/daemon-profile
```

`request` accepts an existing core command name and a JSON array of arguments. `project:open` accepts a Project path directly; OS dialogs, clipboard, notifications, media serving and updates remain desktop features. The daemon has the same local user's privileges and can run provider commands. The daemon socket has no TCP listener. Remote clients connect through the separate authenticated mobile bridge.

A daemon stays alive when clients disconnect. On macOS, running agent turns and Worktree setup hold the existing keep-awake preference through `caffeinate`; closing the laptop lid can still suspend access. Desktop startup alone does not install a login service. `stop`, SIGINT and SIGTERM save resumable turns and drain pending writes before closing, then send every client a `daemon:stopping` event. A desktop whose host stops that way shows a reconnect notice and retains its unsent draft; start the host again to restore snapshots. A host that goes away without that event (a crash, SIGKILL) is started again by the desktop: up to three starts, the delay doubling each time, then a notice saying why it couldn't. A host the desktop stopped itself (an update, a restart, a quit) is never started again by a reconnect. It never retries a send automatically; only the connection is retried.

Updates install only through the explicit restart action. It saves and stops the shared host before replacing the application bundle; connected clients briefly disconnect and resumable turns return when the updated desktop starts its host. Ordinary desktop quit does not install a pending update. Stop the host before manually replacing or moving its source checkout or packaged application too.

Reconnect retains at most 1,024 events or 16 MiB while obtaining its snapshot. If that limit is exceeded, it disconnects and retries the snapshot without replaying commands. A deleted Project is skipped so another Project can still be opened. Other Project errors remain visible as a failed reconnect rather than being silently ignored.

Desktop startup does not install a login service. An older embedded-runtime desktop must be closed before a current desktop can take ownership of its profile. Phone access is managed separately by the daemon through Settings > Devices.

## Ownership and recovery

The profile's `runtime.lock/owner.json`, each Project's `.milagre/runtime.lock/owner.json` and the repository's `<git-common-dir>/milagre-runtime.lock/owner.json` record the owner PID, start times, host name and token. A second host fails before reading or changing that state. The common Git directory lock also covers linked checkouts, so opening another Worktree cannot bypass the owner. A damaged transcript also fails without replacing it with an empty Project.

After a crash, the next host takes over a lock whose owner is certainly gone: no process has its PID, or the process that does started after the owner did (a reused PID). A record from another computer, without a PID, or whose process start can't be read is left alone, as is a lock with no record yet. A host that owns the profile also removes a socket a crashed host left under `/tmp/milagre-<uid>/`. If startup still reports an owned lock, inspect the owner record and verify its process is no longer running, for example with `ps -p <pid> -o pid,lstart,command`. If a process is alive or its identity is unclear, leave its lock alone. Once the owner is confirmed gone, remove only that reported `runtime.lock` directory. Preserve `coordination.json`, settings, recent Projects and handovers. Retry the original command.

Never remove a live runtime's lock. Use `stop` for a running daemon.

## Local protocol

Each newline-delimited UTF-8 JSON request is `{ "v": 1, "id": 1, "method": "chat:runs", "args": [] }`. Responses have the same `v` and `id`, with `result` or `error: { code, message }`. Events are `{ "v": 1, "event": { "channel": "agent:event", "payload": ..., "seq": 1 } }`. Core event payloads match desktop IPC. `daemon:status` advertises the `desktop-v1` and `snapshot-pages-v1` capabilities and core methods. `daemon:snapshot` captures Projects, runs, ports and its event watermark synchronously. Desktop requests `{ paged: true }`, then reads sequential `daemon:snapshot-page` fragments from that immutable capture. A capture belongs to its socket, expires after 30 seconds, and is released after its final page or disconnect. This keeps aggregate snapshots above 16 MiB recoverable without increasing the frame limit. `daemon:focus` updates only that socket's focus. `daemon:flush` saves without ending turns; `daemon:stop` starts graceful shutdown.

Frames are limited to 16 MiB, with 32 concurrent requests per client and a bounded outgoing buffer. Oversized state is rejected; it is never truncated. A slow client is disconnected and must refresh its snapshots. The client does not retry commands automatically. A timed-out mutation may still be running, so inspect state before retrying. Per-Project history pagination, remote reconnect/replay and remote authorization belong to the client protocol phase.

Run `npm test -- --workspace core`, `npm test -- --workspace daemon` and `npm test -- --only test-desktop` to check runtime persistence, socket behavior and desktop compatibility. Tests use temporary Projects and fake provider sessions.
