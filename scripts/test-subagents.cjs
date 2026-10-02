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
      imageDraft={{ images: [], loading: false, error: "", onPaste: noop, clear: noop, remove: noop }}
      projectPath="/fixture" draft={draft} onDraftChange={setDraft} onSend={noop} isSending={sending} sendBlocked={false} subagents={children} waitingForSubagents={true}
      models={MODEL_CATALOG} cliStatus={null} onModelPickerOpen={noop} selectedModel={model} onModelChange={noop}
      capability={capabilityFor(model, null)} onEffortChange={noop} ultracode={false} onUltracodeChange={noop}
      fastMode={fastMode} onFastModeChange={setFastMode} permissionMode="auto" onPermissionModeChange={noop}
      worktreeSummary="main" connectionSummary="No connection" eventsCount={0} firstWorktreeName="main"
      firstAgentRunning={false} secondAgentRunning={false} onToggleFirst={noop} onToggleSecond={noop}
      onCycleConnection={noop} onRecommendationSelect={noop} worktrees={[]} onWorktreeChange={noop}
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
  const evaluate = (source) => window.webContents.executeJavaScript(source);
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
    assert.ok(await evaluate('document.body.textContent.includes("Waiting on subagents")'));
    assert.equal(await evaluate('document.body.textContent.includes("Child-only finding")'), false);
    await evaluate('document.querySelector("[data-slot=subagent-track] > button").click()');
    await waitFor('!!document.querySelector("dialog[open]")');
    assert.ok(await evaluate('document.querySelector("dialog").textContent.includes("Running")'));
    assert.ok(await evaluate('document.querySelector("dialog").textContent.includes("Failed")'));
    await screenshot("subagents-list");
    await evaluate('[...document.querySelectorAll("dialog li button")].find(b=>b.textContent.includes("Review authentication")).click()');
    await waitFor('!!document.querySelector("[data-slot=subagent-transcript]")');
    assert.ok(await evaluate('document.querySelector("[data-slot=subagent-transcript]").textContent.includes("Child-only finding")'));
    assert.equal(await evaluate('document.querySelectorAll("dialog textarea").length'), 0);
    for (const [width,height] of [[800,600],[390,500]]) {
      window.setContentSize(width,height);
      await delay(200);
      const bounds=await evaluate('(() => {const r=document.querySelector("dialog").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()');
      assert.ok(bounds.left>=0 && bounds.right<=bounds.width && bounds.top>=0 && bounds.bottom<=bounds.height, 'Subagent dialog escapes viewport');
    }
    window.setContentSize(800,600);
    await delay(200);
    await screenshot("subagent-transcript");
    await evaluate('window.finishChildren()');
    await waitFor('document.querySelector("[data-slot=subagent-transcript]").textContent.includes("Completed")');
    await evaluate('[...document.querySelectorAll("dialog button")].find(b=>b.textContent==="Close").click()');
    assert.equal(await evaluate('document.activeElement === document.querySelector("[data-slot=subagent-track] > button")'),true);
    assert.ok(await evaluate('document.querySelector("[data-slot=subagent-track]").textContent.includes("2 completed")'));
    assert.equal(await evaluate('document.body.textContent.includes("Waiting on subagents")'),false);
    await evaluate('document.querySelector("[data-slot=subagent-track] > button").click()');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await waitFor('!document.querySelector("dialog[open]")');
    await evaluate('window.setChildren([])');
    await waitFor('!document.querySelector("[data-slot=subagent-track]")');
    console.log('PASS: subagent states, transcript isolation, live completion, focus, Escape, and narrow layout');
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
