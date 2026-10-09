const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPanel, SettingsNav } from '/src/components/Settings';
import '/src/styles.css';
const accounts = [
  { provider: 'claude', accountId: 'default', label: 'personal@example.test' },
  { provider: 'claude', accountId: 'work', label: 'Work' },
  { provider: 'codex', accountId: 'default', label: 'Connected CLI account' },
];
const answers = {
  'claude:default': { problem: null, servers: [
    { name: 'pencil', transport: 'command', scope: 'user', state: 'connected', tools: 5, error: null },
    { name: 'linear', transport: 'url', scope: 'plugin', state: 'needs-sign-in', tools: 0, error: null },
    { name: 'claude.ai Gmail', transport: 'connector', scope: 'claude.ai', state: 'connected', tools: 30, error: null },
  ] },
  'claude:work': { problem: 'Not signed in. Sign in from Accounts.', servers: [] },
  'codex:default': { problem: null, servers: [
    { name: 'linear', transport: 'url', scope: 'user', state: 'connected', tools: 76, error: null },
    { name: 'epidemic-sound', transport: 'url', scope: 'user', state: 'failed', tools: 0, error: 'Environment variable EPIDEMIC_SOUND_API_KEY is not set' },
  ] },
};
window.checks = 0;
window.release = null;
window.milagre = {
  listAccounts: async () => ({ providers: [] }),
  listRecentProjects: async () => [],
  onAccountsChanged: () => () => {},
  mcp: {
    accounts: async () => {
      if (!window.accountsOpened) await new Promise((resolve) => { window.releaseAccounts = () => { window.accountsOpened = true; resolve(); }; });
      return accounts;
    },
    check: async (provider, accountId) => {
      window.checks++;
      const key = provider + ':' + accountId;
      // Codex answers only when the test says so, to show a spinner chip next to finished ones; a reject shows its error.
      if (key === 'codex:default' && !window.codexReleased) await new Promise((resolve) => { window.release = resolve; });
      if (window.failNext) { window.failNext = false; throw new Error('Mac unreachable'); }
      return { provider, accountId, label: accounts.find(a => a.provider === provider && a.accountId === accountId).label, ...answers[key] };
    },
  },
};
document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')).render(<div style={{display:'flex',height:'100vh',padding:16,gap:16}}><SettingsNav section="mcp" onSelect={()=>{}} onBack={()=>{}} /><main style={{flex:1}}><SettingsPanel section="mcp" models={[]} /></main></div>);
`;
async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", fs.mkdtempSync(path.join(require("node:os").tmpdir(), "milagre-mcp-ui-")));
  await app.whenReady();
  const win = new BrowserWindow({ width: 1120, height: 850, show: false, webPreferences: { backgroundThrottling: false } });
  const evaluate = (source) => win.webContents.executeJavaScript(source);
  const waitFor = async (source) => {
    for (let i = 0; i < 160; i++) {
      if (await evaluate(source)) return;
      await delay(50);
    }
    throw new Error("Timed out: " + source);
  };
  const text = () => evaluate("document.body.textContent");
  const shot = async (name) => {
    const dir = process.env.MILAGRE_SCREENSHOT_DIR;
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      await delay(250);
      fs.writeFileSync(path.join(dir, name + ".png"), (await win.webContents.capturePage()).toPNG());
    }
  };
  try {
    await win.loadURL(process.argv[2]);
    // Before the account list arrives: a loading line, and Refresh is disabled.
    await waitFor(`!!window.releaseAccounts`);
    assert.match(await text(), /Checking accounts…/);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Refresh').disabled`), true);
    await evaluate("window.releaseAccounts()");
    // Claude answered, Codex is still checking: finished chips and a spinner chip side by side.
    await waitFor(`document.body.textContent.includes('pencil')`);
    await waitFor(`!!document.querySelector('[data-mcp-chip="codex:default"][data-state="pending"]')`);
    await shot("mcp-checking");
    await evaluate("window.codexReleased = true; window.release()");
    await waitFor(`!!document.querySelector('[data-mcp-row="epidemic-sound"]')`);
    // One row per name; linear has a Claude plugin chip and a Codex user chip.
    assert.equal(await evaluate(`document.querySelectorAll('[data-mcp-row="linear"] [data-mcp-chip]').length`), 2);
    assert.match(await text(), /1 of 2 connected/);
    assert.match(await text(), /EPIDEMIC_SOUND_API_KEY/);
    // The signed-out account says so instead of listing servers.
    assert.match(await text(), /Work.*Not signed in/);
    // claude.ai and plugin-only servers sit under "From projects and plugins".
    assert.ok(await evaluate(`!!document.querySelector('[data-mcp-other] [data-mcp-row="claude.ai Gmail"]')`));
    await shot("mcp-list");
    // Refresh checks every account again; a check that rejects shows its error on that account.
    const before = await evaluate("window.checks");
    await evaluate("window.failNext = true");
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Refresh').click()`);
    await waitFor(`window.checks >= ${before + 3}`);
    await waitFor(`document.body.textContent.includes('Mac unreachable')`);
    await shot("mcp-error");
    console.log("PASS: MCP tab streams per-account checks, groups rows by name, and shows a failed check.");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}
async function main() {
  const { createServer } = await import("vite");
  const { spawn } = require("node:child_process");
  const server = await createServer({
    configFile: path.resolve(__dirname, "../apps/desktop/vite.config.ts"),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "mcp-fixture",
        resolveId: (id) => (id === "/__mcp.tsx" ? id : null),
        load: (id) => (id === "/__mcp.tsx" ? fixture : null),
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url !== "/__mcp__") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/__mcp.tsx"></script></body></html>'),
            );
          });
        },
      },
    ],
  });
  try {
    await server.listen();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [__filename, server.resolvedUrls.local[0] + "__mcp__", "-ApplePersistenceIgnoreState", "YES"], {
      env,
      stdio: "inherit",
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await server.close();
  }
}
(process.versions.electron ? browserChecks() : main()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
