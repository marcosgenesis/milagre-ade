// Runs the real main process, preload, and built renderer against temporary legacy-format data.
// npm run build && npm run test:desktop [-- --packaged release/mac-arm64/Milagre.app]
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");

async function waitFor(read, description) {
  for (let i = 0; i < 400; i++) {
    const value = await read();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const reply = JSON.parse(data);
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    clearTimeout(request.timeout);
    if (reply.error) request.reject(new Error(reply.error.message));
    else request.resolve(reply.result);
  });
  return {
    close: () => socket.close(),
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}`)); }, 20000);
        pending.set(requestId, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
  };
}

async function checkApp({ executable, args, profile, project, expectTheme, expectStartupError = false, recoverOwnership }) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.MILAGRE_DEV_SERVER_URL = pathToFileURL(path.join(root, "apps/desktop/dist/index.html")).href;
  // The packaged app's updater must not download/install a newer release during this check.
  const child = spawn(executable, [...args, `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--proxy-server=http://127.0.0.1:9"], {
    cwd: project, env, stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let output = "";
  let debuggerPort;
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
    output = (output + data.toString()).slice(-20000);
    debuggerPort ??= output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
  });
  let connection;
  try {
    await waitFor(() => {
      assert.equal(child.exitCode, null, output);
      return debuggerPort;
    }, "Electron debugger");
    const page = await waitFor(async () => {
      const pages = await fetch(`http://127.0.0.1:${debuggerPort}/json/list`).then(response => response.json());
      return pages.find(page => page.type === "page" && page.url.startsWith("file:"));
    }, "desktop page");
    connection = await connect(page.webSocketDebuggerUrl);
    const evaluate = async expression => {
      const result = await connection.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    if (expectStartupError) {
      await waitFor(() => evaluate('document.body?.textContent.includes("already owned") && !!document.querySelector("[data-startup-error]")'), "actionable ownership error");
      assert.ok(await evaluate('[...document.querySelectorAll("button")].some(button => button.textContent.includes("Open another project"))'));
      if (process.env.MILAGRE_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
        const shot = await connection.call("Page.captureScreenshot");
        await fs.writeFile(path.join(process.env.MILAGRE_SCREENSHOT_DIR, "project-owned.png"), Buffer.from(shot.data, "base64"));
      }
      await recoverOwnership();
      await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent === "Retry").click()');
      await waitFor(() => evaluate('document.body?.textContent.includes("Saved chat") && !document.querySelector("[data-startup-error]")'), "retry after releasing ownership");
      console.log("PASS: a Project owned by another runtime shows an error and Retry opens its saved Chat after ownership is released");
      return;
    }
    await waitFor(() => evaluate('Boolean(window.milagre && document.body?.textContent.includes("Saved chat"))'), "saved Chat in the real UI");
    const current = await evaluate("window.milagre.getCurrentProject()");
    assert.equal(current.path, project);
    assert.equal(current.state.sessions[2].title, "Saved chat");
    assert.equal(current.state.sessions[2].native_session_id, "existing-provider-session");
    assert.equal(current.state.sessions[4].handoverDraft, "# Existing handover brief");
    assert.equal(current.state.messages[0].body, "Existing conversation survives the move.");
    const settings = await evaluate(`window.milagre.readWorktreeSetup(${JSON.stringify(project)})`);
    assert.equal(settings.setupCommand, "npm ci");
    assert.equal(settings.source, "setting");
    const skills = await evaluate(`window.milagre.listSkills(${JSON.stringify(project)})`);
    assert.ok(JSON.stringify(skills).includes("tldr"), "Bundled skills resolve after relocation");
    assert.equal(typeof await evaluate("window.milagre.getAppVersion()"), "string");
    if (expectTheme) assert.equal(await evaluate('document.documentElement.classList.contains("dark")'), true, "Existing UI settings survive a restart/package change");
    await evaluate('localStorage.setItem("milagre-settings", JSON.stringify({theme:"dark",defaultPermissionMode:"ask",notifyWhenWaiting:false,notifyOnCompletion:false,showDockBadge:false}));');
    await connection.call("Page.reload");
    await waitFor(() => evaluate('document.documentElement?.classList.contains("dark")'), "saved theme after reload");
    if (process.env.MILAGRE_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.MILAGRE_SCREENSHOT_DIR, { recursive: true });
      const shot = await connection.call("Page.captureScreenshot");
      await fs.writeFile(path.join(process.env.MILAGRE_SCREENSHOT_DIR, expectTheme ? "packaged-desktop.png" : "desktop.png"), Buffer.from(shot.data, "base64"));
    }
    console.log(`PASS: ${expectTheme ? "packaged" : "source"} desktop opens existing Chats, provider IDs, Project settings, bundled skills and saved UI preferences`);
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    connection?.close();
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
    await exited;
    clearTimeout(timeout);
  }
}

async function main() {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "milagre-desktop-")));
  try {
    const project = path.join(temporary, "project");
    const profile = path.join(temporary, "profile");
    await fs.mkdir(path.join(project, ".milagre"), { recursive: true });
    await fs.mkdir(profile);
    execFileSync("git", ["init", "-b", "main", project], { stdio: "ignore" });
    execFileSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture"], { stdio: "ignore" });
    const state = {
      next_id: 5, projects: { 1: { id: 1, name: "project" } },
      worktrees: { 1: { id: 1, project_id: 1, path: project, name: "main" } },
      sessions: {
        2: { id: 2, worktree_id: 1, agent_name: "main", title: "Saved chat", status: "Stopped", provider: "codex", native_session_id: "existing-provider-session" },
        4: { id: 4, worktree_id: 1, agent_name: "main", status: "Created", provider: "claude", handedOverFrom: 2, handoverDraft: "# Existing handover brief" },
      },
      messages: [{ id: 3, session_id: 2, role: "user", body: "Existing conversation survives the move.", context: null }],
      connections: {}, events: [], approvals: [], tasks: {}, artifacts: {}, outputs: [], conflicts: [],
    };
    await fs.writeFile(path.join(project, ".milagre/coordination.json"), JSON.stringify(state));
    await fs.writeFile(path.join(profile, "recent-projects.json"), JSON.stringify([{ path: project, name: "project", openedAt: "2026-10-01T00:00:00.000Z" }]));
    await fs.writeFile(path.join(profile, "project-settings.json"), JSON.stringify({ projects: { [project]: { setupCommand: "npm ci", filesToCopy: [".env"] } } }));
    await checkApp({ executable: require("electron"), args: [path.join(root, "apps/desktop")], profile, project, expectTheme: false });
    const packagedIndex = process.argv.indexOf("--packaged");
    if (packagedIndex !== -1) {
      assert.ok(process.argv[packagedIndex + 1], "Pass the packaged .app path after --packaged");
      const bundle = path.resolve(process.argv[packagedIndex + 1]);
      await checkApp({ executable: path.join(bundle, "Contents/MacOS/Milagre"), args: [], profile, project, expectTheme: true });
    }
    const { acquireOwnership } = require("@milagre/core/ownership");
    const owner = acquireOwnership(path.join(project, ".milagre/runtime.lock"));
    try {
      await checkApp({ executable: require("electron"), args: [path.join(root, "apps/desktop")], profile, project, expectStartupError: true, recoverOwnership: () => owner.release() });
    } finally { owner.release(); }
    const saved = JSON.parse(await fs.readFile(path.join(project, ".milagre/coordination.json"), "utf8"));
    assert.deepEqual(saved.messages, state.messages, "Launching and quitting must preserve the transcript");
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
