// The line a Chat shows when a Link on the canvas reaches its Worktree (context kind "worktree-linked"). Types: worktree-link.d.mts.

export function isWorktreeLinked(message) {
  return message?.context?.kind === "worktree-linked";
}

/**
 * What the line says after "Linked to": another Project by name with its branch (or how many Worktrees a whole-Project
 * Link reached), or, in the Chat's own Project, the other Worktree's branch.
 */
export function worktreeLinkLabel(context) {
  const [first, ...rest] = context.branches;
  if (context.sameProject)
    return { lead: rest.length ? `${context.branches.length} Worktrees` : "Worktree", project: null, detail: rest.length ? null : first };
  return { lead: null, project: context.project.name, detail: rest.length ? `· ${context.branches.length} Worktrees` : first };
}

/** The line as text: the message body, and the label screen readers and the transcript use. */
export function worktreeLinkText(context) {
  const label = worktreeLinkLabel(context);
  const name = [label.lead, label.project, label.detail].filter(Boolean).join(" ");
  return `Linked to ${name}${context.sameProject ? " in this Project" : ""}`;
}

/** The linked summary as the line opens it: without the tags that wrap it for the agent. */
export function linkedSummaryText(summary) {
  return summary
    .replace(/^\s*<linked_worktrees>\s*/, "")
    .replace(/\s*<\/linked_worktrees>\s*$/, "")
    .trim();
}
