# Development and releases

[Back to the README](../README.md)

## Development

```bash
npm ci
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run build
npm test -- --unit
npm run release:dry
```

Repository testing skills live in `.agents/skills`: `test-milagre-app` covers isolated Electron checks and screenshots; `test-milagre-mobile` covers device attachment, disposable hosts and native UI verification. These guide development of Milagre and are discovered as workspace skills. They are not bundled into the installed app.

The repo uses npm workspaces with one root lockfile. Run the existing commands from the repository root; `npm ci` installs every workspace. Set `DO_NOT_TRACK=1` in your shell: `@openuidev/lang-core` pings an analytics endpoint at install time otherwise. `npm test -- --only monorepo` checks package resolution and desktop packaging metadata. After building, `npm test -- --only test-desktop` opens the real app against temporary saved Chats and settings. On macOS, run `node scripts/test-desktop.cjs --packaged release/mac-arm64/Milagre.app` to check a local installer build too (use `release/mac/Milagre.app` for Intel).

`npm run dev` starts Vite and opens the Electron shell. The renderer is served locally at port 5180 during development. Its production build is in `apps/desktop/dist/`; installers remain in the root `release/` directory. The desktop package keeps its existing app identity and data paths, so saved Chats and settings need no migration.

## Releases

Merges into `main` run `semantic-release` to create a version tag and draft GitHub Release when the commits warrant a release. Commit and Pull Request titles should use Conventional Commits:

```text
fix: correct agent cancellation       # patch release
feat: add worktree canvas             # minor release
feat!: change the coordination API    # major release
docs: clarify setup                   # no release
```

To ship a candidate, run the **Publish** workflow with `channel=stable` (and optionally its `vX.Y.Z` tag; empty means the newest draft). It builds the macOS DMG and ZIP installers for Intel and Apple Silicon and the Linux AppImage, DEB and RPM, attaches the installers and update feeds, publishes the draft release and redeploys the Linux package repository. `channel=beta` ships the same candidate as a `vX.Y.Z-beta.N` prerelease instead. Draft candidates stay invisible to installed apps. Installed builds check published GitHub Releases at startup, download updates in the background, and ask to restart when ready. Use `npm run release:dry` to inspect what would be released without creating a tag.

Release installers require a Developer ID Application certificate and Apple notarization. The workflow checks Apple credentials before creating a release, signs and notarizes the app, and signs, notarizes and staples the DMG. It verifies signatures, notarization tickets, Gatekeeper acceptance and DMG integrity before uploading installers. See [macOS signing setup](agents/macos-signing.md) for the required GitHub Actions secrets.

For a local build without an Apple certificate, use `npm run package:mac:local`. This explicitly uses an ad-hoc signature and skips notarization; downloaded copies still require a manual security exception.

## README image

`node scripts/capture-readme.cjs /tmp/milagre-readme` captures the real desktop renderer with mock Chats and starts a read-only mobile fixture on `127.0.0.1:8798`. Open its printed demo pairing link in a simulator, capture the Project sidebar, then compose both captures:

```sh
node scripts/capture-readme.cjs /tmp/milagre-readme --compose /absolute/path/to/mobile.png
```

The output is `/tmp/milagre-readme/desktop-and-mobile.png`. Stop the fixture with Ctrl+C. Use `--host-only` to restart it without recapturing desktop. Keep images on the orphan `screenshots` branch and link the README to the image commit's SHA, as described in [AGENTS.md](../AGENTS.md). The fixture opens no real Project and calls no provider.
