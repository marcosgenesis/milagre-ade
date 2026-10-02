const { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");
const { decodeImages } = require("./image-input.cjs");
const { guardNavigation } = require("./links.cjs");
const { AttentionNotifier } = require("./notifications.cjs");
const { ClaudeSession } = require("./agents/claude-provider.cjs");
const { CodexSession } = require("./agents/codex-provider.cjs");
const { createCliCache } = require("./agents/cli.cjs");
const { loadLoginEnvironment } = require("./agents/environment.cjs");
const { createModelCache } = require("./agents/models.cjs");
const { SessionManager } = require("./agents/session-manager.cjs");
const { discoverSkills, expandSkillPrompt } = require("./skills.cjs");
const { createWorktree, listBranches } = require("./worktrees.cjs");
const { readDiffStat } = require("./diffstat.cjs");
const { reconcileState } = require("./project-state.cjs");
const { resolveProjectImage } = require("./project-image.cjs");
const { saveProjectState, stateFile } = require("./project-store.cjs");
const { createUsageReader } = require("./usage.cjs");

const execFileAsync = promisify(execFile);

const appIconPath = path.join(__dirname, "../app/public/logo-milagre-image.png");
let updateState = { status: "idle", version: null, progress: 0 };
// Opened from Finder or the Dock, the app has launchd's bare PATH. The login shell's environment is read
// once, in the background: windows open without waiting, and the first agent (and the usage lookup) waits for it.
const environmentReady = loadLoginEnvironment().then(({ source }) => {
  if (source === "fallback") console.warn("Milagre couldn't read your login shell's environment; looking for agents in common install folders.");
}, (error) => console.warn("Milagre couldn't read your login shell's environment:", error.message));
const readUsage = createUsageReader({ ready: () => environmentReady });

function publishUpdateState(nextState) {
  updateState = { ...updateState, ...nextState };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("update:state", updateState);
  }
}

async function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  publishUpdateState({ status: "checking" });
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo) publishUpdateState({ status: "up-to-date" });
  } catch (error) {
    console.warn("Milagre update check failed:", error.message);
    publishUpdateState({ status: "error" });
  }
}

ipcMain.handle("update:state", () => updateState);
ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());

async function discoverWorktrees(projectPath) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "worktree", "list", "--porcelain"], { encoding: "utf8" });
    return stdout
      .trim()
      .split(/\n(?=worktree )/)
      .filter(Boolean)
      .map((block) => {
        const worktreePath = block.match(/^worktree (.+)$/m)?.[1];
        const branchRef = block.match(/^branch (.+)$/m)?.[1];
        if (!worktreePath) return null;
        const branch = branchRef?.replace(/^refs\/heads\//, "");
        return { path: worktreePath, name: branch || path.basename(worktreePath) };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function readProject(projectPath) {
  const name = path.basename(projectPath) || "Untitled project";
  let storedState = null;
  try {
    const contents = await fs.readFile(stateFile(projectPath), "utf8");
    storedState = JSON.parse(contents);
  } catch {}
  const discoveredWorktrees = await discoverWorktrees(projectPath);
  const state = reconcileState(storedState, name, discoveredWorktrees);
  if (storedState && JSON.stringify(storedState) !== JSON.stringify(state)) await saveProjectState(projectPath, state);
  return { path: projectPath, name, state };
}

ipcMain.handle("skills:list", (_event, projectPath) => discoverSkills(projectPath));
ipcMain.handle("project:branches", (_event, projectPath) => listBranches(projectPath));
ipcMain.handle("project:image", (_event, projectPath) => resolveProjectImage(projectPath));
// Packaged builds get their release version from electron-builder metadata, not the source package.json.
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("worktree:create", async (_event, request) => {
  const created = await createWorktree(request);
  const project = await readProject(request.projectPath);
  const listed = Object.values(project.state.worktrees).find((item) => item.name === created.branch);
  if (!listed) throw new Error(`Created ${created.branch}, but git did not list it as a worktree.`);
  const worktree = { ...listed, base: created.base };
  project.state.worktrees[worktree.id] = worktree;
  await saveProjectState(request.projectPath, project.state);
  return { project, worktreeId: worktree.id };
});
ipcMain.handle("worktree:diffstat", (_event, worktreePath, base) => readDiffStat(worktreePath, base));
// Only a git checkout's top folder opens, so the renderer can't open arbitrary paths.
ipcMain.handle("worktree:reveal", async (_event, worktreePath) => {
  const { stdout } = await execFileAsync("git", ["-C", worktreePath, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if ((await fs.realpath(stdout.trim())) !== (await fs.realpath(worktreePath))) throw new Error(`${worktreePath} is not a worktree.`);
  const error = await shell.openPath(worktreePath);
  if (error) throw new Error(error);
});

// Brings the window back from a notification click and opens the chat it was about.
function openChatFromNotification(chatId) {
  const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  if (process.platform === "darwin") app.focus({ steal: true });
  window.focus();
  window.webContents.send("notification:open-chat", chatId);
}

const notifier = new AttentionNotifier({
  createNotification: ({ title, subtitle, body }) => new Notification({ title, body, ...(subtitle ? { subtitle } : {}) }),
  isAppFocused: () => Boolean(BrowserWindow.getFocusedWindow()),
  openChat: openChatFromNotification,
});

ipcMain.handle("notification:attention", (_event, notice) => (Notification.isSupported() ? notifier.notify(notice) : false));

const agents = new SessionManager({
  createSession: (provider, options) => (provider === "codex"
    ? new CodexSession({ ...options, clientVersion: app.getVersion() })
    : new ClaudeSession(options)),
  send: (chatId, event) => {
    notifier.observe(chatId, event);
    for (const window of BrowserWindow.getAllWindows()) {
      // A window can be mid-teardown while agents shut down on quit.
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      window.webContents.send("agent:event", { chatId, event });
    }
  },
});

// Each CLI is found and its version checked once per run; a missing or outdated one is checked again on the next message.
const agentCli = createCliCache({ ready: () => environmentReady });

ipcMain.handle("usage:read", () => readUsage());

ipcMain.handle("agent:start-turn", async (_event, request) => {
  const images = decodeImages(request.images);
  const prompt = await expandSkillPrompt(request.cwd, request.prompt);
  const cli = await agentCli(request.provider === "codex" ? "codex" : "claude");
  // The renderer shows a start refused here as the turn's failure.
  if (cli.problem) throw new Error(cli.problem);
  return agents.startTurn({ ...request, prompt, images, command: cli.command });
});

const agentModels = createModelCache({ cli: agentCli, cwd: require("node:os").homedir(), clientVersion: app.getVersion() });
ipcMain.handle("agent:models", () => agentModels());

ipcMain.handle("agent:interrupt", (_event, chatId) => agents.interrupt(chatId));

ipcMain.handle("agent:respond-permission", (_event, { chatId, requestId, decision }) => agents.respondToPermission(chatId, requestId, decision));

ipcMain.handle("agent:answer-question", (_event, { chatId, requestId, answers }) => agents.answerQuestion(chatId, requestId, answers));

ipcMain.handle("agent:set-permission-mode", (_event, { chatId, mode }) => agents.setPermissionMode(chatId, mode));

function createWindow() {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Milagre",
    icon: appIconPath,
    backgroundColor: "#f7faf8",
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden", trafficLightPosition: { x: 24, y: 22 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const indexFile = path.join(__dirname, "../dist/index.html");
  const appUrl = app.isPackaged ? pathToFileURL(indexFile).href : process.env.MILAGRE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  guardNavigation(window.webContents, { appUrl, openExternal: (url) => shell.openExternal(url).catch(() => {}) });
  // A reload starts the renderer with no running turns, so stop the agents' turns: none may keep
  // waiting on an approval or question card that no longer exists.
  let loaded = false;
  window.webContents.on("did-finish-load", () => {
    if (loaded) void agents.interruptAll().catch(() => {});
    loaded = true;
  });
  if (!app.isPackaged) {
    window.loadURL(appUrl);
  } else {
    window.loadFile(indexFile);
  }
}

ipcMain.handle("project:current", () => readProject(process.cwd()));
ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open project",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return readProject(result.filePaths[0]);
});
ipcMain.handle("project:save", (_event, projectPath, state) => saveProjectState(projectPath, state));

app.whenReady().then(async () => {
  app.setName("Milagre");
  if (process.platform === "darwin" && app.dock) {
    const appIcon = nativeImage.createFromPath(appIconPath);
    if (!appIcon.isEmpty()) app.dock.setIcon(appIcon);
  }
  createWindow();
  autoUpdater.on("update-available", (info) => publishUpdateState({ status: "downloading", version: info.version }));
  autoUpdater.on("download-progress", (progress) => publishUpdateState({ status: "downloading", progress: progress.percent }));
  autoUpdater.on("update-downloaded", (info) => publishUpdateState({ status: "downloaded", version: info.version, progress: 100 }));
  await checkForUpdates();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  notifier.closeAll();
  // The renderer saves finished turns, so running turns stop with the last window.
  void agents.closeAll();
  if (process.platform !== "darwin") app.quit();
});

let agentsClosed = false;
app.on("before-quit", (event) => {
  if (agentsClosed) return;
  event.preventDefault();
  agentsClosed = true;
  // Agents run in their own process groups, so stop them before the app exits.
  Promise.race([agents.closeAll(), new Promise((resolve) => setTimeout(resolve, 5000))]).finally(() => app.quit());
});
