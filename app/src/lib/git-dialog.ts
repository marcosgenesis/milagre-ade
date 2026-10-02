import type { ChatMessage, ModelProvider } from "../model";

// What the "Commit and open PR" dialog shows and which steps its buttons run, from what git and gh
// report about the chat's folder (electron/git-actions.cjs).

export type GitFileStatus = "added" | "modified" | "deleted";

export interface GitFileChange {
  path: string;
  status: GitFileStatus;
  added: number;
  removed: number;
}

export interface GitPullRequest {
  number: number | null;
  url: string;
  state: "OPEN";
}

export type GitChanges =
  | { isRepo: false }
  | {
      isRepo: true;
      path: string;
      /** Null when HEAD is detached. */
      branch: string | null;
      /** The branch a PR goes into. */
      base: string;
      /** Staged, unstaged and untracked files. */
      files: GitFileChange[];
      hasChanges: boolean;
      /** Commits the remote doesn't have. */
      unpushed: number;
      /** Commits on the branch that its base doesn't have. */
      ahead: number;
      hasOrigin: boolean;
      onBase: boolean;
      ghReady: boolean;
      ghMessage: string | null;
      /** The branch's open PR. */
      pr: GitPullRequest | null;
    };

export interface GitTestCommand {
  command: string;
  status: "done" | "failed";
}

/** What the commit message and PR text are written from, besides the diff. */
export interface GitChatContext {
  chatTitle: string;
  firstMessage: string;
  recentMessages: string[];
  testCommands: GitTestCommand[];
}

export type GitTextResult =
  | { ok: true; provider: ModelProvider; commitMessage: string; prTitle: string; prBody: string }
  | { ok: false; message: string };

export type GitCommitResult =
  | { ok: true; sha: string; shortSha: string }
  | { ok: false; kind: "hook" | "nothing" | "error"; message: string; output?: string };

export type GitPushResult =
  | { ok: true; branch: string; remote: string }
  | { ok: false; kind: "rejected" | "no-origin" | "error"; message: string; hint?: string };

export type GitPrResult =
  | { ok: true; url: string; number: number | null }
  | { ok: false; kind: "no-origin" | "on-base" | "gh-missing" | "gh-auth" | "error"; message: string };

export type GitStep = "commit" | "push" | "pr";

export const NO_ORIGIN = "This repo has no origin remote.";
export const DETACHED = "Check out a branch to push.";
export const GH_MISSING = "Install the GitHub CLI (`brew install gh`) to open PRs.";

export interface DialogModeInput {
  hasChanges: boolean;
  unpushed: number;
  prOpen: boolean;
  onBase: boolean;
  hasOrigin: boolean;
  ghReady: boolean;
  /** Commits on the branch its base doesn't have: an already pushed branch can still get its PR. */
  ahead?: number;
  /** The base branch's name, for the reason a PR can't be opened from it. */
  base?: string;
  /** Why gh can't open a PR, when it isn't ready. */
  ghMessage?: string | null;
  detached?: boolean;
}

export interface DialogButton {
  label: string;
  steps: GitStep[];
  /** Shown beside a disabled button. */
  disabledReason: string | null;
}

export interface DialogMode {
  /** The commit message field; hidden when there's nothing to commit. */
  showCommit: boolean;
  /** The PR title and body fields; shown when the primary button opens a PR. */
  showPrFields: boolean;
  /** The branch's PR is open, so pushing updates it. */
  prOpen: boolean;
  /** Why no PR can be opened, shown in the PR section. */
  prBlocked: string | null;
  primary: DialogButton | null;
  secondary: DialogButton | null;
  /** Shown when there is nothing to do. */
  idle: string | null;
}

/** The dialog's sections and buttons for a folder's state. */
export function dialogMode({ hasChanges, unpushed, prOpen, onBase, hasOrigin, ghReady, ahead = 0, base = "main", ghMessage = null, detached = false }: DialogModeInput): DialogMode {
  const pushBlocked = !hasOrigin ? NO_ORIGIN : detached ? DETACHED : null;
  const prBlocked = prOpen ? null : pushBlocked ?? (onBase ? `You're on ${base}. Open a PR from a worktree branch.` : !ghReady ? ghMessage || GH_MISSING : null);
  const canPr = !prOpen && !prBlocked;
  const button = (label: string, steps: GitStep[], disabledReason: string | null = null): DialogButton => ({ label, steps, disabledReason });

  let primary: DialogButton | null = null;
  if (hasChanges) {
    primary = pushBlocked ? button("Commit and push", ["commit", "push"], pushBlocked)
      : canPr ? button("Commit, push and open PR", ["commit", "push", "pr"])
        : button("Commit and push", ["commit", "push"]);
  } else if (unpushed > 0) {
    primary = pushBlocked ? button("Push", ["push"], pushBlocked)
      : canPr ? button("Push and open PR", ["push", "pr"])
        : button("Push", ["push"]);
  } else if (canPr && ahead > 0) {
    primary = button("Open PR", ["pr"]);
  }

  return {
    showCommit: hasChanges,
    showPrFields: Boolean(primary?.steps.includes("pr")),
    prOpen,
    prBlocked,
    primary,
    secondary: hasChanges ? button("Commit only", ["commit"]) : null,
    idle: primary ? null : prOpen ? "Everything is committed and pushed." : "Nothing to commit or push.",
  };
}

const TEST_COMMAND = /\b(test|tests|spec|vitest|jest|pytest|mocha|playwright|rspec|phpunit|ctest)\b/i;

/** Test commands the agent ran in the chat, from its shell steps ("Ran `npm test`"), last run of each. */
export function testCommandsFrom(messages: ChatMessage[]): GitTestCommand[] {
  const byCommand = new Map<string, GitTestCommand>();
  for (const message of messages) {
    for (const step of message.steps ?? []) {
      if (step.kind !== "shell" || step.status === "running") continue;
      const command = /`([^`]+)`/.exec(step.title)?.[1]?.trim();
      if (!command || !TEST_COMMAND.test(command)) continue;
      byCommand.delete(command);
      byCommand.set(command, { command, status: step.status });
    }
  }
  return [...byCommand.values()].slice(-10);
}

/** The chat's title, its first user message, its last few other user messages and the tests it ran. */
export function gitChatContext(chatTitle: string, messages: ChatMessage[]): GitChatContext {
  const userMessages = messages.filter((message) => message.role !== "assistant" && message.body.trim());
  return {
    chatTitle,
    firstMessage: userMessages[0]?.body ?? "",
    recentMessages: userMessages.slice(1).slice(-3).map((message) => message.body),
    testCommands: testCommandsFrom(messages),
  };
}

/** The message "Send to agent" sends after a hook stops the commit. */
export function hookFailureMessage(output: string): string {
  return `The commit failed in a git hook. Fix the problem and tell me when it's ready:\n\n${output}`;
}

export interface GitRunResult {
  shortSha?: string;
  pushedBranch?: string;
  pr?: { url: string; number: number | null; created: boolean };
}

const capitalize = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;

/** The line saved in the chat after the dialog's steps, e.g. "Committed abc1234 and opened PR #12: <link>". Null when nothing happened. */
export function gitRunNote({ shortSha, pushedBranch, pr }: GitRunResult): string | null {
  const prName = pr?.number ? `PR #${pr.number}` : "the PR";
  const done: string[] = [];
  if (shortSha) done.push(`committed ${shortSha}`);
  if (pushedBranch) done.push(`pushed ${pushedBranch}`);
  if (pr?.created) done.push(`opened ${prName}`);
  if (!done.length) return null;
  const list = done.length > 1 ? `${done.slice(0, -1).join(", ")} and ${done.at(-1)}` : done[0];
  if (pr?.created) return `${capitalize(list)}: ${pr.url}`;
  // A push to a branch with an open PR updates it.
  if (pr && pushedBranch) return `${capitalize(list)}. ${capitalize(prName)} is updated: ${pr.url}`;
  return `${capitalize(list)}.`;
}
