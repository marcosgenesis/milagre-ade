# Linked Worktrees — Specification

Terms follow [`GLOSSARY.md`](../../GLOSSARY.md). Decisions: [ADR-0001](../adr/0001-main-process-owns-chats.md), [ADR-0002](../adr/0002-delegation-not-direct-edits.md).

## Problem Statement

I work on related changes across several repositories and worktrees at once: a backend endpoint and the frontend that calls it, a library and the app that uses it. Each **Chat** in Milagre only knows its own **Worktree**. To keep them in step I copy text between chats, switch projects (which today interrupts running turns), and re-explain what the other side is doing.

## Solution

A canvas shows every **Project** that has been opened in Milagre, with its active **Worktrees** and their **Chats**. Dragging between two of them draws a **Link**. From then on, every **Chat** on each side:

- gets a short summary of the other side's state at the start of each turn;
- can read the other side (chats, git, files) through read-only tools;
- can make a **Delegation**: ask for changes there, carried out by that side's own agent, with a **Delegation report** coming back;
- can open a **Negotiation** when the two sides have to agree on something, letting the agents go back and forth until one concludes.

This is a new feature. It doesn't implement spec 001's typed Connections, which stay as they are.

## User Stories

1. As a user, I want to see every Project I have opened in Milagre on one canvas, with its active Worktrees and their Chats, so I can see all my ongoing work at a glance.
2. As a user, I want a Project to be its repository, so that opening any of its worktree folders shows the same Project.
3. As a user, I want to drag from one Project or Worktree to another to link them, so their Chats know about each other.
4. As a user, I want linking a Project to cover its Worktrees created later, so I don't re-link every new branch.
5. As a user, I want a Chat to know what the linked side is doing without my telling it, so I never copy context between chats.
6. As a user, I want to ask the Chat I'm in for changes on the linked side and have the right agent there do them, so I can drive related work from wherever I am.
7. As a user, I want to see where a Delegation is going and what it says before it is sent, when my Chat is in Ask approval.
8. As a user, I want a Delegation to appear in the receiving Chat as coming from the requesting Chat, so I can tell it apart from my own messages.
9. As a user, I want a summary of what the other side did to come back to the requesting Chat, so I know when it's done.
10. As a user, I want two agents to work out an agreement between themselves when a request needs it, without my having to ask for that, so cross-repo decisions don't need me in the middle.
11. As a user, I want to stop a Negotiation at any time, and want it to stop by itself after 10 rounds, so it never runs away.
12. As a user, I want Chats of Projects I'm not looking at to keep running, so switching Projects never interrupts work.
13. As a user, I want removed Worktrees and their Links to disappear from the canvas.

## Implementation Decisions

### Projects and the registry

- A **Project** is identified by its repository's common git directory (`git rev-parse --git-common-dir`), not by the folder opened. Opening any worktree folder of a repository resolves to the same **Project** and its state file in the main checkout.
- A global registry lists every **Project** opened in Milagre: its id, name, main checkout path and canvas position. It lives in the app's `userData` folder, next to `usage-cache.json`. Opening a **Project** adds it.
- On the first canvas open, a one-time scan seeds the registry with existing `.milagre/coordination.json` files under `~/Developer` and `~/.milagre/worktrees`. Found worktree folders resolve to their **Project**, so `~/.codex/worktrees/cc0d/Milagre` joins Milagre instead of becoming a second Project.
- A **Worktree** is active while `git worktree list` lists it and its folder exists. A **Project** whose main checkout no longer exists is dropped from the registry.

### Main process owns Chats (ADR-0001)

- Transcript persistence (`applyAgentEvent` and saving the finished reply) moves from the renderer to the main process, which writes each **Project**'s `coordination.json` through `project-store.cjs`.
- Chat keys stay `${projectPath}#${sessionId}`, with `projectPath` as the **Project**'s main checkout.
- Switching **Projects** no longer interrupts turns. The renderer subscribes to events for every **Project** and shows running and waiting marks for any of them.

### Canvas

- A new `view: "canvas"` next to `chat` and `settings`, opened from the sidebar and a shortcut.
- **Projects** are boxes. Active **Worktrees** are nodes inside them, showing their branch, diff stat and **Chats** with their marks (waiting, running, unread, idle). Archived **Chats** are hidden.
- Dragging from a **Project** box or a **Worktree** node to another endpoint creates a **Link**. Linking a **Project** to one of its own **Worktrees** is not allowed. Selecting a **Link** offers Remove.
- Clicking a **Chat** opens it in the chat view. Node and box positions are adjustable and saved. The default layout puts **Projects** on a grid by most recent use.
- Running **Delegations** and **Negotiations** show on their **Link**, with a Stop control for a **Negotiation**.
- A **Codex** **Chat** that can't use the tools (see Agent tools) is marked as receive-only.
- Canvas library: React Flow (`@xyflow/react`).

### Links

- Stored in the global store as `{ id, a, b, created_at }`. Each endpoint is `{ project_id }` or `{ project_id, worktree_path }`, so a **Link** can join two **Projects**.
- Symmetric and untyped. Reach is one hop.
- The **Worktrees** a **Chat** can see are the union of its **Worktree**'s **Links** and its **Project**'s **Links**, with **Project** endpoints expanded to their active **Worktrees** at the time of use.
- A **Link** with a **Worktree** endpoint is removed when that **Worktree** stops being active.
- Removing a **Link**: running turns finish, its **Negotiations** stop, and its queued **Delegations** are cancelled with a notice in both **Chats**.

### Linked context (push)

- At the start of each turn, Milagre builds a summary of every **Worktree** the **Chat** can see and attaches it to the turn's input as a context block that isn't shown as part of the message.
- The summary is built from the stored state, without a model call. For each **Worktree** it includes:
  - **Project**, branch and diff stat;
  - each non-archived **Chat**: its title, its status (working, waiting on the user, idle) and the first ~300 characters of its last reply;
  - open **Delegations** and **Negotiations** between the two sides.
- The summary is capped (about 4 KB per **Worktree**, 16 KB total), and the cap truncates **Chats** with older activity first.
- `MILAGRE_INSTRUCTIONS` gains a section explaining **Links**, **Delegations**, **Negotiations** and the tools.

### Agent tools

The tools are served from the main process. For Claude they're an in-process MCP server (`createSdkMcpServer`); for Codex, a local MCP server passed through the thread config, once that path is verified. All reads are read-only and need no approval, and they are scoped to **Worktrees** the **Chat** can see.

- `linked_overview`: the push summary, on demand.
- `read_linked_chat(chat, range?)`: a **Chat**'s transcript, archived **Chats** included.
- `linked_git(worktree, "status" | "diff" | "log", args?)`.
- `read_linked_file(worktree, path, range?)`, `search_linked_files(worktree, query, glob?)`.
- `delegate(worktree, chat? | "new", message, negotiation?: boolean)`.
- `conclude_negotiation(summary)`: available only inside a turn that belongs to a **Negotiation**.

If Codex can't receive custom tools, a Codex **Chat** gets the push summary and receives **Delegations**, but can't read the other side or delegate.

### Delegation (ADR-0002)

- **Storage.** A **Delegation** is stored in the global store as `{ id, link_id, from_chat, to_chat, message, status, negotiation_id?, round? }`, with `status` one of queued, running, done, cancelled or failed.
- **Choosing the target.** The requesting agent picks the **Worktree** and **Chat** from the summary, or `"new"` to open a **Chat** there (provider and model: the **Project**'s last used). Archived **Chats** can't be chosen.
- **Approval.** Approval follows the requesting **Chat**'s permission mode. In Ask approval, a card shows the target (**Project**, **Worktree**, **Chat**), the message, and "Negotiation, up to 10 rounds" when it is one. Its buttons are Allow once, Always allow for this Link in this chat, and Deny. Auto and Full send directly.
- **Delivery.**
  - **Receiving agent mid-turn:** the **Delegation** steers that turn.
  - **Waiting on the user** (approval or question card): it waits, and is delivered once the user answers.
  - **Idle:** it starts a turn.
  - The receiving **Chat**'s own permission mode governs everything its agent then does.
- **Display.** In the receiving **Chat** it's a message with an explicit sender ("Delegation from *Project / branch / chat title*"), styled apart from the user's, and linking to the requesting **Chat**. The receiving **Chat** gets a sidebar mark while the **Delegation** is pending or running.
- **Report.** When the turn that handled it ends, its final reply becomes the **Delegation report**, posted in the requesting **Chat**. A report never starts a turn, except inside a **Negotiation**.
- **No re-delegation.** A turn started by a **Delegation** can make no **Delegation** of its own, unless the **Delegation** belongs to a **Negotiation**.

### Negotiation

- **Opening.** The requesting agent opens one by calling `delegate` with `negotiation: true`, when it judges that the two sides must agree. The receiving side can't open one.
- **Approval.** In Ask approval, the user approves once, at the start. Later rounds need no approval.
- **Rounds.** Each report starts a turn on the other side, and that turn may reply with a `delegate` within the same **Negotiation**. Each delivered **Delegation** is one round.
- **Ending.** It ends when either agent calls `conclude_negotiation`, when the user presses Stop (canvas or either **Chat**), or after 10 rounds, when both **Chats** get a notice asking the user to step in. On conclusion, the agreement summary is posted in both **Chats**.
- **Pausing.** It pauses while either side is waiting on the user.

### Delivery

The work ships as stacked pull requests, each usable on its own:

1. **Main process owns Chats.** Persistence moves to the main process, and switching **Projects** keeps turns running.
2. **Project identity and registry.** Repository-based identity, the global registry and the one-time scan.
3. **Canvas and Links.** The canvas view, React Flow, saved positions, creating and removing **Links**, and **Link** cleanup.
4. **Linked context.** The push summary, the read-only tools for Claude, and the Codex MCP check and fallback.
5. **Delegation.** `delegate`, the approval card, delivery rules, the sender message, sidebar marks and reports.
6. **Negotiation.** Rounds, `conclude_negotiation`, the cap, Stop, and pause on waiting.

## Testing Decisions

- **Projects and registry.** Project identity and the registry scan are tested against temporary git repositories with linked worktrees: a worktree folder resolves to its **Project**, and removed worktrees and missing projects are dropped.
- **Links.**
  - Visibility is a pure function and is tested directly: worktree and project endpoints, project expansion including later worktrees, one-hop reach, and no self-project links.
  - Cleanup on worktree removal is tested the same way.
- **Push summary.** The builder is pure and tested with fixture states: content, archived **Chats** left out, and the caps.
- **Delegation.** Tested at the session-manager seam with fake providers and two fake **Projects**:
  - delivery to an idle, a running and a waiting **Chat**;
  - a new **Chat**;
  - approval in each mode;
  - the report posted without starting a turn;
  - no re-delegation from a delegated turn;
  - cancellation on **Link** removal.
- **Negotiation.** Fake agents that alternate `delegate` calls, covering:
  - conclusion by either side;
  - the 10-round cap;
  - Stop;
  - a pause while one side waits on an approval;
  - the receiving side being refused when it tries to open one.
- **Tools.** Each read tool is refused for a **Worktree** the **Chat** can't see, and writes are impossible through them.
- **Renderer.** Headless Chromium checks with a stubbed bridge cover canvas nodes, creating a **Link** by dragging, the Delegation card and the sender message.
- **Manual.** Before each pull request is merged, run a real Claude-to-Codex and Codex-to-Claude **Delegation** across two **Projects**, and one **Negotiation**.

## Out of Scope

- Spec 001's typed or temporary Connections, Decisions, Blockers and conflicts.
- Links that reach more than one hop, and **Negotiations** among more than two **Chats**.
- Showing inactive or removed **Worktrees**.
- Agents editing a linked **Worktree** directly.
- Model-written summaries.
- Remote machines.

## Further Notes

- **Codex MCP.** Whether `codex app-server` accepts MCP servers in the per-thread `config` is unverified. Check it before step 4, since it decides whether Codex **Chats** are full participants or receive-only.
- **Turn input context.** Claude's appended system prompt and Codex's `developerInstructions` are fixed at session start, which is why the push summary goes in each turn's input instead.
- **Dead MVP UI.** The never-rendered "Shared context" panel in `ChatComposer.tsx` and its Connection wiring in `App.tsx` belong to spec 001 and can be removed separately.
