# One runtime owns each Project

This refines ADR-0001. The single writer is `@milagre/core`, hosted either in Electron or in the optional Node daemon. Desktop still embeds that runtime and quits its agents as before. Connecting desktop and mobile clients to a persistent daemon is a later phase. The Delegation rules in ADR-0002 are unchanged.

Each runtime owns its data directory and every Project it opens. Atomic directory locks prevent two current Milagre hosts from writing the same state. Real paths determine ownership, so symlinks cannot bypass it. A lock in the common Git directory covers linked checkouts as well. Worktree mutations acquire ownership before running git. The saved Chat format, provider IDs and data locations stay unchanged.

Shutdown rejects new commands, waits for accepted commands and background work, saves resumable turns, stops agent/setup processes, drains writes and releases its locks. Desktop quit now waits for that drain instead of forcing exit after five seconds. Slow operations can delay quit; exiting early could leave unfinished writes or release ownership too soon.

Locks survive an unclean exit and require explicit recovery after verifying the recorded owner has exited. This avoids guessing whether another process is alive or reusing its PID. Older Milagre releases do not honor these locks: close a Project in older releases before opening it in the experimental daemon.

The daemon uses a private Unix socket with protocol version 1. It accepts local clients running as the same OS user. Disconnecting a client does not stop agents. Clients reconnect and read Project state and `chat:runs`, which includes active approvals and questions. There is no internet listener, relay, automatic service installation or desktop transport switch in this phase.
