// Run with npm test -- --only test-phone. Exercises Settings › Phone in the real App against a real daemon (its own temporary data
// directory and socket, port chosen by the OS): turn phone access on, see the QR code and the relay status, copy the
// link, see a phone pair, reset access, turn it off. The rest of the window's API is mocked, like the other checks.
// Set MILAGRE_SCREENSHOT_DIR to save screenshots.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
// The window talks to the host through the main process, as the real preload does (see electron/preload.cjs).
const { ipcRenderer } = window.require("electron");
const state = { next_id: 3, projects: { 1: { id: 1, name: "shop" } }, worktrees: { 1: { id: 1, name: "main", path: "/fixture", project_id: 1 } }, sessions: { 2: { id: 2, worktree_id: 1, agent_name: "Claude", provider: "claude", status: "Idle" } }, connections: {}, events: [], messages: [], approvals: [], tasks: {}, artifacts: {}, outputs: [], conflicts: [] };
window.milagre = new Proxy({
  getRuntimeConnection: async () => ({ connected: true }),
  getAgentPorts: async () => ({}),
  getCurrentProject: async () => ({ path: "/fixture", name: "shop", state }),
  listBranches: async () => ["main"],
  listEditors: async () => [],
  getCachedUsage: async () => ({ providers: [] }),
  readUsage: async () => ({ providers: [] }),
  getUpdateState: async () => ({ status: "idle" }),
  getAppVersion: async () => "0.0.0",
  getLinkedWork: async () => ({ delegations: [], negotiations: [], receiveOnly: [] }),
  getPhoneStatus: () => ipcRenderer.invoke("phone:status"),
  setPhoneEnabled: (enabled) => ipcRenderer.invoke("phone:set-enabled", enabled),
  resetPhoneAccess: () => ipcRenderer.invoke("phone:reset"),
  openPhonePairing: () => ipcRenderer.invoke("phone:open-pairing"),
  onPhoneStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("phone:status", listener);
    return () => ipcRenderer.removeListener("phone:status", listener);
  },
}, { get(target, key) { return target[key] ?? (String(key).startsWith("on") ? () => () => {} : async () => null); } });
localStorage.setItem("milagre-settings", JSON.stringify({ defaultModelId: "claude-opus-5-5", defaultPermissionMode: "ask" }));
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<App />);
`;

async function browserChecks() {
  const { app, BrowserWindow, ipcMain, clipboard } = require("electron");
  const { startDaemon } = require("../apps/daemon/src/server.cjs");
  const { connect } = require("../apps/daemon/src/client.cjs");
  app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "milagre-phone-ui-")));
  const dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "milagre-phone-host-")));
  await app.whenReady();
  // The check never dials the public relay: this stand-in reports that it connected. A reset's retired room has no onStatus.
  const relays = [];
  const startRelay = (options) => {
    relays.push(options);
    setTimeout(() => options.onStatus?.("online"), 20);
    return { close: async () => {}, status: () => "online" };
  };
  const daemon = await startDaemon({
    dataDir,
    version: "test",
    phoneOptions: { localPort: 0, startRelay },
    runtimeOptions: {
      cwd: dataDir,
      environmentReady: Promise.resolve(),
      titleModels: {},
      agentCli: Object.assign(async () => ({ command: null }), { invalidate() {} }),
    },
  });
  const host = await connect({ dataDir });
  const paired = [];
  host.on("event", ({ channel, payload }) => {
    if (channel === "phone:paired") paired.push(payload);
  });
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    useContentSize: true,
    show: false,
    webPreferences: { partition: "phone-test", backgroundThrottling: false, nodeIntegration: true, contextIsolation: false },
  });
  for (const method of ["phone:status", "phone:set-enabled", "phone:reset", "phone:open-pairing"])
    ipcMain.handle(method, (_event, ...args) => host.call(method, args));
  host.on("event", ({ channel, payload }) => {
    if (channel === "phone:status" && !window.isDestroyed()) window.webContents.send(channel, payload);
  });
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") console.error(event.message);
  });
  const evaluate = async (source) => {
    try {
      return await window.webContents.executeJavaScript(source);
    } catch (error) {
      throw new Error(`${source}: ${error.message}`);
    }
  };
  async function waitFor(source) {
    for (let n = 0; n < 200; n++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw Error(`Timed out: ${source}`);
  }
  async function click(text) {
    const expr = `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)})`;
    await waitFor(`!!(${expr})`);
    await evaluate(`(${expr}).click()`);
  }
  const screenshotDir = process.env.MILAGRE_SCREENSHOT_DIR;
  async function screenshot(name) {
    if (!screenshotDir) return;
    await delay(400);
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.writeFileSync(path.join(screenshotDir, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  }
  const toggle = `document.querySelector('[role="switch"][aria-label="Allow your phone to connect"]')`;
  const token = async () => new URL((await host.call("phone:status")).pairingLink).searchParams.get("token");

  try {
    await window.loadURL(process.argv[2]);
    await waitFor(`!!document.querySelector('[aria-label="Settings"]')`);
    await evaluate(`document.querySelector('[aria-label="Settings"]').click()`);
    await click("Phone");

    // Off: the toggle, its status, and nothing else to pair with.
    await waitFor(`!!${toggle} && document.body.textContent.includes('Phone access')`);
    assert.equal(await evaluate(`${toggle}.getAttribute('aria-checked')`), "false");
    await waitFor(`document.body.textContent.includes('Allow your phone to connect') && document.body.textContent.includes('Off')`);
    assert.equal(await evaluate(`!!document.querySelector('[data-phone-qr]')`), false);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(el => el.textContent.includes('Reset access'))`), false);
    await screenshot("phone-off");
    console.log("PASS: Settings › Phone starts off, with nothing to pair");

    // On: a QR image that decodes, the relay status, the pairing window and the warning.
    await evaluate(`${toggle}.click()`);
    await waitFor(`!!document.querySelector('[data-phone-qr]')`);
    await waitFor(`(() => { const img = document.querySelector('[data-phone-qr]'); return img.complete && img.naturalWidth > 0; })()`);
    assert.equal(await evaluate(`${toggle}.getAttribute('aria-checked')`), "true");
    assert.equal(await evaluate(`document.querySelector('[data-phone-qr]').src.startsWith('data:image/svg+xml')`), true);
    await waitFor(`document.body.textContent.includes('On, reachable from any network')`);
    assert.equal(await evaluate(`!!document.querySelector('[data-phone-local-only]')`), false);
    await waitFor(`document.querySelector('[data-phone-pairing="open"]')?.textContent.includes('New phones can pair for 10 more minutes')`);
    assert.match(await evaluate(`document.querySelector('[data-phone-warning]').textContent`), /gives access to your agents/);
    const first = await token();
    assert.match(first, /^[a-f0-9]{64}$/);
    await screenshot("phone-on");
    console.log("PASS: turning it on shows the QR code, the relay status, the pairing window and the warning");

    // Copy: the pairing link lands on the clipboard.
    window.webContents.focus();
    await click("Copy pairing link");
    await waitFor(`[...document.querySelectorAll('button')].some(el => el.textContent.trim() === 'Copied')`);
    const copied = await clipboard.readText();
    assert.equal(copied, (await host.call("phone:status")).pairingLink);
    assert.match(copied, /^milagre:\/\/pair\?relay=/);
    console.log("PASS: Copy pairing link copies the link");

    // Paired phones: none yet, then one once a phone pairs through the relay (here, the host's phone list directly).
    await waitFor(`document.querySelector('[data-phone-paired]')?.textContent === 'No phones yet'`);
    await relays
      .filter((options) => !options.retired)
      .at(-1)
      .phones.add("phone-key");
    await waitFor(`document.querySelector('[data-phone-paired]')?.textContent === '1 phone'`);
    assert.deepEqual(paired, [{ pairedPhones: 1 }]);
    await evaluate(`document.querySelector('[data-phone-paired]').scrollIntoView({ block: 'center' })`);
    await screenshot("phone-paired");
    console.log("PASS: a phone pairing shows in Paired phones and is announced to the desktop");

    // Reset asks first, and cancelling changes nothing.
    await click("Reset access");
    await waitFor(`document.body.textContent.includes('must scan again')`);
    await screenshot("phone-reset-confirm");
    await click("Cancel");
    await waitFor(`!document.body.textContent.includes('must scan again')`);
    assert.equal(await token(), first);
    await click("Reset access");
    await click("Reset and disconnect");
    // The old code stays up until the host has restarted with the new token.
    let second = first;
    for (let n = 0; n < 200 && second === first; n++) {
      await delay(25);
      second = await token().catch(() => first);
    }
    await waitFor(
      `(() => { const img = document.querySelector('[data-phone-qr]'); return img && img.complete && img.naturalWidth > 0 && document.body.textContent.includes('Make a new code'); })()`,
    );
    assert.notEqual(second, first);
    await waitFor(`document.querySelector('[data-phone-paired]')?.textContent === 'No phones yet'`);
    // The old room is held only to tell the phone that paired there that this Mac was reset.
    const retired = relays.filter((options) => options.retired);
    assert.equal(retired.length, 1);
    assert.equal(retired[0].token, undefined);
    console.log("PASS: reset asks first, makes a new token, forgets the paired phone and keeps the old room answering");

    // The pushed reset status can reach the renderer before the reset RPC releases its busy guard.
    await waitFor(`[...document.querySelectorAll('button')].some(el => el.textContent.trim() === 'Reset access' && !el.disabled)`);
    // Off: the code goes away and the host keeps the setting.
    await evaluate(`${toggle}.click()`);
    await waitFor(`!document.querySelector('[data-phone-qr]') && ${toggle}.getAttribute('aria-checked') === 'false'`);
    assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(el => el.textContent.includes('Reset access'))`), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "mobile.json"), "utf8")).enabled, false);
    await screenshot("phone-off-again");
    console.log("PASS: turning it off removes the code");

    host.close();
    await daemon.close();
    app.exit(0);
  } catch (error) {
    console.error(error);
    await screenshot("failure").catch(() => {});
    host.close();
    await daemon.close().catch(() => {});
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
        name: "phone-fixture",
        resolveId(id) {
          if (id === "/__phone_fixture.tsx") return id;
        },
        load(id) {
          if (id === "/__phone_fixture.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__phone__") return next();
            const html = await server.transformIndexHtml(
              request.url,
              '<html><body><div id="root"></div><script type="module" src="/__phone_fixture.tsx"></script></body></html>',
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__phone__`], { env, stdio: "inherit" });
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
