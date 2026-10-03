# One runtime owns each Project

This refines ADR-0001. The single writer is `@milagre/core`, hosted in a persistent Node daemon. Desktop connects through its private Unix socket using the existing Electron userData profile. Mobile can connect to that same host. Electron keeps native OS actions and renderer state. The Delegation rules in ADR-0002 are unchanged.

Each runtime owns its data directory and every Project it opens. Atomic directory locks prevent two current Milagre hosts from writing the same state. Real paths determine ownership, so symlinks cannot bypass it. A lock in the common Git directory covers linked checkouts as well. Worktree mutations acquire ownership before running git. The saved Chat format, provider IDs and data locations stay unchanged.

Host shutdown rejects new commands, waits for accepted commands and background work, saves resumable turns, stops agent/setup processes, drains writes and releases its locks. Desktop quit flushes accepted changes and disconnects, leaving the host and agents running. Explicit daemon stop performs the full shutdown. A failed desktop flush keeps the UI open for retry. Explicit update installation saves and stops the host before replacing the bundled code. A normal quit never installs updates behind a running host.

Locks survive an unclean exit and require explicit recovery after verifying the recorded owner has exited. This avoids guessing whether another process is alive or reusing its PID. Older Milagre releases do not honor these locks: close a Project in older releases before opening it in the experimental daemon.

The daemon uses a private Unix socket with protocol version 1. It accepts local clients running as the same OS user. Each socket has its own viewed Project, Chat and focus; one client cannot change another client's selection. Reconnect captures Projects, runs and ports with an event watermark, then applies only later events. Clients never replay a command after losing its acknowledgement. Existing embedded hosts must exit before this daemon opens their Projects; no live state transfer or lock stealing occurs.

Desktop attaches to a host advertising `desktop-v1`, or starts the bundled daemon as a detached process. The packaged Electron executable runs it in Node mode, so a separate Node installation is unnecessary. Activity-based keep-awake moves into the host on macOS. Remote transport and managed startup are separate services layered onto this owner; they cannot create another writer.
