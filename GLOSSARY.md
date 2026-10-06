# Milagre

Milagre coordinates coding agents across projects and git worktrees on one machine. This glossary names the concepts users and agents share.

## Language

### Work

**Account**:
A saved Claude or Codex sign-in on one computer. Each provider has one selected **Account** for that computer's **Projects**. Desktop and paired phones share the selection. A running reply keeps its existing **Account**; the next turn uses the selected one.

**Project**:
A git repository that has been opened in Milagre at least once. Every **Worktree** of the repository belongs to the same **Project**, whichever of its folders was opened.
_Avoid_: folder, workspace, repo

**Worktree**:
A git working directory of a **Project**, the main checkout included. A **Worktree** is active while git lists it and its folder exists; only active **Worktrees** appear on the canvas.
_Avoid_: branch (a **Worktree** has a branch, it isn't one)

**Chat**:
One conversation with one agent. A Project Chat is bound to exactly one **Worktree**; a named Link's shared Chat owns one isolated **Worktree** in each member **Project**. An ordinary **Worktree** can have many **Chats**; a shared Chat's owned Worktree does not receive an independent editable Project Chat.
An archived **Chat** stays readable from a linked side but is never chosen to receive a **Delegation**.
_Avoid_: session, thread (the providers' names for the agent process behind a **Chat**)

**Browser page**:
A page in a Chromium browser on the host that a **Chat** may view and control. It belongs to the **Chat** whose agent process started its browser, or to a **Chat** the user attached that browser to. See ADR-0006.
_Avoid_: tab (a browser's own UI term), session (the page's sign-in state is part of it, not a separate thing)

### Linking

**Named Link**:
A named, selectable set of two or more **Projects** in the desktop sidebar. Its shared **Chats** each create their own set of isolated **Worktrees**, one per member Project, and have one canonical conversation. The agent can edit all Worktrees owned by that Chat. Named Links do not create or replace canvas Links. See ADR-0005.

**Link**:
A symmetric, persistent relationship the user draws on the canvas between two **Link** endpoints, each a **Project** or a **Worktree**. Every **Chat** on either side sees the other side's state and can make a **Delegation** to it. A **Link** reaches one hop only: X–Y and Y–Z do not let X see or delegate to Z. It has no type and lasts until the user removes it or a **Worktree** endpoint stops being active. A **Project** endpoint stands for all of that project's active **Worktrees**, including ones created after the **Link**.
_Avoid_: Connection (the typed, possibly temporary relationship in spec 001, a separate feature), vínculo

**Delegation**:
A request from a **Chat** in one side of a **Link** for changes on the other side, delivered as a message to a **Chat** there and carried out by that side's own agent. The requesting agent picks the receiving **Worktree** and **Chat**, opening a new **Chat** when none fits. It appears there as a message from the requesting **Chat**, never as the user's. If the receiving agent is mid-turn, it steers that turn; if it is waiting on the user, the **Delegation** waits too. The requesting agent never edits the other side's files itself. When the receiving agent finishes, a **Delegation report** appears in the requesting **Chat**.
_Avoid_: remote edit, cross-worktree edit

**Delegation report**:
A summary of what the receiving agent did for a **Delegation**, posted to the requesting **Chat**. Outside a **Negotiation** it never starts a turn there on its own.

**Negotiation**:
A back-and-forth of **Delegations** between two **Chats** across a **Link**, where each **Delegation report** starts a turn on the other side, until one agent concludes it with a summary of the agreement. The requesting agent decides on its own that a request needs a **Negotiation**, and only it can; the user never has to ask for one, and the receiving side can't turn a **Delegation** into one. It stops after at most 10 rounds, when the user stops it, and pauses while either side waits on the user.
_Avoid_: consensus mode, auto-chat

## Relationships

- A **Project** has one or more **Worktrees**; an ordinary **Worktree** has one or more **Chats**. A named Link's shared **Chat** owns one **Worktree** per member **Project**.
- A **Link** joins exactly two endpoints; each endpoint is a **Project** or a **Worktree**.
- A **Delegation** travels along exactly one **Link**, from one **Chat** to one **Chat**.
- A **Negotiation** involves exactly two **Chats** and is made of **Delegations** along one **Link**.

## Example dialogue

> **Dev:** "X and Y are linked. In X's chat I asked for the new endpoint to be wired into the frontend."
> **Domain expert:** "Then X's agent makes a **Delegation** to a **Chat** in Y. Y's own agent edits Y. X only gets the **Delegation report**."
> **Dev:** "And if the two have to agree on the payload shape first?"
> **Domain expert:** "X's agent opens a **Negotiation** by itself. Each report starts the other side's turn until one of them concludes."

## Flagged ambiguities

- "Connection" in spec 001 and "Link" here are different features: spec 001's Connection is typed and can be temporary; a **Link** is untyped and persistent.
- The UI and README say "workspace" for what this glossary calls a **Project**.
