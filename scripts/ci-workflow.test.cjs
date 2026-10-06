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
