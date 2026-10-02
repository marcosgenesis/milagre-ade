// Run with node scripts/test-chat-layout.cjs. Uses the app's existing Vite and
// Electron dependencies to check browser geometry without an extra test runner.
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
  const [count, setCount] = useState(50);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(MODEL_CATALOG[0]);
  const [fastMode, setFastMode] = useState(false);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [sending, setSending] = useState(false);
  window.setHasConflicts = setHasConflicts;
  window.setSending = setSending;
  window.resolveClicks ??= 0;
  window.setMessageCount = setCount;
  window.setDraft = setDraft;
  window.setModel = (id) => setModel(MODEL_CATALOG.find((item) => item.id === id));
  const messages = Array.from({ length: count }, (_, index) => ({
    id: index + 1, session_id: 1, context: null, role: "assistant",
    body: "PR aberta com sucesso: [#9 — fix: update app icon asset](https://github.com/example/project/pull/9). " + index,
  }));
  return <div style={{ height: "100%", padding: 12 }}>
    <ChatComposer messages={messages}
      imageDraft={{ images: [], files: [], removeFile: noop, attachFiles: noop, loading: false, error: "", onPaste: noop, clear: noop, remove: noop }}
      projectPath="/fixture" draft={draft} onDraftChange={setDraft} onSend={noop} isSending={sending} sendBlocked={false}
      onResolveConflicts={hasConflicts ? () => window.resolveClicks++ : undefined}
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
  await app.whenReady();
  const window = new BrowserWindow({ width: 800, height: 600, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => { if (event.level === "error") console.error(event.message); });
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  async function waitFor(source) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw new Error(`Timed out: ${source}`);
  }
  try {
    await window.loadURL(process.argv[2]);
    await waitFor('document.querySelectorAll("[data-slot=preview-rail-item]").length === 50');
    const resolveButton = `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Resolve conflicts')`;
    assert.equal(await evaluate(`!!(${resolveButton})`), false);
    await evaluate('window.setHasConflicts(true)');
    await waitFor(`!!(${resolveButton})`);
    assert.ok(await evaluate(`(${resolveButton}).getBoundingClientRect().bottom <= document.querySelector('[data-promptbar]').getBoundingClientRect().top`), "Conflict pill sits above the composer");
    await evaluate(`(${resolveButton}).click()`);
    assert.equal(await evaluate('window.resolveClicks'), 1);
    await evaluate('window.setSending(true)');
    await waitFor(`(${resolveButton}).disabled`);
    await evaluate(`(${resolveButton}).click()`);
    assert.equal(await evaluate('window.resolveClicks'), 1, "A running turn disables the conflict action");
    await evaluate('window.setSending(false)');
    await waitFor(`!(${resolveButton}).disabled`);
    await delay(250);
    await window.webContents.capturePage().then(image => require("node:fs").writeFileSync("/tmp/milagre-conflict-pill.png", image.toPNG()));
    await evaluate('window.setHasConflicts(false)');
    await waitFor(`!(${resolveButton})`);
    for (const [height, count, draft] of [[600, 50, ""], [360, 50, ""], [360, 50, "A multiline prompt\nthat expands the composer"], [600, 18, ""]]) {
      window.setContentSize(800, height);
      await evaluate(`window.setMessageCount(${count})`);
      await evaluate(`window.setDraft(${JSON.stringify(draft)})`);
      await waitFor(`document.querySelectorAll("[data-slot=preview-rail-item]").length === ${count}`);
      await delay(450);
      for (const edge of ["first", "last"]) {
        const target = await evaluate(`(() => {
          const viewport = document.querySelector('[aria-label="Conversation"]').getBoundingClientRect();
          const buttons = [...document.querySelectorAll('[data-slot="preview-rail-item"]')];
          const button = buttons.filter(node => {
            const rect = node.getBoundingClientRect();
            return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
          }).at(${edge === "first" ? 0 : -1});
          if (!button) throw new Error('No visible navigation item');
          button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
          return button.getAttribute('aria-label');
        })()`);
        await waitFor('!!document.querySelector("[data-slot=preview-rail-card]")');
        await delay(350);
        const geometry = await evaluate(`(() => {
          const rect = selector => {
            const { top, bottom, left, right } = document.querySelector(selector).getBoundingClientRect();
            return { top, bottom, left, right };
          };
          const rail = document.querySelector('[aria-label="Message navigation"]');
          const rows = [...rail.children].map(node => node.getBoundingClientRect());
          return { viewport: rect('[aria-label="Conversation"]'), preview: rect('[data-slot="preview-rail-card"]'), prompt: rect('[data-promptbar]'), railTop: Math.min(...rows.map(row => row.top)), railBottom: Math.max(...rows.map(row => row.bottom)) };
        })()`);
        console.log(JSON.stringify({ height, count, target, ...geometry }));
        assert.ok(geometry.preview.bottom <= geometry.prompt.top, "Message preview overlaps the prompt");
        assert.ok(geometry.preview.top >= geometry.viewport.top && geometry.preview.bottom <= geometry.viewport.bottom, "Message preview escapes the conversation viewport");
        assert.ok(geometry.railTop >= geometry.viewport.top && geometry.railBottom <= geometry.viewport.bottom, "Navigation items escape the conversation viewport");
        await evaluate(`document.querySelector('[aria-label="Message navigation"]').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }))`);
      }
    }
    await evaluate('window.setModel("claude-opus-5-5")');
    await evaluate('window.setDraft("")');
    await waitFor('!!document.querySelector("[aria-label=\\"Fast mode\\"]")');
    assert.equal(await evaluate('document.querySelector("[aria-label=\\"Fast mode\\"]").getAttribute("aria-pressed")'), "false");
    await evaluate('document.querySelector("[aria-label=\\"Fast mode\\"]").click()');
    await waitFor('document.querySelector("[aria-label=\\"Fast mode\\"]").getAttribute("aria-pressed") === "true"');
    await evaluate('window.setDraft("short")');
    await waitFor('document.querySelector("textarea[aria-label=\\"Prompt\\"]").value === "short"');
    const compactTop = await evaluate('document.querySelector("textarea[aria-label=\\"Prompt\\"]").getBoundingClientRect().top');
    await evaluate(`window.setDraft(${JSON.stringify("A longer prompt ".repeat(50))})`);
    await waitFor('document.querySelector("textarea[aria-label=\\"Prompt\\"]").getBoundingClientRect().top < ' + compactTop);
    await evaluate('window.setDraft("")');
    await waitFor('document.querySelector("textarea[aria-label=\\"Prompt\\"]").getBoundingClientRect().top === ' + compactTop);
    await evaluate('window.setModel("claude-sonnet-5-5")');
    await waitFor('!document.querySelector("[aria-label=\\"Fast mode\\"]")');
    console.log("PASS: conflict pill placement, click action, disabled state, and removal");
    console.log("PASS: fast mode appears only for supported Opus models and the prompt expands on wrapping");
    console.log("PASS: message previews stay inside the conversation and above the prompt");
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
      name: "chat-layout-fixture",
      resolveId(id) { if (id === "/__chat_layout_fixture.tsx") return id; },
      load(id) { if (id === "/__chat_layout_fixture.tsx") return fixture; },
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__chat_layout__") return next();
          const html = await server.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__chat_layout_fixture.tsx"></script></body></html>');
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__chat_layout__`], { env, stdio: "inherit" });
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
