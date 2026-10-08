# Host ownership and troubleshooting

The computer's persistent local daemon owns Chats, provider processes, Worktrees and storage. Desktop and paired phones use the same host/profile. Desktop starts or attaches to the host; the packaged app starts its bundled executable without requiring a separate Node installation.

`daemon:status` reports the host PID and profile path. `agent:cli-status` and `agent:models` describe the affected owning scope. `chat:runs` reports active work. Use these through available host tools, not invented shell commands. Diagnostic records belong to that host/profile, which can differ between development and packaged desktop launches.

## Connection and update failures

Confirm the affected host is online, its desktop can open the same Chat, and the client is connected to that computer. A phone disconnected from a healthy desktop points to phone access/transport; both disconnected clients point to host startup or availability. Inspect the reported error before restarting.

A graceful host stop saves resumable parent turns, cancels advisors and drains storage. Explicit update installation restarts the shared host; ordinary desktop quit does not install an update. Clients reconnect without retrying sends automatically. After a lost acknowledgement, inspect the Chat before resending. Interrupted advisors offer Retry; uncertain result delivery is inspected manually.

## Ownership failures

One host owns a profile and every opened Project's common Git directory. A second host fails rather than replacing state. Close an older desktop that still owns an embedded runtime before opening the same Projects with the current app.

After a crash, the host reclaims locks only when the recorded process is certainly gone. A live/uncertain owner or damaged state remains an error. Inspect the reported PID/start identity read-only. Never delete a live ownership lock, reset a transcript or start a competing host as a diagnostic shortcut. Stop the existing host through its owning flow if the user authorized that action. Preserve Chat history and provider IDs.
