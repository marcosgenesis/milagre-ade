// Real main/preload/renderer and daemon against temporary Git repositories.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { startDaemon } = require('@milagre/daemon/server');
const { connect: connectHost } = require('@milagre/daemon/client');
const root = path.resolve(__dirname, '..');
async function waitFor(read, description) {
  for (let i = 0; i < 400; i++) { const value = await read(); if (value) return value; await delay(50); }
  throw new Error(`Timed out: ${description}`);
}
async function cdp(url) {
  const socket = new WebSocket(url); await once(socket, 'open'); let id = 0; const pending = new Map();
  socket.addEventListener('message', ({ data }) => { const response = JSON.parse(data), request = pending.get(response.id); if (!request) return; pending.delete(response.id); clearTimeout(request.timer); response.error ? request.reject(new Error(response.error.message)) : request.resolve(response.result); });
  return { close: () => socket.close(), call(method, params = {}) { return new Promise((resolve, reject) => { const requestId = ++id; const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}`)); }, 20000); pending.set(requestId, { resolve, reject, timer }); socket.send(JSON.stringify({ id: requestId, method, params })); }); } };
}
async function main() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'milagre-project-links-')));
  const profile = path.join(dir, 'profile'), worktreeRoot = path.join(dir, 'worktrees');
  const projects = [];
  for (const name of ['food-api', 'food-web']) {
    const folder = path.join(dir, name); projects.push(folder); await fs.mkdir(folder);
    execFileSync('git', ['init', '-qb', 'main', folder]); await fs.writeFile(path.join(folder, 'status.txt'), 'Original\n');
    execFileSync('git', ['-C', folder, 'add', '.']); execFileSync('git', ['-C', folder, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Fixture']);
  }
  let providerCalls = 0;
  const options = { cwd: projects[0], registryRoots: [], worktreeRoot, environmentReady: Promise.resolve(), titleModels: {}, agentCli: async () => ({ command: '/fake' }), createSession: (provider, context) => ({
    turnActive: false, async startTurn() {
      providerCalls++; assert.equal(context.workspaceRoots.length, 2);
      for (const member of context.workspaceRoots) await fs.writeFile(path.join(member, 'status.txt'), 'Shared edit\n');
      context.emit({ type: 'session-started', nativeId: 'shared-session' }); context.emit({ type: 'turn-started', turnId: 'turn' });
      context.emit({ type: 'text-delta', messageId: `reply-${providerCalls}`, text: 'Updated status.txt in both owned Worktrees.' }); context.emit({ type: 'turn-completed' }); return { turnId: 'turn' };
    }, close() {}, interrupt() {},
  }) };
  let daemon, client, child, connection, evaluate; let output = '';
  const shot = async name => { if (!process.env.MILAGRE_SCREENSHOT_DIR) return; await fs.mkdir(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true }); await delay(200); const image = await connection.call('Page.captureScreenshot'); await fs.writeFile(path.join(process.env.MILAGRE_SCREENSHOT_DIR, name + '.png'), Buffer.from(image.data, 'base64')); };
  try {
    daemon = await startDaemon({ dataDir: profile, version: '0.1.0', runtimeOptions: options }); client = await connectHost({ dataDir: profile });
    for (const project of projects) await client.call('project:open', [project]); await client.call('project:open', [projects[0]]);
    const env = { ...process.env, MILAGRE_DEV_SERVER_URL: pathToFileURL(path.join(root, 'apps/desktop/dist/index.html')).href, MILAGRE_WORKTREE_ROOT: worktreeRoot }; delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(require('electron'), [path.join(root, 'apps/desktop'), `--user-data-dir=${profile}`, '--remote-debugging-port=0'], { cwd: projects[0], env, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-20000); });
    const port = await waitFor(() => { assert.equal(child.exitCode, null, output); return output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1]; }, 'Electron debugger');
    const page = await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(page => page.type === 'page' && page.url.startsWith('file:')), 'real desktop page');
    connection = await cdp(page.webSocketDebuggerUrl);
    evaluate = async expression => { const result = await connection.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value; };
    const click = text => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
    const input = (selector, value) => evaluate(`(() => {const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    const selector = () => evaluate(`document.querySelector('[data-workspace-trigger]').click()`);
    await waitFor(() => evaluate(`!!document.querySelector('[data-workspace-trigger]') && !document.querySelector('.startup-splash-screen')`), 'desktop ready');
    await selector(); await waitFor(() => evaluate(`document.body.textContent.includes('Link projects')`), 'Project selector actions');
    assert.ok(await evaluate(`document.body.textContent.includes('Copy project path')`)); assert.equal(await evaluate(`document.body.textContent.includes('Import project')`), false); await shot('project-selector');
    await click('Link projects…'); await waitFor(() => evaluate(`!!document.querySelector('#link-name') && document.querySelectorAll('dialog input[type=checkbox]').length === 2`), 'Link creation dialog');
    assert.equal(await evaluate(`document.querySelectorAll('dialog input[type=checkbox]:checked').length`), 0, 'Opening Link projects leaves membership choices to the user');
    assert.equal(await evaluate(`document.querySelector('dialog button[type=submit]').disabled`), true);
    await shot('create-link-empty');
    await input('#link-name', 'RDFood');
    assert.equal(await evaluate(`document.querySelector('dialog button[type=submit]').disabled`), true);
    await evaluate(`document.querySelector('dialog input[type=checkbox]').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('dialog input[type=checkbox]:checked').length`), 1);
    assert.equal(await evaluate(`document.querySelector('dialog button[type=submit]').disabled`), true, 'One explicitly selected Project is insufficient');
    await input('input[aria-label="Search projects"]', 'food-web');
    assert.equal(await evaluate(`document.querySelectorAll('dialog input[type=checkbox]').length`), 1); await evaluate(`document.querySelector('dialog input[type=checkbox]').click()`);
    await input('input[aria-label="Search projects"]', ''); await shot('create-link'); await click('Create Link');
    await waitFor(() => evaluate(`document.querySelector('[data-workspace-trigger]')?.textContent.includes('RDFood') && !document.querySelector('#link-name')`), 'selected Link');
    assert.equal(providerCalls, 0); const links = await client.call('link:list'); const link = links[0]; assert.equal(links.length, 1);
    assert.equal(Object.keys((await client.call('link:snapshot', [link.id])).state.sessions).length, 0, 'Draft allocates no Worktrees');
    await selector(); await waitFor(() => evaluate(`document.body.textContent.includes('Links')`), 'Links selector section');
    assert.equal(await evaluate(`document.body.textContent.includes('Copy project path') || document.body.textContent.includes('Reveal in Finder') || document.body.textContent.includes('Project settings')`), false); await shot('link-selector');
    await selector();
    await input('textarea[aria-label="Prompt"]', 'Update status.txt across both Projects.'); await evaluate(`document.querySelector('button[aria-label="Send"]').click()`);
    await waitFor(() => evaluate(`document.body.textContent.includes('Updated status.txt in both owned Worktrees.')`), 'one shared transcript');
    const state = (await client.call('link:snapshot', [link.id])).state, session = Object.values(state.sessions)[0]; assert.equal(session.worktrees.length, 2); assert.equal(providerCalls, 1);
    assert.equal(state.messages.filter(message => message.role === 'assistant').length, 1);
    for (const project of projects) assert.equal(await fs.readFile(path.join(project, 'status.txt'), 'utf8'), 'Original\n');
    for (const member of session.worktrees) assert.equal(await fs.readFile(path.join(member.worktreePath, 'status.txt'), 'utf8'), 'Shared edit\n');
    assert.equal(await evaluate(`document.querySelector('[data-chat-pane]').textContent.includes('RDFood / Link')`), false);
    assert.ok(await evaluate(`document.body.textContent.includes('2 Worktrees')`)); await shot('shared-chat');
    await click('Commit and open PR…'); await waitFor(() => evaluate(`!!document.querySelector('dialog[aria-label="Choose Project for Git"]')`), 'Git member chooser');
    assert.equal(await evaluate(`[...document.querySelectorAll('dialog button')].find(button=>button.textContent==='Continue').disabled`), true); await shot('choose-git-project'); await click('Cancel');
    await input('textarea[aria-label="Prompt"]', 'Keep this Link draft'); await selector(); await waitFor(() => evaluate(`!!document.querySelector('[data-project-item]')`), 'Project menu rows'); await evaluate(`[...document.querySelectorAll('[data-project-item] [data-menu-row]')].find(button => button.textContent.includes('food-api')).click()`);
    await waitFor(() => evaluate(`document.querySelector('[data-workspace-trigger]')?.textContent.includes('food-api')`), 'ordinary Project restored');
    await input('textarea[aria-label="Prompt"]', 'Keep this Project draft'); await selector(); await waitFor(() => evaluate(`!!document.querySelector('[data-link-row]')`), 'Link menu row'); await evaluate(`document.querySelector('[data-link-row]').click()`);
    await waitFor(() => evaluate(`document.querySelector('textarea[aria-label="Prompt"]')?.value === 'Keep this Link draft'`), 'independent Link draft');
    await input('textarea[aria-label="Prompt"]', 'Follow up in both Worktrees'); await evaluate(`document.querySelector('button[aria-label="Send"]').click()`);
    await waitFor(() => providerCalls === 2, 'second turn');
    assert.deepEqual((await client.call('link:snapshot', [link.id])).state.sessions[session.id].worktrees, session.worktrees);
    await evaluate(`document.querySelector('button[aria-label="New chat"]').click()`); await input('textarea[aria-label="Prompt"]', 'An independent new Chat draft');
    await selector(); await waitFor(() => evaluate(`!!document.querySelector('[data-project-item]')`), 'Project rows'); await evaluate(`[...document.querySelectorAll('[data-project-item] [data-menu-row]')].find(button => button.textContent.includes('food-api')).click()`);
    await waitFor(() => evaluate(`document.querySelector('[data-workspace-trigger]')?.textContent.includes('food-api')`), 'Project switch');
    assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Prompt"]').value`), 'Keep this Project draft');
    await selector(); await waitFor(() => evaluate(`!!document.querySelector('[data-link-row]')`), 'Link row'); await evaluate(`document.querySelector('[data-link-row]').click()`);
    await waitFor(() => evaluate(`document.querySelector('textarea[aria-label="Prompt"]')?.value === 'An independent new Chat draft'`), 'new Chat draft restored');
    assert.equal(await evaluate(`document.querySelector('[data-chat-pane]').textContent.includes('Updated status.txt in both owned Worktrees.')`), false, 'Explicit new Chat selection must survive a scope switch');
    const setupGate = path.join(dir, 'setup-ready');
    await client.call('worktree-setup:save', [projects[0], `while test ! -f '${setupGate}'; do sleep 0.1; done`]);
    await evaluate(`document.querySelector('button[aria-label="New chat"]').click()`);
    await input('textarea[aria-label="Prompt"]', 'Slow new shared Chat'); await evaluate(`document.querySelector('button[aria-label="Send"]').click()`);
    await waitFor(async () => Object.values((await client.call('link:snapshot', [link.id])).state.preparations).some(prep => prep.status === 'setup'), 'slow preparation started');
    await evaluate(`document.querySelector('button[aria-label="New chat"]').click()`); await input('textarea[aria-label="Prompt"]', 'Slow new shared Chat');
    await fs.writeFile(setupGate, 'ready'); await waitFor(() => providerCalls === 3, 'earlier send finishes'); await delay(500);
    assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Prompt"]').value`), 'Slow new shared Chat', 'A late send must not select its Chat or clear the new draft');
    await evaluate(`[...document.querySelectorAll('button[data-row]')].find(button => button.textContent.includes('Update status.txt')).click()`);
    await fs.unlink(setupGate);
    await evaluate(`document.querySelector('button[aria-label="New chat"]').click()`); await input('textarea[aria-label="Prompt"]', 'Send then switch scope'); await evaluate(`document.querySelector('button[aria-label="Send"]').click()`);
    await waitFor(async () => Object.values((await client.call('link:snapshot', [link.id])).state.preparations).some(prep => prep.status === 'setup'), 'scope-switch preparation');
    await selector(); await waitFor(() => evaluate(`!!document.querySelector('[data-project-item]')`), 'switch-away Project rows'); await evaluate(`[...document.querySelectorAll('[data-project-item] [data-menu-row]')].find(button => button.textContent.includes('food-api')).click()`);
    await waitFor(() => evaluate(`document.querySelector('[data-workspace-trigger]')?.textContent.includes('food-api')`), 'switched away during setup');
    await fs.writeFile(setupGate, 'ready'); await waitFor(() => providerCalls === 4, 'background send acknowledgement'); await delay(500);
    await selector(); await waitFor(() => evaluate(`!!document.querySelector('[data-link-row]')`), 'return Link row'); await evaluate(`document.querySelector('[data-link-row]').click()`);
    await waitFor(() => evaluate(`document.querySelector('[data-workspace-trigger]')?.textContent.includes('RDFood')`), 'returned Link');
    assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Prompt"]').value`), '', 'Acknowledged first send must not return as an unsent new Chat draft');
    assert.ok(await evaluate(`document.querySelector('[data-chat-pane]').textContent.includes('Send then switch scope')`));
    await evaluate(`[...document.querySelectorAll('button[data-row]')].find(button => button.textContent.includes('Update status.txt')).click()`);
    // Missing members preserve history and the unsent draft, with a named error.
    await fs.rename(projects[0], projects[0] + '-moved');
    try {
      await input('textarea[aria-label="Prompt"]', 'Draft survives missing Project'); await evaluate(`document.querySelector('button[aria-label="Send"]').click()`);
      await waitFor(() => evaluate(`document.body.textContent.includes('unavailable')`), 'named unavailable member error');
      assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Prompt"]').value`), 'Draft survives missing Project'); assert.equal(providerCalls, 4); await shot('missing-member');
    } finally { await fs.rename(projects[0] + '-moved', projects[0]); }
    client.close(); client = null; await daemon.close(); daemon = null;
    await waitFor(() => evaluate(`!!document.querySelector('[data-host-disconnected]')`), 'Link reconnect notice'); await shot('link-disconnected');
    daemon = await startDaemon({ dataDir: profile, version: '0.1.0', runtimeOptions: options }); client = await connectHost({ dataDir: profile });
    await waitFor(() => evaluate(`!document.querySelector('[data-host-disconnected]')`), 'Link reconnect');
    assert.equal(await evaluate(`document.querySelector('textarea[aria-label="Prompt"]').value`), 'Draft survives missing Project');
    assert.deepEqual((await client.call('link:snapshot', [link.id])).state.sessions[session.id].worktrees, session.worktrees);
    console.log('PASS: real desktop creates a named Link, owns two Worktrees in one Chat, chooses Git scope, preserves scoped drafts and reconnects without new Worktrees.');
  } catch (error) { console.error(output); throw error; }
  finally { await fs.writeFile(path.join(dir, 'setup-ready'), 'ready').catch(() => {}); connection?.close(); if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; } client?.close(); await daemon?.close(); await fs.rm(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
