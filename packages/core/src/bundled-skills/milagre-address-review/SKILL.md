---
name: milagre-address-review
description: Address the changes a reviewer requested on a GitHub pull request, then push. Milagre's Address review action invokes it with the pull request's number and URL; also usable as /milagre-address-review with a pull request number.
---

# Address review

The message names the pull request. The user clicking Address review is their request to make the changes and push, so commit and push without asking again.

1. Read the reviews with `gh pr view <number> --comments`, and the inline comments with `gh api repos/{owner}/{repo}/pulls/<number>/comments`. Only unresolved comments from the latest review round need action.
2. Write a list with one line per comment: its `file:line` and what the reviewer asked.
3. Address each one. When a comment is wrong or already out of date, leave the code as it is and note why.
4. Run the checks for the code you changed.
5. Commit and push. Never force-push. Don't reply to or resolve threads on GitHub; the user does that.
6. Report the list: each comment, and what you changed for it or why you didn't.
