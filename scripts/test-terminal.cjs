// Run with node scripts/test-terminal.cjs. Drives the Terminal panel in Electron against real shells: ⌘J opens the
// first Terminal in the Chat's Worktree, typing runs commands, + adds a tab, ⌘W asks before ending a busy Terminal
// and ends an idle one, and `exit` closes the last tab and the panel.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const CHAT = "/fixture#1";
// ⌘ on macOS, Ctrl elsewhere: the main process only takes the close key with the platform's own modifier.
const COMMAND = process.platform === "darwin" ? "meta" : "control";

const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "/src/components/ChatComposer";
import { MODEL_CATALOG, capabilityFor } from "/src/model";
import { TerminalPanel } from "/src/components/terminal/TerminalPanel";
import { PanelToggles } from "/src/components/agents/PanelToggles";
import { useTerminalSync } from "/src/lib/terminal-actions";
import "/src/styles.css";
window.notices = [];
window.setDark = (dark) => document.documentElement.classList.toggle("dark", dark);
const noop = () => {};
const messages = [
  { id: 1, session_id: 1, context: null, role: "user", body: "Start the dev server and check the logs." },
  { id: 2, session_id: 1, context: null, role: "assistant", body: "Open a Terminal with ⌘T and run npm run dev; the output stays there." },
];
function Fixture() {
  useTerminalSync(${JSON.stringify(CHAT)});
  const [model] = useState(MODEL_CATALOG[0]);
  // The chat pane as App lays it out: the Chat, then its Terminals, in one column.
  return <div data-chat-pane style={{ display: "flex", flexDirection: "column", height: "100vh", padding: 12, paddingTop: 48, boxSizing: "border-box", overflow: "hidden" }}>
    <ChatComposer messages={messages}
      imageDraft={{ images: [], files: [], attachFiles: noop, attachPath: noop, removeFile: noop, loading: false, error: "", onPaste: noop, clear: noop, remove: noop }}
      projectPath="/fixture" draft="" onDraftChange={noop} onSend={noop} isSending={false} sendBlocked={false} subagents={[]}
      models={MODEL_CATALOG} cliStatus={null} onModelPickerOpen={noop} selectedModel={model} onModelChange={noop}
      capability={capabilityFor(model, null)} onEffortChange={noop} ultracode={false} onUltracodeChange={noop}
      fastMode={false} onFastModeChange={noop} permissionMode="auto" onPermissionModeChange={noop}
      onRecommendationSelect={noop} worktrees={[]} onWorktreeChange={noop}
      isolation="local" onIsolationChange={noop} branches={[]} baseBranch="main" onBaseBranchChange={noop} newChatError={null} />
    <TerminalPanel chatId={${JSON.stringify(CHAT)}} notify={(message) => window.notices.push(message)} />
    <PanelToggles right={12} />
  </div>;
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(<Fixture />);
`;

const preload = `
const { contextBridge, ipcRenderer } = require("electron");
const call = (method) => (request) => ipcRenderer.invoke(method, request);
contextBridge.exposeInMainWorld("milagre", {
  terminals: { list: call("terminal:list"), open: call("terminal:open"), read: call("terminal:read"), input: call("terminal:input"), resize: call("terminal:resize"), close: call("terminal:close") },
  onTerminalsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:changed", listener);
    return () => ipcRenderer.removeListener("terminal:changed", listener);
  },
  setTerminalFocused: (focused) => ipcRenderer.send("app:terminal-focused", focused === true),
  onCloseFocusedTerminal: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:close-focused-terminal", listener);
    return () => ipcRenderer.removeListener("app:close-focused-terminal", listener);
  },
});
`;

async function electronChecks() {
  const { app, BrowserWindow, ipcMain } = require("electron");
  const { createTerminals, terminalEnvironment } = require("../packages/core/src/terminals.cjs");
  const { forwardAppShortcuts } = require("../apps/desktop/electron/app-shortcuts.cjs");
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "milagre-terminal-ui-")));
  const worktree = path.join(scratch, "dev-server");
  fs.mkdirSync(worktree);
  app.setPath("userData", path.join(scratch, "profile"));
  const preloadFile = path.join(scratch, "preload.cjs");
  fs.writeFileSync(preloadFile, preload);
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1000,
    height: 620,
    useContentSize: true,
    show: false,
    webPreferences: { preload: preloadFile, backgroundThrottling: false, sandbox: false },
  });
  const terminals = createTerminals({
    resolveChat: async (chatId) => {
      if (chatId !== CHAT) throw new Error("Unknown Chat");
      return [{ path: worktree, label: "dev-server" }];
    },
    shell: () => ({ file: "/bin/sh", args: [] }),
    environment: () => terminalEnvironment({ PATH: "/usr/bin:/bin", HOME: scratch, PS1: "$ ", LANG: "en_US.UTF-8" }),
    onChange: (chatId) => !window.isDestroyed() && window.webContents.send("terminal:changed", { chatId }),
  });
  for (const method of ["list", "open", "read", "input", "resize", "close"])
    ipcMain.handle(`terminal:${method}`, (_event, request) => terminals[method](request));
  forwardAppShortcuts(window.webContents);
  window.webContents.on("console-message", (details) => {
    if (details.level === "error") console.error(details.message);
  });
  const evaluate = async (source) => {
    try {
      return await window.webContents.executeJavaScript(source);
    } catch (error) {
      throw new Error(`${source}: ${error.message}`);
    }
  };
  const screenshotDir = process.env.MILAGRE_SCREENSHOT_DIR;
  async function screenshot(name) {
    if (!screenshotDir) return;
    await delay(300);
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.writeFileSync(path.join(screenshotDir, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  }
  async function waitFor(source, what = source) {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw new Error(`Timed out: ${what}`);
  }
  const shown = '(document.querySelector("[data-terminal-body] .xterm-rows")?.textContent ?? "")';
  const tabs = '[...document.querySelectorAll("[data-terminal-tab]")].map((tab) => tab.textContent)';
  function press(key, modifiers = []) {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
  }
  async function type(text) {
    for (const char of text) {
      if (char === "\r") press("Return");
      else {
        // As a real key press: xterm reads printable keys from the keypress that follows their keydown.
        window.webContents.sendInputEvent({ type: "keyDown", keyCode: char });
        window.webContents.sendInputEvent({ type: "char", keyCode: char });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: char });
      }
      await delay(5);
    }
  }
  try {
    await window.loadURL(process.argv[2]);
    await waitFor('!!document.querySelector("[data-panel-toggle=terminal]")', "the Terminals corner button");
    assert.equal(await evaluate('!!document.querySelector("[data-terminal-panel]")'), false, "The panel starts hidden");
    window.webContents.focus();

    // ⌘J with no Terminal opens the first one, focused, in the Chat's Worktree.
    press("J", ["meta"]);
    await waitFor('!!document.querySelector("[data-terminal-panel] .xterm")', "the first Terminal");
    await waitFor('document.activeElement?.classList.contains("xterm-helper-textarea")', "focus in the Terminal");
    // The Chat makes room: its prompt sits above the panel, not under it.
    const layout = await evaluate(
      '(() => { const prompt = document.querySelector("textarea[aria-label=Prompt]").getBoundingClientRect(); const panel = document.querySelector("[data-terminal-panel]").getBoundingClientRect(); return { promptBottom: prompt.bottom, panelTop: panel.top, panelBottom: panel.bottom, height: innerHeight }; })()',
    );
    assert.ok(layout.promptBottom <= layout.panelTop && layout.panelBottom <= layout.height, `The prompt is under the Terminals: ${JSON.stringify(layout)}`);
    await type("echo milagre-$((40+2)); pwd\r");
    await waitFor(`${shown}.includes("milagre-42") && ${shown}.includes(${JSON.stringify(worktree)})`, "the command's output and the Worktree folder");
    assert.equal(await evaluate('document.querySelector("[data-panel-toggle=terminal]").getAttribute("aria-pressed")'), "true");
    await type("printf '\\033[32mgreen\\033[0m \\033[1;34mblue\\033[0m\\n'\r");
    await waitFor(`${shown}.includes("green blue")`);
    await screenshot("terminal-dark");
    await evaluate("window.setDark(false)");
    await screenshot("terminal-light");
    await evaluate("window.setDark(true)");

    // The PTY takes the panel's size.
    const [{ cols, rows }] = (await terminals.list({ chatId: CHAT })).terminals;
    assert.ok(cols > 80 && rows >= 8, `The PTY was not fitted to the panel: ${cols}x${rows}`);

    // ⌘J hides the panel without ending the shell; ⌘J again brings it back with its output.
    press("J", ["meta"]);
    await waitFor('!document.querySelector("[data-terminal-panel]")', "the panel hidden");
    assert.equal((await terminals.list({ chatId: CHAT })).terminals.length, 1, "Hiding keeps the Terminal");
    press("J", ["meta"]);
    await waitFor(`${shown}.includes("milagre-42")`, "the same output after showing it again");

    // + adds a second tab; a running command makes it busy, and ⌘W asks before ending it.
    await evaluate("document.querySelector(\"[aria-label='New Terminal']\").click()");
    await waitFor(`${tabs}.length === 2`, "a second tab");
    await waitFor('document.activeElement?.classList.contains("xterm-helper-textarea")');
    await type("sleep 30\r");
    await waitFor(`${tabs}[1].includes("sleep")`, "the tab named after its command");
    press("W", [COMMAND]);
    await waitFor(`[...document.querySelectorAll("button")].some((button) => button.textContent === "End sleep")`, "the confirmation");
    assert.equal((await terminals.list({ chatId: CHAT })).terminals.length, 2, "⌘W asks first");
    await screenshot("terminal-confirm-dark");
    // A second ⌘W confirms: focus stayed in the Terminal.
    assert.equal(await evaluate('document.activeElement?.classList.contains("xterm-helper-textarea")'), true);
    press("W", [COMMAND]);
    await waitFor(`${tabs}.length === 1`, "the busy Terminal ended");
    assert.equal((await terminals.list({ chatId: CHAT })).terminals.length, 1);

    // exit ends the last Terminal: its tab and the panel go.
    await evaluate('document.querySelector("[data-terminal-tab]").click()');
    await waitFor('document.activeElement?.classList.contains("xterm-helper-textarea")');
    await type("exit\r");
    await waitFor('!document.querySelector("[data-terminal-panel]")', "the panel closed after exit");
    assert.deepEqual((await terminals.list({ chatId: CHAT })).terminals, []);
    assert.deepEqual(await evaluate("window.notices"), []);
    console.log(
      "PASS: ⌘J opens a Terminal in the Worktree, runs commands with colors, fits the PTY, hides and shows, + adds a tab, ⌘W asks before ending a busy one, exit closes the panel",
    );
    await terminals.dispose();
    app.exit(0);
  } catch (error) {
    console.error(error);
    await terminals.dispose();
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
        name: "terminal-fixture",
        resolveId(id) {
          if (id === "/__terminal_fixture.tsx") return id;
        },
        load(id) {
          if (id === "/__terminal_fixture.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__terminal__") return next();
            const html = await server.transformIndexHtml(
              request.url,
              '<html><body><div id="root"></div><script type="module" src="/__terminal_fixture.tsx"></script></body></html>',
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__terminal__`], { env, stdio: "inherit" });
    process.exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await server.close();
  }
}

(process.versions.electron ? electronChecks() : main()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
