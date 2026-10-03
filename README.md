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
- Each command, file edit, read and search an agent runs shows as a row in its reply, such as "Ran `npm test`", whose title shimmers while it runs. Click a row for its output or diff. Saved replies keep their rows.
- Local coordination state under `.milagre/coordination.json`.
- Concise agent output with access to raw details.

The broader coordination graph, canvas and richer provider adapters are documented in [`docs/specs/001-agent-coordination-ade.md`](docs/specs/001-agent-coordination-ade.md).

## Requirements

- macOS
- Node.js 24 or newer
- npm
- At least one local CLI agent, logged in: Claude Code 2.1.286 or newer (`claude auth login`), or Codex CLI 0.158.0 or newer (`codex login`)

Milagre runs agent commands locally. It does not provide model credentials or a hosted inference service.

Milagre reads your login shell's environment at startup, so it finds the agents and gives them your `PATH` (`node`, `git`, `gh` and the rest) even when it's opened from Finder or the Dock. The model picker lists the models each installed CLI reports.

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

The repo uses npm workspaces with one root lockfile. Run the existing commands from the repository root; `npm ci` installs every workspace. `npm run test:monorepo` checks package resolution and desktop packaging metadata. After building, `npm run test:desktop` opens the real app against temporary saved Chats and settings. On macOS, add `-- --packaged release/mac-arm64/Milagre.app` to check a local installer build too (use `release/mac/Milagre.app` for Intel).

`npm run dev` starts Vite and opens the Electron shell. The renderer is served locally at port 5180 during development. Its production build is in `apps/desktop/dist/`; installers remain in the root `release/` directory. The desktop package keeps its existing app identity and data paths, so saved Chats and settings need no migration.

## Releases

Releases are automated from merges into `main` with `semantic-release`. Commit and Pull Request titles should use Conventional Commits:

```text
fix: correct agent cancellation       # patch release
feat: add worktree canvas             # minor release
feat!: change the coordination API    # major release
docs: clarify setup                   # no release
```

The release workflow creates a `vX.Y.Z` tag and a GitHub Release with generated notes, then uploads macOS DMG and ZIP installers for Intel and Apple Silicon. Installed builds check GitHub Releases at startup, download updates in the background, and ask to restart when ready. Use `npm run release:dry` to inspect what would be released without creating a tag.

Release installers require a Developer ID Application certificate and Apple notarization. The workflow checks Apple credentials before creating a release, signs and notarizes the app, and signs, notarizes and staples the DMG. It verifies signatures, notarization tickets, Gatekeeper acceptance and DMG integrity before uploading installers. See [macOS signing setup](docs/agents/macos-signing.md) for the required GitHub Actions secrets.

For a local build without an Apple certificate, use `npm run package:mac:local`. This explicitly uses an ad-hoc signature and skips notarization; downloaded copies still require a manual security exception.

## Attachments and file mentions

Use **+ > Add files**, or drop files onto the chat, to attach local files. Images and videos have previews in the draft and sent message. Click a preview to open it; videos have playback controls. Escape closes the viewer without stopping the agent. Other files appear as removable filename chips before sending.

File paths reach the agent while the visible message keeps your prompt text. Disk previews require the original files to remain in place. Picked or dropped PNG, JPEG, WebP, and GIF images up to 5 MB are also sent as image content, up to four per message. Larger images and other files are sent by path. Video playback depends on the format supported by Electron.

Paste an image with Cmd+V (Ctrl+V on other platforms) to send image content without a disk path. Pasted images keep the four-image and 5 MB limits and remain in local conversation history. Claude receives structured image content; Codex receives temporary image files removed when its request finishes.

Type `@` to find tracked and untracked, non-ignored files in the chat's worktree. Search by filename or path and select with Enter or Tab. Images and videos appear as previews in the composer; other files appear as removable chips. The selected path is sent to the agent without inserting it into your message text. Results are limited and cached for five seconds. Switching chats clears attachment drafts.

Restart Electron after updating to register the media protocol and file-search IPC. Run `npm run test:chat-attachments` for the Chromium integration checks, including video playback, attachment delivery and file selection without calling an agent.

## Notifications

Milagre can notify when a turn completes or fails while its chat is not focused, with a preview of the result. Clicking the notification opens that chat, including switching projects through the usual confirmation flow. The focused chat stays quiet; cancelled turns do not send completion alerts.

The Dock badge counts chats with unread replies or pending approvals/questions, counting each chat once. Reading a chat clears its unread status. **Settings > General** has separate switches for completion notifications, waiting notifications and the Dock badge.

## Workspace image

The sidebar uses the project's main image first, then the GitHub organization avatar for organization-owned repositories, then the profile authenticated in GitHub CLI (`gh`). If `gh` is not authenticated, a personal repository's owner avatar is used. If no image is available, the workspace keeps its default icon.

To explicitly choose a project image, add `.milagre/icon.png` (SVG, JPEG, WebP, GIF and ICO are also supported). Otherwise Milagre checks `package.json` (`build.mac.icon`, `build.icon`, or `expo.icon`), followed by common logo/icon files in the project root, `public/`, `app/public/`, and `assets/icon.*`. Next it checks `favicon.*` in the project root, `public/`, `app/public/`, `app/`, `src/app/`, and `static/`, plus `app/icon.*` and `src/app/icon.*`. Local images must be inside the project and at most 5 MB. Image lookup runs in the background when opening or switching projects; GitHub credentials stay in the main process. Restart Electron after updating the backend.

## Slash skills

Type `/` in the prompt to search commands and installed skills by name or description. Built-in commands appear first under **Milagre skills**, followed by **Workspace skills** and **User skills**. Select a skill with a click, Enter, or Tab, add your request, and send. Milagre reads the selected `SKILL.md` and includes its instructions and reference directory in the agent request.

Milagre bundles `/tldr` and its checklist. Its writing rules apply by default to Claude and Codex progress updates and final replies through their shared instructions. Toggle **Settings > General > Agents > TLDR writing** to enable or disable this default. The preference is saved across app restarts and applies when the next turn starts after any running reply finishes, including in existing chats. The `/tldr` skill remains available when the toggle is off. Say `stop tldr` or `normal mode` to ask the agent to disable them for the current chat; `/tldr` enables them again. `/tldr <text or file>` rewrites one input, and `/tldr is this slop? <text>` audits it. These are agent instructions, so compliance depends on the model. Streaming replies are displayed directly without a second rewrite request.

Skills are discovered recursively in `.agents/skills`, `.claude/skills`, `.gemini/skills`, and `.codex/skills`, under both the active worktree and your home directory. Symlinked skill directories are supported. Workspace skills take precedence over user skills with the same name; within each scope, directories are checked in the order above. A skill with the same name as a built-in command takes precedence over that command.

Bundled skills are the fallback after workspace and user skills. An installed `/tldr` overrides the bundled slash command; the default writing rules still come from Milagre's bundled copy. Bundled skill files are unpacked in the desktop build so agents can read their references.

The menu refreshes when reopened and when switching worktrees. Skill names and descriptions come from YAML frontmatter, with the folder name as a fallback. Unreadable or invalid skills are reported without blocking the rest of the list. Discovery is limited to eight nested levels and 2,000 directories; individual skill files and the combined skill context are limited to 256 KiB. Only standalone slash tokens outside inline and fenced code invoke skills.

## Permission modes

- **Ask approval**: the agent stops before a file edit or command it isn't already allowed to run, and shows the exact command or change. Claude asks before edits and before commands outside its allow rules; Codex asks before any command it doesn't already trust.
- **Auto**: file edits inside the workspace go ahead. Claude still asks before commands outside its allow rules; Codex works inside its workspace sandbox and asks only to go beyond it.
- **Full**: no approvals, and Codex runs without its sandbox. Use only when you trust the prompt and the workspace.

Escape denies an open approval card and dismisses an open question card. "Always allow in this chat" lasts while the chat's agent stays open, which ends after 10 idle minutes or when Milagre quits, and never changes your Claude or Codex settings files.

Question cards appear in every mode, Full included. A message you send while a question is open dismisses it and reaches the agent as your reply. Codex asks with a card through a Codex feature that is still under development; without it, Codex asks in its reply.

The approval boundary is enforced by the shared core runtime, hosted in Electron for desktop. The renderer can request work, but it should not receive arbitrary filesystem or process privileges.

## Repository layout

```text
apps/desktop/     Desktop package (milagre): React renderer and Electron host
apps/daemon/      Opt-in local Node daemon (@milagre/daemon)
packages/core/    Chat runtime, providers, persistence and Worktrees (@milagre/core)
packages/shared/  Shared model, Chat operations and state reducers (@milagre/shared)
scripts/          Root development, integration-test and release helpers
docs/             Product and domain documentation
```

See [Local daemon](docs/local-daemon.md) for commands, ownership rules and recovery. Desktop currently embeds core; remote clients and the desktop transport switch follow separately.

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. For security-sensitive issues, follow [`SECURITY.md`](SECURITY.md).

## License

Milagre is released under the [MIT License](LICENSE).
