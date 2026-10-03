# Local daemon

Desktop starts or connects to a persistent `@milagre/core` daemon through a private Unix socket on macOS or Linux. It uses the same Electron userData directory and existing Project files, so Chat history and provider IDs do not move. Closing desktop leaves agents running. The mobile bridge can use this same profile and owner.

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

`request` accepts an existing core command name and a JSON array of arguments. `project:open` accepts a Project path directly; OS dialogs, clipboard, notifications, media serving and updates remain desktop features. The daemon has the same local user's privileges and can run provider commands. There is no TCP listener or remote authentication in this phase.

A daemon stays alive when clients disconnect. On macOS, running agent turns and Worktree setup hold the existing keep-awake preference through `caffeinate`; closing the laptop lid can still suspend access. Desktop startup alone does not install a login service. `stop`, SIGINT and SIGTERM save resumable turns and drain pending writes before closing. A desktop whose host stops shows a reconnect notice and retains its unsent draft; start the host again to restore snapshots. It never retries a send automatically.

## Ownership and recovery

The profile's `runtime.lock/owner.json`, each Project's `.milagre/runtime.lock/owner.json` and the repository's `<git-common-dir>/milagre-runtime.lock/owner.json` record the owner PID, start time and token. A second host fails before reading or changing that state. The common Git directory lock also covers linked checkouts, so opening another Worktree cannot bypass the owner. A damaged transcript also fails without replacing it with an empty Project.

After a crash, inspect each reported owner record and verify its process is no longer running, for example with `ps -p <pid> -o pid,lstart,command`. If a process is alive or its identity is unclear, leave its lock alone. Once the owner is confirmed gone, remove only that reported `runtime.lock` directory. Preserve `coordination.json`, settings, recent Projects and handovers. A stale socket may remain too; the startup error names its path under `/tmp/milagre-<uid>/`. Remove that socket only after the same owner check. Retry the original command.

Never remove a live runtime's lock. Use `stop` for a running daemon.

## Local protocol

Each newline-delimited UTF-8 JSON request is `{ "v": 1, "id": 1, "method": "chat:runs", "args": [] }`. Responses have the same `v` and `id`, with `result` or `error: { code, message }`. Events are `{ "v": 1, "event": { "channel": "agent:event", "payload": ..., "seq": 1 } }`. Core event payloads match desktop IPC. `daemon:status` advertises the `desktop-v1` capability and core methods. `daemon:snapshot` captures Projects, runs, ports and its event watermark synchronously. `daemon:focus` updates only that socket's focus. `daemon:flush` saves without ending turns; `daemon:stop` starts graceful shutdown.

Frames are limited to 16 MiB, with 32 concurrent requests per client and a bounded outgoing buffer. Oversized state is rejected; it is never truncated. A slow client is disconnected and must refresh its snapshots. The client does not retry commands automatically. A timed-out mutation may still be running, so inspect state before retrying. Pagination, remote reconnect/replay and remote authorization belong to the client protocol phase.

Run `npm run test:core`, `npm run test:daemon` and `npm run test:desktop` to check runtime persistence, socket behavior and desktop compatibility. Tests use temporary Projects and fake provider sessions.
