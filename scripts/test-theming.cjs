// Settings > Appearance in Electron: the theme picker and mode control recolor the page, striped body and code.
// Terminal colors are covered through the --ansi-N variables the terminal reads (no daemon in this fixture).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsNav, SettingsPanel } from '/src/components/Settings';
import { useApplyTheme } from '/src/lib/settings';
import '/src/styles.css';
window.milagre = { listEditors: async () => [], listRecentProjects: async () => [], listProjects: async () => [], setWindowTranslucent: async () => {} };
function Fixture() {
  const [section, setSection] = useState('appearance');
  useApplyTheme();
  return (
    <div style={{ display: 'flex', gap: 12, height: '100vh', padding: 12 }}>
      <SettingsNav section={section} onSelect={setSection} onSelectProject={() => {}} onBack={() => {}} showProjectSettings={false} />
      <main style={{ flex: 1, minWidth: 0 }}><SettingsPanel section={section} models={[]} update={null} /></main>
      <pre className="code-token" style={{ '--shiki-light': 'var(--shiki-token-keyword)', '--shiki-dark': 'var(--shiki-token-keyword)' }}>const</pre>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

const tile = (label) => `document.querySelector('[role="radio"][aria-label="${label}"]')`;
const mode = (label) => `document.querySelector('[role="radiogroup"][aria-label="Mode"] [aria-label="${label}"]')`;
const pageIs = (hex) => `getComputedStyle(document.documentElement).getPropertyValue('--page').trim() === '${hex}'`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", fs.mkdtempSync(path.join(require("node:os").tmpdir(), "milagre-theming-")));
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
  const page = () => evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--page').trim()`);
  try {
    await window.loadURL(process.argv[2]);
    await waitFor(`!!${tile("Milagre Blue")}`);
    assert.equal(await evaluate(`${tile("Milagre Blue")}.getAttribute('aria-checked')`), "true", "Milagre Blue is the default");
    await evaluate(`${mode("Dark")}.click()`);
    await waitFor(`document.documentElement.classList.contains('dark')`);
    const blueDark = await page();
    await screenshot("milagre-blue-dark");
    await evaluate(`${mode("Light")}.click()`);
    await waitFor(`!document.documentElement.classList.contains('dark')`);
    await screenshot("milagre-blue-light");
    await evaluate(`${mode("Dark")}.click()`);
    await evaluate(`${tile("Catppuccin Mocha")}.click()`);
    await waitFor(pageIs("#1e1e2e"));
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.code-token')).color`), "rgb(203, 166, 247)", "code follows the theme");
    assert.equal(await evaluate(`getComputedStyle(document.body).backgroundColor`), "rgb(30, 30, 46)", "the striped body follows the theme");
    await screenshot("catppuccin-mocha-dark");
    await evaluate(`${mode("Light")}.click()`);
    await waitFor(pageIs("#eff1f5"));
    assert.equal(
      await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--ansi-1').trim()`),
      "#d20f39",
      "terminal colors follow the theme",
    );
    await screenshot("catppuccin-latte");
    await evaluate(`document.documentElement.classList.add('translucent')`);
    await waitFor(`/#eff1f5/.test(getComputedStyle(document.documentElement).getPropertyValue('--page'))`);
    assert.match(await page(), /#eff1f5/, "translucent page is the theme's color at an alpha");
    await evaluate(`document.documentElement.classList.remove('translucent')`);
    await evaluate(`${tile("Gray")}.click()`);
    await waitFor(pageIs("#fafafb"));
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('milagre-settings')).colorTheme`), "gray", "the choice is saved");
    assert.notEqual(blueDark, "#17181a", "Milagre Blue dark is not Gray dark");
    assert.equal(await evaluate(`document.querySelectorAll('#milagre-theme').length`), 1, "one theme stylesheet is reused");
    await screenshot("gray-light");
    assert.deepEqual(errors, []);
    console.log(
      "PASS: Appearance defaults to Milagre Blue; picking a theme and a mode recolors the page, body and code, translucency keeps the theme, one stylesheet is reused, and the choice is saved",
    );
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
    cacheDir: path.resolve(__dirname, "../node_modules/.vite-theming"),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "theming-fixture",
        resolveId(id) {
          if (id === "/__theming.tsx") return id;
        },
        load(id) {
          if (id === "/__theming.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__theming") return next();
            response.setHeader("Content-Type", "text/html");
            response.end(
              await server.transformIndexHtml(
                request.url,
                '<html><body><div id="root"></div><script type="module" src="/__theming.tsx"></script></body></html>',
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
    const child = require("node:child_process").spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__theming`], {
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
