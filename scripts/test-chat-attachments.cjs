// Real App and browser file APIs, isolated agent IPC. No paid agent calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const imageBytes = require('node:fs').readFileSync(path.join(__dirname, 'fixtures/photo.png')).toString('base64');
const fixture = `
window.imageBytes = ${JSON.stringify(imageBytes)};
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createInitialState } from '/src/model';
import '/src/styles.css';
const state = createInitialState('Milagre', '/fixture');
state.worktrees = { 1: { id: 1, name: 'main', path: '/fixture', project_id: 1 } };
state.sessions = { 3: { id: 3, worktree_id: 1, agent_name: 'Claude', provider: 'claude', status: 'Idle' }, 5: { id: 5, worktree_id: 1, agent_name: 'Other', provider: 'codex', status: 'Idle' } };
state.messages = [{ id: 4, session_id: 3, role: 'user', body: 'Attachment test', context: null }, { id: 6, session_id: 5, role: 'user', body: 'Other chat', context: null }];
state.next_id = 7;
window.calls = []; window.searches = []; window.notices = []; window.synced = []; window.listeners = [];
window.emitAgent = event => window.listeners.forEach(fn => fn({ chatId: '/fixture#3', event }));
window.milagre = new Proxy({
 onOpenChat: fn => { window.openNotification = fn; return () => {}; },
 switchProject: async root => ({ path: root, name: 'Other project', state: { ...state, sessions: { 10: { id: 10, worktree_id: 1, agent_name: 'Notified', status: 'Idle' } }, messages: [{ id: 11, session_id: 10, body: 'Notification destination', role: 'user', context: null }], next_id: 12 } }),
 getCurrentProject: async () => ({ path: '/fixture', name: 'Milagre', state }),
 listRecentProjects: async () => [], listBranches: async () => ['main'], listEditors: async () => [],
 getCachedUsage: async () => ({ providers: [] }), readUsage: async () => ({ providers: [] }), getUpdateState: async () => ({ status: 'idle' }),
 getPathForFile: file => '/fixture/files/' + file.name,
 searchProjectFiles: async (root, query) => { window.searches.push({root,query}); return ['src/my app.ts', 'src/model.ts'].filter(p => p.includes(query)); },
 startTurn: async request => { window.calls.push(request); window.emitAgent({ type: 'turn-started', turnId: 'test' }); return { turnId: 'test', steered: false }; },
 onAgentEvent: fn => { window.listeners.push(fn); return () => { window.listeners = window.listeners.filter(x => x !== fn); }; },
 notifyCompletion: async notice => { window.notices.push(notice); },
 syncNotifications: async value => { window.synced.push(value); },
 interruptAgent: async () => { window.interrupted = true; },
 saveProject: async (path, value) => { window.saved = value; },
}, { get(target, key) { return target[key] ?? (String(key).startsWith('on') ? () => () => {} : async () => null); } });
localStorage.setItem('milagre-settings', JSON.stringify({ theme: 'dark' }));
const { default: App } = await import('/src/App');
createRoot(document.getElementById('root')).render(<App />);
`;
async function browserChecks() {
 const { app, BrowserWindow, protocol, net, session } = require('electron');
 protocol.registerSchemesAsPrivileged([{ scheme: 'milagre-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
 await app.whenReady();
 const handleMedia = require('../electron/media.cjs').createMediaHandler((url, options) => net.fetch(url, options));
 session.fromPartition('issues-test').protocol.handle('milagre-media', request => {
   const url = new URL(request.url);
   url.searchParams.set('path', path.join(__dirname, 'fixtures', path.basename(url.searchParams.get('path'))));
   return handleMedia(new Request(url, { headers: request.headers }));
 });
 const rangeUrl = `milagre-media://file/?path=${encodeURIComponent(path.join(__dirname, 'fixtures/clip.mp4'))}`;
 const range = await handleMedia(new Request(rangeUrl, { headers: { Range: 'bytes=0-9' } }));
 assert.equal(range.status, 206, 'Actual Electron fetch honors video byte ranges');
 assert.equal((await range.arrayBuffer()).byteLength, 10);
 const window = new BrowserWindow({ width: 1000, height: 760, show: false, webPreferences: { partition: 'issues-test', backgroundThrottling: false } });
 const evaluate = async source => { try { return await window.webContents.executeJavaScript(source); } catch(error) { console.error(source); throw error; } };
 const errors = [];
 window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
 const waitFor = async source => { for (let n=0;n<200;n++) { if (await evaluate(source)) return; await delay(25); } throw Error('Timed out: '+source); };
 const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const key = (key, extra={}) => evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(extra)} }))`);
 const type = async text => { await evaluate(`(() => { const el=document.querySelector('textarea[aria-label="Prompt"]'); el.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el, ${JSON.stringify(text)}); el.setSelectionRange(el.value.length,el.value.length); el.dispatchEvent(new Event('input',{bubbles:true})); })()`); await delay(120); };
 const screenshot = async name => {
   if (!process.env.MILAGRE_SCREENSHOT_DIR) return;
   const fs = require('node:fs');
   fs.mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
   window.webContents.invalidate();
   await delay(250);
   fs.writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, `${name}.png`), (await window.webContents.capturePage()).toPNG());
 };
 const chooseFiles = async names => { await evaluate(`(() => { const dt=new DataTransfer(); for(const [name,type] of ${JSON.stringify(names)}) dt.items.add(new File([type.startsWith('image/') ? Uint8Array.from(atob(window.imageBytes), c => c.charCodeAt(0)) : name],name,{type})); const input=document.querySelector('input[type=file]'); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`); await delay(100); };
 try {
  await window.loadURL(process.argv[2]);
  await waitFor(String.raw`!!document.querySelector("textarea")`);
  await key('2', { metaKey: true });
  await waitFor(String.raw`document.querySelector("[aria-current=page]")?.textContent.includes("Attachment test")`);
  await evaluate(`document.querySelector('input[type=file]').addEventListener('click', e => { window.pickerOpened=true; e.preventDefault(); });`);
  await click('[aria-label="Add attachments and sources"]');
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Add files')).click()`);
  assert.equal(await evaluate('window.pickerOpened'), true, 'Add files invokes native file input');
  await chooseFiles([['note.txt','text/plain'],['clip.mp4','video/mp4'],['photo.png','image/png']]);
  await waitFor(String.raw`!!document.querySelector("[aria-label=\"Preview clip.mp4\"]")`);
  assert.equal(await evaluate('document.querySelector("textarea").value'), '', 'Paths do not pollute draft text');
  assert.equal(await evaluate('document.querySelector("[aria-label=Send]").disabled'), false, 'File-only messages can send');
  await screenshot('attachments-draft');
  await click('[aria-label="Preview photo.png"]');
  await waitFor(String.raw`!!document.querySelector("dialog[open]")`);
  await key('Escape');
  await waitFor(String.raw`!document.querySelector("dialog")`);
  assert.equal(await evaluate('window.interrupted'), undefined);
  await click('[aria-label="Preview clip.mp4"]');
  await waitFor(String.raw`document.querySelector("dialog video[controls]")?.videoWidth > 0`);
  await waitFor(String.raw`document.querySelector("dialog video")?.currentTime > 0`);
  await screenshot('video-preview');
  await key('Escape');
  await click('[aria-label="Send"]');
  await waitFor(String.raw`window.calls.length === 1`);
  assert.deepEqual(await evaluate('window.calls[0].images.map(i=>i.name)'), ['photo.png']);
  assert.ok(await evaluate('window.calls[0].prompt.includes("/fixture/files/note.txt") && window.calls[0].prompt.includes("/fixture/files/clip.mp4")'));
  assert.deepEqual(await evaluate('window.saved.messages.at(-1).files'), ['/fixture/files/note.txt','/fixture/files/clip.mp4','/fixture/files/photo.png']);
  assert.equal(await evaluate('window.saved.messages.at(-1).body'), '');
  await waitFor(String.raw`!!document.querySelector("article [aria-label=\"Preview photo.png\"]")`);
  await click('article [aria-label="Preview photo.png"]');
  await key('Escape');
  assert.equal(await evaluate('window.interrupted'), undefined, 'Preview Escape never stops active agent');
  await type('@src/');
  await waitFor(String.raw`document.querySelector("[aria-label=\"Project files\"]")?.textContent.includes("my app.ts")`);
  await screenshot('file-mentions');
  await key('Enter');
  assert.equal(await evaluate('document.querySelector("textarea").value'), '@"src/my app.ts" ');
  assert.equal(await evaluate('window.calls.length'), 1, 'Choosing a file does not send the message');
  assert.equal(await evaluate('window.searches.at(-1).root'), '/fixture');
  await type('');
  await evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(6 * 1024 * 1024)], 'photo.png', {type:'image/png'})); document.querySelector('textarea').dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:dt })); })()`);
  await waitFor(String.raw`document.querySelector('[data-promptbar] img')?.src.startsWith('milagre-media:')`);
  assert.equal(await evaluate('document.querySelector("textarea").value'), '', 'Large-image drops remain attachments');
  await click('[data-promptbar] [aria-label="Remove photo.png"]');
  await evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(window.imageBytes), c=>c.charCodeAt(0))], 'pasted.png', {type:'image/png'})); document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste', { bubbles:true, cancelable:true, clipboardData:dt })); })()`);
  await waitFor(String.raw`document.querySelector('[data-promptbar] img')?.src.startsWith('data:image/png')`);
  await chooseFiles([['discard.txt','text/plain']]);
  await key('2', { metaKey: true });
  await waitFor(String.raw`document.querySelector("[aria-current=page]")?.textContent.includes("Other chat")`);
  assert.equal(await evaluate('!!document.querySelector("[data-promptbar] [aria-label=Attachments]")'), false, 'Switching chats in same worktree clears attachments');
  await evaluate('window.emitAgent({type:"text-delta", messageId:"test", text:"Done"}); window.emitAgent({type:"turn-completed"})');
  await waitFor(String.raw`window.notices.length === 1`);
  await waitFor(String.raw`window.synced.at(-1)?.unread.includes("/fixture#3")`);
  await key('1', { metaKey: true });
  await waitFor(String.raw`!window.synced.at(-1)?.unread.includes("/fixture#3")`);
  await delay(250);
  require('node:fs').writeFileSync('/tmp/milagre-attachments.png', (await window.webContents.capturePage()).toPNG());
  await key(',', { metaKey:true });
  await waitFor(String.raw`!!document.querySelector('[role=switch][aria-label="Notify when finished"]')`);
  await screenshot('notification-settings');
  await click('[role=switch][aria-label="Notify when finished"]');
  await waitFor('window.synced.at(-1)?.notifyOnCompletion === false');
  await click('[role=switch][aria-label="Dock badge"]');
  await waitFor('window.synced.at(-1)?.showDockBadge === false');
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("milagre-settings")).showDockBadge'), false, 'Notification preferences persist');
  await evaluate('window.openNotification("/other#10")');
  await waitFor(String.raw`document.querySelector("[aria-current=page]")?.textContent.includes("Notification destination")`);
  console.log('PASS: native picker trigger, file-only send, saved attachments, image/video viewer, Escape isolation, @ file selection, same-worktree draft isolation, real video playback/Range, completion request, unread/read sync and cross-project notification routing');
  app.exit(0);
 } catch(error) { console.error(error); console.error(errors); console.error(await evaluate(`(() => { const v = document.querySelector('dialog video'); return v ? { src:v.src, error:v.error?.message, code:v.error?.code, ready:v.readyState, network:v.networkState } : null; })()`)); app.exit(1); }
}
async function main() {
  const { createServer } = await import('vite');
  const { spawn } = require('node:child_process');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'issues-fixture',
    resolveId(id) { if (id === '/__issues.tsx') return id; },
    load(id) { if (id === '/__issues.tsx') return fixture; },
    configureServer(server) { server.middlewares.use(async (request, response, next) => {
      if (request.url !== '/__issues') return next();
      response.setHeader('Content-Type', 'text/html');
      response.end(await server.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__issues.tsx"></script></body></html>'));
    }); },
  }] });
  try {
    await server.listen();
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__issues`], { env, stdio: 'inherit' });
    process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
  } finally { await server.close(); }
}
(process.versions.electron ? browserChecks() : main()).catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
