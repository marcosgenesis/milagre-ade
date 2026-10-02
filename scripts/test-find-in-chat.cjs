// Run with node scripts/test-find-in-chat.cjs. Mirrors test-subagents.cjs: Vite serves a ChatComposer fixture
// to an isolated Electron window (own port, throwaway profile). Set MILAGRE_SCREENSHOT_DIR to save screenshots.
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "/src/components/ChatComposer";
import { MODEL_CATALOG, capabilityFor } from "/src/model";
import "/src/styles.css";
const noop = () => {};
const filler = "The migration touches the session store and the reply renderer, so each step is checked against the fixtures before moving on. ".repeat(6);
const bodies = [
  "Please review the sidebar. Needle one lives in this request.",
  filler,
  "Reply with a needle in the middle of a sentence. " + filler,
  filler + " Another NEEDLE here and one more needle after it.",
  filler,
  "A closing line without the term, then a last needle.",
];
const messages = bodies.map((body, index) => ({ id: index + 1, session_id: 1, context: null, role: index % 2 ? "assistant" : "user", body }));
function Fixture() {
  const [findOpen, setFindOpen] = useState(false);
  const [findSignal, setFindSignal] = useState(0);
  const [draft, setDraft] = useState("");
  const [model] = useState(MODEL_CATALOG[0]);
  // Stands in for App's shortcut handler, which owns the find state in the real app.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); setFindOpen(true); setFindSignal((n) => n + 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <div style={{ height: "100%", padding: 12 }}>
    <ChatComposer messages={messages}
      imageDraft={{ images: [], files: [], attachFiles: noop, attachPath: noop, removeFile: noop, loading: false, error: "", onPaste: noop, clear: noop, remove: noop }}
      projectPath="/fixture" draft={draft} onDraftChange={setDraft} onSend={noop} isSending={false} sendBlocked={false} subagents={[]}
      models={MODEL_CATALOG} cliStatus={null} onModelPickerOpen={noop} selectedModel={model} onModelChange={noop}
      capability={capabilityFor(model, null)} onEffortChange={noop} ultracode={false} onUltracodeChange={noop}
      fastMode={false} onFastModeChange={noop} permissionMode="auto" onPermissionModeChange={noop}
      worktreeSummary="main" connectionSummary="No connection" eventsCount={0} firstWorktreeName="main"
      firstAgentRunning={false} secondAgentRunning={false} onToggleFirst={noop} onToggleSecond={noop}
      onCycleConnection={noop} onRecommendationSelect={noop} worktrees={[]} onWorktreeChange={noop}
      isolation="local" onIsolationChange={noop} branches={[]} baseBranch="main" onBaseBranchChange={noop} newChatError={null}
      findOpen={findOpen} findSignal={findSignal} onFindClose={() => setFindOpen(false)} />
  </div>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", require("node:fs").mkdtempSync(path.join(require("node:os").tmpdir(), "milagre-find-ui-")));
  await app.whenReady();
  const window = new BrowserWindow({ width: 900, height: 640, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  window.webContents.on("console-message", details => { if (details.level === "error") console.error(details.message); });
  const evaluate = async (source) => {
    try { return await window.webContents.executeJavaScript(source); }
    catch (error) { throw new Error(`${source}: ${error.message}`); }
  };
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
    throw new Error(`Timed out: ${source} (count: ${await evaluate('document.querySelector("[data-find-count]")?.textContent')})`);
  }
  const key = (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  const count = () => evaluate('document.querySelector("[data-find-count]")?.textContent ?? null');
  const activeTop = () => evaluate('(() => { const r = [...CSS.highlights.get("find-active")][0].getBoundingClientRect(); return Math.round(r.top); })()');
  const activeOffset = () => evaluate('(() => { const range = [...CSS.highlights.get("find-active")][0]; return range.startContainer.data.slice(0, range.startOffset).length + range.startContainer.data.length * 1000; })()');
  const inView = () => evaluate('(() => { const v = document.querySelector("section"); const vr = v.getBoundingClientRect(); const r = [...CSS.highlights.get("find-active")][0].getBoundingClientRect(); return r.top >= vr.top && r.bottom <= vr.bottom; })()');
  const setTheme = (dark) => evaluate(`document.documentElement.classList.toggle("dark", ${dark})`);
  try {
    await window.loadURL(process.argv[2]);
    await waitFor('!!document.querySelector("textarea[aria-label=Prompt]")');
    await evaluate('document.querySelector("textarea[aria-label=Prompt]").focus()');
    assert.equal(await evaluate('!!document.querySelector("[data-find-bar]")'), false);

    key("F", ["meta"]);
    await waitFor('document.activeElement === document.querySelector("[data-find-bar] input")');
    assert.equal(await count(), "");

    window.webContents.insertText("needle");
    await waitFor('document.querySelector("[data-find-count]").textContent === "1 of 5"');
    assert.equal(await evaluate('[...CSS.highlights.get("find-match")].length'), 5);
    assert.equal(await evaluate('CSS.highlights.get("find-active").size'), 1);
    // The query typed in the bar is not a match: the highlights live only in the message list.
    assert.equal(await evaluate('[...CSS.highlights.get("find-match")].every(range => !!range.startContainer.parentElement.closest(".chat-column"))'), true);
    assert.ok(await inView());
    await screenshot("find-light-first");

    const first = await activeOffset();
    key("Return");
    await waitFor('document.querySelector("[data-find-count]").textContent === "2 of 5"');
    assert.notEqual(await activeOffset(), first);
    assert.ok(await inView());
    key("Return");
    await waitFor('document.querySelector("[data-find-count]").textContent === "3 of 5"');
    assert.ok(await inView());
    const scrolled = await evaluate('document.querySelector("section").scrollTop');
    assert.ok(scrolled > 0, "next match scrolls the list");
    await screenshot("find-light-third");

    key("Return", ["shift"]);
    await waitFor('document.querySelector("[data-find-count]").textContent === "2 of 5"');
    key("G", ["meta"]);
    await waitFor('document.querySelector("[data-find-count]").textContent === "3 of 5"');
    key("G", ["meta", "shift"]);
    await waitFor('document.querySelector("[data-find-count]").textContent === "2 of 5"');
    // Previous from the first wraps to the last.
    key("Return", ["shift"]);
    key("Return", ["shift"]);
    await waitFor('document.querySelector("[data-find-count]").textContent === "5 of 5"');
    assert.ok(await inView());

    // Reopening with the bar open selects the field text.
    await evaluate('document.querySelector("textarea[aria-label=Prompt]").focus()');
    key("F", ["meta"]);
    await waitFor('document.activeElement === document.querySelector("[data-find-bar] input")');
    assert.equal(await evaluate('(() => { const i = document.querySelector("[data-find-bar] input"); return i.selectionStart === 0 && i.selectionEnd === i.value.length; })()'), true);

    await setTheme(true);
    await screenshot("find-dark");
    await setTheme(false);

    window.webContents.insertText("zzz");
    await waitFor('document.querySelector("[data-find-count]").textContent === "No results"');
    assert.equal(await evaluate('CSS.highlights.has("find-match") ? CSS.highlights.get("find-match").size : 0'), 0);
    await evaluate('document.querySelector("[data-find-bar] input").select()');
    window.webContents.insertText("needle");
    await waitFor('document.querySelector("[data-find-count]").textContent === "1 of 5"');

    key("Escape");
    await waitFor('!document.querySelector("[data-find-bar]")');
    assert.equal(await evaluate('CSS.highlights.size'), 0);
    assert.equal(await evaluate('document.activeElement === document.querySelector("textarea[aria-label=Prompt]")'), true);
    console.log("PASS: opens with the shortcut, live count, Enter and Shift+Enter step and scroll, wrap, reopen selects, Esc clears and restores focus");
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
      name: "find-fixture",
      resolveId(id) { if (id === "/__find_fixture.tsx") return id; },
      load(id) { if (id === "/__find_fixture.tsx") return fixture; },
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__find__") return next();
          const html = await server.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__find_fixture.tsx"></script></body></html>');
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__find__`], { env, stdio: "inherit" });
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
