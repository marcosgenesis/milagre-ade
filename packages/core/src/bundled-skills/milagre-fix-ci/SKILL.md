---
name: milagre-fix-ci
description: Fix the failing CI checks on a GitHub pull request and push the fix. Milagre's Fix CI action invokes it with the pull request's number and URL; also usable as /milagre-fix-ci with a pull request number.
---

# Fix CI

The message names the pull request. The user clicking Fix CI is their request to fix it and push, so commit and push without asking again.

1. List the checks with `gh pr checks <number>`. Note each failing check and its run id.
2. Read each failure with `gh run view <run-id> --log-failed`. Find the first real error, not the errors that cascade from it.
3. Decide whether the failure is this branch's. A check that also fails on the base branch, or a timeout or network error with no code cause, is not: rerun it once with `gh run rerun <run-id> --failed`, and if it fails again, report it instead of changing code.
4. Reproduce the failure locally with the command the workflow runs (read it in `.github/workflows/`). Fix the cause. Never skip, disable or loosen a check, and never mark a test as skipped to get green.
5. Run that command again, plus the repo's own pre-push checks, until it passes.
6. Commit with a message that names the fix, and push to the pull request's branch. Never force-push.
7. Report each failing check, its cause, your fix and the local command that now passes. Name any check you left alone and why.
