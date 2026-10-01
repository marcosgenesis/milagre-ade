# Milagre

Milagre is a local-first desktop ADE for coordinating coding agents across projects and git worktrees.

The current public alpha uses React and Electron. It is designed for a solo developer who wants to see related worktrees, share context between agent sessions, and keep approval-sensitive operations visible without losing the raw output.

> The project is experimental. Do not use Full permission mode in a workspace you cannot recover.

## What exists today

- A React renderer inside an Electron desktop shell.
- Project and worktree-oriented chat navigation.
- One long-lived agent session per chat, run by Electron's main process: Claude through the Claude Agent SDK and Codex through `codex app-server`. Replies stream in as formatted Markdown with syntax-highlighted code, chats remember earlier turns after a restart, a message sent while the agent works steers it, and Escape cancels a running turn. Links in replies open in your browser.
- Ask approval, Auto and Full permission modes.
- Approval cards that show the exact command or file change an agent wants to make, with Allow once, Always allow in this chat, and Deny.
- Question cards: when an agent asks you to choose, its options appear as a card. Tap one (or several, where the agent allows it), type your own answer, or dismiss the question; the agent carries on in the same turn.
- Local coordination state under `.milagre/coordination.json`.
- Concise agent output with access to raw details.

The broader coordination graph, canvas and richer provider adapters are documented in [`docs/specs/001-agent-coordination-ade.md`](docs/specs/001-agent-coordination-ade.md).

## Requirements

- macOS
- Node.js 24 or newer
- npm
- At least one supported local CLI agent, such as Codex CLI or Claude Code

Milagre runs agent commands locally. It does not provide model credentials or a hosted inference service.

## Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run build
npm run test:agent
npm run release:dry
```

`npm run dev` starts Vite and opens the Electron shell. The renderer is served locally at port 5180 during development.

## Releases

Releases are automated from merges into `main` with `semantic-release`. Commit and Pull Request titles should use Conventional Commits:

```text
fix: correct agent cancellation       # patch release
feat: add worktree canvas             # minor release
feat!: change the coordination API    # major release
docs: clarify setup                   # no release
```

The release workflow creates a `vX.Y.Z` tag and a GitHub Release with generated notes, then uploads macOS DMG and ZIP installers for Intel and Apple Silicon. Installed builds check GitHub Releases at startup, download updates in the background, and ask to restart when ready. Use `npm run release:dry` to inspect what would be released without creating a tag.

For production distribution, configure Apple Developer signing and notarization in GitHub Actions. Without them, macOS can show security warnings or block downloaded updates.

## Pasting images

Paste an image into the chat prompt with Cmd+V (Ctrl+V on other platforms). Images appear as removable thumbnails and can be sent with a prompt or on their own. PNG, JPEG, WebP, and GIF are supported, with up to four images per message and a 5 MB limit per image. Plain-text pasting is unchanged.

Sent images remain in the local conversation history. Claude receives image content through structured input; Codex receives temporary image files that are removed when its request finishes. Restart the development Electron process after updating to load the new image-handling backend.

## Workspace image

The sidebar uses the project's main image first, then the GitHub organization avatar for organization-owned repositories, then the profile authenticated in GitHub CLI (`gh`). If `gh` is not authenticated, a personal repository's owner avatar is used. If no image is available, the workspace keeps its default icon.

To explicitly choose a project image, add `.milagre/icon.png` (SVG, JPEG, WebP, GIF and ICO are also supported). Otherwise Milagre checks `package.json` (`build.mac.icon`, `build.icon`, or `expo.icon`), followed by common logo/icon files in the project root, `public/`, `app/public/`, and `assets/icon.*`. Next it checks `favicon.*` in the project root, `public/`, `app/public/`, `app/`, `src/app/`, and `static/`, plus `app/icon.*` and `src/app/icon.*`. Local images must be inside the project and at most 5 MB. Image lookup runs in the background when opening or switching projects; GitHub credentials stay in the main process. Restart Electron after updating the backend.

## Slash skills

Type `/` in the prompt to search commands and installed skills by name or description. Built-in commands appear first under **Milagre skills**, followed by **Workspace skills** and **User skills**. Select a skill with a click, Enter, or Tab, add your request, and send. Milagre reads the selected `SKILL.md` and includes its instructions and reference directory in the agent request.

Skills are discovered recursively in `.agents/skills`, `.claude/skills`, `.gemini/skills`, and `.codex/skills`, under both the active worktree and your home directory. Symlinked skill directories are supported. Workspace skills take precedence over user skills with the same name; within each scope, directories are checked in the order above. A skill with the same name as a built-in command takes precedence over that command.

The menu refreshes when reopened and when switching worktrees. Skill names and descriptions come from YAML frontmatter, with the folder name as a fallback. Unreadable or invalid skills are reported without blocking the rest of the list. Discovery is limited to eight nested levels and 2,000 directories; individual skill files and the combined skill context are limited to 256 KiB. Only standalone slash tokens outside inline and fenced code invoke skills.

## Permission modes

- **Ask approval**: the agent stops before a file edit or command it isn't already allowed to run, and shows the exact command or change. Claude asks before edits and before commands outside its allow rules; Codex asks before any command it doesn't already trust.
- **Auto**: file edits inside the workspace go ahead. Claude still asks before commands outside its allow rules; Codex works inside its workspace sandbox and asks only to go beyond it.
- **Full**: no approvals, and Codex runs without its sandbox. Use only when you trust the prompt and the workspace.

Escape denies an open approval card and dismisses an open question card. "Always allow in this chat" lasts while the chat's agent stays open, which ends after 10 idle minutes or when Milagre quits, and never changes your Claude or Codex settings files.

Question cards appear in every mode, Full included. A message you send while a question is open dismisses it and reaches the agent as your reply. Codex asks with a card through a Codex feature that is still under development; without it, Codex asks in its reply.

The approval boundary is enforced in the Electron main process. The renderer can request work, but it should not receive arbitrary filesystem or process privileges.

## Repository layout

```text
app/       React renderer, components and styles
electron/  Electron main process, preload bridge and agent runner
scripts/   Development launch helpers
docs/      Product and domain documentation
```

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. For security-sensitive issues, follow [`SECURITY.md`](SECURITY.md).

## License

Milagre is released under the [MIT License](LICENSE).
