---
name: milagre-resolve-conflicts
description: Resolve a GitHub pull request's merge conflicts with its base branch, keeping the intent of both sides, then push. Milagre's Resolve conflicts action invokes it with the pull request's number and URL; also usable as /milagre-resolve-conflicts with a pull request number.
---

# Resolve conflicts

The message names the pull request. The user clicking Resolve conflicts is their request to resolve them and push, so commit and push without asking again.

1. Find the base branch with `gh pr view <number> --json baseRefName --jq .baseRefName`, then `git fetch origin <base>`.
2. Merge it: `git merge origin/<base>`. Don't rebase; the branch is already pushed and may be reviewed.
3. For each conflicted file, read both sides and the commits behind them (`git log --oneline HEAD...origin/<base> -- <file>`) to learn what each side meant. Keep both intents. When they truly contradict, keep the base branch's behavior and say so in the report.
4. Regenerate lockfiles and generated files with their own tools instead of merging them by hand.
5. Run the typecheck, the linter and the tests that cover the conflicted files.
6. Commit the merge and push. Never force-push.
7. Report each conflicted file and how you resolved it.
