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
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".txt": "text/plain",
};
const HERO_TITLE = "Your agents keep working. Answer them from anywhere.";

function serve() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    // Stands in for the Worker route so the star pill can be checked without GitHub.
    if (pathname === "/api/stars") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ stars: 1234 }));
    }
    let file = path.join(dist, pathname);
    if (!file.startsWith(dist)) {
      res.writeHead(403);
      return res.end();
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function waitFor(evaluate, window, code, description) {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(window, code)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}

// The page is one screen: nothing scrolls, and the scene sits inside the viewport.
async function assertOneScreen(evaluate, window) {
  const size = await evaluate(
    window,
    `({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight })`,
  );
  assert.ok(size.sw <= size.w, `scrollWidth ${size.sw} > ${size.w}`);
  assert.ok(size.sh <= size.h, `scrollHeight ${size.sh} > ${size.h}`);
  const box = await evaluate(
    window,
    `(() => { const r = document.querySelector(".scene").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })()`,
  );
  assert.ok(box.top >= 0 && box.left >= 0 && box.bottom <= size.h + 1 && box.right <= size.w + 1, `scene outside the viewport: ${JSON.stringify(box)}`);
}

const checks = [
  {
    name: "desktop: title, both downloads and the star count, all on one screen",
    async run(open, evaluate, shot) {
      const window = await open({ width: 1440, height: 900 });
      assert.equal(await evaluate(window, `document.querySelector("h1").textContent.trim()`), HERO_TITLE);
      assert.ok(await evaluate(window, `!!document.querySelector('.hero a[href="/download/mac-arm64"]')`), "Apple Silicon download");
      assert.ok(await evaluate(window, `!!document.querySelector('.hero a[href="/download/mac-x64"]')`), "Intel download");
      assert.equal(await evaluate(window, `document.querySelector(".stars").getAttribute("href")`), "https://github.com/the-ptf/milagre-ade");
      await waitFor(evaluate, window, `!document.querySelector("[data-stars]").hidden`, "star count");
      assert.equal(await evaluate(window, `document.querySelector("[data-stars]").textContent`), "1.2K");
      assert.ok(await evaluate(window, `getComputedStyle(document.querySelector(".mac")).display !== "none"`), "Mac window shown");
      await assertOneScreen(evaluate, window);
      assert.ok(!(await evaluate(window, `/[\\u2013\\u2014]/.test(document.body.innerText)`)), "no en or em dashes in copy");
      await shot(window, "desktop.png");
      window.destroy();
    },
  },
  {
    name: "short laptop screen still fits without scrolling",
    async run(open, evaluate, shot) {
      const window = await open({ width: 1280, height: 640 });
      await assertOneScreen(evaluate, window);
      await shot(window, "laptop-short.png");
      window.destroy();
    },
  },
  {
    name: "phone: the phone app alone, on one screen",
    async run(open, evaluate, shot) {
      const window = await open({ width: 390, height: 844, mobile: true });
      assert.equal(await evaluate(window, `getComputedStyle(document.querySelector(".mac")).display`), "none");
      await assertOneScreen(evaluate, window);
      await shot(window, "phone.png");
      window.destroy();
    },
  },
  {
    name: "star pill stays a plain link when the count is unavailable",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
      await evaluate(window, `document.querySelector("[data-stars]").hidden = true`);
      assert.equal(await evaluate(window, `document.querySelector(".stars").textContent.trim()`).then((text) => text.startsWith("Star")), true);
      window.destroy();
    },
  },
  {
    name: "hero scene animates when motion is allowed",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
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
    name: "metadata: canonical, description, Open Graph image",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
      const meta = await evaluate(
        window,
        `({
        canonical: document.querySelector('link[rel="canonical"]')?.href,
        description: document.querySelector('meta[name="description"]')?.content,
        image: document.querySelector('meta[property="og:image"]')?.content,
        card: document.querySelector('meta[name="twitter:card"]')?.content,
      })`,
      );
      assert.equal(meta.canonical, "https://milagre.cloud/");
      assert.ok(meta.description.startsWith("Milagre runs Claude Code and Codex on your Mac"));
      assert.equal(meta.image, "https://milagre.cloud/og.png");
      assert.equal(meta.card, "summary_large_image");
      assert.ok(fs.existsSync(path.join(dist, "og.png")), "og.png is built");
      assert.ok(fs.existsSync(path.join(dist, "robots.txt")), "robots.txt is built");
      window.destroy();
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
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    await window.loadURL(url);
    if (mobile || reducedMotion) {
      // Device emulation before the first navigation crashes Electron 44, so emulate after the first load and reload.
      window.webContents.debugger.attach();
      if (mobile) await window.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 3, mobile: true });
      if (reducedMotion)
        await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      const reloaded = new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
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
    try {
      await check.run(open, evaluate, shot);
      console.log(`PASS: ${check.name}`);
    } catch (error) {
      failed = true;
      console.error(`FAIL: ${check.name}\n${error.stack}`);
    } finally {
      for (const w of opened.splice(0)) if (!w.isDestroyed()) w.destroy();
    }
  }
  if (errors.length) {
    failed = true;
    console.error(`FAIL: console errors\n${errors.join("\n")}`);
  }
  server.close();
  app.exit(failed ? 1 : 0);
}

if (process.versions.electron) {
  browserChecks().catch((error) => {
    console.error(error);
    require("electron").app.exit(1);
  });
} else {
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    console.error("Build the site first: npm run build:site");
    process.exit(1);
  }
  const child = spawn(require("electron"), [__filename], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
  child.on("exit", (code) => process.exit(code ?? 1));
}

module.exports = { checks };
