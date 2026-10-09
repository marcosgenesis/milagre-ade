// Loads the built landing page in headless Electron at desktop and phone sizes.
// npm run test:site (builds the site first)
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
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
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

// The page is one screen: nothing scrolls, the devices rise from the bottom fade, and the download button sits at the
// bottom, drawn in front of them.
async function assertOneScreen(evaluate, window) {
  const size = await evaluate(
    window,
    `({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight })`,
  );
  assert.ok(size.sw <= size.w, `scrollWidth ${size.sw} > ${size.w}`);
  assert.ok(size.sh <= size.h, `scrollHeight ${size.sh} > ${size.h}`);
  const demo = await evaluate(
    window,
    `(() => { const r = document.querySelector(".demo").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })()`,
  );
  assert.ok(demo.left >= 0 && demo.right <= size.w + 1, `devices wider than the screen: ${JSON.stringify(demo)}`);
  // They reach into the bottom of the fade, where it is already solid page colour, so they read as running off the edge.
  const fade = await evaluate(window, `document.querySelector(".fade").getBoundingClientRect().height`);
  assert.ok(demo.top < size.h * 0.6 && demo.bottom >= size.h - fade * 0.4, `devices don't reach the bottom fade: ${JSON.stringify({ demo, fade })}`);
  const button = await evaluate(
    window,
    `(() => { const a = [...document.querySelectorAll(".cta .button")].find((el) => el.offsetParent); const r = a.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, onTop: a.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }; })()`,
  );
  assert.ok(button.bottom <= size.h && button.top > size.h * 0.6, `download button not at the bottom: ${JSON.stringify(button)}`);
  assert.ok(button.top > demo.top && button.onTop, "the download button is drawn in front of the devices");
}

const checks = [
  {
    name: "desktop: title, both downloads and the star count, all on one screen",
    async run(open, evaluate, shot) {
      const window = await open({ width: 1440, height: 900 });
      assert.equal(await evaluate(window, `document.querySelector("h1").textContent.trim()`), HERO_TITLE);
      assert.ok(await evaluate(window, `!!document.querySelector('.cta a[href="/download/mac-arm64"]')`), "Apple Silicon download");
      assert.ok(await evaluate(window, `!!document.querySelector('.cta a[href="/download/mac-x64"]')`), "Intel download");
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
    name: "an iPhone gets the iOS beta instead of the Mac download",
    async run(open, evaluate, shot) {
      const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1";
      const window = await open({ width: 390, height: 844, mobile: true, userAgent: iphone });
      const visible = (selector) => `[...document.querySelectorAll('${selector}')].filter((a) => a.offsetParent).length`;
      assert.equal(await evaluate(window, visible('.cta a[href="https://testflight.apple.com/join/K9ExV7bV"]')), 1);
      assert.equal(await evaluate(window, visible('.cta a[href="/download/mac-arm64"]')), 0);
      await assertOneScreen(evaluate, window);
      await shot(window, "iphone.png");
      window.destroy();
      const mac = await open({ width: 1440, height: 900 });
      assert.equal(await evaluate(mac, visible('.cta a[href="https://testflight.apple.com/join/K9ExV7bV"]')), 0);
      mac.destroy();
    },
  },
  {
    name: "an Android phone gets the Android beta and the Android recording",
    async run(open, evaluate, shot) {
      const pixel = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
      const window = await open({ width: 412, height: 915, mobile: true, userAgent: pixel });
      const visible = `[...document.querySelectorAll(".cta a")].filter((a) => a.offsetParent).map((a) => a.getAttribute("href"))`;
      assert.deepEqual(await evaluate(window, visible), ["/download/android"]);
      assert.equal(
        await evaluate(window, `[...document.querySelectorAll(".cta .button")].find((a) => a.offsetParent).textContent.trim()`),
        "Download Android beta",
      );
      assert.equal(await evaluate(window, `new URL(document.querySelector("[data-phone]").src).pathname`), "/demo/android.mp4");
      await waitFor(
        evaluate,
        window,
        `(() => { const v = document.querySelector("[data-phone]"); return !v.paused && v.currentTime > 1; })()`,
        "Android recording playing",
      );
      await assertOneScreen(evaluate, window);
      await shot(window, "android.png");
      window.destroy();
    },
  },
  {
    name: "Linux gets the AppImage (or the .deb or .rpm when the browser names the distribution), Windows gets its own button, and every desktop lists the others",
    async run(open, evaluate, shot) {
      const linux = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
      const visible = (selector) => `[...document.querySelectorAll('${selector}')].filter((a) => a.offsetParent).map((a) => a.getAttribute("href"))`;
      const window = await open({ width: 1440, height: 900, userAgent: linux });
      assert.deepEqual(await evaluate(window, visible(".cta a")), [
        "/download/linux-appimage",
        "/download/linux-deb",
        "/download/linux-rpm",
        "/download/mac-arm64",
        "/download/windows",
      ]);
      assert.ok(
        (await evaluate(window, `[...document.querySelectorAll(".cta .button")].find((a) => a.offsetParent).textContent.trim()`)) === "Download for Linux",
      );
      await assertOneScreen(evaluate, window);
      await shot(window, "linux.png");
      window.destroy();
      const ubuntu = await open({ width: 1440, height: 900, userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0" });
      assert.deepEqual(await evaluate(ubuntu, visible(".cta a")), [
        "/download/linux-deb",
        "/download/linux-appimage",
        "/download/linux-rpm",
        "/download/mac-arm64",
        "/download/windows",
      ]);
      ubuntu.destroy();
      const fedora = await open({ width: 1440, height: 900, userAgent: "Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0" });
      assert.deepEqual(await evaluate(fedora, visible(".cta a")), [
        "/download/linux-rpm",
        "/download/linux-appimage",
        "/download/linux-deb",
        "/download/mac-arm64",
        "/download/windows",
      ]);
      fedora.destroy();
      const windows = await open({
        width: 1440,
        height: 900,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      });
      assert.deepEqual(await evaluate(windows, visible(".cta a")), ["/download/windows", "/download/mac-arm64", "/download/linux-appimage"]);
      assert.equal(
        await evaluate(windows, `[...document.querySelectorAll(".cta .button")].find((a) => a.offsetParent).textContent.trim()`),
        "Download for Windows",
      );
      await shot(windows, "windows.png");
      windows.destroy();
      const mac = await open({ width: 1440, height: 900 });
      assert.deepEqual(await evaluate(mac, visible(".cta a")), ["/download/mac-arm64", "/download/mac-x64", "/download/linux-appimage", "/download/windows"]);
      mac.destroy();
    },
  },
  {
    name: "the phone is a 3D model where WebGL works, and the flat frame where it doesn't",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900 });
      const webgl = await evaluate(
        window,
        `(() => { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); })()`,
      );
      if (webgl) {
        await waitFor(evaluate, window, `document.querySelector(".demo").classList.contains("three")`, "3D phone");
        const canvas = await evaluate(
          window,
          `(() => { const r = document.querySelector(".phone-canvas").getBoundingClientRect(); return { w: r.width, h: r.height }; })()`,
        );
        assert.ok(canvas.w > 100 && canvas.h > 200, `canvas ${JSON.stringify(canvas)}`);
      } else {
        // CI's Linux runners block WebGL: the recording keeps its flat frame and stays visible.
        await delay(1000);
        assert.equal(await evaluate(window, `document.querySelector(".demo").classList.contains("three")`), false);
        assert.equal(await evaluate(window, `getComputedStyle(document.querySelector(".phone-video")).opacity`), "1");
      }
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
    name: "both recordings play, and the phone keeps time with the desktop",
    async run(open, evaluate, shot) {
      const window = await open({ width: 1440, height: 900 });
      assert.equal(await evaluate(window, `document.querySelector(".demo").getAttribute("aria-hidden")`), "true");
      assert.ok(
        await evaluate(window, `document.querySelector(".demo-description").textContent.includes("approved on the phone")`),
        "described for screen readers",
      );
      await waitFor(evaluate, window, `[...document.querySelectorAll(".demo video")].every((v) => !v.paused && v.currentTime > 1.5)`, "videos playing");
      const drift = await evaluate(
        window,
        `Math.abs(document.querySelector("[data-desktop]").currentTime - document.querySelector("[data-phone]").currentTime)`,
      );
      assert.ok(drift < 0.3, `phone drifts ${drift}s from the desktop`);
      await shot(window, "desktop-playing.png");
      window.destroy();
    },
  },
  {
    name: "reduced motion leaves both recordings on their first frame",
    async run(open, evaluate) {
      const window = await open({ width: 1440, height: 900, reducedMotion: true });
      await delay(800);
      assert.deepEqual(await evaluate(window, `[...document.querySelectorAll(".demo video")].map((v) => v.paused)`), [true, true]);
      assert.deepEqual(await evaluate(window, `[...document.querySelectorAll(".demo video")].map((v) => v.poster.replace(location.origin, ""))`), [
        "/demo/desktop.jpg",
        "/demo/phone.jpg",
      ]);
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
      // The canonical URL and og:image follow astro.config.mjs `site` (milagre.dev since #365); milagre.cloud serves the same pages.
      assert.equal(meta.canonical, "https://milagre.dev/");
      assert.ok(meta.description.length >= 120 && meta.description.length <= 160, `description is ${meta.description.length} characters`);
      assert.ok(meta.description.includes("Claude Code"));
      const extra = await evaluate(
        window,
        `({
        title: document.title,
        siteName: document.querySelector('meta[property="og:site_name"]')?.content,
        imageAlt: document.querySelector('meta[property="og:image:alt"]')?.content,
        schema: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)["@type"]),
        summary: document.querySelector("main p")?.textContent ?? "",
      })`,
      );
      assert.ok(extra.title.length >= 30 && extra.title.length <= 60, `title is ${extra.title.length} characters`);
      assert.equal(extra.siteName, "Milagre");
      assert.ok(extra.imageAlt.length > 20, "og:image:alt");
      assert.deepEqual(extra.schema, ["WebSite", "Organization", "SoftwareApplication", "SoftwareSourceCode"]);
      assert.ok(extra.summary.includes("open-source"), "a crawlable summary of what Milagre is");
      for (const file of ["sitemap.xml", "llms.txt"]) assert.ok(fs.existsSync(path.join(dist, file)), `${file} is built`);
      assert.match(fs.readFileSync(path.join(dist, "robots.txt"), "utf8"), /Sitemap: https:\/\/milagre\.cloud\/sitemap\.xml/);
      assert.equal(meta.image, "https://milagre.dev/og.png");
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
  // A Mac browser unless a check says otherwise: the page picks its download from the user agent, and CI runs on Linux.
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  async function open({ width, height, mobile = false, reducedMotion = false, userAgent = MAC }) {
    const window = new BrowserWindow({ width, height, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
    opened.push(window);
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    window.webContents.setUserAgent(userAgent);
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
  // Builds the site first, so the checks always see the current source (CI's Electron shards have no build of their own).
  require("node:child_process").execFileSync("npx", ["astro", "build"], { cwd: path.dirname(dist), stdio: ["ignore", "ignore", "inherit"] });
  const child = spawn(require("electron"), [__filename], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
  child.on("exit", (code) => process.exit(code ?? 1));
}

module.exports = { checks };
