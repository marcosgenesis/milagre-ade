// Run with npm run test:worktree-setup. Exercises the real App with an isolated project and mocked Electron IPC:
// the Setup command field in Settings, and the setup step in the chat of a new worktree, which starts without asking.
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
// The main process's reducer, so agent events are saved into the state as ChatHost saves them.
import { applyAgentEvent } from "/@fs${require("node:path").resolve(__dirname, "../electron/shared/agent-runs.mjs")}";
// A project's state as the main process reads it.
const state = { next_id: 1, projects: { 1: { id: 1, name: "shop" } }, worktrees: {}, sessions: {}, connections: {}, events: [], messages: [], approvals: [], tasks: {}, artifacts: {}, outputs: [], conflicts: [] };
state.worktrees = { 1: { id: 1, name: "main", path: "/fixture", project_id: 1 } };
state.sessions = { 2: { id: 2, worktree_id: 1, agent_name: "Claude", provider: "claude", status: "Idle" } };
state.messages = [{ id: 3, session_id: 2, role: "user", body: "Previous chat", context: null }];
state.next_id = 4;
window.calls = { saved: [], turns: [] };
window.setupSettings = { setupCommand: "", source: "none", command: null };
const listeners = new Set();
let runs = {};
// Stands in for the main process: folds each event into the state and sends it on, with the state when it changed.
window.emitAgent = ({ chatId, event }) => {
  const result = applyAgentEvent(state, runs, "/fixture", chatId, event);
  runs = result.runs;
  if (result.changed) Object.assign(state, result.state);
  listeners.forEach((listener) => listener({ chatId, event, ...(result.changed ? { state: structuredClone(state) } : {}) }));
};
window.milagre = new Proxy({
  // The main process always answers with a map of chat id to ports; null would crash the ports hook.
  getAgentPorts: async () => ({}),
  getCurrentProject: async () => ({ path: "/fixture", name: "shop", state }),
  listBranches: async () => ["main"],
  createWorktree: async () => {
    const id = state.next_id;
    state.worktrees[id] = { id, name: "milagre/chat-" + id, path: "/worktrees/shop/chat-" + id, project_id: 1, base: "main" };
    state.sessions[id + 1] = { id: id + 1, worktree_id: id, agent_name: "milagre/chat-" + id, status: "Created" };
    state.next_id = id + 2;
    return { project: { path: "/fixture", name: "shop", state: structuredClone(state) }, worktreeId: id };
  },
  readWorktreeSetup: async () => window.setupSettings,
  saveWorktreeSetup: async (_projectPath, command) => {
    window.calls.saved.push(command);
    window.setupSettings = { setupCommand: command.trim(), source: command.trim() ? "setting" : "none", command: command.trim() || null };
    return window.setupSettings;
  },
  readFilesToCopy: async () => ({ filesToCopy: [], source: "default", worktreeInclude: null, matches: [".env"] }),
  previewFilesToCopy: async () => ({ source: "default", worktreeInclude: null, matches: [".env"] }),
  // Stands in for the main process: it saves the message, tells the window, then starts the turn.
  sendMessage: async (request) => {
    const chatId = request.projectPath + "#" + request.sessionId;
    window.emitAgent({ chatId, event: { type: "message-sent", model: request.model } });
    const message = { id: state.next_id, session_id: request.sessionId, body: request.body, images: request.images, context: null, role: "user", model: request.model };
    Object.assign(state, { next_id: state.next_id + 1, messages: [...state.messages, message] });
    listeners.forEach((listener) => listener({ chatId, event: { type: "note" }, state: structuredClone(state) }));
    window.calls.turns.push({ ...request, chatId });
    return { sessionId: request.sessionId };
  },
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
  const screenshotDir = process.env.MILAGRE_SCREENSHOT_DIR;
  async function screenshot(name) {
    if (!screenshotDir) return;
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

    // A new worktree's setup starts with the first message: no dialog, and the reply shows the setup running.
    await sendInNewWorktree("Add a checkout page");
    await waitFor(`window.calls.turns.length === 1`);
    assert.equal(await evaluate(`document.body.textContent.includes('Run the setup command?')`), false);
    console.log("PASS: the first message in a new worktree starts the turn without asking");

    const chatId = await evaluate(`window.calls.turns[0].chatId`);
    await emit(chatId, { type: "step-started", step: { id: "setup-1", kind: "setup", title: "Running setup `npm ci`", detail: "$ npm ci\n" } });
    await emit(chatId, { type: "step-output", id: "setup-1", text: "npm warn deprecated inflight@1.0.6\n" });
    await waitFor(`document.querySelector('[data-slot="step"][data-status="running"]')?.textContent.includes('Running setup')`);
    assert.equal(await evaluate(`!!document.querySelector('[data-slot="step"][data-status="running"]').closest('[data-slot="activity"]')`), false);
    // The reply fades in; let it settle so the shot shows the row as it reads.
    await delay(900);
    await screenshot("setup-running");
    console.log("PASS: the setup shows as a running row of its own at the start of the reply");

    await emit(chatId, { type: "step-output", id: "setup-1", text: "npm error code EUSAGE\nnpm error The `npm ci` command can only install with an existing package-lock.json\n" });
    await emit(chatId, { type: "step-completed", id: "setup-1", status: "failed", title: "Setup failed `npm ci`", note: "exited with code 1 after 4s", detail: "$ npm ci\nnpm warn deprecated inflight@1.0.6\nnpm error code EUSAGE\nnpm error The `npm ci` command can only install with an existing package-lock.json\n\nExited with code 1", durationMs: 4200 });
    await emit(chatId, { type: "turn-started", turnId: "t1" });
    await emit(chatId, { type: "text-delta", messageId: "t1", text: "The setup failed because there is no package-lock.json. I'll run `npm install` to create one, then add the checkout page." });
    await emit(chatId, { type: "turn-completed" });
    await waitFor(`document.querySelector('[data-slot="step"][data-status="failed"]')?.textContent.includes('Setup failed')`);
    assert.equal(await evaluate(`document.querySelector('[data-slot="step"][data-status="failed"]').textContent.includes('exited with code 1 after 4s')`), true);
    await evaluate(`[...document.querySelectorAll('[data-slot="step"] button')].find(el => el.textContent.includes('Setup failed')).click()`);
    await waitFor(`document.body.textContent.includes('EUSAGE')`);
    await screenshot("setup-failed");
    console.log("PASS: a failed setup ends as a failed step with its output");

    // A setup that worked, then a reply with thinking and a command: the setup stays its own row above "Thought for ...".
    await sendInNewWorktree("Add a cart badge");
    await waitFor(`window.calls.turns.length === 2`);
    const second = await evaluate(`window.calls.turns[1].chatId`);
    await emit(second, { type: "step-started", step: { id: "setup-2", kind: "setup", title: "Running setup `npm ci`", detail: "$ npm ci\n" } });
    await emit(second, { type: "step-completed", id: "setup-2", status: "done", title: "Ran setup `npm ci`", note: "3s", detail: "$ npm ci\nadded 412 packages in 3s\n", durationMs: 3000 });
    await emit(second, { type: "turn-started", turnId: "t2" });
    await emit(second, { type: "step-started", step: { id: "think-1", kind: "thinking", title: "Thinking" } });
    await emit(second, { type: "step-completed", id: "think-1", status: "done", title: "Thought", detail: "The header owns the cart count.", durationMs: 4000 });
    await emit(second, { type: "step-started", step: { id: "cmd-1", kind: "shell", title: "Ran `npm test`", detail: "$ npm test\n" } });
    await emit(second, { type: "step-completed", id: "cmd-1", status: "done", title: "Ran `npm test`", detail: "$ npm test\nok\n" });
    await emit(second, { type: "text-delta", messageId: "t2", text: "Added the cart badge to the header." });
    await emit(second, { type: "turn-completed" });
    await waitFor(`!!document.querySelector('[data-slot="activity"]')`);
    await delay(900);
    const rows = await evaluate(`(() => {
      const setup = [...document.querySelectorAll('[data-slot="step"]')].find((el) => el.textContent.includes('Ran setup'));
      const activity = document.querySelector('[data-slot="activity"]');
      return { found: !!setup, inside: !!setup?.closest('[data-slot="activity"]'), before: !!(setup && activity && (setup.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING)), summary: activity?.querySelector('[role="status"]')?.textContent };
    })()`);
    assert.deepEqual(rows, { found: true, inside: false, before: true, summary: "Thought for 4s · ran 1 command" });
    await screenshot("setup-done");
    console.log("PASS: a finished setup is its own row above the activity, and the summary doesn't count it");

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
