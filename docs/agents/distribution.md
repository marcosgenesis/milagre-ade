# Desktop packages

macOS is available through the [public Homebrew tap](https://github.com/the-ptf/homebrew-tap):

```sh
brew install --cask the-ptf/tap/milagre
```

The tap starts with the signed, notarized `v0.88.0` release for Apple Silicon and Intel. Its scheduled updater downloads both stable-release DMGs, checks their sizes and hashes, and commits the new cask. Uninstalling keeps saved Chats and settings.

| Platform | Architecture | Installers | Distribution |
| --- | --- | --- | --- |
| macOS | Apple Silicon, Intel | DMG, ZIP | Homebrew tap and signed GitHub releases |
| Windows | x64 | Per-user NSIS EXE | WinGet manifest; public listing awaits a tested signed release |
| Linux | x64 | AppImage, DEB, RPM | Signed APT/RPM metadata and Cloudflare hosting workflow; first publication pending |

Windows ARM64, Linux ARM64, Chocolatey, Scoop, Flatpak and Snap remain outside this implementation. Git and a supported, logged-in agent CLI are still required. Electron bundles the host's Node runtime.

## Build and metadata

After `npm ci`, run on the target OS:

```sh
npm run package:mac:local -- --x64 --arm64 --config.extraMetadata.version=1.2.3
npm run package:win -- --config.extraMetadata.version=1.2.3
npm run package:linux -- --config.extraMetadata.version=1.2.3
```

Outputs live in `release/`: `Milagre-X.Y.Z-{arm64,x64}.{dmg,zip}`, `Milagre-Setup-X.Y.Z-x64.exe`, `Milagre-X.Y.Z-x86_64.AppImage`, `Milagre-X.Y.Z-amd64.deb`, and `Milagre-X.Y.Z-x86_64.rpm`. Linux's desktop file is `milagre.desktop`.

Generate signed Linux repositories before hashing the installers, because RPM signing changes its bytes:

```sh
npm run package:repositories -- --tag v1.2.3 --artifacts release \
  --output release/linux-repository --sign-rpm
node scripts/finalize-update-feeds.cjs --tag v1.2.3 --platform linux
npm run package:managers -- --tag v1.2.3 --platform all
node scripts/finalize-update-feeds.cjs --tag v1.2.3 --check
```

`package:repositories` requires `GNUPGHOME` outside the repo and `MILAGRE_LINUX_SIGNING_KEY` set to the full signing fingerprint. [Repository instructions](../../distribution/linux-repository/README.md) cover tooling and prior-release retention.

`package:managers` supports `macos`, `windows`, `linux`, or `all`, plus `--artifacts` and `--output`. It requires stable tags and nonempty regular installer files. It writes `homebrew/milagre.rb`, `winget/Milagre.Milagre.yaml`, and `SHA256SUMS` from the final installer bytes. For the old Intel naming convention, pass `--mac-intel-name Milagre-X.Y.Z.dmg`.

The cask follows the [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook). WinGet uses Microsoft's [singleton manifest format](https://learn.microsoft.com/en-us/windows/package-manager/package/manifest), user scope, and `/currentuser`. Its proposed identifier is `Milagre.Milagre`. Generating a manifest does not create a public WinGet listing.

## Validation and release

**Build package candidates** runs on every push to `main`, on dispatch, and on a PR once it carries the `preview:installers` label. Windows pipe, ACL and process tests and Linux repository signing run on every PR in CI's `native-tests` job without an installer. It builds on native macOS, Windows and Ubuntu runners. It installs the NSIS/DEB packages and runs the real desktop against temporary profiles, including saved Chats, shared-host updates, crash recovery, and ownership errors. Windows also runs real named-pipe, NTFS ACL and process tests. Candidate installers are unsigned/ad-hoc Actions artifacts, kept for 14 days.

**Publish installers** defaults to `platforms=macos`. Selecting `all` adds Windows and Linux builds. Windows requires Authenticode signing; Linux signs the RPM and APT/RPM indexes. All selected platforms must pass before the draft becomes public. The final stage verifies complete updater feeds and regenerates combined checksums/manifests from the signed assets. DMG notarization and RPM signing are followed by feed hash refreshes.

## Beta channel

Installs set to Beta in Settings read `beta-mac.yml`; Stable installs read `latest-mac.yml` and never see a beta. **Publish beta** runs on weekdays at 09:00 UTC and on dispatch. It takes the newest draft candidate (`vX.Y.Z`), builds and signs it on the beta channel, and publishes `vX.Y.Z-beta.<run>` as a prerelease that is never marked latest. It skips the run when a beta for the same commit already exists. Ship one by hand with `gh workflow run publish-beta.yml`, optionally `-f tag=vX.Y.Z` to pick a specific draft.

Promotion is unchanged: **Publish installers** publishes the untouched draft as stable. A stable release now uploads both `latest-mac.yml` and `beta-mac.yml` (same installers), so beta installs move to the stable build once it ships.

Required repository secrets:

| Purpose | Secrets |
| --- | --- |
| Apple signing | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows signing | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |
| Linux signing | `LINUX_REPOSITORY_PRIVATE_KEY`, `LINUX_REPOSITORY_KEY_FINGERPRINT` |
| Cloudflare deployment | `CLOUDFLARE_PACKAGES_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

Apple and Linux signing secrets and the Cloudflare account ID are configured. Windows signing and the dedicated Cloudflare deployment token still need setup. The existing local Cloudflare token stays in its private environment file; it is not copied into GitHub. Use a dedicated deployment token for the repository workflow.

For the first Linux release, select `initialize_linux_repository=true`. Later releases fetch existing download/index mappings before replacing current metadata. **Deploy Linux package repository** takes the public tag, verifies the bundle against the pinned fingerprint, downloads both public installers to check their hashes, and deploys `packages.milagre.cloud`. No private signing key enters the Worker. Install commands for that domain become usable after this deployment, not after a candidate build.

The repository key fingerprint is `0AC0E3D496374278E689EC0F6605D632D39BA587`. Its private key and revocation certificate are stored outside the checkout. Rotate the pinned fingerprint and public installation instructions together when rotating the key.

After a signed Windows EXE is public, validate the attached manifest with `winget validate`, test `winget install --manifest`, and submit it to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). `winget install --id Milagre.Milagre` becomes available after Microsoft accepts the submission.

## Runtime

Windows uses a local named pipe with mutual HMAC authentication. NTFS permissions restrict its token to the current Windows SID and SYSTEM. Unauthenticated peers receive no events or commands. Unix retains its private socket transport. Windows CLI shims run through their JavaScript entry points with literal arguments; Linux setup falls back to `sh`.

Run `npm test -- --unit` and `npm run build`. Real Windows behavior must pass its native runner before support is announced.

## Evidence from this implementation

Local macOS x64/arm64 DMG/ZIP builds and source/packaged desktop checks passed. Homebrew parsed and fetched the published cask, both public DMGs passed stapled-ticket validation, and the tap's release updater passed on GitHub Actions.

Linux x64 AppImage, DEB and RPM builds passed. Isolated Debian and Fedora containers installed the DEB and signed RPM and passed source/installed desktop checks without disabling Electron's sandbox. Real-tool repository tests verified GPG signatures, APT downloads through the Worker, DEB/RPM installation, and rejection of damaged package bytes. A production-sized signed repository generated a Worker bundle of about 28 KiB.

Windows manifest fixtures passed Microsoft's singleton schema. Native Windows checks passed the Codex protocol, named-pipe authentication, NTFS permissions, process cleanup, PowerShell 7 inheritance, fresh host startup, and real Git worktree identity. A real npm-installed Codex launcher and NSIS installation passed. Source and installed desktop checks preserved saved Chats, provider IDs, settings and drafts across shared clients, host restart and crash recovery; Project ownership errors and Retry also passed.

Full repository CI passed for the final runtime changes: [CI run](https://github.com/the-ptf/milagre-ade/actions/runs/37349549214). Native installer evidence is in the [candidate run](https://github.com/the-ptf/milagre-ade/actions/runs/37349549112); its unsigned artifacts are for testing, while public Windows/Linux publication still requires the credentials and release steps above.
