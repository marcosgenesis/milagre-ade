// Settings > Experimental > Linear in Electron: the switch reveals the connection, which connects and disconnects.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsNav, SettingsPanel } from '/src/components/Settings';
import '/src/styles.css';
let enabled = false;
let status = { connected: false };
const listeners = new Set();
const connected = { connected: true, viewer: { name: 'Victor', email: 'v@x' }, organization: { name: 'Acme', urlKey: 'acme' } };
window.milagre = {
  listEditors: async () => [], listRecentProjects: async () => [], listProjects: async () => [],
  readLinearEnabled: async () => ({ enabled }),
  saveLinearEnabled: async (value) => ({ enabled: (enabled = value) }),
  readLinearStatus: async () => status,
  connectLinear: () =>
    window.__hangConnect
      ? new Promise((resolve, reject) => (window.__rejectConnect = () => reject(new Error('Linear sign-in timed out. Try again.'))))
      : new Promise((resolve) => setTimeout(() => resolve((status = connected)), 300)),
  disconnectLinear: async () => (status = { connected: false }),
  onLinearStatusChanged: (callback) => (listeners.add(callback), () => listeners.delete(callback)),
};
// What the Mac's daemon does when the status changes behind the window's back (a phone, or a sign-in finishing).
window.__emitLinear = (next) => {
  status = next;
  listeners.forEach((callback) => callback(next));
};
window.__connectedStatus = connected;
function Fixture() {
  const [section, setSection] = useState('appearance');
  return (
    <div style={{ display: 'flex', gap: 12, height: '100vh', padding: 12 }}>
      <SettingsNav section={section} onSelect={setSection} onSelectProject={() => {}} onBack={() => {}} showProjectSettings={false} />
      <main style={{ flex: 1, minWidth: 0 }}><SettingsPanel section={section} models={[]} update={null} /></main>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", fs.mkdtempSync(path.join(require("node:os").tmpdir(), "milagre-linear-settings-")));
  await app.whenReady();
  const window = new BrowserWindow({ width: 1100, height: 700, show: false, webPreferences: { backgroundThrottling: false } });
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  const errors = [];
  window.webContents.on("console-message", (details) => {
    if (details.level === "error") errors.push(details.message);
  });
  const waitFor = async (source) => {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw Error("Timed out: " + source);
  };
  const screenshot = async (name) => {
    if (!process.env.MILAGRE_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
    window.webContents.invalidate();
    await delay(250);
    fs.writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, name + ".png"), (await window.webContents.capturePage()).toPNG());
  };
  const toggle = `document.querySelector('[role="switch"][aria-label="Linear"]')`;
  const button = (label) => `[...document.querySelectorAll('[data-linear-settings] button')].find(b => b.textContent.trim() === '${label}')`;
  const text = `document.querySelector('[data-linear-settings]').textContent`;
  try {
    await window.loadURL(process.argv[2]);
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Experimental')`);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Experimental').click()`);
    await waitFor(`!!${toggle}`);
    assert.equal(await evaluate(`!!${button("Connect")}`), false, "Connection hidden while the switch is off");
    await screenshot("off");
    await evaluate(`${toggle}.click()`);
    await waitFor(`!!${button("Connect")}`);
    assert.match(await evaluate(text), /Not connected/);
    await screenshot("not-connected");
    await evaluate(`${button("Connect")}.click()`);
    await waitFor(`${text}.includes('Finish signing in to Linear in your browser.')`);
    assert.equal(await evaluate(`!!${button("Start again")}`), true);
    await screenshot("connecting");
    await waitFor(`document.querySelector('[data-linear-settings]').dataset.linearConnected === 'true'`);
    assert.match(await evaluate(text), /Connected as Victor to Acme/);
    await screenshot("connected");
    await evaluate(`${button("Disconnect")}.click()`);
    await waitFor(`document.querySelector('[data-linear-settings]').dataset.linearConnected === 'false'`);
    // A status that arrives from the daemon (a sign-in that finished elsewhere) updates the row without a click.
    await evaluate(`window.__emitLinear(window.__connectedStatus)`);
    await waitFor(`document.querySelector('[data-linear-settings]').dataset.linearConnected === 'true'`);
    assert.match(await evaluate(text), /Connected as Victor to Acme/);
    await evaluate(`${button("Disconnect")}.click()`);
    await waitFor(`document.querySelector('[data-linear-settings]').dataset.linearConnected === 'false'`);
    // A connect still waiting when the connected status arrives ends quietly: no error, no "Start again", even when
    // the waiting call later fails.
    await evaluate(`window.__hangConnect = true`);
    await evaluate(`${button("Connect")}.click()`);
    await waitFor(`!!${button("Start again")}`);
    await evaluate(`window.__emitLinear(window.__connectedStatus)`);
    await waitFor(`document.querySelector('[data-linear-settings]').dataset.linearConnected === 'true'`);
    await evaluate(`window.__rejectConnect()`);
    await delay(150);
    const row = await evaluate(text);
    assert.match(row, /Connected as Victor to Acme/);
    assert.doesNotMatch(row, /timed out|Finish signing in/);
    assert.equal(await evaluate(`!!${button("Start again")}`), false);
    assert.equal(await evaluate(`!!document.querySelector('[data-linear-settings] .text-red')`), false, "no error shown");
    await screenshot("connected-elsewhere");
    assert.deepEqual(errors, []);
    console.log("PASS: Experimental > Linear shows the connection only when on, connects through the browser and disconnects");
    app.exit(0);
  } catch (error) {
    console.error(error);
    console.error(errors);
    app.exit(1);
  }
}

async function main() {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: path.resolve(__dirname, "../apps/desktop/vite.config.ts"),
    cacheDir: path.resolve(__dirname, "../node_modules/.vite-linear-settings"),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "linear-settings-fixture",
        resolveId(id) {
          if (id === "/__linear-settings.tsx") return id;
        },
        load(id) {
          if (id === "/__linear-settings.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__linear-settings") return next();
            response.setHeader("Content-Type", "text/html");
            response.end(
              await server.transformIndexHtml(
                request.url,
                '<html><body><div id="root"></div><script type="module" src="/__linear-settings.tsx"></script></body></html>',
              ),
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
    const child = require("node:child_process").spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__linear-settings`], {
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
  if (process.versions.electron) require("electron").app.exit(1);
  else process.exitCode = 1;
});
