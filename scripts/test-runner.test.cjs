const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { discoverUnitTests, discoverElectronChecks, selectTests, parseArgs, MANIFEST } = require('./test-runner.cjs')
const root = path.join(__dirname, '..')

test('discovers every node:test file and every Electron check', () => {
  const unit = discoverUnitTests(root)
  assert.ok(unit.includes('packages/shared/src/chats.test.ts'))
  assert.ok(unit.includes('apps/relay/src/room.test.mjs'))
  assert.ok(unit.includes('scripts/monorepo.test.cjs'))
  assert.ok(!unit.some(file => file.includes('node_modules')))
  const electron = discoverElectronChecks(root)
  assert.ok(electron.includes('scripts/test-chat-titles.cjs'))
  assert.deepEqual(electron, [...electron].sort())
  assert.ok(!electron.includes('scripts/test-runner.cjs') && !electron.includes('scripts/test-runner.test.cjs'))
})

test('--only narrows by name and an unmatched name fails loudly', () => {
  const selected = selectTests({ unit: ['a/b.test.ts'], electron: ['scripts/test-chat-titles.cjs', 'scripts/test-ports.cjs'], filters: { ...parseArgs(['--only', 'chat-titles']), platform: 'darwin', commandExists: () => true } })
  assert.deepEqual(selected.electron, ['scripts/test-chat-titles.cjs'])
  assert.deepEqual(selected.unit, [])
  assert.throws(() => selectTests({ unit: [], electron: [], filters: { ...parseArgs(['--only', 'nothing']), platform: 'darwin', commandExists: () => true } }), /no test matched "nothing"/)
})

test('--workspace keeps that workspace only', () => {
  const selected = selectTests({ unit: ['packages/core/src/a.test.cjs', 'apps/mobile/src/b.test.ts'], electron: [], filters: { ...parseArgs(['--workspace', 'core']), platform: 'darwin', commandExists: () => true } })
  assert.deepEqual(selected.unit, ['packages/core/src/a.test.cjs'])
})

test('platform and tool prerequisites skip checks with a reason instead of failing them', () => {
  const electron = ['scripts/test-windows-cli.cjs', 'scripts/test-ports.cjs', 'scripts/test-desktop.cjs']
  const onLinuxWithoutLsof = selectTests({ unit: [], electron, filters: { ...parseArgs(['--electron']), platform: 'linux', commandExists: name => name !== 'lsof' } })
  assert.deepEqual(onLinuxWithoutLsof.electron, ['scripts/test-desktop.cjs'])
  assert.deepEqual(onLinuxWithoutLsof.skipped.map(item => item.file), ['scripts/test-ports.cjs', 'scripts/test-windows-cli.cjs'].sort())
  assert.equal(MANIFEST['test-desktop.cjs'].needsBuild, true)
  assert.deepEqual(MANIFEST['test-windows-cli.cjs'].platforms, ['win32'])
})

test('unknown flags are rejected', () => {
  assert.throws(() => parseArgs(['--watchh']), /Unknown option --watchh/)
})
