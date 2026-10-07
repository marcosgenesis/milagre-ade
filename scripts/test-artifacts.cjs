// Run with node scripts/test-artifacts.cjs. Checks that a design an agent shows with artifact_show is a card in the
// reply, outside the folded activity, with a sandboxed preview that can't make requests of its own; that Open docks it
// beside the chat and the dock follows the agent's next revision; and that earlier versions and Escape work.
// Set MILAGRE_SCREENSHOT_DIR to keep screenshots.
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const design = (version, accent) => `<!doctype html><html><head><title>Login</title><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: #f4f1ec; display: grid; place-items: center; min-height: 100vh; }
  .card { width: 340px; background: white; border-radius: 18px; padding: 32px; box-shadow: 0 12px 40px #0001; }
  h1 { margin: 0 0 6px; font-size: 24px; } p { color: #6b6560; margin: 0 0 24px; }
  input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 10px; border: 1px solid #e3ded7; margin-bottom: 12px; font-size: 15px; }
  button { width: 100%; padding: 12px; border: 0; border-radius: 10px; color: white; font-size: 15px; font-weight: 600; background: ${accent}; }
</style></head><body><div class="card"><h1>Welcome back</h1><p>Version ${version} of the login screen</p>
<input placeholder="Email"><input placeholder="Password" type="password"><button>Sign in</button></div>
<script>fetch("https://example.com/collect").then(() => parent.postMessage({ request: "sent" }, "*"), () => parent.postMessage({ request: "blocked" }, "*"));</script>
</body></html>`;

const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "/src/components/ChatComposer";
import { MODEL_CATALOG, capabilityFor } from "/src/model";
import "/src/styles.css";
const noop = () => {};
const designs = { 1: ${JSON.stringify(design(1, "#8a7f74"))}, 2: ${JSON.stringify(design(2, "#2f6f4f"))}, 3: ${JSON.stringify(design(3, "#c2410c"))} };
window.requests = [];
window.calls = [];
window.addEventListener("message", (event) => event.data?.request && window.requests.push(event.data.request));
window.milagre = {
  listEditors: async () => [],
  artifacts: {
    get: async ({ chatId, id, version }) => {
      window.calls.push([chatId, id, version ?? null]);
      const latest = window.latest;
      const shown = version ?? latest;
      return { id, version: shown, title: shown === 1 ? "Login screen" : "Login screen, warmer", versions: latest, latest, html: designs[shown] };
    },
  },
};
window.latest = 2;
const step = (version, offset) => ({ id: "s" + version, kind: "artifact", title: "Showed \`Login screen\`", status: "done", offset, artifact: { id: "login", version, title: version === 1 ? "Login screen" : "Login screen, warmer" } });
function Fixture() {
  const [revised, setRevised] = useState(false);
  window.revise = () => { window.latest = 3; setRevised(true); };
  const messages = [
    { id: 1, session_id: 1, context: null, role: "user", body: "design a login screen" },
    { id: 2, session_id: 1, context: null, role: "assistant", body: "Here is a first pass.", steps: [step(1, 0)] },
    { id: 3, session_id: 1, context: null, role: "user", body: "warmer, please" },
    { id: 4, session_id: 1, context: null, role: "assistant", body: "Warmer greens.", steps: [step(2, 0)] },
    ...(revised ? [{ id: 5, session_id: 1, context: null, role: "assistant", body: "Orange accent.", steps: [step(3, 0)] }] : []),
  ];
  // The app's layout: the chat pane inside the workspace, beside a 260px sidebar.
  return <div style={{ display: "flex", height: "100%" }}><aside style={{ width: 260, flexShrink: 0 }} /><main data-workspace-main style={{ display: "flex", flex: 1, minWidth: 0, height: "100%" }}><div data-chat-pane style={{ flex: 1, minWidth: 0, height: "100%", padding: 12 }}>
    <ChatComposer messages={messages}
      imageDraft={{ images: [], files: [], attachFiles: noop, attachPath: noop, removeFile: noop, loading: false, error: "", onPaste: noop, clear: noop, remove: noop }}
      projectPath="/fixture" draft="" onDraftChange={noop} onSend={noop} isSending={false} sendBlocked={false}
      streamingText="" asking={false}
      models={MODEL_CATALOG} cliStatus={null} onModelPickerOpen={noop} selectedModel={MODEL_CATALOG[0]} onModelChange={noop}
      capability={capabilityFor(MODEL_CATALOG[0], null)} onEffortChange={noop} ultracode={false} onUltracodeChange={noop}
      fastMode={false} onFastModeChange={noop} permissionMode="auto" onPermissionModeChange={noop}
      onRecommendationSelect={noop} worktrees={[]} onWorktreeChange={noop}
      isolation="local" onIsolationChange={noop} branches={[]} baseBranch="main" onBaseBranchChange={noop} newChatError={null} />
  </div></main></div>;
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(<Fixture />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", require("node:fs").mkdtempSync(path.join(require("node:os").tmpdir(), "milagre-artifacts-")));
  await app.whenReady();
  const window = new BrowserWindow({ width: 1280, height: 820, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  window.webContents.on("console-message", (details) => {
    if (details.level === "error" && !/Content Security Policy|example\.com/.test(details.message)) console.error(details.message);
  });
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  async function screenshot(name) {
    if (!process.env.MILAGRE_SCREENSHOT_DIR) return;
    await delay(900);
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
  const cards = 'document.querySelectorAll("[data-slot=artifact-card]")';
  const dock = 'document.querySelector("[data-slot=artifact-dock]")';
  try {
    await window.loadURL(process.argv[2]);
    await waitFor(`${cards}.length === 2 && [...${cards}].every((card) => card.querySelector("iframe"))`);
    assert.equal(await evaluate(`[...${cards}].some((card) => card.closest("[data-slot=activity]"))`), false, "designs are not folded into the activity");
    assert.deepEqual(await evaluate("window.calls"), [
      ["/fixture#1", "login", 1],
      ["/fixture#1", "login", 2],
    ]);
    const frame = await evaluate(
      `(() => { const f = ${cards}[0].querySelector("iframe"); return { sandbox: f.getAttribute("sandbox"), csp: f.srcdoc.includes("Content-Security-Policy") }; })()`,
    );
    assert.deepEqual(frame, { sandbox: "allow-scripts", csp: true }, "the preview runs without same origin, under the policy");
    await waitFor("window.requests.length === 2");
    assert.deepEqual(await evaluate("window.requests"), ["blocked", "blocked"], "a design can't make requests of its own");
    assert.match(await evaluate(`${cards}[0].textContent`), /Login screen.*Version 1.*version 2 is newer/);
    await evaluate(`${cards}[1].scrollIntoView()`);
    await screenshot("card");

    // Open docks the newest design beside the chat, and the chat makes room for it.
    await evaluate(`${cards}[1].querySelector("button").click()`);
    await waitFor(`${dock}?.querySelector("iframe")`);
    assert.match(await evaluate(`${dock}.textContent`), /Login screen, warmer.*Version 2 of 2.*follows the agent's revisions/);
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--artifact-dock").trim()'), "572px");
    const layout = await evaluate(
      `(() => { const d = ${dock}.getBoundingClientRect(); const p = document.querySelector("[data-chat-pane]").getBoundingClientRect(); return { dock: d.left, pane: p.right, top: d.top }; })()`,
    );
    assert.ok(layout.pane <= layout.dock, "the chat ends where the design begins");
    assert.ok(layout.dock - 260 > 400, "the chat keeps its room: the workspace reserves the dock once, not again in the chat pane");
    assert.equal(layout.top, 40, "the design docks at the top right");
    await screenshot("docked");

    // A revision from the agent replaces what the dock shows, since it follows the newest.
    await evaluate("window.revise()");
    await waitFor(`/Version 3 of 3/.test(${dock}.textContent)`);
    await screenshot("revised");
    await evaluate(`${dock}.querySelector("[aria-label='Previous version']").click()`);
    await waitFor(`/Version 2 of 3/.test(${dock}.textContent) && !/follows/.test(${dock}.textContent)`);
    await screenshot("earlier-version");

    // The design can fill the workspace beside the sidebar, covering the chat, and go back beside it.
    await evaluate(`${dock}.querySelector("[aria-label='Fill the window with the design']").click()`);
    await waitFor(`${dock}.dataset.full === "true" && Math.round(${dock}.getBoundingClientRect().left) === 260`);
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--artifact-dock")'), "", "a full design reserves nothing");
    await screenshot("expanded");
    await evaluate(`${dock}.querySelector("[aria-label='Show the chat beside the design']").click()`);
    await waitFor(`!${dock}.dataset.full`);
    // Too narrow for a useful chat beside it, the design fills the workspace on its own.
    window.setContentSize(1100, 820);
    await waitFor(`${dock}.dataset.full === "true" && !${dock}.querySelector("[aria-label='Fill the window with the design']")`);
    await screenshot("narrow");
    window.setContentSize(1280, 820);
    await waitFor(`!${dock}.dataset.full`);

    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await waitFor(`!${dock}`);
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--artifact-dock")'), "", "closing gives the chat its width back");
    console.log(
      "PASS: a shown design is a card outside the activity with a sandboxed preview that can't make requests; Open docks it at the top right beside the chat (filling the workspace when expanded or when the window is narrow), the dock follows the agent's revision, steps back through versions and closes on Escape",
    );
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
        name: "artifacts-fixture",
        resolveId(id) {
          if (id === "/__artifacts_fixture.tsx") return id;
        },
        load(id) {
          if (id === "/__artifacts_fixture.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__artifacts__") return next();
            const html = await server.transformIndexHtml(
              request.url,
              '<html><body><div id="root"></div><script type="module" src="/__artifacts_fixture.tsx"></script></body></html>',
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__artifacts__`], { env, stdio: "inherit" });
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
