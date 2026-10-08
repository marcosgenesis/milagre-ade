---
name: milagre-update-branch
description: Bring a GitHub pull request's branch up to date with its base branch, fix what the update breaks, then push. Milagre's Update branch action invokes it with the pull request's number and URL; also usable as /milagre-update-branch with a pull request number.
---

# Update branch

The message names the pull request. The user clicking Update branch is their request to update it and push, so commit and push without asking again.

1. Run `git status`. If the tree has uncommitted changes, stop and report them: a merge would sweep them into its commit.
2. Find the base with `gh pr view <number> --json baseRefName,baseRepository`. The base repository may not be `origin` (on a fork it is usually `upstream`): pick the remote in `git remote -v` whose URL matches `baseRepository`, and add it if none does. Then `git fetch <remote> <base>`.
3. Merge it: `git merge <remote>/<base>`. Don't rebase. If the merge conflicts, resolve it as [milagre-resolve-conflicts](../milagre-resolve-conflicts/SKILL.md) describes.
4. Run the typecheck, the linter and the tests. Fix whatever the new base commits broke on this branch, such as a renamed module or a changed API.
5. Push. Never force-push.
6. Report how many commits came in from the base branch and any fixes you made.
