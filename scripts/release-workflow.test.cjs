const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const YAML = require('yaml')

const workflow = YAML.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/release.yml'), 'utf8'))
const credentials = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
const credentialStep = workflow.jobs.release.steps.find(step => step.name === 'Check Apple release credentials')
const notarizeStep = workflow.jobs['package-macos'].steps.find(step => step.name === 'Notarize and staple disk images')
const verifyStep = workflow.jobs['package-macos'].steps.find(step => step.name === 'Verify macOS signatures, notarization and disk images')

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
  fs.writeFileSync(path.join(root, 'release/Milagre-arm64.dmg'), '')
  const mock = `#!/bin/bash
printf '%s %s %s\\n' "$(basename "$0")" "$1" "$2" >> "$CALL_LOG"
if [ "$(basename "$0")" = "$FAIL_TOOL" ]; then exit 1; fi
if [ "$1" = notarytool ]; then
  printf '{"id":"test-submission","status":"%s"}\\n' "$NOTARY_STATUS"
  exit "$NOTARY_EXIT"
fi
`
  for (const tool of ['xcrun', 'codesign', 'spctl', 'hdiutil']) {
    fs.writeFileSync(path.join(root, 'bin', tool), mock, { mode: 0o755 })
  }
  const env = {
    PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
    CALL_LOG: path.join(root, 'calls.log'),
    NOTARY_STATUS: 'Accepted',
    NOTARY_EXIT: '0',
    FAIL_TOOL: '',
    ...Object.fromEntries(credentials.map(name => [name, `test-secret-${name}`])),
  }
  return {
    root,
    env,
    calls: () => fs.existsSync(env.CALL_LOG) ? fs.readFileSync(env.CALL_LOG, 'utf8') : '',
  }
}

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

test('signature, ticket, Gatekeeper and disk image failures stop verification', t => {
  const f = fixture(t)
  for (const tool of ['codesign', 'xcrun', 'spctl', 'hdiutil']) {
    const result = runStep(verifyStep, f.root, { ...f.env, FAIL_TOOL: tool })
    assert.notEqual(result.status, 0, `${tool} failure must block upload`)
  }
  assert.equal(runStep(verifyStep, f.root, f.env).status, 0)
})
