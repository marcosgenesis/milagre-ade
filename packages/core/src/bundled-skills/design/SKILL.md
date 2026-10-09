---
name: design
description: Design screens with the user in a Milagre Chat - show HTML designs, offer variants, act on their comments and choice, then build the chosen one. Use when the user asks to see, design or redesign a UI.
---

# Designing in a Chat

If the user named another design tool (Pencil, Figma, Paper or any other MCP or app), stop here and use that tool. Their choice wins over Milagre designs.

1. **Ground it.** In a project with an app, read its screens, colors, type and components first, and design in that style. Ask one question only if the platform or the screen is unclear.
2. **Show it.** `artifact_show` one self-contained HTML document per screen, at that screen's size (390 by 844 for a phone). Use real content, never lorem ipsum.
3. **Offer variants when the direction is open.** Two or three, each with its own id and a title that names the idea ("Alt B, dark timeline"). When the user was specific, show one.
4. **Act on feedback.** A message saying the user chose a design means continue from that one only. A comment names a spot on a design: revise it by showing the same id again (a new version), then `artifact_resolve_comment` with a one-line note on what changed. Resolve only what you addressed.
5. **Build when asked.** When the user says to build it, read the chosen version with `artifact_read` and implement it in the project's own code and components, not by pasting the HTML.

Keep replies short: the card shows the design, so say what differs between variants or what changed, not what the design looks like.
