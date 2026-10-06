// Browser check: dragging the sidebar's right edge resizes it, clamps, persists, and resets.
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import SidebarNav from "/src/components/SidebarNav";
import "/src/styles.css";
const recents = [
  { id: "1", label: "lets pick the next 3 issues from the tracker and plan them" },
  { id: "2", label: "the chat names arent reflecting the first message" },
  { id: "3", label: "when i navigate between chats the scroll jumps" },
];
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(
  <div style={{ display: "flex", height: "100vh", padding: "60px 12px 12px" }}>
    <SidebarNav fill workspaceName="agent-sessions-pr2" recents={recents} activeId="1" />
    <div style={{ flex: 1 }} />
  </div>
);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const window = new BrowserWindow({ width: 1200, height: 500, show: false, webPreferences: { backgroundThrottling: false } });
  const evaluate = source => window.webContents.executeJavaScript(source);
  // Moves carry leftButtonDown, or Chromium reads them as the button already released.
  const mouse = (type, x, y) => window.webContents.sendInputEvent({ type, x, y, button: "left", clickCount: 1, modifiers: type === "mouseMove" ? ["leftButtonDown"] : [] });
  async function waitFor(source) {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw new Error(`Timed out: ${source}`);
  }
  const width = () => evaluate('document.querySelector("aside").getBoundingClientRect().width');
  const handle = () => evaluate('(() => { const r = document.querySelector("[aria-label=\\"Resize sidebar\\"]").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()');
  const drag = async dx => {
    const { x, y } = await handle();
    mouse("mouseMove", x, y);
    mouse("mouseDown", x, y);
    for (let i = 1; i <= 10; i++) { mouse("mouseMove", x + Math.round(dx * i / 10), y); await delay(16); }
    mouse("mouseUp", x + dx, y);
    await delay(400);
  };
  const screenshot = async name => {
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 640, height: 500 });
    require("node:fs").writeFileSync(path.join(require("node:os").tmpdir(), `milagre-sidebar-${name}.png`), image.toPNG());
  };
  try {
    await window.loadURL(process.argv[2]);
    await evaluate('localStorage.removeItem("milagre.sidebarWidth")');
    await window.loadURL(process.argv[2]);
    await waitFor('!!document.querySelector("aside")');
    await delay(400);
    assert.equal(await width(), 224, "starts at the default width");
    await screenshot("default");
    {
      // Mid-drag, so the edge line shows.
      const { x, y } = await handle();
      mouse("mouseDown", x, y);
      for (let i = 1; i <= 10; i++) { mouse("mouseMove", x + i * 8, y); await delay(16); }
      await delay(100);
      await screenshot("dragging");
      mouse("mouseUp", x + 80, y);
      await delay(400);
      await evaluate('document.querySelector("[aria-label=\\"Resize sidebar\\"]").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
      await delay(400);
    }
    await drag(100);
    assert.equal(await width(), 324, "drag right widens it");
    assert.equal(await evaluate('localStorage.getItem("milagre.sidebarWidth")'), "324");
    await screenshot("wide");
    await drag(400);
    assert.equal(await width(), 420, "clamps at the max");
    await screenshot("max");
    await drag(-600);
    assert.equal(await width(), 224, "clamps at the min");
    await drag(150);
    await window.loadURL(process.argv[2]);
    await waitFor('!!document.querySelector("aside")');
    await delay(400);
    assert.equal(await width(), 374, "width survives a reload");
    await evaluate('document.querySelector("[aria-label=\\"Collapse sidebar\\"]").click()');
    await delay(400);
    assert.equal(await width(), 44, "collapses to the rail");
    await screenshot("collapsed");
    assert.equal(await evaluate('document.querySelector("[aria-label=\\"Resize sidebar\\"]")'), null, "no handle on the rail");
    await evaluate('document.querySelector("[aria-label=\\"Expand sidebar\\"]").click()');
    await delay(400);
    assert.equal(await width(), 374, "expands back to the chosen width");
    const { x, y } = await handle();
    window.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 2 });
    window.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 2 });
    await delay(400);
    assert.equal(await width(), 224, "double-click resets");
    await evaluate('document.querySelector("[aria-label=\\"Resize sidebar\\"]").focus()');
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Right" });
    await delay(400);
    assert.equal(await width(), 240, "arrow key widens by 16px");
    console.log("Screenshots: default, dragging, wide, max, collapsed in the temp directory");
    console.log("PASS: drag widens, clamps 224..420, persists across reload, hidden when collapsed, restores on expand, double-click reset, keyboard");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}

async function main() {
  const { createServer } = await import("vite");
  const { spawn } = require("node:child_process");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "sidebar-resize-fixture",
      resolveId(id) { if (id === "/__sidebar_resize_fixture.tsx") return id; },
      load(id) { if (id === "/__sidebar_resize_fixture.tsx") return fixture; },
      configureServer(server) {
        // oxlint-disable-next-line oxc/no-async-endpoint-handlers -- pre-existing, see PR body
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__sidebar_resize__") return next();
          const html = await server.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__sidebar_resize_fixture.tsx"></script></body></html>');
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__sidebar_resize__`], { env, stdio: "inherit" });
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
