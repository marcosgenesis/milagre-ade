// Run with node scripts/test-mobile-terminal.cjs. Loads the phone's Terminal page (apps/mobile/src/terminal-receiver.ts)
// in Chromium, standing in for the WebView: its messages go to a real shell through the same follower the phone uses,
// and the host's output comes back through the page's window functions. Checks typing, the held Ctrl and the theme.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { setTimeout: delay } = require("node:timers/promises");

const preload = `
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ReactNativeWebView", { postMessage: (message) => ipcRenderer.send("terminal-view", message) });
`;

async function electronChecks() {
  const { app, BrowserWindow, ipcMain } = require("electron");
  const { createTerminals, terminalEnvironment } = require("../packages/core/src/terminals.cjs");
  const { followTerminal } = await import(pathToFileURL(path.join(__dirname, "../packages/shared/src/terminal-client.mjs")).href);
  const [page, themesFile] = process.argv.slice(2);
  const themes = JSON.parse(fs.readFileSync(themesFile, "utf8"));
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "milagre-mobile-terminal-")));
  app.setPath("userData", path.join(scratch, "profile"));
  const preloadFile = path.join(scratch, "preload.cjs");
  fs.writeFileSync(preloadFile, preload);
  await app.whenReady();
  const window = new BrowserWindow({ width: 390, height: 640, useContentSize: true, show: false, webPreferences: { preload: preloadFile, sandbox: false } });
  const terminals = createTerminals({
    resolveChat: async () => [{ path: scratch, label: "phone" }],
    shell: () => ({ file: "/bin/sh", args: [] }),
    environment: () => terminalEnvironment({ PATH: "/usr/bin:/bin", HOME: scratch, PS1: "$ " }),
  });
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  const messages = [];
  let follower = null;
  const call = (script) => void window.webContents.executeJavaScript(`${script};true;`);
  const opened = await terminals.open({ chatId: "/phone#1" });
  ipcMain.on("terminal-view", (_event, raw) => {
    const message = JSON.parse(raw);
    messages.push(message);
    if (message.channel !== "milagre-terminal") return;
    if (message.event === "ready") {
      follower = followTerminal({
        terminalId: opened.id,
        api: terminals,
        write: (data) => call(`window.terminalWrite(${JSON.stringify(data)})`),
        reset: (data) => call(`window.terminalReset(${JSON.stringify(data)})`),
      });
      follower.resize(message.cols, message.rows);
    } else if (message.event === "input") follower?.send(message.data);
    else if (message.event === "resize") follower?.resize(message.cols, message.rows);
  });
  const screenshotDir = process.env.MILAGRE_SCREENSHOT_DIR;
  async function screenshot(name) {
    if (!screenshotDir) return;
    await delay(300);
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.writeFileSync(path.join(screenshotDir, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  }
  async function waitFor(check, what) {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (await check()) return;
      await delay(25);
    }
    throw new Error(`Timed out: ${what}`);
  }
  const shown = () => evaluate('document.querySelector(".xterm-rows")?.textContent ?? ""');
  async function type(text) {
    for (const char of text) {
      if (char === "\r") {
        window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
      } else {
        window.webContents.sendInputEvent({ type: "keyDown", keyCode: char });
        window.webContents.sendInputEvent({ type: "char", keyCode: char });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: char });
      }
      await delay(5);
    }
  }
  try {
    await window.loadFile(page);
    await waitFor(() => messages.some((message) => message.event === "ready"), "the page's ready message");
    const ready = messages.find((message) => message.event === "ready");
    assert.ok(ready.cols >= 30 && ready.rows >= 20, `The page did not fit the phone's width: ${JSON.stringify(ready)}`);
    await waitFor(async () => (await terminals.list({ chatId: "/phone#1" })).terminals[0].cols === ready.cols, "the PTY sized to the page");
    window.webContents.focus();
    await evaluate("window.terminalFocus()");
    await type("echo phone-$((40+2))\r");
    await waitFor(async () => (await shown()).includes("phone-42"), "the command's output");

    // A held Ctrl turns the next letter into its control character: Ctrl+C stops a running command.
    await type("sleep 30\r");
    await waitFor(async () => (await terminals.list({ chatId: "/phone#1" })).terminals[0].busy, "sleep running");
    await evaluate("window.terminalCtrl(true)");
    await type("c");
    await waitFor(() => messages.some((message) => message.event === "ctrl-used"), "the Ctrl key released after use");
    await waitFor(async () => !(await terminals.list({ chatId: "/phone#1" })).terminals[0].busy, "sleep stopped by Ctrl+C");
    await type("echo after-ctrl\r");
    await waitFor(async () => (await shown()).includes("after-ctrl"), "typing works after Ctrl");
    await screenshot("mobile-terminal-dark");
    await evaluate(`window.terminalTheme(${JSON.stringify(themes.light)})`);
    await screenshot("mobile-terminal-light");
    console.log("PASS: the phone's Terminal page fits the PTY, runs commands, Ctrl+C stops a command and the theme switches");
    follower?.stop();
    await terminals.dispose();
    app.exit(0);
  } catch (error) {
    console.error(error);
    follower?.stop();
    await terminals.dispose();
    app.exit(1);
  }
}

async function main() {
  const { createServer } = await import("vite");
  const { spawn } = require("node:child_process");
  const root = path.resolve(__dirname, "..");
  const server = await createServer({ configFile: false, root, logLevel: "error", server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const receiver = await server.ssrLoadModule(path.join(root, "apps/mobile/src/terminal-receiver.ts"));
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "milagre-mobile-terminal-page-"));
    const page = path.join(scratch, "terminal.html");
    // The phone's dark palette (apps/mobile/src/theme.ts).
    const dark = { scheme: "dark", background: "#17181a", ink: "#f4f5f6", ink3: "#7f828a", accent: "#2b95ff" };
    const light = { scheme: "light", background: "#fafafb", ink: "#1f2124", ink3: "#9a9da3", accent: "#0285ff" };
    fs.writeFileSync(page, receiver.createTerminalHtml(dark));
    const themes = path.join(scratch, "themes.json");
    fs.writeFileSync(themes, JSON.stringify({ light: receiver.xtermTheme(light) }));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [path.resolve(__filename), page, themes], { env, stdio: "inherit" });
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
