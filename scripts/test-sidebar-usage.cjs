// Browser integration check using the app's existing Electron/Vite dependencies.
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SidebarUsage } from "/src/components/usage/SidebarUsage";
import { updateSettings } from "/src/lib/settings";
import "/src/styles.css";
const weekly = { id: "weekly", label: "Weekly", shortLabel: "wk", usedPercent: 96, resetsAt: null };
const session = { id: "session", label: "Session", shortLabel: "5h", usedPercent: 32, resetsAt: null };
window.setDisplay = usageDisplay => updateSettings({ usageDisplay });
function Fixture() {
  const [hasSession, setSession] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  window.setSession = setSession;
  window.setCollapsed = setCollapsed;
  const snapshot = { providers: [
    { provider: "claude", account: { id: "work", label: "Work" }, status: "ok", windows: [{ ...session, usedPercent: 0 }, { ...weekly, usedPercent: 82 }] },
    { provider: "codex", account: { id: "personal", label: "Personal", email: "victor@example.test" }, status: "ok", windows: hasSession ? [session, weekly] : [weekly], bankedResets: 3 },
    { provider: "antigravity", status: "unavailable", windows: [], message: "Google doesn't report Antigravity quota." },
  ] };
  return <aside className="bg-surface rounded-[8px]" data-sidebar-collapsed={collapsed} style={{ width: collapsed ? 44 : 224, padding: 8, margin: 24 }}>
    <SidebarUsage usage={{ snapshot, loading: false, refresh: async () => {}, refreshIfStale: () => {} }} />
  </aside>;
}
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")).render(<Fixture />);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const window = new BrowserWindow({ width: 320, height: 180, show: false, webPreferences: { backgroundThrottling: false } });
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  async function waitFor(source) {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw new Error(`Timed out: ${source}`);
  }
  const geometry = () =>
    evaluate(`(() => [...document.querySelectorAll('.sidebar-usage-row')].map(row =>
    [...row.querySelectorAll('.sidebar-copy .overflow-hidden')].map(bar => {
      const rect = bar.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, fill: bar.firstElementChild.style.width };
    })
  ))()`);
  const screenshot = async (name) => {
    await delay(350);
    const image = await window.webContents.capturePage();
    if (!process.env.MILAGRE_SCREENSHOT_DIR) return;
    require("node:fs").mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
    require("node:fs").writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, `${name}.png`), image.toPNG());
  };
  try {
    await window.loadURL(process.argv[2]);
    await waitFor('document.querySelectorAll(".sidebar-usage-row").length === 2');
    const [claude, codex] = await geometry();
    assert.equal(codex.length, 1);
    assert.equal(codex[0].width, 116, "Weekly-only meter spans both window columns");
    assert.equal(codex[0].left, claude[0].left);
    assert.equal(codex[0].right, claude[1].right);
    assert.equal(codex[0].fill, "96%", "Full-width track preserves actual usage");
    await screenshot("weekly-only-dark");
    await evaluate("window.setSession(true)");
    await waitFor('document.querySelectorAll(".sidebar-usage-row")[1].textContent.includes("5h")');
    const [twoClaude, twoCodex] = await geometry();
    assert.deepEqual(
      twoCodex.map(({ left, right, width }) => ({ left, right, width })),
      twoClaude.map(({ left, right, width }) => ({ left, right, width })),
    );
    assert.deepEqual(
      twoCodex.map((bar) => bar.width),
      [52, 52],
    );
    assert.deepEqual(
      twoCodex.map((bar) => bar.fill),
      ["32%", "96%"],
    );
    await screenshot("5h-dark");
    await evaluate('document.documentElement.classList.remove("dark")');
    await screenshot("5h-light");
    await evaluate('window.setSession(false); window.setDisplay("remaining")');
    await waitFor('document.querySelectorAll(".sidebar-usage-row")[1].textContent.includes("4%")');
    assert.equal((await geometry())[1][0].width, 116);
    assert.equal((await geometry())[1][0].fill, "4%");
    await evaluate('window.setDisplay("used")');
    await waitFor('document.querySelectorAll(".sidebar-usage-row")[1].textContent.includes("96%")');
    await screenshot("weekly-only-light");
    window.setContentSize(560, 420);
    await evaluate('document.querySelector("aside").style.marginTop = "300px"');
    const cardText = '(document.querySelector("[data-usage-card]")?.textContent ?? "")';
    await evaluate('document.querySelectorAll(".sidebar-usage-row")[1].click()');
    await waitFor(`${cardText}.includes("victor@example.test")`);
    assert.doesNotMatch(await evaluate(cardText), /Codex/);
    assert.match(await evaluate(cardText), /Banked resets3 left/);
    assert.equal(await evaluate('document.querySelector("[data-usage-account]").textContent'), "victor@example.test");
    assert.match(await evaluate('document.querySelectorAll(".sidebar-usage-row")[1].getAttribute("aria-label")'), /victor@example.test/);
    await screenshot("codex-card-banked");
    await evaluate('document.documentElement.classList.add("dark")');
    await screenshot("codex-account-dark");
    await evaluate('document.querySelectorAll(".sidebar-usage-row")[0].click()');
    await waitFor(`${cardText}.includes("Work")`);
    assert.doesNotMatch(await evaluate(cardText), /Claude/);
    assert.equal(await evaluate('document.querySelector("[data-usage-account]").textContent'), "Work");
    await screenshot("claude-account-name");
    assert.doesNotMatch(await evaluate(cardText), /Banked/, "No banked row when the account has none");
    await evaluate('document.querySelector("aside").style.marginTop = ""');
    await evaluate("window.setCollapsed(true)");
    await waitFor('document.querySelector("aside").dataset.sidebarCollapsed === "true"');
    assert.equal(await evaluate('getComputedStyle(document.querySelectorAll(".sidebar-usage-row")[1].querySelector(".sidebar-copy")).display'), "none");
    assert.equal(await evaluate('document.querySelectorAll(".sidebar-usage-rail")[1].firstElementChild.getBoundingClientRect().width'), 16);
    console.log(
      "PASS: weekly-only width, 5h column alignment, actual percentages, remaining mode, banked resets row, collapsed rail, account email and name fallback",
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
        name: "sidebar-usage-fixture",
        resolveId(id) {
          if (id === "/__sidebar_usage_fixture.tsx") return id;
        },
        load(id) {
          if (id === "/__sidebar_usage_fixture.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__sidebar_usage__") return next();
            const html = await server.transformIndexHtml(
              request.url,
              '<html><body><div id="root"></div><script type="module" src="/__sidebar_usage_fixture.tsx"></script></body></html>',
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
    const child = spawn(require("electron"), [path.resolve(__filename), `${server.resolvedUrls.local[0]}__sidebar_usage__`], { env, stdio: "inherit" });
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
