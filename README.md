# Milagre

Milagre is a local-first desktop ADE for coordinating coding agents across projects and git worktrees.

The current public alpha uses React and Electron. It is designed for a solo developer who wants to see related worktrees, share context between agent sessions, and keep approval-sensitive operations visible without losing the raw output.

> The project is experimental. Do not use Full permission mode in a workspace you cannot recover.

## What exists today

- A React renderer inside an Electron desktop shell.
- Project and worktree-oriented chat navigation.
- Codex and Claude CLI process integration through Electron's main process.
- Ask approval, Auto and Full permission modes.
- Tool approval cards for file changes and other write operations.
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

The menu refreshes when reopened and when switching worktrees. Skill names and descriptions come from YAML frontmatter, with the folder name as a fallback. Unreadable or invalid skills are reported without blocking the rest of the list. Discovery is limited to eight nested levels and 2,000 directories; individual skill files and the combined skill context are limited to 256 KiB. Only standalone slash tokens outside inline and fenced code invoke skills. In Ask approval mode, slash requests require confirmation before the agent runs.

## Permission modes

- **Ask approval**: pauses before risky write or execution operations and shows the requested command or change.
- **Auto**: allows ordinary agent work while retaining safeguards for higher-risk operations.
- **Full**: gives the selected CLI the broadest available local access. Use only when you explicitly trust the prompt and workspace.

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
