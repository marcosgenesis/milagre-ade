const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");

test("npm discovers the desktop and shared packages from the repository root", () => {
  const workspaces = JSON.parse(execFileSync("npm", ["query", ".workspace"], { cwd: root, encoding: "utf8" }));
  assert.deepEqual(workspaces.map(item => item.name).sort(), ["@milagre/core", "@milagre/daemon", "@milagre/mobile", "@milagre/relay", "@milagre/shared", "@milagre/site", "milagre"]);
});

test("Electron CommonJS and renderer imports share the same chat operations", async () => {
  const desktopRequire = createRequire(path.join(root, "apps/desktop/package.json"));
  const { chatTitle } = desktopRequire("@milagre/shared/chats");
  const { chatKey, projectOfKey, sessionIdFromKey } = desktopRequire("@milagre/shared/agent-runs");
  const { chatTitle: rendererTitle } = await import("../apps/desktop/app/src/lib/chat-list.ts");
  assert.equal(rendererTitle, chatTitle);
  assert.equal(chatTitle({ id: 7, agent_name: "main" }, [{ session_id: 7, role: "user", body: "Keep my existing chat" }]), "Keep my existing chat");
  const key = chatKey("/existing/project", 7);
  assert.equal(projectOfKey(key), "/existing/project");
  assert.equal(sessionIdFromKey(key), 7);
});

test("electron-builder retains desktop identity, update feed, output path and release version overrides", async () => {
  const { Packager } = require("app-builder-lib");
  const packager = new Packager({ projectDir: root, config: { extraMetadata: { version: "9.8.7" } } });
  await packager.validateConfig();
  assert.equal(packager.appDir, path.join(root, "apps/desktop"));
  const info = new (require("app-builder-lib/out/appInfo").AppInfo)(packager, null);
  assert.equal(info.name, "milagre");
  assert.equal(info.productName, "Milagre");
  assert.equal(info.id, "com.milagre.app");
  assert.equal(info.version, "9.8.7");
  assert.equal(path.resolve(root, packager.config.directories.output), path.join(root, "release"));
  assert.deepEqual(packager.config.publish, { provider: "github", owner: "the-ptf", repo: "milagre-ade", releaseType: "release" });
});
