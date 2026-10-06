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

async function copyLabel(evaluate, window) {
  let label = "";
  for (let i = 0; i < 40 && !/^(Copied|Press ⌘C)$/.test(label); i++) {
    await delay(50);
    label = await evaluate(window, `document.querySelector(".hero [data-copy]").textContent.trim()`);
  }
  return label;
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
    name: "copy button copies the brew command",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
      await evaluate(window, `document.querySelector(".hero [data-copy]").click()`);
      const label = await copyLabel(evaluate, window);
      // A hidden window may lack clipboard focus, so the selection fallback is also accepted here.
      assert.match(label, /^(Copied|Press ⌘C)$/);
      window.destroy();
    },
  },
  {
    name: "copy button falls back to selecting the command when the clipboard is unavailable",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
      await evaluate(window, `void (navigator.clipboard.writeText = () => Promise.reject(new Error("denied")))`);
      await evaluate(window, `document.querySelector(".hero [data-copy]").click()`);
      assert.equal(await copyLabel(evaluate, window), "Press ⌘C");
      assert.equal(await evaluate(window, `getSelection().toString()`), BREW);
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
  {
    name: "hero scene animates when motion is allowed",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
      assert.ok(await evaluate(window, `!!document.querySelector(".scene")`), "scene exists");
      assert.equal(await evaluate(window, `document.querySelector(".scene").getAttribute("aria-hidden")`), "true");
      assert.ok(await evaluate(window, `document.querySelector(".scene").getAnimations({ subtree: true }).length > 0`), "animations running");
      window.destroy();
    },
  },
  {
    name: "reduced motion shows the approval on both devices, without animation",
    async run(open, evaluate, shot) {
      const window = await open({ width: 1440, height: 900, reducedMotion: true });
      assert.equal(await evaluate(window, `document.querySelector(".scene").getAnimations({ subtree: true }).length`), 0);
      const opacities = await evaluate(window, `[...document.querySelectorAll('.scene [data-frame="approval"]')].map(el => getComputedStyle(el).opacity)`);
      assert.deepEqual(opacities, ["1", "1"]);
      assert.ok(await evaluate(window, `!!document.querySelector(".scene-description")?.textContent.includes("approval")`), "described for screen readers");
      await shot(window, "desktop-reduced-motion.png");
      window.destroy();
    },
  },
  {
    name: "sections appear in order with FAQ, images and a closing download",
    async run(open, evaluate, shot) {
      const window = await open({ width: 1440, height: 900 });
      const headings = await evaluate(window, `[...document.querySelectorAll("main h2")].map(h => h.textContent.trim())`);
      assert.deepEqual(headings, [
        "Agents stop for you. You'll notice.",
        "Several changes at once, no mixed files",
        "Agents that work across repos",
        "Your Mac does the work. Your phone keeps up.",
        "Local-first",
        "Questions",
        "Download Milagre",
      ]);
      assert.equal(await evaluate(window, `document.querySelectorAll("main details").length`), 5);
      const images = await evaluate(window, `[...document.querySelectorAll("main img")].map(img => ({ alt: img.alt, w: img.getAttribute("width"), h: img.getAttribute("height"), loaded: img.complete && img.naturalWidth > 0 }))`);
      assert.equal(images.length, 3);
      for (const image of images) {
        assert.ok(image.alt.length > 10, "alt text");
        assert.ok(image.w && image.h, "explicit size");
      }
      assert.ok(await evaluate(window, `document.querySelectorAll('main a[href="/download/mac-arm64"]').length >= 2`), "closing download");
      assert.ok(!(await evaluate(window, `/[\\u2013\\u2014]/.test(document.body.innerText)`)), "no en or em dashes in copy");
      const height = await evaluate(window, `document.documentElement.scrollHeight`);
      window.setContentSize(1440, Math.min(height, 12000));
      await shot(window, "desktop-full.png");
      window.destroy();
      const phone = await open({ width: 390, height: 844, mobile: true });
      const widths = await evaluate(phone, `[document.documentElement.scrollWidth, window.innerWidth]`);
      assert.ok(widths[0] <= widths[1], `phone scrollWidth ${widths[0]} > ${widths[1]}`);
      phone.destroy();
    },
  },
];

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  app.on("window-all-closed", () => {}); // checks close their windows; keep the app alive until app.exit
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const errors = [];
  const opened = [];
  async function open({ width, height, mobile = false, reducedMotion = false }) {
    const window = new BrowserWindow({ width, height, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
    opened.push(window);
    window.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    await window.loadURL(url);
    if (mobile || reducedMotion) {
      // Device emulation before the first navigation crashes Electron 44, so emulate after the first load and reload.
      window.webContents.debugger.attach();
      if (mobile) await window.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 3, mobile: true });
      if (reducedMotion) await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      const reloaded = new Promise(resolve => window.webContents.once("did-finish-load", resolve));
      window.webContents.reload();
      await reloaded;
    }
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
    finally { for (const w of opened.splice(0)) if (!w.isDestroyed()) w.destroy(); }
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
