---
name: milagre-fix-ci
description: Fix the failing CI checks on a GitHub pull request and push the fix. Milagre's Fix CI action invokes it with the pull request's number and URL; also usable as /milagre-fix-ci with a pull request number.
---

# Fix CI

The message names the pull request. The user clicking Fix CI is their request to fix it and push, so commit and push without asking again.

1. Run `git status`. If the tree has uncommitted changes you didn't make, stop and report them instead of committing them with your fix.
2. List the checks with `gh pr checks <number> --json name,state,link`. For each failing GitHub Actions check, the run id is the number after `/actions/runs/` in its link. A check from another service (Vercel, CircleCI and the like) has no run id: open its link with `gh` or report it if you can't read its logs.
3. Read each Actions failure with `gh run view <run-id> --log-failed`. Find the first real error, not the errors that cascade from it.
4. Decide whether the failure is this branch's. A timeout or network error with no code cause is flaky: rerun it once with `gh run rerun <run-id> --failed`. A check that fails the same way on the base branch is not this branch's to fix: report it instead of changing code.
5. Reproduce the failure locally with the command the workflow runs (read it in `.github/workflows/`). Fix the cause. Never skip, disable or loosen a check, and never mark a test as skipped to get green.
6. Run that command again, plus the repo's own pre-push checks, until it passes.
7. Commit only the files you changed, with a message that names the fix, and push to the pull request's branch. Never force-push.
8. Report each failing check, its cause, your fix and the local command that now passes. Name any check you left alone and why.
