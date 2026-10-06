const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { CanvasView } from "/src/components/CanvasView";
import "/src/styles.css";
const state = (id, title) => ({ next_id: 5, projects: {}, worktrees: { 1: { id: 1, project_id: 1, path: "/" + id, name: "main", diff: { added: 12, removed: 3 } } }, sessions: { 2: { id: 2, worktree_id: 1, agent_name: "Claude", status: "Stopped", title }, 3: { id: 3, worktree_id: 1, agent_name: "Claude", status: "Stopped", title: "Archived", archived: true } }, messages: [], tasks: {} });
const projects = [
  { id: "a", path: "/a", name: "Frontend", openedAt: "2026-10-03T10:00:00Z", position: { x: 0, y: 0 } },
  { id: "b", path: "/b", name: "Backend", openedAt: "2026-10-03T09:00:00Z", position: { x: 440, y: 0 } },
];
const readLinks = () => JSON.parse(localStorage.getItem("canvas-test-links") || "[]");
window.milagre = {
  getCanvas: async () => ({ projects, links: readLinks(), worktreePositions: {}, states: [{ path: "/a", state: state("a", "Build UI") }, { path: "/b", state: state("b", "Add API") }] }),
  addLink: async (a, b) => { const links = [...readLinks(), { id: "link-1", a, b, created_at: new Date().toISOString() }]; localStorage.setItem("canvas-test-links", JSON.stringify(links)); return links; },
  removeLink: async id => { const links = readLinks().filter(link => link.id !== id); localStorage.setItem("canvas-test-links", JSON.stringify(links)); return links; },
  setProjectPosition: async () => [],
  setWorktreePosition: async () => null,
};
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(<div style={{ display: "flex", height: "100vh", padding: "20px" }}><CanvasView states={{}} runs={{}} linkedWork={{ delegations: [], negotiations: [], receiveOnly: [] }} onOpenChat={(path, id) => { window.__openedChat = { path, id }; }} onBack={() => {}} /></div>);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const window = new BrowserWindow({ width: 1100, height: 690, show: false, webPreferences: { backgroundThrottling: false } });
  const evaluate = code => window.webContents.executeJavaScript(code);
  const mouse = (type, x, y) => window.webContents.sendInputEvent({ type, x, y, button: "left", clickCount: 1, modifiers: type === "mouseMove" ? ["leftButtonDown"] : [] });
  const waitFor = async code => { for (let i = 0; i < 200; i++) { if (await evaluate(code)) return; await delay(25); } throw new Error(`Timed out: ${code}`); };
  const point = (nodeName, handle) => evaluate(`(() => { const node = [...document.querySelectorAll('.react-flow__node')].find(node => node.textContent.includes(${JSON.stringify(nodeName)}) && node.classList.contains('react-flow__node-project')); const r = node?.querySelector(${JSON.stringify(`.react-flow__handle[data-handleid="${handle}"]`)})?.getBoundingClientRect(); return r && { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const screenshot = name => { if (!process.env.MILAGRE_SCREENSHOT_DIR) return Promise.resolve(); fs.mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true }); return window.webContents.capturePage().then(image => fs.writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, `${name}.png`), image.toPNG())); };
  try {
    await window.loadURL(process.argv[2]);
    await evaluate('localStorage.removeItem("canvas-test-links")');
    await window.reload();
    await waitFor('document.querySelectorAll(".react-flow__node-project").length === 2');
    assert.equal(await evaluate('document.body.textContent.includes("Archived")'), false);
    await evaluate('[...document.querySelectorAll(".react-flow__node-worktree button")].find(button => button.textContent === "Add API").click()');
    assert.deepEqual(await evaluate('window.__openedChat'), { path: "/b", id: 2 });
    await screenshot("before");
    const from = await point("Frontend", "right-source");
    const to = await point("Backend", "left-target");
    assert.ok(from && to, "project handles are rendered");
    mouse("mouseMove", from.x, from.y);
    mouse("mouseDown", from.x, from.y);
    for (let i = 1; i <= 20; i++) { mouse("mouseMove", Math.round(from.x + (to.x - from.x) * i / 20), Math.round(from.y + (to.y - from.y) * i / 20)); await delay(15); }
    mouse("mouseUp", to.x, to.y);
    await waitFor('JSON.parse(localStorage.getItem("canvas-test-links") || "[]").length === 1');
    await waitFor('document.querySelectorAll(".react-flow__edge").length === 1');
    await screenshot("linked");
    await evaluate('document.querySelector(".react-flow__edge").dispatchEvent(new MouseEvent("click", { bubbles: true }))');
    await waitFor('[...document.querySelectorAll("[data-canvas] button")].some(button => button.textContent === "Remove Link")');
    await evaluate('[...document.querySelectorAll("[data-canvas] button")].find(button => button.textContent === "Remove Link").click()');
    await waitFor('JSON.parse(localStorage.getItem("canvas-test-links") || "[]").length === 0');
    await screenshot("removed");
    // The same gesture creates it again; a reload reads the saved Link through the stubbed bridge.
    await window.reload();
    await waitFor('document.querySelectorAll(".react-flow__node-project").length === 2');
    const fromAgain = await point("Frontend", "right-source");
    const toAgain = await point("Backend", "left-target");
    mouse("mouseMove", fromAgain.x, fromAgain.y); mouse("mouseDown", fromAgain.x, fromAgain.y);
    for (let i = 1; i <= 20; i++) { mouse("mouseMove", Math.round(fromAgain.x + (toAgain.x - fromAgain.x) * i / 20), Math.round(fromAgain.y + (toAgain.y - fromAgain.y) * i / 20)); await delay(15); }
    mouse("mouseUp", toAgain.x, toAgain.y);
    await waitFor('JSON.parse(localStorage.getItem("canvas-test-links") || "[]").length === 1');
    await window.reload();
    await waitFor('document.querySelectorAll(".react-flow__edge").length === 1');
    console.log("PASS: canvas nodes, archived Chat hidden, Link drag, removal, persistence after reload");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}

async function main() {
  const { createServer } = await import("vite");
  const { spawn } = require("node:child_process");
  const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, plugins: [{
    name: "canvas-links-fixture",
    resolveId(id) { if (id === "/__canvas_links_fixture.tsx") return id; },
    load(id) { if (id === "/__canvas_links_fixture.tsx") return fixture; },
    // oxlint-disable-next-line oxc/no-async-endpoint-handlers -- pre-existing, see PR body
    configureServer(server) { server.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__canvas_links__") return next();
      const html = await server.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__canvas_links_fixture.tsx"></script></body></html>');
      response.setHeader("Content-Type", "text/html"); response.end(html);
    }); },
  }] });
  try {
    await server.listen();
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__canvas_links__`], { env, stdio: "inherit" });
    process.exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => resolve(code ?? 1)); });
  } finally { await server.close(); }
}
(process.versions.electron ? browserChecks() : main()).catch(error => { console.error(error); process.exitCode = 1; });
