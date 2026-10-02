// Run with npm run test:worktree-setup. Exercises the real App with an isolated project and mocked Electron IPC:
// the Setup command field in Settings, the trust dialog (Run and Skip), and the setup step in the chat.
// Screenshots go to MILAGRE_SCREENSHOT_DIR, or docs/screenshots/worktree-setup.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { createInitialState } from "/src/model";
import "/src/styles.css";
const state = createInitialState("shop", "/fixture");
state.worktrees = { 1: { id: 1, name: "main", path: "/fixture", project_id: 1 } };
state.sessions = { 2: { id: 2, worktree_id: 1, agent_name: "Claude", provider: "claude", status: "Idle" } };
state.messages = [{ id: 3, session_id: 2, role: "user", body: "Previous chat", context: null }];
state.next_id = 4;
window.calls = { decide: [], saved: [], turns: [] };
window.setupSettings = { setupCommand: "", source: "none", command: null };
window.nextSetup = { command: "npm ci", source: "repo", approved: false };
const listeners = new Set();
window.emitAgent = (payload) => listeners.forEach((listener) => listener(payload));
window.milagre = new Proxy({
  getCurrentProject: async () => ({ path: "/fixture", name: "shop", state }),
  listBranches: async () => ["main"],
  createWorktree: async () => {
    const id = state.next_id;
    state.worktrees[id] = { id, name: "milagre/chat-" + id, path: "/worktrees/shop/chat-" + id, project_id: 1, base: "main" };
    state.sessions[id + 1] = { id: id + 1, worktree_id: id, agent_name: "milagre/chat-" + id, status: "Created" };
    state.next_id = id + 2;
    return { project: { path: "/fixture", name: "shop", state: structuredClone(state) }, worktreeId: id, setup: window.nextSetup };
  },
  decideWorktreeSetup: async (worktreePath, decision) => { window.calls.decide.push([worktreePath, decision]); return true; },
  readWorktreeSetup: async () => window.setupSettings,
  saveWorktreeSetup: async (_projectPath, command) => {
    window.calls.saved.push(command);
    window.setupSettings = { setupCommand: command.trim(), source: command.trim() ? "setting" : "none", command: command.trim() || null };
    return window.setupSettings;
  },
  readFilesToCopy: async () => ({ filesToCopy: [], source: "default", worktreeInclude: null, matches: [".env"] }),
  previewFilesToCopy: async () => ({ source: "default", worktreeInclude: null, matches: [".env"] }),
  startTurn: async (request) => { window.calls.turns.push(request); return { turnId: null, steered: false }; },
  onAgentEvent: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
  listEditors: async () => [],
  getCachedUsage: async () => ({ providers: [] }),
  readUsage: async () => ({ providers: [] }),
  getUpdateState: async () => ({ status: "idle" }),
}, { get(target, key) { return target[key] ?? (String(key).startsWith("on") ? () => () => {} : async () => null); } });
localStorage.setItem("milagre-settings", JSON.stringify({ defaultModelId: "claude-opus-5-5", defaultPermissionMode: "ask" }));
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<App />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "milagre-worktree-setup-ui-")));
  await app.whenReady();
  const window = new BrowserWindow({ width: 1100, height: 760, useContentSize: true, show: false, webPreferences: { partition: "worktree-setup-test", backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => { if (event.level === "error") console.error(event.message); });
  const evaluate = async (source) => {
    try { return await window.webContents.executeJavaScript(source); }
    catch (error) { throw new Error(`${source}: ${error.message}`); }
  };
  async function waitFor(source) {
    for (let n = 0; n < 200; n++) { if (await evaluate(source)) return; await delay(25); }
    throw Error(`Timed out: ${source}`);
  }
  async function click(text, { exact = true } = {}) {
    const expr = `[...document.querySelectorAll('button')].find(el => ${exact ? "el.textContent.trim() ===" : "el.textContent.includes("}${JSON.stringify(text)}${exact ? "" : ")"})`;
    await waitFor(`!!(${expr})`);
    await evaluate(`(${expr}).click()`);
  }
  const screenshotDir = process.env.MILAGRE_SCREENSHOT_DIR ?? path.resolve(__dirname, "../docs/screenshots/worktree-setup");
  async function screenshot(name) {
    await delay(300);
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.writeFileSync(path.join(screenshotDir, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  }
  const type = (selector, value, proto = "HTMLTextAreaElement") => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.focus();
    Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  async function sendInNewWorktree(prompt) {
    await evaluate(`document.querySelector('[aria-label="New chat"]').click()`);
    await waitFor(`!!document.querySelector('[data-new-chat-pickers]')`);
    if (!(await evaluate(`document.querySelector('[data-new-chat-pickers]').textContent.includes('New worktree')`))) {
      await click("Local", { exact: false });
      await click("New worktree", { exact: false });
    }
    await type('textarea[aria-label="Prompt"]', prompt);
    await waitFor(`!document.querySelector('[aria-label="Send"]').disabled`);
    await evaluate(`document.querySelector('[aria-label="Send"]').click()`);
  }
  const emit = (chatId, event) => evaluate(`window.emitAgent({ chatId: ${JSON.stringify(chatId)}, event: ${JSON.stringify(event)} })`);

  try {
    await window.loadURL(process.argv[2]);
    await waitFor(`!!document.querySelector('[aria-label="New chat"]')`);

    // Settings › Worktrees: the field saves what is typed, and a repo file takes it over.
    await evaluate(`document.querySelector('[aria-label="Settings"]').click()`);
    await click("Worktrees");
    await waitFor(`!!document.querySelector('#setup-command') && !document.querySelector('#setup-command').disabled`);
    assert.equal(await evaluate(`document.querySelector('#setup-command').placeholder`), "npm ci");
    assert.equal(await evaluate(`document.body.textContent.includes('Runs once in each new worktree before the agent starts, e.g. npm ci.')`), true);
    await type("#setup-command", "pnpm install --frozen-lockfile", "HTMLInputElement");
    await waitFor(`window.calls.saved.at(-1) === "pnpm install --frozen-lockfile"`);
    await evaluate(`document.activeElement.blur()`);
    await screenshot("settings-field");
    console.log("PASS: the Setup command field saves what is typed");

    await evaluate(`window.setupSettings = { setupCommand: "pnpm install --frozen-lockfile", source: "repo", command: "uv sync" }; window.dispatchEvent(new Event('focus'))`);
    await waitFor(`!!document.querySelector('[data-setup-command-locked]')`);
    assert.equal(await evaluate(`document.querySelector('#setup-command').value`), "uv sync");
    assert.equal(await evaluate(`document.querySelector('#setup-command').readOnly`), true);
    await screenshot("settings-repo-file");
    await evaluate(`window.setupSettings = { setupCommand: "pnpm install --frozen-lockfile", source: "setting", command: "pnpm install --frozen-lockfile", note: ".milagre/worktree.json isn't valid JSON, so Milagre ignored it." }; window.dispatchEvent(new Event('focus'))`);
    await waitFor(`!!document.querySelector('[data-setup-command-note]')`);
    assert.equal(await evaluate(`document.querySelector('#setup-command').readOnly`), false);
    await screenshot("settings-invalid-file");
    console.log("PASS: a repo file locks the field, and an invalid one shows a note");
    await click("Back");

    // The trust dialog: Run approves the command, and the first reply shows the setup running.
    await sendInNewWorktree("Add a checkout page");
    await waitFor(`!!document.querySelector('[data-setup-dialog]')`);
    assert.equal(await evaluate(`document.querySelector('[data-setup-dialog-command]').textContent`), "npm ci");
    assert.equal(await evaluate(`document.querySelector('[data-setup-dialog]').textContent.includes('.milagre/worktree.json')`), true);
    assert.equal(await evaluate(`document.activeElement.textContent`), "Skip", `Focus starts on Skip, not ${await evaluate("document.activeElement.outerHTML.slice(0, 200)")}`);
    assert.equal(await evaluate(`window.calls.turns.length`), 0, "The turn waits for the answer");
    await screenshot("trust-dialog");
    await click("Run");
    await waitFor(`window.calls.turns.length === 1`);
    assert.equal(await evaluate(`!!document.querySelector('[data-setup-dialog]')`), false);
    const [firstPath, firstDecision] = await evaluate(`window.calls.decide[0]`);
    assert.equal(firstDecision, "run");
    assert.equal(firstPath, await evaluate(`window.calls.turns[0].cwd`));
    console.log("PASS: Run approves the command before the first turn starts");

    const chatId = await evaluate(`window.calls.turns[0].chatId`);
    await emit(chatId, { type: "step-started", step: { id: "setup-1", kind: "shell", title: "Set up worktree: `npm ci`", detail: "$ npm ci\n" } });
    await emit(chatId, { type: "step-output", id: "setup-1", text: "npm warn deprecated inflight@1.0.6\n" });
    await waitFor(`document.querySelector('[data-slot="step"][data-status="running"]')?.textContent.includes('Set up worktree')`);
    // The reply fades in; let it settle so the shot shows the row as it reads.
    await delay(900);
    await screenshot("setup-running");
    console.log("PASS: the setup shows as a running step at the start of the reply");

    await emit(chatId, { type: "step-output", id: "setup-1", text: "npm error code EUSAGE\nnpm error The `npm ci` command can only install with an existing package-lock.json\n" });
    await emit(chatId, { type: "step-completed", id: "setup-1", status: "failed", title: "Set up worktree: `npm ci` exited with code 1 after 4s", detail: "$ npm ci\nnpm warn deprecated inflight@1.0.6\nnpm error code EUSAGE\nnpm error The `npm ci` command can only install with an existing package-lock.json\n\nExited with code 1", durationMs: 4200 });
    await emit(chatId, { type: "turn-started", turnId: "t1" });
    await emit(chatId, { type: "text-delta", messageId: "t1", text: "The setup failed because there is no package-lock.json. I'll run `npm install` to create one, then add the checkout page." });
    await emit(chatId, { type: "turn-completed" });
    await waitFor(`document.querySelector('[data-slot="step"][data-status="failed"]')?.textContent.includes('exited with code 1 after 4s')`);
    await evaluate(`[...document.querySelectorAll('[data-slot="step"] button')].find(el => el.textContent.includes('Set up worktree')).click()`);
    await waitFor(`document.body.textContent.includes('EUSAGE')`);
    await screenshot("setup-failed");
    console.log("PASS: a failed setup ends as a failed step with its output");

    // Skip: the command is dropped for this worktree, and the turn still starts.
    await sendInNewWorktree("Fix the cart badge");
    await waitFor(`!!document.querySelector('[data-setup-dialog]')`);
    await click("Skip");
    await waitFor(`window.calls.turns.length === 2`);
    assert.equal((await evaluate(`window.calls.decide[1]`))[1], "skip");
    assert.equal(await evaluate(`!!document.querySelector('[data-setup-dialog]')`), false);
    console.log("PASS: Skip drops the command and starts the turn");

    // An approved command doesn't ask.
    await evaluate(`window.nextSetup = { command: "npm ci", source: "repo", approved: true }`);
    await sendInNewWorktree("Polish the footer");
    await waitFor(`window.calls.turns.length === 3`);
    assert.equal(await evaluate(`!!document.querySelector('[data-setup-dialog]')`), false);
    assert.equal(await evaluate(`window.calls.decide.length`), 2);
    console.log("PASS: an approved command runs without asking");
    app.exit(0);
  } catch (error) {
    console.error(error);
    await screenshot("failure").catch(() => {});
    app.exit(1);
  }
}

async function main() {
  const { createServer } = await import("vite");
  const { spawn } = require("node:child_process");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "worktree-setup-fixture",
      resolveId(id) { if (id === "/__worktree_setup_fixture.tsx") return id; },
      load(id) { if (id === "/__worktree_setup_fixture.tsx") return fixture; },
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__worktree_setup__") return next();
          const html = await server.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__worktree_setup_fixture.tsx"></script></body></html>');
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__worktree_setup__`], { env, stdio: "inherit" });
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
