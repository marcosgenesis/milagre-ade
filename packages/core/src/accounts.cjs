const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawnCommand, execCommand } = require('./agents/command.cjs');
const { CodexRpc } = require('./agents/codex-rpc.cjs');
const { killTree } = require('./agents/process-tree.cjs');
const { preparePrivateDirectory } = require('./private-files.cjs');

const PROVIDERS = ['claude', 'codex'];
const text = value => typeof value === 'string' ? value.slice(0, 200) : undefined;

// Only public identity fields leave the host. Never forward raw CLI output or parsing errors.
async function inspectAccount(provider, { command, env }) {
  if (provider === 'claude') return new Promise(resolve => {
    execCommand(command, ['auth', 'status'], { env, encoding: 'utf8', timeout: 10000 }, (_error, stdout) => {
      try {
        const raw = String(stdout); const info = JSON.parse(raw.slice(raw.indexOf('{')));
        resolve({ state: info.loggedIn ? 'ready' : 'signed-out', email: text(info.email), plan: text(info.subscriptionType || info.authMethod) });
      // oxlint-disable-next-line promise/no-multiple-resolved -- pre-existing, see PR body
      } catch { resolve({ state: 'error', message: 'Could not check this account. Try Refresh.' }); }
    })?.stdin?.end();
  });
  const rpc = new CodexRpc({ command, env, cwd: os.homedir() });
  try {
    rpc.start();
    await rpc.request('initialize', { clientInfo: { name: 'milagre', version: '0.1.0' }, capabilities: null }, { timeoutMs: 10000 });
    rpc.notify('initialized');
    const { account, requiresOpenaiAuth } = await rpc.request('account/read', { refreshToken: false }, { timeoutMs: 8000 });
    return { state: account || requiresOpenaiAuth === false ? 'ready' : 'signed-out', email: text(account?.email), plan: text(account?.planType || account?.type) };
  } catch { return { state: 'error', message: 'Could not check this account. Try Refresh.' }; }
  finally { rpc.close(); }
}

function createAccounts({ dataDir, cli, ready = () => {}, env = process.env, home = os.homedir(), inspect = inspectAccount, spawn = spawnCommand, changed = () => {} }) {
  const root = path.join(dataDir, 'accounts');
  const file = path.join(root, 'accounts.json');
  let saved = { accounts: [], selected: { claude: 'default', codex: 'default' } };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed.accounts) || !parsed.selected || parsed.accounts.some(a => !PROVIDERS.includes(a.provider) || !/^[a-f0-9-]{36}$/.test(a.id) || typeof a.label !== 'string')) throw new Error();
    for (const provider of PROVIDERS) {
      if (parsed.selected[provider] !== 'default' && !parsed.accounts.some(a => a.provider === provider && a.id === parsed.selected[provider])) throw new Error();
    }
    saved = { accounts: parsed.accounts.map(({ id, provider, label }) => ({ id, provider, label })), selected: { claude: parsed.selected.claude, codex: parsed.selected.codex } };
  // oxlint-disable-next-line preserve-caught-error -- pre-existing, see PR body
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read saved accounts. Restore accounts/accounts.json before switching accounts.'); }
  const identities = new Map();
  const logins = new Map();
  let checking = null;
  let closed = false;
  const key = (provider, id) => `${provider}:${id}`;
  function providerCheck(provider) { if (!PROVIDERS.includes(provider)) throw new Error('Unknown account provider.'); }
  function account(provider, id) {
    providerCheck(provider);
    if (id === 'default') return { id, provider, label: 'Connected CLI account' };
    const found = saved.accounts.find(a => a.provider === provider && a.id === id);
    if (!found) throw new Error('Account not found. Refresh and try again.');
    return found;
  }
  const directory = (provider, id) => id === 'default' ? path.resolve(env[provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] || path.join(home, `.${provider}`)) : path.join(root, id);
  function environment(provider, id = saved.selected[provider]) {
    account(provider, id);
    if (id === 'default') return { ...env };
    const next = { ...env };
    const names = provider === 'codex' ? ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'] : ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_PROFILE'];
    for (const name of names) next[name] = '';
    if (provider === 'claude') next.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1';
    next[provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] = directory(provider, id);
    return next;
  }
  function persist(next) {
    preparePrivateDirectory(root);
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(temp, file);
    saved = next;
  }
  function snapshot() {
    return { providers: PROVIDERS.map(provider => ({ provider, selectedId: saved.selected[provider], accounts: [account(provider, 'default'), ...saved.accounts.filter(a => a.provider === provider)].map(a => ({ ...a, ...(identities.get(key(provider, a.id)) || { state: 'unknown' }), ...(logins.has(key(provider, a.id)) ? { state: 'signing-in', message: 'Finish signing in in the browser on your computer.' } : {}) })) })) };
  }
  async function check(provider, id, current = () => true) {
    const scopedEnv = environment(provider, id);
    const status = await cli(provider);
    const identity = status.problem || !status.command ? { state: 'error', message: status.problem || 'Install the provider CLI on your computer.' } : await inspect(provider, { command: status.command, env: scopedEnv });
    if (current()) identities.set(key(provider, id), identity);
    return identity;
  }
  async function list(refresh = false) {
    await ready();
    if (refresh || !identities.size) {
      checking ??= Promise.all(PROVIDERS.flatMap(provider => [account(provider, 'default'), ...saved.accounts.filter(a => a.provider === provider)].filter(a => !logins.has(key(provider, a.id))).map(a => check(provider, a.id)))).finally(() => { checking = null; });
      await checking;
    }
    return snapshot();
  }
  function select(provider, id) {
    account(provider, id);
    if (logins.has(key(provider, id))) throw new Error('Finish signing in before using this account.');
    if (identities.get(key(provider, id))?.state !== 'ready') throw new Error('Sign in to this account, then refresh before using it.');
    persist({ ...saved, selected: { ...saved.selected, [provider]: id } });
    changed(provider);
    return snapshot();
  }
  async function add(provider, label) {
    providerCheck(provider);
    if (typeof label !== 'string' || !label.trim() || label.length > 80) throw new Error('Enter an account name of 1 to 80 characters.');
    if (logins.size) throw new Error('Finish or cancel the current sign-in first.');
    if (saved.accounts.length >= 20) throw new Error('You can save up to 20 accounts.');
    await ready();
    const status = await cli(provider);
    if (status.problem || !status.command) throw new Error(status.problem || 'Install the provider CLI first.');
    const a = { id: randomUUID(), provider, label: label.trim() };
    preparePrivateDirectory(root);
    const target = directory(provider, a.id);
    preparePrivateDirectory(target);
    // Credentials remain isolated. Share history so switching can resume an existing Chat.
    const source = directory(provider, 'default');
    const folders = provider === 'codex' ? ['sessions', 'archived_sessions', 'skills', 'rules', 'plugins', 'generated_images'] : ['projects', 'skills', 'commands', 'agents', 'plugins'];
    for (const name of folders) {
      const original = path.join(source, name);
      fs.mkdirSync(original, { recursive: true });
      fs.symlinkSync(original, path.join(target, name), process.platform === 'win32' ? 'junction' : 'dir');
    }
    // Copy settings once; never symlink a file the provider may rewrite during sign-in.
    const config = provider === 'codex' ? 'config.toml' : 'settings.json';
    try { fs.copyFileSync(path.join(source, config), path.join(target, config)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (provider === 'claude') {
      const configFile = path.join(target, config);
      if (fs.existsSync(configFile)) {
        let settings; try { settings = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { throw new Error('Claude settings could not be read. Fix settings.json before adding an account.'); }
        delete settings.apiKeyHelper;
        fs.writeFileSync(configFile, JSON.stringify(settings), { mode: 0o600 });
      }
    }
    if (provider === 'codex') {
      const configFile = path.join(target, config);
      let body = ''; try { body = fs.readFileSync(configFile, 'utf8'); } catch {}
      // Root settings must precede TOML tables. Existing root values are replaced, table values stay untouched.
      const at = body.search(/^\s*\[/m); const split = at < 0 ? body.length : at;
      const head = body.slice(0, split).replace(/^\s*cli_auth_credentials_store\s*=.*\n?/gm, '');
      fs.writeFileSync(configFile, `${/^\s*sqlite_home\s*=/m.test(head) ? "" : `sqlite_home = ${JSON.stringify(source)}\n`}cli_auth_credentials_store = "file"\n${head}${body.slice(split)}`, { mode: 0o600 });
    }
    const instructions = provider === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
    try { fs.copyFileSync(path.join(source, instructions), path.join(target, instructions)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    persist({ ...saved, accounts: [...saved.accounts, a] });
    return login(provider, a.id);
  }
  async function login(provider, id) {
    account(provider, id);
    if (id === 'default') throw new Error('Use Add account to sign in without replacing your connected CLI account.');
    if (closed) throw new Error('Account manager is closing.');
    if (logins.size) throw new Error('Finish or cancel the current sign-in first.');
    const status = await cli(provider);
    if (status.problem || !status.command) throw new Error(status.problem || 'Install the provider CLI first.');
    const k = key(provider, id);
    const child = spawn(status.command, provider === 'codex' ? ['login'] : ['auth', 'login', '--claudeai'], { env: environment(provider, id), cwd: home, stdio: ['ignore', 'ignore', 'ignore'], detached: true, windowsHide: true });
    const entry = { child, timer: null };
    logins.set(k, entry);
    const finish = async success => {
      if (logins.get(k) !== entry) return;
      clearTimeout(entry.timer);
      try {
        if (success) {
          const result = await check(provider, id, () => logins.get(k) === entry);
          if (logins.get(k) === entry && result.state === 'ready' && !closed) changed(provider);
        } else identities.set(k, { state: 'signed-out', message: 'Sign-in did not finish. Try again.' });
      } catch {
        if (logins.get(k) === entry) identities.set(k, { state: 'error', message: 'Could not check this account. Try Refresh.' });
      } finally {
        if (logins.get(k) === entry) logins.delete(k);
      }
    };
    child.once('error', () => { void finish(false); });
    child.once('close', code => { void finish(code === 0); });
    entry.timer = setTimeout(() => { cancel(provider, id); }, 5 * 60_000);
    entry.timer.unref?.();
    return snapshot();
  }
  function cancel(provider, id) {
    account(provider, id);
    const k = key(provider, id); const entry = logins.get(k);
    if (entry) { clearTimeout(entry.timer); logins.delete(k); void killTree(entry.child, { graceMs: 100 }).catch(() => {}); }
    identities.set(k, { state: 'signed-out', message: 'Sign-in cancelled. You can try again.' });
    return snapshot();
  }
  function remove(provider, id) {
    account(provider, id);
    if (id === 'default') throw new Error('The connected CLI account cannot be removed here.');
    const wasSelected = saved.selected[provider] === id;
    cancel(provider, id);
    // Retain the private profile: a running reply may still use it. Forgetting never revokes its tokens.
    persist({ ...saved, accounts: saved.accounts.filter(a => a.id !== id), selected: wasSelected ? { ...saved.selected, [provider]: 'default' } : saved.selected });
    identities.delete(key(provider, id));
    if (wasSelected) changed(provider);
    return snapshot();
  }
  // oxlint-disable-next-line unicorn/no-useless-spread -- pre-existing, see PR body
  return { list, select, add, login, cancel, remove, environment, directory, selected: provider => saved.selected[provider], close() { closed = true; for (const k of [...logins.keys()]) cancel(...k.split(':')); } };
}

module.exports = { createAccounts, inspectAccount };
