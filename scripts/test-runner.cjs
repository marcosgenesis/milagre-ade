// Discovery and selection for `npm test`. Pure: no process spawning here (see test.cjs).
const fs = require('node:fs')
const path = require('node:path')

const UNIT_ROOTS = ['apps', 'packages', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', '.expo', 'ios', 'android', 'squashfs-root'])

/** Checks that need more than Node, Vite and Electron. Everything else runs anywhere. */
const MANIFEST = {
  'test-windows-cli.cjs': { platforms: ['win32'] },
  'test-ports.cjs': { needs: ['zsh', 'ps', 'lsof'] },
  'test-desktop.cjs': { needsBuild: true },
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out) }
    else if (/\.test\.(ts|mjs|cjs)$/.test(entry.name)) out.push(path.join(dir, entry.name))
  }
}

function discoverUnitTests(root) {
  const out = []
  for (const dir of UNIT_ROOTS) walk(path.join(root, dir), out)
  return out.map(file => path.relative(root, file)).sort()
}

function discoverElectronChecks(root) {
  return fs.readdirSync(path.join(root, 'scripts')).filter(name => /^test-.*\.cjs$/.test(name) && !/\.test\.cjs$/.test(name) && name !== 'test-runner.cjs').sort().map(name => `scripts/${name}`)
}

const WORKSPACES = { shared: 'packages/shared/', core: 'packages/core/', desktop: 'apps/desktop/', daemon: 'apps/daemon/', relay: 'apps/relay/', mobile: 'apps/mobile/', scripts: 'scripts/' }

function parseArgs(argv) {
  const filters = { unit: false, electron: false, workspace: null, only: null, changed: false, list: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--unit' || arg === '--electron' || arg === '--changed' || arg === '--list') filters[arg.slice(2)] = true
    else if (arg === '--workspace' || arg === '--only') { filters[arg.slice(2)] = argv[++i]; if (!filters[arg.slice(2)]) throw new Error(`${arg} needs a value`) }
    else throw new Error(`Unknown option ${arg}`)
  }
  if (filters.workspace && !WORKSPACES[filters.workspace]) throw new Error(`Unknown workspace ${filters.workspace}; one of ${Object.keys(WORKSPACES).join(', ')}`)
  return filters
}

function selectTests({ unit, electron, filters }) {
  const wantUnit = filters.unit || !filters.electron
  const wantElectron = filters.electron || !filters.unit
  let pickedUnit = wantUnit ? unit : []
  let pickedElectron = wantElectron ? electron : []
  if (filters.workspace) {
    const prefix = WORKSPACES[filters.workspace]
    pickedUnit = pickedUnit.filter(file => file.startsWith(prefix))
    pickedElectron = filters.workspace === 'scripts' || filters.workspace === 'desktop' ? pickedElectron : []
  }
  if (filters.only) {
    pickedUnit = pickedUnit.filter(file => file.includes(filters.only))
    pickedElectron = pickedElectron.filter(file => file.includes(filters.only))
    if (pickedUnit.length + pickedElectron.length === 0) throw new Error(`no test matched "${filters.only}"`)
  }
  const skipped = []
  pickedElectron = pickedElectron.filter(file => {
    const rule = MANIFEST[path.basename(file)]
    if (!rule) return true
    if (rule.platforms && !rule.platforms.includes(filters.platform)) { skipped.push({ file, reason: `needs ${rule.platforms.join('/')}` }); return false }
    const missing = (rule.needs ?? []).filter(name => !filters.commandExists(name))
    if (missing.length) { skipped.push({ file, reason: `needs ${missing.join(', ')}` }); return false }
    return true
  })
  skipped.sort((a, b) => a.file.localeCompare(b.file))
  return { unit: pickedUnit, electron: pickedElectron, skipped }
}

module.exports = { discoverUnitTests, discoverElectronChecks, selectTests, parseArgs, MANIFEST, WORKSPACES }
