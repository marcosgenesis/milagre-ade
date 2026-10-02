# Linked Worktrees change through Delegation, not direct edits

When a **Chat** in X wants changes in a linked **Worktree** Y, it sends a **Delegation** that Y's own agent carries out. X's agent can read Y, but it never writes to Y. This keeps a single agent acting in each **Worktree**, so two agents never edit the same files at once. It also keeps approvals and history in Y's own **Chat**, and lets the agent that already knows Y do the work.

## Considered Options

- Give X's agent write access to Y (extra writable directories): rejected. Two agents would be editing one **Worktree** at the same time, and Y's **Chats** would have no record of the change.
- Allow both, case by case: rejected, because every request would raise "who edits?" again.

## Consequences

- Changes in Y happen asynchronously. X learns the outcome from a **Delegation report**, or from a **Negotiation** when both sides have to agree.
- Read access to the other side goes through Milagre's read-only query tools. It does not rely on the agent's own file permissions, which Codex's sandbox limits.
