// Run with npm test -- --only test-sidebar-computers. The footer's computers popover in the real App against a stand-in for
// main: the laptop button opens a popover of This Mac and each computer with its route line, a gear with its tooltip
// opens that computer's settings (This Mac's opens Settings › Devices), Add computer opens its dialog, and nothing about
// computers shows while Settings › Experimental › Other computers is off. Set MILAGRE_SCREENSHOT_DIR to save screenshots.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { updateSettings } from "/src/lib/settings";
import "/src/styles.css";
const HOUR = 3600000;
const local = { next_id: 3, projects: { 1: { id: 1, name: "milagre-ade" } }, worktrees: { 1: { id: 1, name: "main", path: "/work/milagre-ade", project_id: 1 } }, sessions: { 2: { id: 2, worktree_id: 1, agent_name: "Claude", provider: "claude", status: "Idle", title: "Desktop connect sidebar" } }, connections: {}, events: [], messages: [], approvals: [], tasks: {}, artifacts: {}, outputs: [], conflicts: [] };
window.computerList = [
  { id: "c-arketa", name: "arketa", hostId: "a".repeat(22), relayHost: "relay.milagre.cloud", state: "online", route: "lan", lastSeen: Date.now(), addedAt: 1, message: null, lan: true, lanRoutes: ["ws://192.168.0.24:8798"] },
  { id: "c-studio", name: "studio", hostId: "s".repeat(22), relayHost: "relay.milagre.cloud", state: "offline", route: null, lastSeen: Date.now() - 2 * HOUR, addedAt: 1, message: null, lan: false, lanRoutes: [] },
];
let computersChanged = () => {};
window.setComputers = (list) => { window.computerList = list; computersChanged({ thisMac: "victor-mbp", computers: list }); };
window.milagre = new Proxy({
  getRuntimeConnection: async () => ({ connected: true }),
  getAgentPorts: async () => ({}),
  getCurrentProject: async () => ({ path: "/work/milagre-ade", name: "milagre-ade", state: local }),
  listRecentProjects: async () => [{ path: "/work/milagre-ade", name: "milagre-ade" }],
  listBranches: async () => ["main"],
  listEditors: async () => [],
  getCachedUsage: async () => ({ providers: [] }),
  readUsage: async () => ({ providers: [] }),
  getUpdateState: async () => ({ status: "idle" }),
  getAppVersion: async () => "0.0.0",
  getLinkedWork: async () => ({ delegations: [], negotiations: [], receiveOnly: [] }),
  getRuns: async () => ({ runs: {}, seq: 0 }),
  getPhoneStatus: async () => ({ enabled: false, state: "off", remote: "none" }),
  listDevices: async () => [],
  onComputersChanged: (callback) => ((computersChanged = callback), () => {}),
  computers: {
    list: async () => ({ thisMac: "victor-mbp", computers: window.computerList }),
    setEnabled: async () => {},
    invoke: async (id, method) => (method === "daemon:status" ? { version: "0.121.0" } : method === "project:recent" ? [] : null),
    preview: async () => { throw new Error("That isn't a Milagre pairing link. Copy it from Settings › Devices on the other Mac."); },
  },
}, { get(target, key) { return target[key] ?? (String(key).startsWith("on") ? () => () => {} : async () => null); } });
// settings.ts read localStorage when it was imported above, so the saved settings go through its own setter.
updateSettings({ defaultModelId: "claude-opus-5-5", defaultPermissionMode: "ask", otherComputers: true });
window.setOther = (otherComputers) => updateSettings({ otherComputers });
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<App />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "milagre-sidebar-computers-")));
  await app.whenReady();
  const window = new BrowserWindow({ width: 1280, height: 760, show: false, webPreferences: { backgroundThrottling: false } });
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
    throw new Error(`Timed out: ${source}`);
  };
  const screenshot = async (name) => {
    if (!process.env.MILAGRE_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
    window.webContents.invalidate();
    await delay(250);
    fs.writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, name + ".png"), (await window.webContents.capturePage()).toPNG());
  };
  try {
    await window.loadURL(process.argv[2]);
    const hover = async (selector) => {
      const rect = await evaluate(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(rect.x), y: Math.round(rect.y) });
    };
    const openPopover = async () => {
      await evaluate(`document.querySelector('[data-computers-button]').click()`);
      await waitFor(`!!document.querySelector('[data-computers-panel]')`);
    };
    const lines = () =>
      evaluate(
        `[...document.querySelectorAll('[data-computers-panel] [data-computer-row]')].map((row) => [row.dataset.computerRow, row.querySelector('[data-computer-name]').textContent.trim(), row.querySelector('[data-computer-line]').textContent.trim()])`,
      );
    await waitFor(`!!document.querySelector('[data-computers-button]')`);
    await openPopover();
    assert.deepEqual(await lines(), [
      ["this-mac", "victor-mbp", "This Mac"],
      ["c-arketa", "arketa", "Same network"],
      ["c-studio", "studio", "Offline, seen 2h ago"],
    ]);
    assert.equal(await evaluate(`!!document.querySelector('[data-computers-panel] [data-add-computer-row]')`), true);
    await screenshot("popover");
    await hover('[data-computer-row="c-arketa"] [data-computer-gear]');
    await waitFor(`[...document.querySelectorAll('[role="tooltip"]')].some((tip) => tip.textContent.includes('arketa settings: rename, connection, remove'))`);
    await screenshot("popover-gear");
    console.log("PASS: the popover lists This Mac, then each computer with its route line, a gear with its tooltip, and Add computer");

    await evaluate(`document.querySelector('[data-computer-row="c-arketa"] [data-computer-gear]').click()`);
    await waitFor(`document.querySelector('h1')?.textContent === 'arketa' && !!document.querySelector('[data-computer-settings]')`);
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Back').click()`);
    await waitFor(`!!document.querySelector('[data-computers-button]')`);
    await openPopover();
    await evaluate(`document.querySelector('[data-computer-row="this-mac"] [data-computer-gear]').click()`);
    await waitFor(`document.querySelector('h1')?.textContent === 'Devices'`);
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Back').click()`);
    await waitFor(`!!document.querySelector('[data-computers-button]')`);
    console.log("PASS: a computer's gear opens its settings, and This Mac's opens Settings › Devices");

    await openPopover();
    await evaluate(`document.querySelector('[data-add-computer-row]').click()`);
    await waitFor(`document.querySelector('dialog[data-add-computer]')?.open && !document.querySelector('[data-computers-panel]')`);
    await evaluate(`document.querySelector('dialog[data-add-computer]').dispatchEvent(new Event('cancel', { cancelable: true }))`);
    await waitFor(`!document.querySelector('dialog')`);
    await evaluate(`window.setOther(false)`);
    await waitFor(`!document.querySelector('[data-computers-button]')`);
    assert.deepEqual(errors, []);
    console.log("PASS: Add computer opens from the popover, and nothing about computers shows while Other computers is off");
    app.exit(0);
  } catch (error) {
    console.error(error);
    console.error(errors);
    await screenshot("failure").catch(() => {});
    app.exit(1);
  }
}

async function main() {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: path.resolve(__dirname, "../apps/desktop/vite.config.ts"),
    cacheDir: path.resolve(__dirname, "../node_modules/.vite-sidebar-computers"),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "sidebar-computers-fixture",
        resolveId(id) {
          if (id === "/__sidebar-computers.tsx") return id;
        },
        load(id) {
          if (id === "/__sidebar-computers.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__sidebar-computers") return next();
            response.setHeader("Content-Type", "text/html");
            response.end(
              await server.transformIndexHtml(
                request.url,
                '<html><body><div id="root"></div><script type="module" src="/__sidebar-computers.tsx"></script></body></html>',
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
    const child = require("node:child_process").spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__sidebar-computers`], {
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
