// Real Electron checks for Linear issues on the Mac: the new-chat "Linear issue" picker, and the issue chip on a sidebar row.
// MILAGRE_SCREENSHOT_DIR saves images outside the repo.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/styles.css';
import { NewChatHeader } from '/src/components/ChatComposer';
import { ChatRow } from '/src/components/sidebar/ChatRow';
import { issueFirstMessage } from '@milagre/shared/linear';
const issues = [
  { key: 'ENG-1', title: 'Fix login redirect', url: 'https://linear.app/acme/issue/ENG-1', branchName: 'eng-1-fix-login-redirect', state: { name: 'In Progress', type: 'started', color: '#f2c94c' } },
  { key: 'ENG-2', title: 'Dark mode tokens', url: 'https://linear.app/acme/issue/ENG-2', branchName: 'eng-2-dark-mode-tokens', description: 'Share the palette.', state: { name: 'Backlog', type: 'backlog', color: '#8e8e93' } },
];
const linearOn = new URLSearchParams(location.search).get('linear') === 'on';
window.__queries = [];
window.milagre = {
  listLinearIssues: async (query) => {
    window.__queries.push(query ?? null);
    const search = (query ?? '').trim().toLowerCase();
    return { issues: issues.filter((issue) => !search || (issue.key + ' ' + issue.title).toLowerCase().includes(search)) };
  },
};
const worktrees = [{ id: 1, name: 'main', path: '/fixture' }];
// The app only fills linearIssue while Linear is on and connected; the fixture follows the same rule.
const row = { id: 'chat-1', label: 'Login redirect', mark: 'idle', details: { branch: 'eng-1-fix-login-redirect', path: '/worktrees/eng-1', linearIssue: linearOn ? issues[0] : undefined } };
const plainRow = { id: 'chat-2', label: 'No issue here', mark: 'idle', details: { branch: 'main', path: '/fixture' } };
function Fixture() {
  const [isolation, setIsolation] = useState('worktree');
  const [baseBranch, setBaseBranch] = useState('main');
  return (
    <div style={{ padding: 40, width: 760 }}>
      <NewChatHeader
        worktrees={worktrees}
        branches={['main']}
        isolation={isolation}
        onIsolationChange={setIsolation}
        baseBranch={baseBranch}
        onBaseBranchChange={setBaseBranch}
        selectedWorktreeId={1}
        onWorktreeChange={() => {}}
        linearActive={linearOn}
        onStartFromIssue={(issue) => {
          window.__started = { key: issue.key, body: issueFirstMessage(issue, 'Keep it small') };
        }}
      />
      <div style={{ marginTop: 24, width: 280 }}>
        <ChatRow item={row} active={false} collapsed={false} onPick={() => {}} actions={{}} />
        <ChatRow item={plainRow} active={false} collapsed={false} onPick={() => {}} actions={{}} />
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

async function checks(url) {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "milagre-linear-issues-")));
  await app.whenReady();
  const window = new BrowserWindow({ width: 900, height: 600, show: false, webPreferences: { backgroundThrottling: false } });
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  async function waitFor(source) {
    for (let n = 0; n < 200; n++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw new Error("Timed out: " + source);
  }
  const click = (name) => evaluate(`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(name)}).click()`);
  const type = (value) =>
    evaluate(
      `(() => { const input = document.querySelector('input[placeholder="Search issues"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
  async function screenshot(name) {
    if (!process.env.MILAGRE_SCREENSHOT_DIR) return;
    await delay(250);
    fs.mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, name + ".png"), (await window.webContents.capturePage()).toPNG());
  }
  const errors = [];
  window.webContents.on("console-message", (details) => {
    if (details.level === "error") errors.push(details.message);
  });
  try {
    // (b) Linear off: no Linear issue chip in the header; the sidebar row shows no issue chip either.
    await window.loadURL(url + "?linear=off");
    await waitFor(`!!document.querySelector('[data-new-chat-pickers]')`);
    assert.equal(
      await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Linear issue')`),
      false,
      "no chip while Linear is off",
    );
    assert.equal(await evaluate(`!!document.querySelector('[data-linear-issue-chip]')`), false, "no row chip without an issue");
    await window.loadURL(url + "?linear=on");
    await waitFor(`!!document.querySelector('[data-new-chat-pickers]')`);
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Linear issue')`);

    // (a) Linear on: the chip opens the issue list, typing filters through listLinearIssues, picking starts the chat.
    await click("Linear issue");
    await waitFor(`document.querySelectorAll('[data-linear-issue-row]').length === 2`);
    assert.equal(await evaluate(`!!document.querySelector('[data-linear-issue-row] [data-linear-logo]')`), true, "picker rows show Linear's mark");
    assert.equal(await evaluate(`document.body.textContent.includes('Start from a Linear issue')`), true, "the picker is titled");
    await screenshot("linear-issue-menu");
    await type("dark");
    await waitFor(`document.querySelectorAll('[data-linear-issue-row]').length === 1`);
    assert.ok(await evaluate(`window.__queries.includes('dark')`), "the typed query reaches listLinearIssues");
    assert.equal(await evaluate(`document.querySelector('[data-linear-issue-row]').textContent.includes('ENG-2 Dark mode tokens')`), true);
    await evaluate(`document.querySelector('[data-linear-issue-row] button').click()`);
    await waitFor(`!!window.__started`);
    assert.deepEqual(await evaluate(`window.__started`), {
      key: "ENG-2",
      body: "Work on Linear issue ENG-2: Dark mode tokens\n\nShare the palette.\n\nhttps://linear.app/acme/issue/ENG-2\n\nKeep it small",
    });
    await waitFor(`!document.querySelector('input[placeholder="Search issues"]')`);

    // (c) A sidebar row with a linked issue shows its chip, and the row without one shows none.
    await waitFor(`document.querySelector('[data-linear-issue-chip]')?.textContent === 'ENG-1 · In Progress'`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-linear-issue-chip]').length`), 1);
    assert.equal(await evaluate(`!!document.querySelector('[data-linear-issue-chip] [data-linear-logo]')`), true, "the row chip shows Linear's mark");
    await screenshot("linear-issue-chip");
    assert.deepEqual(errors, []);
    console.log("PASS: Linear issue picker starts a chat from an issue; the sidebar chip shows the issue; both hidden while Linear is off");
    app.exit(0);
  } catch (error) {
    console.error(error);
    console.error(errors);
    await screenshot("failure");
    app.exit(1);
  }
}

async function main() {
  const { createServer } = await import("vite");
  const { spawn } = require("node:child_process");
  const server = await createServer({
    configFile: path.resolve(__dirname, "../apps/desktop/vite.config.ts"),
    cacheDir: path.resolve(__dirname, "../node_modules/.vite-linear-issues"),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "linear-issues-fixture",
        enforce: "pre",
        transform(source, id) {
          if (id.endsWith("/components/ChatComposer.tsx")) return source + "\nexport { NewChatHeader };\n";
        },
        resolveId(id) {
          if (id === "/__linear_issues_fixture.tsx") return id;
        },
        load(id) {
          if (id === "/__linear_issues_fixture.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (!request.url.startsWith("/__linear-issues")) return next();
            response.setHeader("Content-Type", "text/html");
            response.end(
              await server.transformIndexHtml(
                request.url,
                '<html><body><div id="root"></div><script type="module" src="/__linear_issues_fixture.tsx"></script></body></html>',
              ),
            );
          });
        },
      },
    ],
  });
  try {
    await server.listen();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [__filename, server.resolvedUrls.local[0] + "__linear-issues"], { env, stdio: "inherit" });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await server.close();
  }
}
(process.versions.electron ? checks(process.argv[2]) : main()).catch((error) => {
  console.error(error);
  if (process.versions.electron) require("electron").app.exit(1);
  else process.exitCode = 1;
});
