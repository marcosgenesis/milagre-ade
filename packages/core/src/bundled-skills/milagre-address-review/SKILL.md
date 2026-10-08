---
name: milagre-address-review
description: Address the changes a reviewer requested on a GitHub pull request, then push. Milagre's Address review action invokes it with the pull request's number and URL; also usable as /milagre-address-review with a pull request number.
---

# Address review

The message names the pull request. The user clicking Address review is their request to make the changes and push, so commit and push without asking again.

1. Run `git status`. If the tree has uncommitted changes you didn't make, stop and report them instead of committing them with your changes.
2. Read the review summaries with `gh pr view <number> --comments`.
3. Read the inline threads with their resolved state. The REST comments API doesn't have it, so use GraphQL:
   `gh api graphql --paginate -f owner=<owner> -f repo=<repo> -F number=<number> -f query='query($owner:String!,$repo:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{isResolved isOutdated path line comments(first:20){nodes{author{login} body}}}}}}}'`
   Every thread with `isResolved: false` needs action, whatever review round it came from.
4. Write a list with one line per unresolved thread and per change asked for in a review summary: its `file:line` and what the reviewer asked.
5. Address each one. When a comment is wrong or already out of date, leave the code as it is and note why.
6. Run the checks for the code you changed.
7. Commit only the files you changed, and push. Never force-push. Don't reply to or resolve threads on GitHub; the user does that.
8. Report the list: each comment, and what you changed for it or why you didn't.
