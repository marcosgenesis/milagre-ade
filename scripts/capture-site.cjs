// Captures the landing page screenshots from the real desktop renderer in dark mode.
// Demo data only (scripts/fixtures/demo-desktop.cjs); no provider or personal data is read.
// npm run capture:site
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { desktopFixture } = require('./fixtures/demo-desktop.cjs');

const output = path.resolve(__dirname, '../apps/site/src/assets/screenshots');
const canvasFixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasView } from '/src/components/CanvasView';
import '/src/styles.css';
const state = (id, title, added, removed) => ({ next_id: 5, projects: {}, worktrees: { 1: { id: 1, project_id: 1, path: '/' + id, name: 'main', diff: { added, removed } } }, sessions: { 2: { id: 2, worktree_id: 1, agent_name: 'Claude', status: 'Stopped', title } }, messages: [], tasks: {} });
const projects = [
  { id: 'web', path: '/web', name: 'Frontend', openedAt: '2026-10-03T10:00:00Z', position: { x: 0, y: 0 } },
  { id: 'api', path: '/api', name: 'Backend', openedAt: '2026-10-03T09:00:00Z', position: { x: 440, y: 0 } },
];
const links = [{ id: 'link-1', a: { project_id: 'web' }, b: { project_id: 'api' }, created_at: '2026-10-03T10:05:00Z' }];
window.milagre = {
  getCanvas: async () => ({ projects, links, worktreePositions: {}, states: [{ path: '/web', state: state('web', 'Show order history', 48, 6) }, { path: '/api', state: state('api', 'Add the orders endpoint', 112, 9) }] }),
  addLink: async () => links, removeLink: async () => links, setProjectPosition: async () => [], setWorktreePosition: async () => null,
};
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<div style={{ display: 'flex', height: '100vh', padding: '20px', background: 'var(--page)' }}><CanvasView states={{}} runs={{}} linkedWork={{ delegations: [], negotiations: [], receiveOnly: [] }} onOpenChat={() => {}} onBack={() => {}} /></div>);
`;

async function waitFor(window, code, description) {
  for (let i = 0; i < 200; i++) {
    if (await window.webContents.executeJavaScript(code)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}

async function capture(desktopUrl, canvasUrl) {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'milagre-site-electron-')));
  await app.whenReady();
  const window = new BrowserWindow({ width: 1360, height: 860, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  window.webContents.on('console-message', e => { if (e.level === 'error') console.error(e.message); });
  const save = async name => {
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    await delay(800);
    fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG());
  };

  await window.loadURL(desktopUrl);
  await waitFor(window, `!!document.querySelector('[data-row]') && !document.querySelector('.startup-splash-screen')`, 'desktop fixture');
  await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b => /^new chat$/i.test(b.getAttribute('aria-label') || ''))?.click()`);
  await save('sidebar.png');

  await window.webContents.executeJavaScript(`[...document.querySelectorAll('button, a, [role="button"]')].find(el => el.textContent.includes('Swipe between Chat and Changes'))?.click()`);
  await waitFor(window, `document.body.innerText.includes('Run the swipe navigation checks')`, 'approval card');
  await save('approval.png');

  await window.loadURL(canvasUrl);
  await waitFor(window, `!!document.querySelector('[data-canvas]') && document.body.innerText.includes('Backend')`, 'canvas fixture');
  await save('canvas.png');
  app.exit();
}

// Renders the built site's hero at 1200x630 for link previews.
async function captureOg() {
  const http = require('node:http');
  const dist = path.resolve(__dirname, '../apps/site/dist');
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
  const server = http.createServer((req, res) => {
    let file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'milagre-og-electron-')));
  await app.whenReady();
  const window = new BrowserWindow({ width: 1200, height: 630, useContentSize: true, show: false });
  const url = `http://127.0.0.1:${server.address().port}/`;
  // Electron 44 crashes if emulation is sent before the first navigation, so load, attach, then reload.
  await window.loadURL(url);
  window.webContents.debugger.attach();
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.webContents.reload();
  await reloaded;
  // The full hero is taller than 630px, so keep the title and the scene and shrink both to fit.
  await window.webContents.executeJavaScript(`
    document.querySelector('.nav')?.remove();
    const hero = document.querySelector('.hero');
    for (const el of hero.children) if (!el.matches('h1, .hero-visual')) el.style.display = 'none';
    hero.style.cssText += 'padding: 30px 0 0; gap: 0;';
    for (const part of [hero, hero.parentElement]) {
      for (let next = part.nextElementSibling; next; next = next.nextElementSibling) next.style.display = 'none';
    }
    const title = hero.querySelector('h1');
    title.style.cssText += 'max-width: 22ch; font-size: 54px;';
    const visual = hero.querySelector('.hero-visual');
    visual.style.cssText += 'margin-top: 20px; zoom: 0.74;';
    document.fonts.ready.then(() => true)
  `);
  await delay(500);
  fs.writeFileSync(path.resolve(__dirname, '../apps/site/public/og.png'), (await window.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 630 })).resize({ width: 1200, height: 630 }).toPNG());
  server.close();
  app.exit();
}

async function main() {
  if (process.versions.electron) return process.argv.includes('--og') ? captureOg() : capture(process.argv.at(-2), process.argv.at(-1));
  if (process.argv.includes('--og')) {
    const child = spawn(require('electron'), [__filename, '--og'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    const code = await new Promise(resolve => child.on('exit', resolve));
    if (code) throw new Error('OG capture failed');
    return console.log('Saved apps/site/public/og.png');
  }
  fs.mkdirSync(output, { recursive: true });
  const { createServer } = await import('vite');
  const fixtures = { '/__site_desktop.tsx': desktopFixture('dark'), '/__site_canvas.tsx': canvasFixture };
  const server = await createServer({
    configFile: path.resolve(__dirname, '../apps/desktop/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'site-fixtures',
      resolveId: id => (id in fixtures ? id : null),
      load: id => fixtures[id] ?? null,
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const entry = { '/__site_desktop': '/__site_desktop.tsx', '/__site_canvas': '/__site_canvas.tsx' }[req.url];
          if (!entry) return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(await server.transformIndexHtml(req.url, `<html class="dark"><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`));
        });
      },
    }],
  });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const child = spawn(require('electron'), [__filename, `${base}__site_desktop`, `${base}__site_canvas`], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  const code = await new Promise(resolve => child.on('exit', resolve));
  await server.close();
  if (code) throw new Error('Screenshot capture failed');
  for (const name of ['sidebar.png', 'approval.png', 'canvas.png']) {
    const size = fs.statSync(path.join(output, name)).size;
    assert.ok(size > 20000, `${name} looks empty (${size} bytes)`);
    console.log(`Saved ${path.join(output, name)} (${Math.round(size / 1024)} KB)`);
  }
}

main().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
