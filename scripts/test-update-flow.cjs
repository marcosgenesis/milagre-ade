// Browser check: Settings > About lets the user pick the Beta release channel and hands the choice to the main process.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { UpdateShell, useAppUpdates } from "/src/components/UpdateNotice";
import { AboutSettings } from "/src/components/Settings";
import "/src/styles.css";
let listener;
window.__installs = 0;
window.__checks = 0;
window.__state = { status: "downloading", version: "1.2.3", progress: 42 };
window.__update = (state) => { window.__state = state; listener(state); };
window.milagre = {
  getAppVersion: async () => "1.2.2", getReleaseChannel: async () => "stable",
  getUpdateState: async () => window.__state,
  onUpdateState: (cb) => { listener = cb; return () => {}; },
  installUpdate: async () => { window.__installs++; window.__update({ ...window.__state, status: "installing" }); },
  checkForUpdates: async () => { window.__checks++; window.__update({ ...window.__state, status: "checking" }); },
};
document.documentElement.classList.add("dark");
function Settings() { return <AboutSettings update={useAppUpdates()} />; }
createRoot(document.getElementById("root")).render(
  <UpdateShell><div style={{ maxWidth: 640, margin: "60px auto" }}><Settings /></div></UpdateShell>
);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const window = new BrowserWindow({
    width: 900,
    height: 520,
    show: false,
    webPreferences: { backgroundThrottling: false, partition: "update-flow-check" },
  });
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  async function waitFor(source) {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw new Error(`Timed out: ${source}`);
  }
  const screenshot = async (name) => {
    const dir = process.env.MILAGRE_SCREENSHOT_DIR;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    await delay(200);
    fs.writeFileSync(path.join(dir, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  };
  const button = (label) => `[...document.querySelectorAll('button')].find(n => n.textContent.trim() === ${JSON.stringify(label)})`;
  try {
    await window.loadURL(process.argv[2]);
    await waitFor("document.body.innerText.includes('Downloading update')");
    await evaluate(`${button("Downloading update · 42%")}.click()`);
    await waitFor("!!document.querySelector('[role=progressbar]')");
    await screenshot("update-downloading");
    await evaluate("window.__update({ status: 'downloaded', version: '1.2.3', progress: 100 })");
    await waitFor("!!document.querySelector('[aria-label=\"Update available\"]')");
    assert.match(await evaluate("document.body.innerText"), /stop running agents/);
    assert.doesNotMatch(await evaluate("document.body.innerText"), /terminal/i);
    assert.equal(await evaluate("document.querySelector('a').href"), "https://github.com/the-ptf/milagre-ade/releases/tag/v1.2.3");
    await screenshot("update-ready-dark");
    await evaluate("document.documentElement.classList.remove('dark')");
    await screenshot("update-ready-light");
    await evaluate("document.documentElement.classList.add('dark'); document.querySelector('[aria-label=\"Dismiss update\"]').click()");
    await waitFor("!document.querySelector('[role=dialog]')");
    assert.ok(await evaluate(`${button("Update available")}`));
    // Repeated download events must not undo dismissal.
    await evaluate("window.__update({ status: 'downloaded', version: '1.2.3', progress: 100 })");
    await delay(100);
    assert.equal(await evaluate("!!document.querySelector('[role=dialog]')"), false);
    await screenshot("update-dismissed");
    // Settings installation also goes through the agent-stop warning.
    await evaluate(`${button("Install & restart")}.click()`);
    await waitFor("!!document.querySelector('[role=dialog]')");
    assert.equal(await evaluate("window.__installs"), 0);
    await evaluate("document.querySelector('[role=dialog] button[data-install]').click()");
    await waitFor("document.body.innerText.includes('Restarting Milagre')");
    assert.equal(await evaluate("window.__installs"), 1);
    await screenshot("update-installing");
    await evaluate("window.__update({ status: 'downloaded', version: '1.2.3', progress: 100, error: 'Could not restart Milagre. Try again.' })");
    await waitFor("!!document.querySelector('[role=alert]')");
    await screenshot("update-install-error");
    await evaluate("window.__update({ status: 'error', version: '1.2.4', progress: 12, error: 'Could not download the update. Try again.' })");
    await waitFor("document.body.innerText.includes('Could not download')");
    await screenshot("update-download-error");
    await evaluate(`${button("Try again")}.click()`);
    await waitFor("window.__checks === 1");
    await evaluate("window.__update({ status: 'downloaded', version: '1.2.4', progress: 100 })");
    await waitFor("document.body.innerText.includes('v1.2.4 is ready')");
    // Escape returns keyboard focus to the persistent trigger.
    await evaluate("document.querySelector('[role=dialog] button').focus()");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await waitFor("!document.querySelector('[role=dialog]')");
    assert.equal(await evaluate("document.activeElement.textContent.trim()"), "Update available");
    await evaluate(`${button("Update available")}.click()`);
    await evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
    await waitFor("!document.querySelector('[role=dialog]')");
    console.log("PASS: update progress, ready card, dismissal, settings warning, installation, retries and keyboard access");
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
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "update-flow-fixture",
        resolveId(id) {
          if (id === "/__update_flow_fixture.tsx") return id;
        },
        load(id) {
          if (id === "/__update_flow_fixture.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__update_flow__") return next();
            const html = await server.transformIndexHtml(
              request.url,
              '<html><body><div id="root"></div><script type="module" src="/__update_flow_fixture.tsx"></script></body></html>',
            );
            response.setHeader("Content-Type", "text/html");
            response.end(html);
          });
        },
      },
    ],
  });
  try {
    await server.listen();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__update_flow__`], { env, stdio: "inherit" });
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
