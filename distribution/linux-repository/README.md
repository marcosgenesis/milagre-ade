# Signed Linux repository

Generate signed APT and RPM metadata from the final amd64 DEB and x86_64 RPM. The Cloudflare Worker bundles metadata and a public key, then streams the two package formats from exact versioned GitHub Release URLs. Package binaries and private keys never enter the deployment bundle.

## Generate

On Debian, install `gnupg`, `dpkg-dev`, `rpm` and `createrepo-c`. Set `GNUPGHOME` to the signing key directory outside this repository and `MILAGRE_LINUX_SIGNING_KEY` to its full GPG fingerprint. GPG must be able to sign in batch mode, through the configured agent if the key is protected.

```sh
export GNUPGHOME="$HOME/.private_keys/milagre-packages"
export MILAGRE_LINUX_SIGNING_KEY='FULL_SIGNING_KEY_FINGERPRINT'
export SOURCE_DATE_EPOCH='RELEASE_TIMESTAMP_IN_SECONDS'
node scripts/generate-linux-repository.cjs \
  --tag v1.2.3 --artifacts release --output release/linux-repository --sign-rpm
```

`--sign-rpm` changes the RPM in the artifacts directory before any hashes are calculated. Run other checksum/manifest generators and upload release assets **after** this command. Without this flag, the generator requires an RPM already signed by the repository key. `scripts/linux-repository-sign-rpm.cjs --rpm <path>` is the standalone signing preflight.

Expected inputs are `Milagre-X.Y.Z-amd64.deb` and `Milagre-X.Y.Z-x86_64.rpm`. The package name, version and architecture must match. Missing, empty or symlinked files fail; prerelease tags fail. RPM signature and payload digest checks use an isolated keyring containing only the exported repository key. The generator verifies and hashes snapshots of the final package bytes, and checks the upload inputs again before replacing output.

`SOURCE_DATE_EPOCH` makes the index dates, compressed APT data and RPM repository revision repeatable. It defaults to the current time. GPG signatures carry their actual signing time. Reruns replace the generated tree and remove stale metadata; a nonempty directory without a repository manifest is rejected.

## Preserve prior release downloads

The Worker serves `/package-map.json`, which contains public canonical routes, release URLs, sizes and checksums. On a fresh publishing runner, fetch the current map and pass it to generation:

```sh
curl --fail --silent --show-error https://packages.milagre.cloud/package-map.json \
  --output /tmp/milagre-package-map.json
curl --fail --silent --show-error https://packages.milagre.cloud/immutable-metadata.json \
  --output /tmp/milagre-immutable-metadata.json
node scripts/generate-linux-repository.cjs \
  --tag v1.2.3 --artifacts release --output release/linux-repository \
  --sign-rpm --previous /tmp/milagre-package-map.json \
  --previous-metadata /tmp/milagre-immutable-metadata.json
```

`/immutable-metadata.json` preserves APT by-hash indexes and RPM metadata with hashes in their filenames, so cached signed Release and repomd files still resolve after deployment. Each retained path and decoded SHA-256 is validated. Both maps accept at most 1 MiB and 1000 entries; the Worker module accepts at most 3 MiB. Exceeding a limit fails instead of silently expiring indexes or downloads.

Omit both previous-map options for the first publication. A local rerun automatically reads the existing output's maps. Only JSON is parsed; every previous package route must be a canonical stable-version DEB/RPM path with the exact corresponding `the-ptf/milagre-ade` release URL and a SHA-256 checksum. A published version's checksum cannot change.

## Generated tree and deployment

```text
archive-keyring.asc
dists/stable/{Release,InRelease,Release.gpg}
dists/stable/main/binary-amd64/{Packages,Packages.gz,by-hash/SHA256/...}
rpm/x86_64/repodata/{repomd.xml,repomd.xml.asc,...}
milagre.sources
milagre.repo
package-map.json
immutable-metadata.json
SHA256SUMS
repository-manifest.json
worker/{worker.mjs,repository-handler.mjs,repository-data.mjs,wrangler.toml}
```

The APT package filename is `/pool/main/m/milagre/Milagre-X.Y.Z-amd64.deb`. The RPM location is `/rpm/x86_64/Milagre-X.Y.Z-x86_64.rpm`. Both map to `https://github.com/the-ptf/milagre-ade/releases/download/vX.Y.Z/<filename>`.

Publish those exact signed assets on GitHub Releases before deploying. Load the existing Cloudflare credentials from `~/.private_keys/cloudflare.env`, then deploy the generated manifest:

```sh
npx -y wrangler@4.147.0 deploy \
  --config release/linux-repository/worker/wrangler.toml
```

The manifest uses the custom domain `packages.milagre.cloud`. It needs no R2, KV or database. `wrangler deploy --dry-run --outdir /tmp/milagre-packages-worker` checks the bundle without publishing. The Worker accepts GET/HEAD, serves only known metadata or package routes, and rejects query strings and encoded paths. Binary requests forward only range/cache headers; credentials and cookies are not forwarded. Clients validate packages against the signed APT indexes or RPM package signatures.

Before deployment, run `node scripts/verify-linux-repository.cjs --directory release/linux-repository --tag v1.2.3 --fingerprint <expected-public-fingerprint>`. It uses a fresh public-key-only GPG home, verifies all signatures and index links, and checks embedded Worker bytes against the repository files and checked-in Worker templates. `--artifacts <final-assets>` also checks final package hashes and the RPM signature.

APT uses the generated `milagre.sources` after dearmoring `archive-keyring.asc` into `/usr/share/keyrings/milagre-archive-keyring.gpg`. RPM clients use `milagre.repo`, with both `gpgcheck=1` and `repo_gpgcheck=1`. Users should verify the public key fingerprint against the published installation documentation before trusting it.

The format follows [Debian's repository specification](https://wiki.debian.org/DebianRepository/Format), [APT authentication](https://manpages.debian.org/bookworm/apt/apt-secure.8.en.html) and [RPM signing](https://rpm.org/docs/4.20.x/man/rpmsign.8).

## Verify locally

`node --test scripts/linux-repository.test.cjs` runs the validation and Worker route tests. Enable `MILAGRE_LINUX_REPOSITORY_INTEGRATION=1` with the tools and signing environment above to build small real package fixtures, verify signatures/checksums, exercise `apt-get update` and download, and install through `dpkg` and `rpm` into disposable roots. This verifies repository authenticity and installation mechanics; full Milagre GUI execution is a separate platform check.

For an isolated Linux toolchain:

```sh
docker build --platform linux/amd64 \
  -f distribution/linux-repository/test.Dockerfile \
  -t milagre-linux-repository-test distribution/linux-repository
```

Run that image with the checkout mounted read-only at `/repo`. Import the signing key into a temporary private directory inside the container, never into the mounted checkout. Set the signing variables plus `MILAGRE_LINUX_REPOSITORY_INTEGRATION=1`, then run the test command. Removing the container removes its temporary signing directory and fixture packages.
