// Loads the built landing page in headless Electron at desktop and phone sizes.
// npm run build:site && npm run test:site
// Set MILAGRE_SCREENSHOT_DIR (outside the repo) to save screenshots.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const dist = path.resolve(__dirname, "../apps/site/dist");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain" };
const HERO_TITLE = "Your agents keep working. Answer them from anywhere.";
const BREW = "brew install --cask the-ptf/tap/milagre";

function serve() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.join(dist, pathname);
    if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const checks = [
  {
    name: "desktop hero has the title, both downloads, brew and the iPhone link",
    async run(open, evaluate, shot) {
      const window = await open({ width: 1440, height: 900 });
      assert.equal(await evaluate(window, `document.querySelector("h1").textContent.trim()`), HERO_TITLE);
      assert.ok(await evaluate(window, `!!document.querySelector('.hero a[href="/download/mac-arm64"]')`), "Apple Silicon download");
      assert.ok(await evaluate(window, `!!document.querySelector('.hero a[href="/download/mac-x64"]')`), "Intel download");
      assert.equal(await evaluate(window, `document.querySelector(".hero [data-command]").textContent.trim()`), BREW);
      assert.ok(await evaluate(window, `[...document.querySelectorAll(".hero a")].some(a => a.textContent.includes("Get the iPhone beta"))`), "iPhone link");
      await shot(window, "desktop-hero.png");
      window.destroy();
    },
  },
  {
    name: "copy button copies, or selects the command and asks for Command-C",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
      await evaluate(window, `document.querySelector(".hero [data-copy]").click()`);
      let label = "";
      for (let i = 0; i < 40 && !/^(Copied|Press ⌘C)$/.test(label); i++) {
        await delay(50);
        label = await evaluate(window, `document.querySelector(".hero [data-copy]").textContent.trim()`);
      }
      assert.match(label, /^(Copied|Press ⌘C)$/);
      if (label === "Press ⌘C") assert.equal(await evaluate(window, `getSelection().toString()`), BREW);
      window.destroy();
    },
  },
  {
    name: "phone width has no horizontal scroll",
    async run(open, evaluate, shot) {
      const window = await open({ width: 390, height: 844, mobile: true });
      const widths = await evaluate(window, `[document.documentElement.scrollWidth, window.innerWidth]`);
      assert.ok(widths[0] <= widths[1], `scrollWidth ${widths[0]} > innerWidth ${widths[1]}`);
      await shot(window, "phone-hero.png");
      window.destroy();
    },
  },
];

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const errors = [];
  async function open({ width, height, mobile = false, reducedMotion = false }) {
    const window = new BrowserWindow({ width, height, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
    window.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    window.webContents.debugger.attach();
    if (mobile) await window.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 3, mobile: true });
    if (reducedMotion) await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await window.loadURL(url);
    await window.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
    return window;
  }
  const evaluate = (window, code) => window.webContents.executeJavaScript(code);
  async function shot(window, name) {
    const dir = process.env.MILAGRE_SCREENSHOT_DIR;
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    await delay(300);
    fs.writeFileSync(path.join(dir, name), (await window.webContents.capturePage()).toPNG());
  }
  let failed = false;
  for (const check of checks) {
    try { await check.run(open, evaluate, shot); console.log(`PASS: ${check.name}`); }
    catch (error) { failed = true; console.error(`FAIL: ${check.name}\n${error.stack}`); }
  }
  if (errors.length) { failed = true; console.error(`FAIL: console errors\n${errors.join("\n")}`); }
  server.close();
  app.exit(failed ? 1 : 0);
}

if (process.versions.electron) {
  browserChecks().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    console.error("Build the site first: npm run build:site");
    process.exit(1);
  }
  const child = spawn(require("electron"), [__filename], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
  child.on("exit", code => process.exit(code ?? 1));
}

module.exports = { checks };
