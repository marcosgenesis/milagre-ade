// Settings > Experimental in Electron: the section is listed, and its switch turns the every-Project sidebar on and off.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsNav, SettingsPanel } from '/src/components/Settings';
import { useSettings } from '/src/lib/settings';
import '/src/styles.css';
window.milagre = { listEditors: async () => [], listRecentProjects: async () => [], listProjects: async () => [] };
function Fixture() {
  const [section, setSection] = useState('appearance');
  const { sidebarAllProjects } = useSettings();
  return (
    <div data-all-projects={String(sidebarAllProjects)} style={{ display: 'flex', gap: 12, height: '100vh', padding: 12 }}>
      <SettingsNav section={section} onSelect={setSection} onSelectProject={() => {}} onBack={() => {}} showProjectSettings={false} />
      <main style={{ flex: 1, minWidth: 0 }}><SettingsPanel section={section} models={[]} update={null} /></main>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", fs.mkdtempSync(path.join(require("node:os").tmpdir(), "milagre-experimental-settings-")));
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
  const toggle = `document.querySelector('[role="switch"][aria-label="Every project in the sidebar"], button[aria-label="Every project in the sidebar"], input[aria-label="Every project in the sidebar"]')`;
  try {
    await window.loadURL(process.argv[2]);
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Experimental')`);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Experimental').click()`);
    await waitFor(`!!${toggle}`);
    assert.equal(await evaluate(`document.querySelector('[data-all-projects]').dataset.allProjects`), "false", "Off by default");
    await screenshot("off");
    await evaluate(`${toggle}.click()`);
    await waitFor(`document.querySelector('[data-all-projects]').dataset.allProjects === 'true'`);
    await screenshot("on");
    await evaluate(`${toggle}.click()`);
    await waitFor(`document.querySelector('[data-all-projects]').dataset.allProjects === 'false'`);
    assert.deepEqual(errors, []);
    console.log("PASS: Settings lists an Experimental section whose switch turns the every-Project sidebar on and off, off by default");
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
    cacheDir: path.resolve(__dirname, "../node_modules/.vite-experimental-settings"),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "experimental-settings-fixture",
        resolveId(id) {
          if (id === "/__experimental-settings.tsx") return id;
        },
        load(id) {
          if (id === "/__experimental-settings.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__experimental-settings") return next();
            response.setHeader("Content-Type", "text/html");
            response.end(
              await server.transformIndexHtml(
                request.url,
                '<html><body><div id="root"></div><script type="module" src="/__experimental-settings.tsx"></script></body></html>',
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
    const child = require("node:child_process").spawn(
      require("electron"),
      [path.resolve(__filename), `${server.resolvedUrls.local[0]}__experimental-settings`],
      {
        env,
        stdio: "inherit",
      },
    );
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
