// Exercises the real App with an isolated project and mocked Electron IPC.
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { createInitialState } from "/src/model";
import "/src/styles.css";
const state = createInitialState("Fixture", "/fixture");
state.worktrees = { 1: { id: 1, name: "main", path: "/fixture", project_id: 1 }, 2: { id: 2, name: "develop", path: "/fixture-dev", project_id: 1 } };
state.sessions = { 3: { id: 3, worktree_id: 1, agent_name: "Claude", provider: "claude", status: "Idle" } };
state.messages = [{ id: 4, session_id: 3, role: "user", body: "Previous chat", context: null }];
state.next_id = 5;
window.milagre = new Proxy({
  getCurrentProject: async () => ({ path: "/fixture", name: "Fixture", state }),
  listBranches: async () => ["main", "develop"],
  listEditors: async () => [],
  getCachedUsage: async () => ({ providers: [] }),
  readUsage: async () => ({ providers: [] }),
  getUpdateState: async () => ({ status: "idle" }),
}, { get(target, key) { return target[key] ?? (String(key).startsWith("on") ? () => () => {} : async () => null); } });
if (!localStorage.getItem("seeded")) {
  localStorage.setItem("milagre-settings", JSON.stringify({ defaultModelId: "gpt-6-astra", defaultPermissionMode: "ask" }));
  localStorage.setItem("seeded", "yes");
}
const { updateSettings } = await import("/src/lib/settings");
window.changeDefaults = updateSettings;
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<App />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const window = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { partition: "selection-test", backgroundThrottling: false } });
  window.webContents.on("console-message", event => { if (event.level === "error") console.error(event.message); });
  const evaluate = source => window.webContents.executeJavaScript(source);
  async function waitFor(source) {
    for (let n = 0; n < 200; n++) { if (await evaluate(source)) return; await delay(25); }
    throw Error(`Timed out: ${source}`);
  }
  async function click(text) {
    const expr = `[...document.querySelectorAll('button')].find(el => el.textContent.includes(${JSON.stringify(text)}))`;
    await waitFor(`!!(${expr})`);
    await evaluate(`(${expr}).click()`);
  }
  const newChat = () => evaluate(`document.querySelector('[aria-label="New chat"]').click()`);
  const modelIs = name => waitFor(`[...document.querySelectorAll('[data-promptbar] button')].some(el => el.textContent === ${JSON.stringify(name)})`);
  try {
    await window.loadURL(process.argv[2]);
    await waitFor(`!!document.querySelector('[aria-label="New chat"]')`);
    await newChat();
    await modelIs("GPT-6-Astra");
    await evaluate(`window.changeDefaults({ defaultModelId: "gpt-6-sol" })`);
    await modelIs("GPT-6-Sol");
    await click("GPT-6-Sol");
    await click("Claude");
    await click("Opus 5.5");
    await modelIs("Opus 5.5");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('milagre-settings')).defaultModelId`), "claude-opus-5-5");
    await evaluate(`document.querySelector('[aria-label="Agent permissions"]').click()`);
    await click("Full");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('milagre-settings')).defaultPermissionMode`), "full");
    await click("main");
    await click("develop");
    await newChat();
    await waitFor(`document.querySelector('[data-new-chat-pickers]').textContent.includes('develop')`);
    await click("Local");
    await click("New worktree");
    await click("develop");
    await click("main");
    await click("main");
    await click("develop");
    await newChat();
    await waitFor(`document.querySelector('[data-new-chat-pickers]').textContent.includes('New worktree') && document.querySelector('[data-new-chat-pickers]').textContent.includes('develop')`);
    await new Promise(resolve => { window.webContents.once("did-finish-load", resolve); window.reload(); });
    await waitFor(`!!document.querySelector('[aria-label="New chat"]')`);
    await newChat();
    await modelIs("Opus 5.5");
    await waitFor(`document.querySelector('[data-new-chat-pickers]').textContent.includes('New worktree') && document.querySelector('[data-new-chat-pickers]').textContent.includes('develop')`);
    await waitFor(`document.querySelector('[aria-label="Agent permissions"]').textContent === "Full"`);
    console.log("PASS: new chats follow Settings, remember explicit selections, and restore them after reload");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}

async function main() {
  const { createServer } = await import("vite");
  const { spawn } = require("node:child_process");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "chat-selections-fixture",
      resolveId(id) { if (id === "/__chat_selections_fixture.tsx") return id; },
      load(id) { if (id === "/__chat_selections_fixture.tsx") return fixture; },
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__chat_selections__") return next();
          const html = await server.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__chat_selections_fixture.tsx"></script></body></html>');
          response.setHeader("Content-Type", "text/html");
          response.end(html);
        });
      },
    }],
  });
  try {
    await server.listen();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__chat_selections__`], { env, stdio: "inherit" });
    process.exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", code => resolve(code ?? 1));
    });
  } finally {
    await server.close();
  }
}

(process.versions.electron ? browserChecks() : main()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
