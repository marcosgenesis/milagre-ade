---
name: browser
description: Attach or detach a browser on this computer to the current Milagre Chat so the user can view and control its pages on desktop or phone. Use when driving a browser for web work, when a browser you started does not show in the Chat, or when changing which browser the Chat uses.
---

# Chat browsers

1. Call Milagre's `browser_list`. `targets` are the pages already in this Chat: those of browsers this Chat's agent started (`source: "agent"`) and attached ones (`source: "attached"`). `others` are browsers on this computer that no Chat's agent started, with their id, product and page count.
2. A browser you launch yourself with `--remote-debugging-port` joins the Chat on its own while it stays in your process tree: Milagre reads the OS process table and attributes it to this Chat. Check `browser_list` after launching; if its pages are in `targets`, nothing else is needed.
3. If the browser is under `others`, call `browser_attach` with its id. This happens when the browser left your process tree (a daemon such as agent-browser's, a shell that backgrounded it and exited, `open -a`), or when the user started it. The tool supplies the current Chat identity; do not pass a Chat id.
4. Keep driving the browser with your own automation tools. Attaching makes its pages available in this Chat's Browser pill on desktop and phone; it never starts a capture, navigates or takes control. Keep it attached when finishing work so the user can inspect it.
5. Call `browser_detach` with the browser id when the user asks to remove it or you replace it. Detach closes this Chat's viewers of that browser, preserves other Chats' attachments and leaves the browser running. Browsers attributed by lineage cannot be detached; they leave the Chat when they exit.

A browser appears only if it exposes a loopback DevTools HTTP endpoint. Playwright MCP's default `--remote-debugging-pipe` and browsers without a debugging port never appear; launch with a port (`--remote-debugging-port=0` picks a free one) when the user should be able to watch. A browser another Chat's agent started is never offered; do not attach every browser you discover, and never close another Chat's browser to clean up this one. Attachments live in the host's memory and end when the browser exits or the host restarts.

Viewing never claims control from you: a person who takes control in the viewer shares the page with your DevTools session, so expect the page to change under you while they do.
