# The main process owns every Chat, not just the open Project's

A **Delegation** can start or steer a turn in a **Chat** of a **Project** that isn't open on screen, so the Electron main process owns agent sessions and writes transcripts for every **Project**. The renderer only displays them. Before this, the renderer saved transcripts only for the open **Project** and interrupted running turns on a project switch. Switching **Projects** no longer stops anything: turns keep running in the background.

## Considered Options

- Keep the renderer as the writer and open several **Projects** at once: rejected, because a **Delegation** would still fail whenever the target **Project** wasn't loaded in the window.
