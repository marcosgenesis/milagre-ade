const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const capture = Boolean(process.env.MILAGRE_SCREENSHOT_DIR);
const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { HandoverRow, HandoverLinkBar, HandoverFromLabel, HandoverNote, HandoverBriefChip } from "/src/components/Handover";
import { Notice } from "/src/components/Notice";
import "/src/styles.css";
function Fixture() {
  const [opened, setOpened] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [noteOpen, setNoteOpen] = useState(true);
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [brief, setBrief] = useState("# Goal\\n\\nFix the **login redirect**.");
  window.brief = () => brief;
  window.opened = () => opened;
  window.block = setBlocked;
  return <div style={{ width: 360, padding: "64px 12px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
    <section data-shot="row"><HandoverRow targets={[{ provider: "codex", blocked }, { provider: "antigravity", blocked: null }]} onChoose={(provider) => setOpened("handover:" + provider)} /></section>
    <section data-shot="to"><HandoverLinkBar to={{ id: 7, title: "Fix login redirect", provider: "codex" }} onOpen={setOpened} /></section>
    <section data-shot="note">{noteOpen && <HandoverNote from="codex" to="claude" permissionMode="auto" onDismiss={() => setNoteOpen(false)} />}</section>
    <section data-shot="notice">{noticeOpen && <Notice data-plain-notice onDismiss={() => setNoticeOpen(false)}>The worktree's setup command failed.</Notice>}</section>
    <section data-shot="brief" data-editable-brief><HandoverBriefChip brief={brief} onSave={async (text) => setBrief(text)} /></section>
    <section data-read-only-brief><HandoverBriefChip brief="# Sent brief" /></section>
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
  const win = new BrowserWindow({ width: 400, height: 640, show: false, webPreferences: { backgroundThrottling: false } });
  const evaluate = (source) => win.webContents.executeJavaScript(source);
  async function waitFor(source) {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(source)) return;
      await delay(20);
    }
    throw Error(`Timed out: ${source}`);
  }
  async function shot(name) {
    if (!capture) return;
    // A hidden window repaints lazily: wait for the frame that shows the last change.
    await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await delay(250);
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
    assert.equal(await evaluate("window.opened()"), "handover:codex");
    assert.match(await evaluate('document.querySelector("[data-handover-row][data-provider=antigravity]").textContent'), /Handover to Antigravity/);
    await evaluate('document.querySelector("[data-handover-row][data-provider=antigravity]").click()');
    assert.equal(await evaluate("window.opened()"), "handover:antigravity");
    const reason = "The agent is still running. Stop the turn or wait for it to finish to hand over.";
    await evaluate(`window.block(${JSON.stringify(reason)})`);
    await waitFor('document.querySelector("[data-handover-row]").disabled');
    // A disabled button gets no hover, so the reason shows as a tooltip from its wrapper rather than a native title.
    const box = await evaluate('JSON.stringify(document.querySelector("[data-handover-row]").getBoundingClientRect())').then(JSON.parse);
    win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
    await waitFor('document.querySelector("[role=tooltip]")');
    assert.equal(await evaluate('document.querySelector("[role=tooltip]").textContent'), reason);
    await shot("picker-row-blocked");
    win.webContents.sendInputEvent({ type: "mouseMove", x: 390, y: 630 });
    await waitFor('!document.querySelector("[role=tooltip]")');
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
    assert.equal(await evaluate('document.querySelector("[data-handover-note]").getAttribute("role")'), "status");
    assert.equal(await evaluate('document.querySelector("[data-handover-note]").hasAttribute("data-notice")'), true);
    await evaluate('document.querySelector("[data-handover-note] [data-notice-dismiss]").click()');
    await waitFor('!document.querySelector("[data-handover-note]")');

    // A plain notice has the same look and dismisses the same way.
    assert.equal(await evaluate('document.querySelector("[data-plain-notice]").textContent'), "The worktree's setup command failed.Dismiss");
    await evaluate('document.querySelector("[data-plain-notice] [data-notice-dismiss]").click()');
    await waitFor('!document.querySelector("[data-plain-notice]")');

    // The brief chip opens an editor with a preview; Save keeps the edit, Cancel drops it.
    assert.equal(await evaluate('document.querySelector("[data-editable-brief] [data-handover-brief]").textContent'), "Handover brief.md");
    await evaluate('document.querySelector("[data-editable-brief] [data-handover-brief]").click()');
    await waitFor('document.querySelector("[data-brief-dialog]")');
    assert.equal(await evaluate('document.querySelector("[data-brief-tab=edit]").getAttribute("aria-selected")'), "true");
    assert.equal(await evaluate('document.querySelector("[data-brief-editor]").value'), "# Goal\n\nFix the **login redirect**.");
    await evaluate(`(() => {
      const editor = document.querySelector("[data-brief-editor]");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(editor, "# Goal\\n\\nFix the **logout** redirect.");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await evaluate('document.querySelector("[data-brief-tab=preview]").click()');
    await waitFor('document.querySelector("[data-brief-preview] h1")');
    assert.equal(await evaluate('document.querySelector("[data-brief-preview] h1").textContent'), "Goal");
    assert.equal(await evaluate('document.querySelector("[data-brief-preview] strong").textContent'), "logout");
    assert.equal(await evaluate('!!document.querySelector("[data-brief-editor]")'), false);
    await shot("brief-preview");
    await evaluate('document.querySelector("[data-brief-tab=edit]").click()');
    await waitFor('document.querySelector("[data-brief-editor]")');
    assert.equal(await evaluate('document.querySelector("[data-brief-editor]").value'), "# Goal\n\nFix the **logout** redirect.");
    await shot("brief-edit");
    await evaluate('document.querySelector("[data-brief-save]").click()');
    await waitFor('!document.querySelector("[data-brief-dialog]")');
    assert.equal(await evaluate("window.brief()"), "# Goal\n\nFix the **logout** redirect.");
    await evaluate('document.querySelector("[data-editable-brief] [data-handover-brief]").click()');
    await waitFor('document.querySelector("[data-brief-dialog]")');
    await evaluate(`(() => {
      const editor = document.querySelector("[data-brief-editor]");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(editor, "discarded");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await evaluate('document.querySelector("[data-brief-cancel]").click()');
    await waitFor('!document.querySelector("[data-brief-dialog]")');
    assert.equal(await evaluate("window.brief()"), "# Goal\n\nFix the **logout** redirect.");

    // A sent brief opens read-only: Preview alone, and Close.
    await evaluate('document.querySelector("[data-read-only-brief] [data-handover-brief]").click()');
    await waitFor('document.querySelector("[data-brief-dialog]")');
    assert.equal(
      await evaluate(
        '!!document.querySelector("[data-brief-tab]") || !!document.querySelector("[data-brief-editor]") || !!document.querySelector("[data-brief-save]")',
      ),
      false,
    );
    assert.equal(await evaluate('document.querySelector("[data-brief-preview] h1").textContent'), "Sent brief");
    await evaluate('document.querySelector("[data-brief-close]").click()');
    await waitFor('!document.querySelector("[data-brief-dialog]")');
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
    plugins: [
      {
        name: "handover-fixture",
        resolveId(id) {
          if (id === "/__handover_fixture.tsx") return id;
        },
        load(id) {
          if (id === "/__handover_fixture.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__handover__") return next();
            const html = await server.transformIndexHtml(
              request.url,
              '<html><body><div id="root"></div><script type="module" src="/__handover_fixture.tsx"></script></body></html>',
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__handover__`], { env, stdio: "inherit" });
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
