// Run with node scripts/test-subagents.cjs. Uses the app's existing Vite and
// Electron dependencies to check subagent interactions and layout without an extra test runner.
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "/src/components/ChatComposer";
import { MODEL_CATALOG, capabilityFor } from "/src/model";
import "/src/styles.css";
const noop = () => {};
function Fixture() {
  const [count, setCount] = useState(2);
  const [children, setChildren] = useState([
    {id:"review",title:"Review authentication",prompt:"Check auth for regressions",status:"running",startedAt:Date.now()-65000,updatedAt:Date.now(),latestActivity:"Reading auth.ts",transcript:[{id:"a",kind:"message",text:"Child-only finding"}]},
    {id:"tests",title:"Run tests",status:"failed",startedAt:Date.now()-40000,updatedAt:Date.now(),endedAt:Date.now(),transcript:[{id:"b",kind:"tool",text:"Tests failed"}]}
  ]);
  const [sending, setSending] = useState(true);
  const archive = (id,archived) => setChildren(items=>items.map(child=>child.id===id ? {...child,archived} : child));
  const archiveFinished = () => setChildren(items=>items.map(child=>["completed","failed","cancelled"].includes(child.status) ? {...child,archived:true} : child));
  window.setChildren = setChildren;
  window.finishChildren = () => {setChildren(items=>items.map(item=>({...item,status:"completed",endedAt:Date.now()})));setSending(false);};
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(MODEL_CATALOG[0]);
  const [fastMode, setFastMode] = useState(false);
  window.setMessageCount = setCount;
  window.setDraft = setDraft;
  window.setModel = (id) => setModel(MODEL_CATALOG.find((item) => item.id === id));
  const messages = Array.from({ length: count }, (_, index) => ({
    id: index + 1, session_id: 1, context: null, role: index === 0 ? "user" : "assistant",
    body: index === 0 ? "Review authentication and run the relevant tests." : "I started two subagents. Their progress is available below.",
  }));
  return <div style={{ height: "100%", padding: 12 }}>
    <ChatComposer messages={messages}
      imageDraft={{ images: [], files: [], attachFiles: noop, attachPath: noop, removeFile: noop, loading: false, error: "", onPaste: noop, clear: noop, remove: noop }}
      projectPath="/fixture" draft={draft} onDraftChange={setDraft} onSend={noop} isSending={sending} sendBlocked={false} subagents={children} onArchiveFinishedSubagents={archiveFinished} onArchiveSubagent={archive} waitingForSubagents={true}
      models={MODEL_CATALOG} cliStatus={null} onModelPickerOpen={noop} selectedModel={model} onModelChange={noop}
      capability={capabilityFor(model, null)} onEffortChange={noop} ultracode={false} onUltracodeChange={noop}
      fastMode={fastMode} onFastModeChange={setFastMode} permissionMode="auto" onPermissionModeChange={noop}
      onRecommendationSelect={noop} worktrees={[]} onWorktreeChange={noop}
      isolation="local" onIsolationChange={noop} branches={[]} baseBranch="main" onBaseBranchChange={noop} newChatError={null} />
  </div>;
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(<Fixture />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", require("node:fs").mkdtempSync(path.join(require("node:os").tmpdir(), "milagre-subagent-ui-")));
  await app.whenReady();
  const window = new BrowserWindow({ width: 800, height: 600, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  window.webContents.on("console-message", details => { if (details.level === "error") console.error(details.message); });
  const evaluate = async (source) => {
    try { return await window.webContents.executeJavaScript(source); }
    catch (error) { throw new Error(`${source}: ${error.message}`); }
  };
  const clickLabel = label => evaluate(`[...document.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === ${JSON.stringify(label)}).click()`);
  async function screenshot(name) {
    if (!process.env.MILAGRE_SCREENSHOT_DIR) return;
    await delay(300);
    const fs = require("node:fs");
    fs.mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  }
  async function waitFor(source) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw new Error(`Timed out: ${source}`);
  }
  try {
    await window.loadURL(process.argv[2]);
    await waitFor('!!document.querySelector("[data-slot=subagent-track]")');
    assert.equal(await evaluate('document.querySelector("[data-slot=subagent-track]").textContent.includes("active")'), false);
    assert.equal(await evaluate('document.querySelector("[data-slot=subagent-track]").textContent.includes("failed")'), false);
    await evaluate('document.querySelector("[data-slot=subagent-track] > button").click()');
    await waitFor('!!document.querySelector("[data-slot=subagent-popover]")');
    assert.equal(await evaluate('document.querySelectorAll("dialog[open], [aria-modal=true]").length'), 0);
    assert.equal(await evaluate('document.querySelectorAll("[data-subagent-row]").length'), 2);
    assert.ok(await evaluate('document.querySelector("[data-slot=subagent-track] > button").getBoundingClientRect().height <= 24'));
    const rowPosition = await evaluate('(() => {const r=document.querySelector("[data-subagent-row]").getBoundingClientRect();return {x:Math.round(r.right-38),y:Math.round(r.top+r.height/2)}})()');
    window.webContents.sendInputEvent({type:"mouseMove",...rowPosition});
    await screenshot("subagents-list");
    await clickLabel('Archive Run tests');
    await waitFor('document.querySelectorAll("[data-subagent-row]").length === 1');
    await evaluate('document.querySelector("[data-subagent-archived-toggle]").click()');
    await waitFor(`!!document.querySelector('[aria-label="Restore Run tests"]')`);
    await clickLabel('Restore Run tests');
    await evaluate('document.querySelector("[data-subagent-archived-toggle]").click()');
    await waitFor('document.querySelectorAll("[data-subagent-row]").length === 2');
    await evaluate('document.querySelector("[data-subagent-open]").click()');
    await waitFor('!!document.querySelector("[data-slot=subagent-transcript]")');
    assert.ok(await evaluate('document.querySelector("[data-slot=subagent-transcript]").textContent.includes("Child-only finding")'));
    for (const [width,height] of [[800,600],[390,500]]) {
      window.setContentSize(width,height);
      await delay(200);
      const bounds=await evaluate('(() => {const r=document.querySelector("[data-slot=subagent-popover]").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()');
      assert.ok(bounds.left>=0 && bounds.right<=bounds.width && bounds.top>=0 && bounds.bottom<=bounds.height, 'Subagent popover escapes viewport');
    }
    window.setContentSize(800,600);
    await delay(200);
    await screenshot("subagent-transcript");
    await clickLabel('Close subagents');
    assert.equal(await evaluate('document.activeElement === document.querySelector("[data-slot=subagent-track] > button")'),true);
    await evaluate('document.querySelector("[data-slot=subagent-track] > button").click()');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await waitFor('!document.querySelector("[data-slot=subagent-popover]")');
    await evaluate('document.querySelector("[data-slot=subagent-track] > button").click()');
    await waitFor('!!document.querySelector("[data-slot=subagent-popover]")');
    await evaluate('document.querySelector("textarea[aria-label=Prompt]").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
    await waitFor('!document.querySelector("[data-slot=subagent-popover]")');
    await evaluate('document.querySelector("[data-slot=subagent-track] > button").click()');
    await waitFor('!!document.querySelector("[data-slot=subagent-popover]")');
    assert.equal(await evaluate(`document.querySelectorAll('[aria-label^="Unlink"]').length`), 0);
    await evaluate('document.querySelector("[data-subagent-archive-finished]").click()');
    await waitFor('document.querySelectorAll("[data-subagent-row]").length===1');
    assert.ok(await evaluate('document.querySelector("[data-subagent-archive-finished]").disabled'));
    assert.ok(await evaluate('document.querySelector("[data-subagent-row]").textContent.includes("Review authentication")'));
    await evaluate('window.finishChildren()');
    await waitFor('!document.querySelector("[data-slot=subagent-track] > button svg")');
    await waitFor('!document.querySelector("[data-subagent-archive-finished]").disabled');
    await evaluate('document.querySelector("[data-subagent-archive-finished]").click()');
    await waitFor('document.querySelectorAll("[data-subagent-row]").length===0');
    await evaluate('document.querySelector("[data-subagent-archived-toggle]").click()');
    await waitFor('document.querySelectorAll("[data-subagent-row]").length===2');
    await clickLabel('Restore Review authentication');
    await waitFor('document.querySelectorAll("[data-subagent-row]").length===1');
    await evaluate('window.setChildren([])');
    await waitFor('!document.querySelector("[data-slot=subagent-track]")');
    console.log('PASS: anchored popover, activity indicator, archive/restore, bulk archive, compact trigger, focus, Escape, outside click, and narrow layout');
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
      name: "subagents-fixture",
      resolveId(id) { if (id === "/__subagents_fixture.tsx") return id; },
      load(id) { if (id === "/__subagents_fixture.tsx") return fixture; },
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__subagents__") return next();
          const html = await server.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__subagents_fixture.tsx"></script></body></html>');
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__subagents__`], { env, stdio: "inherit" });
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
