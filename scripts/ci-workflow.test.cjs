const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const YAML = require('yaml')

const read = name => YAML.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8'))
const ci = read('ci.yml')
const candidates = read('package-candidates.yml')

test('CI and candidate runs on one ref cancel the previous PR run but never a main run', () => {
  for (const workflow of [ci, candidates]) {
    assert.equal(workflow.concurrency.group, `${workflow.name.toLowerCase().replace(/ /g, '-')}-\${{ github.ref }}`)
    assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}")
  }
})

test('every CI job has a timeout', () => {
  for (const [name, job] of Object.entries(ci.jobs)) assert.ok(Number.isInteger(job['timeout-minutes']), `${name} needs timeout-minutes`)
})

test('CI typechecks once and builds the renderer without a second typecheck', () => {
  const runs = ci.jobs.javascript.steps.map(step => step.run).filter(Boolean)
  assert.ok(runs.includes('npm run typecheck'))
  assert.ok(runs.includes('npm run build:renderer --workspace milagre'))
  assert.ok(!runs.includes('npm run build'))
})

test('desktop agent tests do not repeat the renderer logic tests', () => {
  const desktop = require('../apps/desktop/package.json').scripts
  assert.equal(desktop['test:agent'], 'node --test electron/*.test.cjs')
  assert.equal(desktop['test:ui'], 'node --test "app/src/**/*.test.ts"')
})

test('every action is pinned to a full SHA with its version in a comment', () => {
  for (const name of fs.readdirSync(path.join(__dirname, '../.github/workflows'))) {
    const text = fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8')
    for (const line of text.split('\n').filter(line => /^\s*-?\s*uses:/.test(line))) {
      assert.match(line, /uses: (\.\/\S+|[^@\s]+@[0-9a-f]{40} # v\d+\.\d+\.\d+)/, `${name}: ${line.trim()}`)
    }
  }
})

test('CI runs the unit suite through the single test command', () => {
  const runs = ci.jobs.javascript.steps.map(step => step.run).filter(Boolean)
  assert.ok(runs.includes('npm test -- --unit'))
  assert.ok(!runs.some(run => /npm run test:/.test(run)), 'no per-suite scripts left in CI')
})

test('Windows and Linux native tests run on PRs without building an installer', () => {
  const job = ci.jobs['native-tests']
  assert.deepEqual(job.strategy.matrix.include.map(item => item.os), ['windows-latest', 'ubuntu-latest'])
  const runs = JSON.stringify(job.steps)
  assert.ok(runs.includes('windows-runtime.test.cjs') && runs.includes('windows-transport.test.cjs') && runs.includes('process-tree.test.cjs') && runs.includes('ownership.test.cjs'))
  assert.ok(runs.includes('MILAGRE_LINUX_REPOSITORY_INTEGRATION=1'))
  assert.ok(!runs.includes('package:'), 'native tests never package')
})

test('native tests run only when a PR touches desktop code; the JavaScript job always runs', () => {
  const changes = ci.jobs.changes
  assert.ok(changes, 'a changes job decides what a PR touched')
  const filter = changes.steps.find(step => step.id === 'filter')
  assert.equal(filter.uses, 'dorny/paths-filter@d1c1ffe0248fe513906c8e24db8ea791d46f8590')
  const desktop = YAML.parse(filter.with.filters).desktop
  assert.ok(desktop.includes('apps/desktop/**') && desktop.includes('packages/**'))
  assert.ok(!desktop.includes('apps/mobile/**'), 'mobile-only PRs skip the desktop jobs')
  assert.equal(changes.outputs.desktop, "${{ github.event_name != 'pull_request' || steps.filter.outputs.desktop == 'true' }}")
  assert.equal(ci.jobs['native-tests'].needs, 'changes')
  assert.equal(ci.jobs['native-tests'].if, "needs.changes.outputs.desktop == 'true'")
  assert.equal(ci.jobs.javascript.if, undefined)
})

test('installers build on main, on dispatch, and on PRs only with the preview:installers label', () => {
  assert.deepEqual(candidates.on.pull_request.types, ['labeled', 'synchronize', 'reopened'])
  assert.equal(candidates.on.pull_request.paths, undefined)
  assert.deepEqual(candidates.on.push, { branches: ['main'], paths: candidates.on.push.paths })
  assert.equal(candidates.jobs.package.if, "${{ github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'preview:installers') }}")
})

test('Electron checks run on Ubuntu under xvfb with screenshots kept as an artifact', () => {
  const job = ci.jobs['desktop-checks']
  assert.equal(job['runs-on'], 'ubuntu-latest')
  const runs = job.steps.map(step => step.run).filter(Boolean)
  assert.ok(runs.includes('xvfb-run -a -s "-screen 0 1600x1200x24" npm test -- --electron'))
  const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact'))
  assert.equal(upload.if, 'always()')
  assert.equal(upload.with.path, '${{ runner.temp }}/electron-screenshots')
})
