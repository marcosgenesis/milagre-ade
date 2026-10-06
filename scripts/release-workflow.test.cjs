const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const YAML = require('yaml')

const releaseWorkflow = YAML.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/release.yml'), 'utf8'))
const publishWorkflow = YAML.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/publish-installers.yml'), 'utf8'))
const buildWorkflow = YAML.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/build-macos.yml'), 'utf8'))
const candidateWorkflow = YAML.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/package-candidates.yml'), 'utf8'))
const credentials = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
const credentialStep = buildWorkflow.jobs['package-macos'].steps.find(step => step.name === 'Check Apple release credentials')
const notarizeStep = buildWorkflow.jobs['package-macos'].steps.find(step => step.name === 'Notarize and staple disk images')
const verifyStep = buildWorkflow.jobs['package-macos'].steps.find(step => step.name === 'Verify macOS signatures, notarization and disk images')
const authStep = buildWorkflow.jobs['package-macos'].steps.find(step => step.name === 'Check Apple notarization authentication')
const uploadStep = buildWorkflow.jobs['package-macos'].steps.find(step => step.name === 'Upload installers and publish the release')

function runStep(step, cwd, overrides = {}) {
  const env = { ...process.env }
  for (const name of credentials) delete env[name]
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
    cwd,
    env: { ...env, ...overrides },
    encoding: 'utf8',
  })
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'milagre-release-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'release/mac-arm64/Milagre.app'), { recursive: true })
  fs.mkdirSync(path.join(root, 'bin'))
  fs.mkdirSync(path.join(root, 'scripts'))
  for (const script of ['with-apple-credentials.cjs', 'notarize-dmg.cjs']) fs.copyFileSync(path.join(__dirname, script), path.join(root, 'scripts', script))
  fs.writeFileSync(path.join(root, 'release/Milagre-arm64.dmg'), '')
  const mock = `#!/bin/bash
printf '%s %s %s %s\\n' "$(basename "$0")" "$1" "$2" "$3" >> "$CALL_LOG"
if [ "$(basename "$0")" = "$FAIL_TOOL" ]; then exit 1; fi
if [ "$1" = notarytool ]; then
  if [ "$2" = wait ] && [ -n "$WAIT_ERROR" ]; then echo "$WAIT_ERROR" >&2; exit 1; fi
  if [ "$2" = wait ] && [ -n "$NOTARY_WAIT_STATUS" ]; then NOTARY_STATUS="$NOTARY_WAIT_STATUS"; fi
  if [ "$2" = wait ] || [[ "$*" == *" --wait "* ]]; then
    if [ "$NETWORK_ALWAYS_FAIL" = 1 ]; then
      echo 'Error Domain=NSURLErrorDomain Code=-1009 The Internet connection appears to be offline. URL=/submissions/ab401def-1234-1234-1234-123456789abc' >&2
      exit 1
    fi
    if [ "$NETWORK_FAIL_ONCE" = 1 ] && [ ! -f "$NETWORK_STATE" ]; then
      touch "$NETWORK_STATE"
      echo 'Error Domain=NSURLErrorDomain Code=-1009 The Internet connection appears to be offline. No network route' >&2
      exit 1
    fi
  fi
  printf '{"id":"12345678-1234-1234-1234-123456789abc","status":"%s"}\\n' "$NOTARY_STATUS"
  exit "$NOTARY_EXIT"
fi
`
  for (const tool of ['xcrun', 'codesign', 'spctl', 'hdiutil', 'sleep']) {
    fs.writeFileSync(path.join(root, 'bin', tool), mock, { mode: 0o755 })
  }
  const env = {
    PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
    CALL_LOG: path.join(root, 'calls.log'),
    NOTARY_STATUS: 'Accepted',
    NOTARY_EXIT: '0',
    FAIL_TOOL: '',
    NETWORK_STATE: path.join(root, 'network-state'),
    NETWORK_FAIL_ONCE: '0',
    NETWORK_ALWAYS_FAIL: '0',
    WAIT_ERROR: '',
    NOTARY_WAIT_STATUS: '',
    ...Object.fromEntries(credentials.map(name => [name, `test-secret-${name}`])),
  }
  return {
    root,
    env,
    calls: () => fs.existsSync(env.CALL_LOG) ? fs.readFileSync(env.CALL_LOG, 'utf8') : '',
  }
}

test('every candidate platform forwards the release version through npm to the packager', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'milagre-candidate-args-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'record.cjs'), "require('node:fs').writeFileSync('args.json', JSON.stringify(process.argv.slice(2)))")
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {
    'package:mac:local': 'node record.cjs', 'package:win': 'node record.cjs', 'package:linux': 'node record.cjs',
  } }))
  const build = candidateWorkflow.jobs.package.steps.find(step => step.name === 'Build experimental installers')
  for (const platform of candidateWorkflow.jobs.package.strategy.matrix.include) {
    const command = build.run.replace('${{ matrix.command }}', platform.command)
    const result = runStep({ run: command }, root, { RELEASE_TAG: 'v1.2.3' })
    assert.equal(result.status, 0, result.stderr)
    const args = JSON.parse(fs.readFileSync(path.join(root, 'args.json'), 'utf8'))
    assert.ok(args.includes('--config.extraMetadata.version=1.2.3'), `${platform.platform}: ${JSON.stringify(args)}`)
  }
})

test('missing Apple credentials stop the release without printing secret values', () => {
  const ready = Object.fromEntries(credentials.map(name => [name, `test-secret-${name}`]))
  for (const missing of credentials) {
    const result = runStep(credentialStep, undefined, { ...ready, [missing]: '' })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, new RegExp(`Missing GitHub Actions secret: ${missing}`))
    assert.doesNotMatch(result.stdout + result.stderr, /test-secret-/)
  }
  assert.equal(runStep(credentialStep, undefined, ready).status, 0)
})

test('Apple rejection stops notarization even when notarytool exits successfully', t => {
  const f = fixture(t)
  const result = runStep(notarizeStep, f.root, { ...f.env, NOTARY_STATUS: 'Invalid' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Apple notarization failed: Invalid/)
  assert.doesNotMatch(f.calls(), /stapler staple/)
})

test('notarytool failure stops before stapling', t => {
  const f = fixture(t)
  const result = runStep(notarizeStep, f.root, { ...f.env, NOTARY_EXIT: '1' })
  assert.notEqual(result.status, 0)
  assert.doesNotMatch(f.calls(), /stapler staple/)
})

test('an accepted disk image is stapled', t => {
  const f = fixture(t)
  const result = runStep(notarizeStep, f.root, f.env)
  assert.equal(result.status, 0, result.stderr)
  assert.match(f.calls(), /xcrun notarytool submit/)
  assert.match(f.calls(), /xcrun stapler staple/)
})

test('a candidate is created only after CI succeeded on that main commit, and from that commit', () => {
  assert.deepEqual(releaseWorkflow.on, { workflow_run: { workflows: ['CI'], types: ['completed'], branches: ['main'] } })
  const job = releaseWorkflow.jobs.release
  assert.equal(
    job.if,
    "${{ github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_repository.full_name == github.repository }}",
  )
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout'))
  assert.equal(checkout.with.ref, '${{ github.event.workflow_run.head_sha }}')
  assert.equal(checkout.with['fetch-depth'], 0)
  assert.equal(checkout.with['persist-credentials'], false)
  const runs = job.steps.map(step => step.run).filter(Boolean)
  assert.deepEqual(runs, ['npm ci', 'npm run release'])
  assert.ok(!JSON.stringify(releaseWorkflow).includes('package:mac'))
})

test('release candidates are created as drafts', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../.releaserc.json'), 'utf8'))
  const github = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/github')
  assert.equal(github?.[1]?.draftRelease, true)
})

test('a candidate is not published without the auto-updater metadata, and publishes with it', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.root, 'bin/gh'), '#!/bin/bash\nprintf \'gh %s\\n\' "$*" >> "$CALL_LOG"\n', { mode: 0o755 })
  const env = { ...f.env, RELEASE_TAG: 'v9.9.9', PUBLISH_PLATFORMS: 'macos' }
  const missing = runStep(uploadStep, f.root, env)
  assert.notEqual(missing.status, 0)
  assert.match(missing.stdout, /latest-mac\.yml/)
  assert.doesNotMatch(f.calls(), /gh release/)
  fs.writeFileSync(path.join(f.root, 'release/latest-mac.yml'), '')
  const noBeta = runStep(uploadStep, f.root, env)
  assert.notEqual(noBeta.status, 0)
  assert.match(noBeta.stdout, /beta-mac\.yml/)
  assert.doesNotMatch(f.calls(), /gh release/)
  fs.writeFileSync(path.join(f.root, 'release/beta-mac.yml'), '')
  fs.writeFileSync(path.join(f.root, 'release/Milagre-arm64-mac.zip'), '')
  fs.mkdirSync(path.join(f.root, 'release/package-managers/homebrew'), { recursive: true })
  fs.writeFileSync(path.join(f.root, 'release/package-managers/homebrew/milagre.rb'), 'generated cask')
  fs.writeFileSync(path.join(f.root, 'release/package-managers/SHA256SUMS'), 'generated checksums')
  const result = runStep(uploadStep, f.root, env)
  assert.equal(result.status, 0, result.stderr)
  assert.match(f.calls(), /gh release upload v9\.9\.9 .*release\/latest-mac\.yml/)
  assert.match(f.calls(), /release\/beta-mac\.yml/)
  assert.match(f.calls(), /release\/Milagre-arm64\.dmg/)
  assert.match(f.calls(), /release\/Milagre-arm64-mac\.zip/)
  assert.match(f.calls(), /release\/package-managers\/homebrew\/milagre\.rb/)
  assert.match(f.calls(), /release\/package-managers\/SHA256SUMS/)
  assert.match(f.calls(), /gh release upload[\s\S]*gh release edit v9\.9\.9 --draft=false --latest/)
})

test('missing or empty Homebrew metadata stops publication before any upload', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.root, 'bin/gh'), '#!/bin/bash\nprintf \'gh %s\\n\' "$*" >> "$CALL_LOG"\n', { mode: 0o755 })
  fs.writeFileSync(path.join(f.root, 'release/latest-mac.yml'), '')
  fs.writeFileSync(path.join(f.root, 'release/beta-mac.yml'), '')
  const directory = path.join(f.root, 'release/package-managers')
  fs.mkdirSync(path.join(directory, 'homebrew'), { recursive: true })
  const env = { ...f.env, RELEASE_TAG: 'v9.9.9', PUBLISH_PLATFORMS: 'macos' }
  for (const contents of [null, '']) {
    if (contents !== null) {
      fs.writeFileSync(path.join(directory, 'homebrew/milagre.rb'), contents)
      fs.writeFileSync(path.join(directory, 'SHA256SUMS'), contents)
    }
    const result = runStep(uploadStep, f.root, env)
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /Homebrew metadata/)
    assert.doesNotMatch(f.calls(), /gh release/)
  }
})

test('signature, ticket, Gatekeeper and disk image failures stop verification', t => {
  const f = fixture(t)
  for (const tool of ['codesign', 'xcrun', 'spctl', 'hdiutil']) {
    const result = runStep(verifyStep, f.root, { ...f.env, FAIL_TOOL: tool })
    assert.notEqual(result.status, 0, `${tool} failure must block upload`)
  }
  assert.equal(runStep(verifyStep, f.root, f.env).status, 0)
})


test('an invalid app-specific password stops before contacting Apple and is never printed', t => {
  const f = fixture(t)
  const secret = 'test-private-password-value'
  const result = runStep(authStep, f.root, { ...f.env, APPLE_APP_SPECIFIC_PASSWORD: secret })
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /App-specific password has the expected format: false/)
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret))
  assert.equal(f.calls(), '')
})

test('Apple authentication rejection stops the preflight without printing credentials', t => {
  const f = fixture(t)
  const password = 'abcd-efgh-ijkl-mnop'
  const result = runStep(authStep, f.root, { ...f.env, APPLE_APP_SPECIFIC_PASSWORD: password, NOTARY_EXIT: '1' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Apple authentication check failed/)
  assert.doesNotMatch(result.stdout + result.stderr, /abcd-efgh-ijkl-mnop|test-secret-/)
  assert.match(f.calls(), /xcrun notarytool history/)
})

test('accepted Apple credentials pass the authentication preflight', t => {
  const f = fixture(t)
  const result = runStep(authStep, f.root, { ...f.env, APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Apple accepted the configured notarization credentials/)
  assert.match(f.calls(), /xcrun notarytool history/)
})

test('release commands trim Apple credentials, preserve certificate passwords and propagate failure', () => {
  const secret = 'certificate-password-with-intentional-spaces'
  const command = [path.join(__dirname, 'with-apple-credentials.cjs'), process.execPath, '-e', "const assert = require('node:assert/strict'); assert.equal(process.env.APPLE_ID, 'developer@example.test'); assert.equal(process.env.APPLE_APP_SPECIFIC_PASSWORD, 'abcd-efgh-ijkl-mnop'); assert.equal(process.env.APPLE_TEAM_ID, 'TESTTEAM01'); assert.equal(process.env.CSC_KEY_PASSWORD, '  certificate-password-with-intentional-spaces  '); process.exit(7)"]
  const result = spawnSync(process.execPath, command, {
    env: { ...process.env, APPLE_ID: ' developer@example.test\n', APPLE_APP_SPECIFIC_PASSWORD: ' abcd-efgh-ijkl-mnop\n', APPLE_TEAM_ID: ' TESTTEAM01\n', CSC_KEY_PASSWORD: '  ' + secret + '  ' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 7, result.stderr)
  assert.equal(result.stdout + result.stderr, '')
  const build = buildWorkflow.jobs['package-macos'].steps.find(step => step.name === 'Build macOS installers')
  assert.match(build.run, /^node scripts\/with-apple-credentials\.cjs npm run package:mac /)
  assert.match(notarizeStep.run, /^node scripts\/with-apple-credentials\.cjs bash -e -o pipefail/)
})


test('a network drop while waiting resumes the same submission before stapling', t => {
  const f = fixture(t)
  const result = runStep(notarizeStep, f.root, { ...f.env, NETWORK_FAIL_ONCE: '1' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal((f.calls().match(/xcrun notarytool submit/g) || []).length, 1)
  assert.equal((f.calls().match(/xcrun notarytool wait 12345678-1234-1234-1234-123456789abc/g) || []).length, 2)
  assert.match(f.calls(), /xcrun stapler staple/)
})


test('persistent network failures stop after four waits without another upload', t => {
  const f = fixture(t)
  const result = runStep(notarizeStep, f.root, { ...f.env, NETWORK_ALWAYS_FAIL: '1' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /after four network attempts/)
  assert.equal((f.calls().match(/xcrun notarytool submit/g) || []).length, 1)
  assert.equal((f.calls().match(/xcrun notarytool wait/g) || []).length, 4)
  assert.doesNotMatch(f.calls(), /stapler staple/)
  assert.doesNotMatch(result.stdout + result.stderr, /test-secret-/)
})


test('a rejected DMG status after upload is never retried or stapled', t => {
  const f = fixture(t)
  const result = runStep(notarizeStep, f.root, { ...f.env, NOTARY_WAIT_STATUS: 'Invalid' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Apple notarization failed: Invalid/)
  assert.equal((f.calls().match(/xcrun notarytool wait/g) || []).length, 1)
  assert.doesNotMatch(f.calls(), /stapler staple|sleep/)
})

test('authentication failure during the wait stops immediately without logging credentials', t => {
  const f = fixture(t)
  const result = runStep(notarizeStep, f.root, { ...f.env, WAIT_ERROR: 'HTTP status code: 401. Invalid credentials. test-secret-APPLE_APP_SPECIFIC_PASSWORD' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Apple rejected the notarization credentials/)
  assert.equal((f.calls().match(/xcrun notarytool wait/g) || []).length, 1)
  assert.doesNotMatch(f.calls(), /stapler staple|sleep/)
  assert.doesNotMatch(result.stdout + result.stderr, /test-secret-/)
})

test('the stable macOS leg calls the reusable build on the latest channel and publishes', () => {
  const job = publishWorkflow.jobs['package-macos']
  assert.equal(job.uses, './.github/workflows/build-macos.yml')
  assert.equal(job.with.channel, 'latest')
  assert.equal(job.with.publish, true)
  assert.equal(job.secrets, 'inherit')
  const build = buildWorkflow.jobs['package-macos'].steps.find(step => step.name === 'Build macOS installers')
  assert.match(build.run, /--config\.publish\.channel="\$\{CHANNEL\}" --config\.generateUpdatesFilesForAllChannels=true/)
  assert.ok(buildWorkflow.jobs['package-macos'].steps.find(step => step.name === 'Require a stable draft release').if.includes('require_draft'))
})

const betaWorkflow = YAML.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/publish-beta.yml'), 'utf8'))
test('a beta is a separate prerelease built from the newest draft candidate on the beta channel', () => {
  assert.deepEqual(Object.keys(betaWorkflow.on), ['workflow_dispatch', 'schedule'])
  const build = betaWorkflow.jobs.build
  assert.equal(build.uses, './.github/workflows/build-macos.yml')
  assert.equal(build.with.channel, 'beta')
  assert.equal(build.with.require_draft, false)
  assert.notEqual(build.with.publish, true)
  const publish = JSON.stringify(betaWorkflow.jobs.publish.steps)
  assert.ok(publish.includes('--prerelease'))
  assert.ok(publish.includes('beta-mac.yml'))
  assert.ok(!publish.includes('--latest'), 'a beta never becomes the latest release')
})
