## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

This is a single-context repo. See `docs/agents/domain.md`.

### Pull request screenshots

Every PR that changes something visible includes screenshots in its description. Take them from a real run (an Electron check under `scripts/test-*.cjs`, or the dev app) and show the before/after or each state the change adds.

Screenshots never go in the PR's own commits. They live on the `screenshots` branch, which has no shared history with `main`, holds only images and is never merged:

1. Fetch it (`git fetch origin screenshots`) and add the images in a folder named after the feature, e.g. `sidebar-resize/default.png`. Use a temporary worktree or clone so your PR branch stays untouched.
2. Commit and push to `screenshots`.
3. In the PR body, link each image by that commit's SHA so the link never moves: `https://raw.githubusercontent.com/marcosgenesis/milagre-ade/<sha>/<feature>/<name>.png`.

`docs/screenshots/` holds older images from before this rule; don't add to it.
