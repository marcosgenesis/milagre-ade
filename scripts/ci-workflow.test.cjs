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
