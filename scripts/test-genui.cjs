// Run with node scripts/test-genui.cjs. Checks that an `openui` fence in a reply renders as native UI inside the
// answer, that a button in it sends its message once as the next user message, that a broken block falls back to
// a code block, and that an open fence while the reply streams builds up with its buttons disabled.
// Set MILAGRE_SCREENSHOT_DIR to keep screenshots.
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const block = `\`\`\`openui
root = Stack([title, summary, prs, note, done, bars, actions])
title = Heading("Three PRs are waiting on you")
summary = KeyValue([["Open", "3"], ["Failing CI", "1"], ["Oldest", "4 days"]])
prs = Table(["PR", "Author", "CI"], [["#403 Worktree link line", "victor", "green"], ["#390 Sidebar Links", "victor", "red"], ["#377 Issue sheet font", "victor"]])
note = Callout("#390 needs a rebase before its CI can pass.", "warning", "One is red")
done = Progress("Review", 0.66)
bars = BarChart(["Mon", "Tue", "Wed"], [3, 5, 2], "PRs opened")
actions = Stack([approve, later], "row")
approve = Button("Merge the green ones", Action([@ToAssistant("Merge the PRs whose CI is green")]))
later = Button("Later", Action([@ToAssistant("Not now")]), "secondary")
\`\`\``;
const broken = "```openui\nthis is not a program\n```";
const partial =
  'Here is the summary so far.\n\n```openui\nroot = Stack([title, approve])\ntitle = Heading("Streaming")\napprove = Button("Go", Action([@ToAssistant("Go")]))\n';

const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "/src/components/ChatComposer";
import { MODEL_CATALOG, capabilityFor } from "/src/model";
import "/src/styles.css";
const noop = () => {};
window.milagre = { listEditors: async () => [] };
window.sent = [];
window.failNext = false;
function Fixture() {
  const [said, setSaid] = useState([]);
  const [streaming, setStreaming] = useState(false);
  window.setStreaming = setStreaming;
  const onSendDesignMessage = async (text) => {
    if (window.failNext) { window.failNext = false; return false; }
    window.sent.push(text); setSaid((current) => [...current, text]); return true;
  };
  const messages = [
    { id: 1, session_id: 1, context: null, role: "user", body: "what's waiting on me?" },
    { id: 2, session_id: 1, context: null, role: "assistant", body: "Three PRs.\\n\\n" + ${JSON.stringify(block)} + "\\n\\nAnd a block that is not valid:\\n\\n" + ${JSON.stringify(broken)}, steps: [] },
    ...said.map((body, index) => ({ id: 10 + index, session_id: 1, context: null, role: "user", body })),
  ];
  return <div style={{ height: "100%", padding: 12 }}>
    <ChatComposer messages={messages} onSendDesignMessage={onSendDesignMessage}
      imageDraft={{ images: [], files: [], attachFiles: noop, attachPath: noop, removeFile: noop, loading: false, error: "", onPaste: noop, clear: noop, remove: noop }}
      projectPath="/fixture" messageScope="/fixture" agentChatId="/fixture#1" draft="" onDraftChange={noop} onSend={noop} isSending={streaming} sendBlocked={false}
      streamingText={streaming ? ${JSON.stringify(partial)} : ""} asking={false}
      models={MODEL_CATALOG} cliStatus={null} onModelPickerOpen={noop} selectedModel={MODEL_CATALOG[0]} onModelChange={noop}
      capability={capabilityFor(MODEL_CATALOG[0], null)} onEffortChange={noop} ultracode={false} onUltracodeChange={noop}
      fastMode={false} onFastModeChange={noop} permissionMode="auto" onPermissionModeChange={noop}
      onRecommendationSelect={noop} worktrees={[]} onWorktreeChange={noop}
      isolation="local" onIsolationChange={noop} branches={[]} baseBranch="main" onBaseBranchChange={noop} newChatError={null} />
  </div>;
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(<Fixture />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", require("node:fs").mkdtempSync(path.join(require("node:os").tmpdir(), "milagre-genui-")));
  await app.whenReady();
  const window = new BrowserWindow({ width: 1000, height: 900, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
  window.webContents.on("console-message", (details) => {
    if (details.level === "error") console.error(details.message);
  });
  // A failing script names itself: Electron's own error says only that one failed.
  const evaluate = (source) =>
    window.webContents.executeJavaScript(source).catch((error) => {
      throw new Error(`${error.message}\n  in: ${source.slice(0, 300)}`);
    });
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
  try {
    await window.loadURL(process.argv[2]);
    const blocks = 'document.querySelectorAll("[data-slot=genui]")';
    const buttons = `${blocks}[0].querySelectorAll("[data-slot=genui-button]")`;
    await waitFor(`${blocks}.length === 1 && ${blocks}[0].querySelectorAll("[data-slot=genui-table] tbody tr").length === 3`);
    // The block is inside the answer, not folded into the activity, and every component drew.
    assert.equal(await evaluate(`!!${blocks}[0].closest("[data-slot=message-content]")`), true);
    const text = await evaluate(`${blocks}[0].textContent`);
    for (const expected of ["Three PRs are waiting on you", "Failing CI", "#403 Worktree link line", "One is red", "Review", "66%", "PRs opened"])
      assert.match(text, new RegExp(expected));
    // A short row is padded: the third row has three cells, the last one empty.
    assert.deepEqual(await evaluate(`[...${blocks}[0].querySelectorAll("tbody tr")[2].cells].map((c) => c.textContent)`), [
      "#377 Issue sheet font",
      "victor",
      "",
    ]);
    assert.equal(await evaluate(`${blocks}[0].querySelectorAll("[data-slot=genui-chart] rect").length`), 3);
    // The broken block is a code block, with its text intact.
    assert.match(await evaluate('[...document.querySelectorAll("pre")].map((p) => p.textContent).join("|")'), /this is not a program/);
    await evaluate(`${blocks}[0].scrollIntoView()`);
    await screenshot("block");

    // A tap sends the button's message once, as the next user message; a double tap does not send twice.
    await evaluate(`${buttons}[0].click(); ${buttons}[0].click()`);
    await waitFor("window.sent.length >= 1");
    await delay(300);
    assert.deepEqual(await evaluate("window.sent"), ["Merge the PRs whose CI is green"]);
    await waitFor('[...document.querySelectorAll("[data-slot=message][data-from=user]")].at(-1)?.textContent.includes("Merge the PRs whose CI is green")');
    await screenshot("sent");
    // A failed send re-enables the button; the next tap goes through.
    await evaluate("window.failNext = true");
    await evaluate(`${buttons}[1].click()`);
    await delay(300);
    assert.equal(await evaluate(`${buttons}[1].disabled`), false);
    await evaluate(`${buttons}[1].click()`);
    await waitFor("window.sent.length === 2");
    assert.deepEqual(await evaluate("window.sent"), ["Merge the PRs whose CI is green", "Not now"]);

    // While the reply streams, an open fence builds up as UI with its buttons disabled, never as a code block.
    await evaluate("window.setStreaming(true)");
    await waitFor(`${blocks}.length === 2 && ${blocks}[1].textContent.includes("Streaming")`);
    assert.equal(await evaluate(`${blocks}[1].querySelector("[data-slot=genui-button]").disabled`), true);
    assert.equal(await evaluate(`${blocks}[1].querySelector("pre")`), null);
    await evaluate(`${blocks}[1].scrollIntoView()`);
    await screenshot("streaming");
    await evaluate("window.setStreaming(false)");
    console.log(
      "PASS: an openui fence in a reply draws as native UI inside the answer, a button sends its message once as the next user message and comes back after a failed send, a block without a root stays a code block, and an open fence while the reply streams builds up as UI with its buttons disabled",
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
        name: "genui-fixture",
        resolveId(id) {
          if (id === "/__genui_fixture.tsx") return id;
        },
        load(id) {
          if (id === "/__genui_fixture.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__genui__") return next();
            const html = await server.transformIndexHtml(
              request.url,
              '<html><body><div id="root"></div><script type="module" src="/__genui_fixture.tsx"></script></body></html>',
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__genui__`], { env, stdio: "inherit" });
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
