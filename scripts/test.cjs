#!/usr/bin/env node
// `npm test`: every node:test file in one process, then each Electron check serially (each owns a Vite port and an Electron profile).
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { discoverUnitTests, discoverElectronChecks, selectTests, parseArgs, MANIFEST } = require('./test-runner.cjs')

const root = path.resolve(__dirname, '..')
const commandExists = name => spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' }).status === 0
let filters
try { filters = parseArgs(process.argv.slice(2)) } catch (error) { console.error(error.message); console.error('Usage: npm test [-- --unit | --electron] [--workspace <name>] [--only <substring>] [--list]'); process.exit(2) }

let selected
try { selected = selectTests({ unit: discoverUnitTests(root), electron: discoverElectronChecks(root), filters: { ...filters, platform: process.platform, commandExists } }) } catch (error) { console.error(error.message); process.exit(2) }

if (filters.list) { for (const file of [...selected.unit, ...selected.electron]) console.log(file); process.exit(0) }

const failures = []
function run(label, command, args, options = {}) {
  const started = Date.now()
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...options })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  if (result.status !== 0) failures.push(label)
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'}: ${label} (${seconds}s)`)
}

if (selected.unit.length) run(`${selected.unit.length} unit test files`, process.execPath, ['--test', ...selected.unit])

if (selected.electron.length) {
  if (selected.electron.some(file => MANIFEST[path.basename(file)]?.needsBuild)) run('build renderer', 'npm', ['run', 'build:renderer', '--workspace', 'milagre'])
  for (const file of selected.electron) run(file, process.execPath, [file])
}

for (const { file, reason } of selected.skipped) console.log(`SKIP: ${file} (${reason})`)
console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join('\n  ')}` : '\nAll selected tests passed.')
if (selected.electron.length > 5 && !filters.only) console.log('Tip: npm test -- --only <name> runs one Electron check; --unit skips them.')
process.exit(failures.length ? 1 : 0)
