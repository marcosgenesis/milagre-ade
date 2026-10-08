// Browser check: with the Experimental "Every project in the sidebar" on, the sidebar lists each recent Project and
// Link with its chats, leaves out a hidden Project, marks exactly one open scope, shows each scope's ⋯ menu and New chat
// label, pins and folds groups, opens another Project's chat and follows its live updates. Off, the project menu is
// back on top. No agent calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import SidebarNav from "/src/components/SidebarNav";
import { updateSettings } from "/src/lib/settings";
import "/src/styles.css";
const chat = (id, body) => ({
  sessions: { [id]: { id, worktree_id: 1, agent_name: "Claude", status: "Idle" } },
  worktrees: { 1: { id: 1, name: "main", path: "/work/x" } },
  messages: [{ id, session_id: id, role: "user", body }],
});
const listeners = [];
window.milagre = {
  listRecentProjects: async () => [
    { path: "/work/arketa", name: "arketa" },
    { path: "/work/shop", name: "shop" },
    { path: "/work/api", name: "api", hidden: true },
  ],
  listProjects: async () => [{ id: "p-shop", path: "/work/shop", name: "shop" }, { id: "p-api", path: "/work/api", name: "api" }],
  listNamedLinks: async () => [{ id: "6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7", name: "Checkout", projectIds: ["p-shop", "p-api"] }],
  getProjectImage: async () => null,
  listEditors: async () => [],
  readProject: async (path) => ({ path, name: path, state: chat(7, "Shop chat") }),
  readLink: async (id) => ({
    link: { id },
    state: {
      next_id: 4,
      sessions: { 3: { id: 3, agent_name: "Checkout", status: "Idle", workspacePath: "/w", worktrees: [{}, {}] } },
      messages: [{ id: 3, session_id: 3, role: "user", body: "Shared checkout chat" }],
      preparations: {},
    },
  }),
  onProjectState: (callback) => (listeners.push(callback), () => {}),
  onLinkState: () => () => {},
  patchChat: async (scope, id, patch) => {
    window.patched = [scope, id, patch];
    if (scope === "/work/shop") window.pushShop({ ...chat(7, "Shop chat"), sessions: { 7: { id: 7, worktree_id: 1, agent_name: "Claude", status: "Idle", ...patch } } });
  },
};
window.pushShop = (state) => listeners.forEach((callback) => callback({ path: "/work/shop", state }));
window.showAll = (sidebarAllProjects) => updateSettings({ sidebarAllProjects });
localStorage.removeItem("milagre.sidebarClosedScopes");
updateSettings({ sidebarAllProjects: true });
createRoot(document.getElementById("root")).render(
  <div style={{ display: "flex", height: "100vh", padding: "60px 12px 12px" }}>
    <SidebarNav fill workspaceName="arketa" projectPath="/work/arketa" recents={[{ id: "1", label: "Fix the login flow" }]} activeId="1"
      runningKeys={"/work/shop#7\\nmilagre-link:6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7#3"} waitingKeys="milagre-link:6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7#3" onOpenScopeChat={(key, id) => { window.opened = key + "#" + id; }} />
  </div>,
);
`;

async function browserChecks() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const window = new BrowserWindow({ width: 1280, height: 640, show: false, webPreferences: { backgroundThrottling: false } });
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  const errors = [];
  window.webContents.on("console-message", (details) => {
    if (details.level === "error") errors.push(details.message);
  });
  const waitFor = async (source) => {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw new Error(`Timed out: ${source}`);
  };
  const screenshot = async (name) => {
    if (!process.env.MILAGRE_SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
    await delay(300);
    fs.writeFileSync(path.join(process.env.MILAGRE_SCREENSHOT_DIR, name + ".png"), (await window.webContents.capturePage()).toPNG());
  };
  const click = async (selector) => {
    const point = await evaluate(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
    );
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    await delay(200);
  };
  // Other checks share this storage: leave the sidebar as they expect it.
  const reset = () => evaluate(`window.showAll?.(false); localStorage.removeItem("milagre.sidebarClosedScopes")`).catch(() => {});
  const scopes = () => evaluate(`[...document.querySelectorAll("[data-sidebar-scope]")].map((node) => node.dataset.sidebarScope)`);
  const chats = (scope) => evaluate(`[...document.querySelectorAll('[data-sidebar-scope="${scope}"] [data-chat-id]')].map((node) => node.textContent.trim())`);
  try {
    await window.loadURL(process.argv[2]);
    await waitFor(`!!document.querySelector('[data-sidebar-scope="milagre-link:6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7"] [data-chat-id]')`);
    await waitFor(`!!document.querySelector('[data-sidebar-scope="/work/shop"] [data-chat-id]')`);
    assert.deepEqual(
      await scopes(),
      ["/work/arketa", "/work/shop", "milagre-link:6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7"],
      "Every Project and Link but the hidden one",
    );
    assert.match((await chats("/work/arketa"))[0], /Fix the login flow/);
    assert.match((await chats("/work/shop"))[0], /Shop chat/);
    assert.equal(
      await evaluate(`(() => {
        const arc = document.querySelector('[data-sidebar-scope="/work/shop"] [data-mark="running"] circle:last-child');
        const expected = document.createElement('span');
        expected.style.color = 'var(--accent)';
        document.body.append(expected);
        const matches = !!arc && getComputedStyle(arc).stroke === getComputedStyle(expected).color;
        expected.remove();
        return matches;
      })()`),
      true,
      "Running Chats use the accent color, as on mobile",
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-sidebar-scope="milagre-link:6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7"] [data-chat-id="3"] [data-mark]')?.dataset.mark`,
      ),
      "waiting",
      "A Link chat waiting on the user shows the mark",
    );
    assert.match((await chats("milagre-link:6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7"))[0], /Shared checkout chat/);
    assert.equal(
      await evaluate(`(() => {
        const header = document.querySelector('[data-sidebar-scope="milagre-link:6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7"] [data-scope-toggle]');
        const avatars = [...header.querySelectorAll('[aria-hidden] > span')].map((node) => node.getBoundingClientRect());
        const project = document.querySelector('[data-sidebar-scope="/work/shop"] [data-scope-toggle] span span').getBoundingClientRect();
        return avatars.length === 2 && Math.abs(Math.min(...avatars.map((rect) => rect.left)) - project.left) < 0.5 &&
          Math.max(...avatars.map((rect) => rect.right)) <= header.querySelector('[data-scope-name]').getBoundingClientRect().left;
      })()`),
      true,
      "A Link's stacked avatars start on the Projects' icon line and end before its name",
    );
    await screenshot("all-projects");

    // One open scope; the others offer New chat in <name>; only a Project's ⋯ menu on a non-current scope has Remove.
    assert.equal(await evaluate(`document.querySelectorAll("[data-sidebar-scope][data-current]").length`), 1, "Exactly one scope is open");
    assert.equal(await evaluate(`document.querySelector('[data-sidebar-scope="/work/arketa"]')?.hasAttribute("data-current")`), true);
    assert.equal(await evaluate(`document.querySelector('[data-sidebar-scope="/work/arketa"] [data-scope-action]')?.getAttribute("aria-label")`), "New chat");
    assert.equal(
      await evaluate(`document.querySelector('[data-sidebar-scope="/work/shop"] [data-scope-action]')?.getAttribute("aria-label")`),
      "New chat in shop",
    );

    await evaluate(`document.querySelector('[data-sidebar-scope="/work/shop"] [data-scope-menu]').click()`);
    await waitFor(`!!document.querySelector("[data-scope-menu-panel]")`);
    assert.equal(
      await evaluate(`!!document.querySelector('[data-scope-menu-panel] [data-scope-menu-item="remove"]')`),
      true,
      "A non-current Project's menu offers Remove",
    );
    await screenshot("scope-menu");
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await waitFor(`!document.querySelector("[data-scope-menu-panel]")`);

    await evaluate(`document.querySelector('[data-sidebar-scope="/work/arketa"] [data-scope-menu]').click()`);
    await waitFor(`!!document.querySelector("[data-scope-menu-panel]")`);
    assert.equal(
      await evaluate(`!!document.querySelector('[data-scope-menu-panel] [data-scope-menu-item="remove"]')`),
      false,
      "The open Project's menu has no Remove",
    );
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await waitFor(`!document.querySelector("[data-scope-menu-panel]")`);

    await click('[data-sidebar-scope="/work/shop"] [data-chat-id] [data-row]');
    assert.equal(await evaluate("window.opened"), "/work/shop#7", "Another Project's chat opens through onOpenScopeChat");

    // Another Project's chat pins from its row menu and moves to the Pinned section on top of every group.
    await evaluate(`document.querySelector('[data-sidebar-scope="/work/shop"] [data-chat-id="7"] [aria-label="Chat actions"]').click()`);
    await waitFor(`!!document.querySelector("[data-chat-menu]")`);
    await evaluate(`[...document.querySelectorAll("[data-chat-menu] [data-menu-row]")].find((row) => row.textContent.trim() === "Pin").click()`);
    assert.deepEqual(await evaluate("window.patched"), ["/work/shop", 7, { pinned: true, pin_order: 0 }]);
    await waitFor(`!!document.querySelector('[data-all-pinned] [data-pinned-scope="/work/shop"] [data-chat-id="7"]')`);
    assert.equal(
      await evaluate(
        `document.querySelector("[data-all-pinned]").compareDocumentPosition(document.querySelector('[data-sidebar-scope]')) & Node.DOCUMENT_POSITION_FOLLOWING`,
      ),
      4,
      "Pinned comes before the first group",
    );
    assert.deepEqual(await chats("/work/shop"), [], "The pinned chat leaves its group");
    await screenshot("pinned-other-project");

    await evaluate(
      `window.pushShop({ sessions: { 7: { id: 7, worktree_id: 1, agent_name: "Claude", status: "Idle", pinned: true, pin_order: 0 }, 8: { id: 8, worktree_id: 1, agent_name: "Claude", status: "Idle" } }, worktrees: {}, messages: [{ id: 7, session_id: 7, role: "user", body: "Shop chat" }, { id: 8, session_id: 8, role: "user", body: "New from the phone" }] })`,
    );
    await waitFor(`document.querySelectorAll('[data-sidebar-scope="/work/shop"] [data-chat-id]').length === 1`);

    await click('[data-sidebar-scope="/work/shop"] [data-scope-toggle]');
    assert.deepEqual(await chats("/work/shop"), [], "Folding a group hides its chats");
    assert.equal(await evaluate(`!!document.querySelector('[data-all-pinned] [data-chat-id="7"]')`), true, "Its pinned chat stays on top");
    assert.deepEqual(JSON.parse(await evaluate(`localStorage.getItem("milagre.sidebarClosedScopes")`)), ["/work/shop"]);
    await screenshot("folded");

    await evaluate("window.showAll(false)");
    await waitFor(`!document.querySelector("[data-sidebar-scope]")`);
    await screenshot("off");
    assert.match(await evaluate(`document.querySelector("[data-chat-id]").textContent`), /Fix the login flow/, "Off, only the open Project's chats");
    assert.equal(await evaluate(`!!document.querySelector("[data-workspace-trigger]")`), true, "Off, the project menu is back on top");
    assert.equal(await evaluate(`!!document.querySelector("[data-link-projects]")`), false, "Off, Link projects stays in that menu");
    assert.deepEqual(errors, []);
    await reset();
    console.log(
      "PASS: with the Experimental setting on, the sidebar lists each Project and Link with its chats, skips a hidden Project, marks one open scope, offers New chat per scope and Remove only on other Projects, pins chats to one Pinned section on top, opens them, marks Link chats waiting on the user, follows live changes, and folds groups; off, the old project menu returns",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    console.error(errors);
    await reset();
    app.exit(1);
  }
}

async function main() {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: path.resolve(__dirname, "../apps/desktop/vite.config.ts"),
    cacheDir: path.resolve(__dirname, "../node_modules/.vite-sidebar-all-projects"),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "sidebar-all-projects-fixture",
        resolveId(id) {
          if (id === "/__sidebar-all-projects.tsx") return id;
        },
        load(id) {
          if (id === "/__sidebar-all-projects.tsx") return fixture;
        },
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            if (request.url !== "/__sidebar-all-projects") return next();
            response.setHeader("Content-Type", "text/html");
            response.end(
              await server.transformIndexHtml(
                request.url,
                '<html><body><div id="root"></div><script type="module" src="/__sidebar-all-projects.tsx"></script></body></html>',
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
    const child = require("node:child_process").spawn(
      require("electron"),
      [path.resolve(__filename), `${server.resolvedUrls.local[0]}__sidebar-all-projects`],
      {
        env,
        stdio: "inherit",
      },
    );
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
  if (process.versions.electron) require("electron").app.exit(1);
  else process.exitCode = 1;
});
