// The real App, with worktree creation and message persistence held at the IPC boundary.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
const state = { next_id: 4, projects: { 1: { id: 1, name: "shop" } },
  worktrees: { 1: { id: 1, name: "main", path: "/fixture", project_id: 1 } },
  sessions: { 2: { id: 2, worktree_id: 1, agent_name: "Previous chat", provider: "claude", status: "Idle" } },
  messages: [{ id: 3, session_id: 2, role: "user", body: "Previous chat", context: null }], tasks: {} };
const listeners = new Set();
window.calls = { created: 0, sent: [] };
window.milagre = new Proxy({
  getRuntimeConnection: async () => ({ connected: true }),
  getAgentPorts: async () => ({}),
  getRuns: async () => ({ seq: 0, runs: {} }),
  getLinkedWork: async () => ({ delegations: [], negotiations: [], receiveOnly: [] }),
  getCurrentProject: async () => ({ path: "/fixture", name: "shop", state: structuredClone(state) }),
  listBranches: async () => ["main"],
  getPathForFile: file => "/fixture/" + file.name,
  createWorktree: () => {
    window.calls.created++;
    return new Promise((resolve, reject) => {
      window.failCreate = () => reject(new Error("Setup failed"));
      window.finishCreate = () => {
        const id = state.next_id;
        state.worktrees[id] = { id, name: "milagre/chat-" + id, path: "/worktrees/shop/chat-" + id, project_id: 1, base: "main" };
        state.sessions[id + 1] = { id: id + 1, worktree_id: id, agent_name: "milagre/chat-" + id, status: "Created" };
        state.next_id = id + 2;
        resolve({ project: { path: "/fixture", name: "shop", state: structuredClone(state) }, worktreeId: id });
      };
    });
  },
  sendMessage: request => {
    window.calls.sent.push(request);
    return new Promise((resolve, reject) => {
      window.failSend = () => reject(new Error("Disk full"));
      window.saveSend = () => {
        const sessionId = request.sessionId ?? state.next_id++;
        state.sessions[sessionId] ??= { id: sessionId, worktree_id: request.worktreeId, agent_name: "Local chat", status: "Created" };
        state.sessions[sessionId].provider = request.provider;
        state.messages.push({ id: state.next_id++, session_id: sessionId, body: request.body, images: request.images, files: request.files, clientMessageId: request.clientMessageId, context: null, role: "user", model: request.model });
        listeners.forEach(listener => listener({ chatId: "/fixture#" + sessionId, event: { type: "message-sent", model: request.model }, state: structuredClone(state) }));
        window.ackSend = () => resolve({ sessionId });
      };
    });
  },
  onAgentEvent: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  listEditors: async () => [],
  getCachedUsage: async () => ({ providers: [] }),
  readUsage: async () => ({ providers: [] }),
  getUpdateState: async () => ({ status: "idle" }),
}, { get(target, key) { return target[key] ?? (String(key).startsWith("on") ? () => () => {} : async () => null); } });
localStorage.setItem("milagre-settings", JSON.stringify({ defaultModelId: "claude-opus-5-5" }));
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<App />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "milagre-chat-send-feedback-")));
  await app.whenReady();
  const window = new BrowserWindow({ width: 1100, height: 760, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  const consoleErrors = [];
  window.webContents.on("console-message", event => { if (event.level === "error") { consoleErrors.push(event.message); console.error(event.message); } });
  const evaluate = source => window.webContents.executeJavaScript(source);
  async function waitFor(source) {
    for (let i = 0; i < 200; i++) { if (await evaluate(source)) return; await delay(25); }
    throw new Error(`Timed out: ${source}`);
  }
  async function screenshot(name) {
    if (!process.env.MILAGRE_SCREENSHOT_DIR) return;
    await delay(400);
    fs.mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  }
  const prompt = 'textarea[aria-label="Prompt"]';
  const type = value => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(prompt)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  async function clickText(text) {
    const expr = `[...document.querySelectorAll('button')].find(el => el.textContent.includes(${JSON.stringify(text)}))`;
    await waitFor(`!!(${expr})`);
    await evaluate(`(${expr}).click()`);
  }
  async function newChat(isolation) {
    await evaluate(`document.querySelector('[aria-label="New chat"]').click()`);
    await waitFor(`!!document.querySelector('[data-new-chat-pickers]')`);
    const current = await evaluate(`document.querySelector('[data-new-chat-pickers]').textContent`);
    if (!current.includes(isolation)) {
      await clickText(isolation === 'Local' ? 'New worktree' : 'Local');
      await clickText(isolation);
    }
  }
  async function send(body) {
    await type(body);
    await waitFor(`(document.querySelector('[aria-label="Send"]') && !document.querySelector('[aria-label="Send"]').disabled)`);
    await evaluate(`document.querySelector('[aria-label="Send"]').click()`);
  }
  const acknowledged = `(document.querySelector('[aria-label="Send"]') && !document.querySelector('[aria-label="Send"]').disabled) || !!document.querySelector('[aria-label="Stop agent"]')`;
  const transcript = `document.querySelector('[aria-label="Conversation"]')`;
  async function immediate(body) {
    await waitFor(`${transcript}?.textContent.includes(${JSON.stringify(body)})`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(prompt)}).value`), '', 'submitted draft clears before setup completes');
    assert.equal(await evaluate(`!!document.querySelector('[data-new-chat-pickers]')`), false, 'first message opens the conversation layout');
    assert.equal(await evaluate(`!!document.querySelector('[role="status"][aria-label^="Working with"]')`), true, 'working feedback appears before the backend completes');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Send"]').disabled`), true, 'duplicate submits are blocked during preparation');
  }
  const occurrences = body => evaluate(`(${transcript}?.textContent.match(new RegExp(${JSON.stringify(body)}, 'g')) ?? []).length`);
  try {
    await window.loadURL(process.argv[2]);
    await waitFor(`!!document.querySelector('[aria-label="New chat"]')`);
    await newChat('New worktree');
    await type('Add a checkout page');
    await screenshot('before-send');
    await evaluate(`document.querySelector('[aria-label="Send"]').click()`);
    await waitFor('window.calls.created === 1');
    await immediate('Add a checkout page');
    assert.equal(await evaluate(`document.querySelector('aside').textContent.includes('Add a checkout page')`), true, 'the sidebar lists the new Chat before setup');
    assert.equal(await evaluate('window.calls.sent.length'), 0, 'feedback does not wait for worktree setup');
    await screenshot('preparing-worktree');
    await evaluate(`[...document.querySelectorAll('aside [data-row]')].find(row => row.textContent.includes('Previous chat')).click()`);
    await waitFor(`${transcript}?.textContent.includes('Previous chat')`);
    await evaluate(`[...document.querySelectorAll('aside [data-row]')].find(row => row.textContent.includes('Add a checkout page')).click()`);
    await waitFor(`${transcript}?.textContent.includes('Add a checkout page')`);
    await type('Next draft');
    await evaluate(`document.querySelector(${JSON.stringify(prompt)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    assert.equal(await evaluate('window.calls.created'), 1);
    await evaluate('window.finishCreate()');
    await waitFor('window.calls.sent.length === 1');
    assert.equal(await occurrences('Add a checkout page'), 1);
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['notes'], 'next.txt', { type: 'text/plain' }));
      document.querySelector(${JSON.stringify(prompt)}).dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    })()`);
    await waitFor(`document.body.textContent.includes('next.txt')`);
    await evaluate('window.saveSend()');
    await delay(100);
    assert.equal(await occurrences('Add a checkout page'), 1, 'state arriving before acknowledgement does not duplicate the message');
    assert.equal(await evaluate(`[...document.querySelectorAll('aside [data-row]')].filter(row => row.textContent.includes('Add a checkout page')).length`), 1, 'canonical input replaces the sidebar preview before acknowledgement');
    await evaluate('window.ackSend()');
    await waitFor(`(${transcript}?.textContent.includes('Add a checkout page')) && (${acknowledged})`);
    assert.equal(await occurrences('Add a checkout page'), 1);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(prompt)}).value`), 'Next draft', 'acknowledgement keeps text typed during setup');
    assert.equal(await evaluate(`document.body.textContent.includes('next.txt')`), true, 'acknowledgement keeps attachments added for the next message');
    await screenshot('sent');

    await newChat('Local');
    await send('Check the local project');
    await waitFor('window.calls.sent.length === 2');
    await immediate('Check the local project');
    assert.equal(await evaluate('window.calls.created'), 1, 'Local still uses the selected worktree');
    await evaluate('window.saveSend(); window.ackSend()');
    await waitFor(acknowledged);
    assert.equal(await occurrences('Check the local project'), 1);

    await newChat('New worktree');
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0))], 'note.png', { type: 'image/png' }));
      document.querySelector(${JSON.stringify(prompt)}).dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    })()`);
    await waitFor(`document.body.textContent.includes('note.png')`);
    await send('Keep this draft');
    await immediate('Keep this draft');
    await type('A follow-up note');
    await evaluate('window.failCreate()');
    await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('Setup failed')`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(prompt)}).value`), 'Keep this draft\n\nA follow-up note', 'failed setup keeps both the submitted message and text typed while preparing');
    assert.equal(await evaluate(`document.body.textContent.includes('note.png')`), true, 'failed setup restores attachments');
    await screenshot('setup-failed');
    await send('Keep this draft');
    await evaluate('window.finishCreate()');
    await waitFor('window.calls.sent.length === 3');
    assert.equal(await evaluate('window.calls.sent[2].images[0].name'), 'note.png');
    assert.deepEqual(await evaluate('window.calls.sent[2].files'), ['/fixture/note.png']);
    await evaluate('window.failSend()');
    await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('Disk full')`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(prompt)}).value`), 'Keep this draft');
    const created = await evaluate('window.calls.created');
    await send('Keep this draft');
    await waitFor('window.calls.sent.length === 4');
    assert.equal(await evaluate('window.calls.created'), created, 'retry after persistence failure reuses the prepared worktree');
    await evaluate('window.saveSend(); window.ackSend()');
    await waitFor(acknowledged);

    await newChat('New worktree');
    await send('Continue in the background');
    await immediate('Continue in the background');
    await evaluate(`document.querySelector('[aria-label="New chat"]').click()`);
    await waitFor(`!!document.querySelector('[data-new-chat-pickers]')`);
    await type('A different draft');
    await evaluate('window.finishCreate()');
    await waitFor('window.calls.sent.length === 5');
    await evaluate('window.saveSend(); window.ackSend()');
    await waitFor(`document.querySelector('[data-new-chat-pickers]') && (document.querySelector('[aria-label="Send"]') && !document.querySelector('[aria-label="Send"]').disabled)`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(prompt)}).value`), 'A different draft', 'background completion keeps the selected chat and its draft');
    assert.equal(await evaluate(`${transcript}?.textContent.includes('Continue in the background') ?? false`), false);
    await newChat('New worktree');
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['notes'], 'recovery.txt', { type: 'text/plain' }));
      document.querySelector(${JSON.stringify(prompt)}).dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    })()`);
    await waitFor(`document.body.textContent.includes('recovery.txt')`);
    await send('Recover after leaving');
    await evaluate('window.finishCreate()');
    await waitFor('window.calls.sent.length === 6');
    await evaluate(`document.querySelector('[aria-label="New chat"]').click()`);
    await waitFor(`!!document.querySelector('[data-new-chat-pickers]')`);
    await type('Keep the current draft');
    await evaluate('window.failSend()');
    await waitFor(`(document.querySelector('[aria-label="Send"]') && !document.querySelector('[aria-label="Send"]').disabled)`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(prompt)}).value`), 'Keep the current draft');
    const recoverable = await evaluate(`[...document.querySelectorAll('aside [data-row]')].find(row => row.textContent.includes('Recover after leaving')) != null`);
    assert.equal(recoverable, true, 'background failure keeps the submission recoverable in the sidebar');
    await screenshot('background-failed');
    await send('Another background send');
    await evaluate('window.finishCreate()');
    await waitFor('window.calls.sent.length === 7');
    await evaluate(`[...document.querySelectorAll('aside [data-row]')].find(row => row.textContent.includes('Recover after leaving')).click()`);
    await waitFor(`document.querySelector(${JSON.stringify(prompt)}).value.includes('Recover after leaving') && document.body.textContent.includes('recovery.txt')`);
    await screenshot('background-failed-restored');
    await evaluate('window.saveSend(); window.ackSend()');
    await waitFor(`document.querySelector('[aria-label="Send"]') && !document.querySelector('[aria-label="Send"]').disabled`);
    const beforeRecovery = await evaluate('window.calls.created');
    await send('Recover after leaving');
    await waitFor('window.calls.sent.length === 8');
    assert.equal(await evaluate('window.calls.created'), beforeRecovery, 'background failure restores its prepared Worktree for retry');
    await evaluate('window.saveSend(); window.ackSend()');
    await waitFor(acknowledged);
    assert.deepEqual(consoleErrors, []);
    console.log('PASS: immediate first messages, Local and new worktree sends, acknowledgement, next drafts, attachment recovery, retries and background navigation');
    app.exit(0);
  } catch (error) {
    console.error(error);
    await screenshot('failure').catch(() => {});
    app.exit(1);
  }
}

async function main() {
  const { createServer } = await import("vite");
  const { spawn } = require("node:child_process");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "chat-send-feedback-fixture",
      resolveId(id) { if (id === "/__chat_send_feedback_fixture.tsx") return id; },
      load(id) { if (id === "/__chat_send_feedback_fixture.tsx") return fixture; },
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__chat_send_feedback__") return next();
          const html = await server.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__chat_send_feedback_fixture.tsx"></script></body></html>');
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__chat_send_feedback__`], { env, stdio: "inherit" });
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
