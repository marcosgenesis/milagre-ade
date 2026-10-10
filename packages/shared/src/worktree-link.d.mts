import type { ChatMessage, WorktreeLinkedContext } from "./model.ts";

export function isWorktreeLinked(message: ChatMessage | undefined): message is ChatMessage & { context: WorktreeLinkedContext };
/** `lead` and `project` are null when absent; `detail` is a branch, or a Worktree count for a whole-Project Link. */
export function worktreeLinkLabel(context: WorktreeLinkedContext): { lead: string | null; project: string | null; detail: string | null };
export function worktreeLinkText(context: WorktreeLinkedContext): string;
/** The linked summary as the line opens it: without the tags that wrap it for the agent. */
export function linkedSummaryText(summary: string): string;
