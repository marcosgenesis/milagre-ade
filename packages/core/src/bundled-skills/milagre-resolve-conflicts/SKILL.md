---
name: milagre-resolve-conflicts
description: Resolve a GitHub pull request's merge conflicts with its base branch, keeping the intent of both sides, then push. Milagre's Resolve conflicts action invokes it with the pull request's number and URL; also usable as /milagre-resolve-conflicts with a pull request number.
---

# Resolve conflicts

The message names the pull request. The user clicking Resolve conflicts is their request to resolve them and push, so commit and push without asking again.

1. Run `git status`. If the tree has uncommitted changes, stop and report them: a merge would sweep them into its commit.
2. Find the base with `gh pr view <number> --json baseRefName,baseRepository`. The base repository may not be `origin` (on a fork it is usually `upstream`): pick the remote in `git remote -v` whose URL matches `baseRepository`, and add it if none does. Then `git fetch <remote> <base>`.
3. Merge it: `git merge <remote>/<base>`. Don't rebase; the branch is already pushed and may be reviewed.
4. For each conflicted file, read both sides and the commits behind them (`git log --oneline HEAD...<remote>/<base> -- <file>`) to learn what each side meant. Keep both intents. When they truly contradict, keep the base branch's behavior and say so in the report.
5. Regenerate lockfiles and generated files with their own tools instead of merging them by hand.
6. Run the typecheck, the linter and the tests that cover the conflicted files.
7. Commit the merge and push. Never force-push.
8. Report each conflicted file and how you resolved it.
