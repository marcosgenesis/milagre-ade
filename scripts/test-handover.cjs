const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const capture = Boolean(process.env.MILAGRE_SCREENSHOT_DIR);
const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { HandoverRow, HandoverLinkBar, HandoverFromLabel, HandoverNote } from "/src/components/Handover";
import "/src/styles.css";
function Fixture() {
  const [opened, setOpened] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [noteOpen, setNoteOpen] = useState(true);
  window.opened = () => opened;
  window.block = setBlocked;
  return <div style={{ width: 360, padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
    <section data-shot="row"><HandoverRow provider="codex" blocked={blocked} onClick={() => setOpened("handover")} /></section>
    <section data-shot="to"><HandoverLinkBar to={{ id: 7, title: "Fix login redirect", provider: "codex" }} onOpen={setOpened} /></section>
    <section data-shot="note">{noteOpen && <HandoverNote from="codex" to="claude" permissionMode="auto" onDismiss={() => setNoteOpen(false)} />}</section>
    <section data-shot="from" style={{ display: "flex", flexDirection: "column" }}><HandoverFromLabel from={{ id: 3, title: "Fix login redirect" }} onOpen={setOpened} /></section>
  </div>;
}
document.documentElement.classList.add("dark");
document.body.style.cssText = "margin:0;background:#202123";
createRoot(document.getElementById("root")).render(<Fixture />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const win = new BrowserWindow({ width: 400, height: 420, show: false, webPreferences: { backgroundThrottling: false } });
  const evaluate = (source) => win.webContents.executeJavaScript(source);
  async function waitFor(source) {
    for (let i = 0; i < 200; i++) { if (await evaluate(source)) return; await delay(20); }
    throw Error(`Timed out: ${source}`);
  }
  async function shot(name) {
    if (!capture) return;
    const fs = require("node:fs/promises");
    await fs.mkdir(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
    await fs.writeFile(path.join(process.env.MILAGRE_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  try {
    await win.loadURL(process.argv[2]);
    await waitFor("!!window.block");
    assert.match(await evaluate('document.querySelector("[data-handover-row]").textContent'), /Handover to Codex.*New chat with this chat's context/);
    await shot("picker-row");
    await evaluate('document.querySelector("[data-handover-row]").click()');
    assert.equal(await evaluate("window.opened()"), "handover");
    await evaluate('window.block("Stop the turn or wait for it to finish to hand over.")');
    await waitFor('document.querySelector("[data-handover-row]").disabled');
    assert.equal(await evaluate('document.querySelector("[data-handover-row]").title'), "Stop the turn or wait for it to finish to hand over.");
    await shot("picker-row-blocked");
    assert.match(await evaluate('document.querySelector("[data-handover-to]").textContent'), /Handed over to Codex.*Fix login redirect/);
    await evaluate('document.querySelector("[data-handover-to]").click()');
    assert.equal(await evaluate("window.opened()"), 7);
    await evaluate('document.querySelector("[data-handover-from]").click()');
    assert.equal(await evaluate("window.opened()"), 3);
    await shot("links");
    const note = await evaluate('document.querySelector("[data-handover-note]").textContent');
    assert.match(note, /Always allow in this chat.*stay with the Codex chat\./);
    assert.match(note, /Subagents still running in the Codex chat keep running there\./);
    assert.match(note, /On Claude, Auto applies edits inside this worktree/);
    await shot("note");
    await evaluate('document.querySelector("[data-handover-note-dismiss]").click()');
    await waitFor('!document.querySelector("[data-handover-note]")');
    console.log("Handover checks passed.");
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
      name: "handover-fixture",
      resolveId(id) { if (id === "/__handover_fixture.tsx") return id; },
      load(id) { if (id === "/__handover_fixture.tsx") return fixture; },
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__handover__") return next();
          const html = await server.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__handover_fixture.tsx"></script></body></html>');
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__handover__`], { env, stdio: "inherit" });
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
