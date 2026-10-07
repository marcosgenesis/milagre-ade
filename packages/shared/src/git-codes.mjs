export const GIT_CODES = Object.freeze({
  NO_ORIGIN: "NO_ORIGIN",
  DETACHED: "DETACHED",
  DETACHED_COMMIT: "DETACHED_COMMIT",
  GH_MISSING: "GH_MISSING",
  WORKTREE_CHANGED: "WORKTREE_CHANGED",
});
export const GIT_MESSAGES = Object.freeze({
  NO_ORIGIN: "This repo has no origin remote.",
  DETACHED: "Check out a branch to push.",
  DETACHED_COMMIT: "Check out a branch to commit.",
  GH_MISSING: "Install the GitHub CLI (`brew install gh`) to open PRs.",
  WORKTREE_CHANGED: "It changed after you checked, so the chat and its worktree stay.",
});
export const gitMessage = (code) => GIT_MESSAGES[code];
