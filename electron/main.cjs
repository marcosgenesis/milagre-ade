const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { decodeImages } = require("./image-input.cjs");
const { ClaudeSession } = require("./agents/claude-provider.cjs");
const { CodexSession } = require("./agents/codex-provider.cjs");
const { resolveExecutable } = require("./agents/environment.cjs");
const { SessionManager } = require("./agents/session-manager.cjs");
const { discoverSkills, expandSkillPrompt } = require("./skills.cjs");
const { createWorktree, listBranches } = require("./worktrees.cjs");
const { reconcileState } = require("./project-state.cjs");
const { saveProjectState, stateFile } = require("./project-store.cjs");

const execFileAsync = promisify(execFile);

const appIconPath = path.join(__dirname, "../app/public/logo-milagre-image.png");
let updateState = { status: "idle", version: null, progress: 0 };

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
// Packaged builds get their release version from electron-builder metadata, not the source package.json.
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("worktree:create", async (_event, request) => {
  const created = await createWorktree(request);
  const project = await readProject(request.projectPath);
  await saveProjectState(request.projectPath, project.state);
  const worktree = Object.values(project.state.worktrees).find((item) => item.name === created.branch);
  if (!worktree) throw new Error(`Created ${created.branch}, but git did not list it as a worktree.`);
  return { project, worktreeId: worktree.id };
});

const agents = new SessionManager({
  createSession: (provider, options) => (provider === "codex"
    ? new CodexSession({ ...options, clientVersion: app.getVersion() })
    : new ClaudeSession(options)),
  send: (chatId, event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      // A window can be mid-teardown while agents shut down on quit.
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      window.webContents.send("agent:event", { chatId, event });
    }
  },
});

// CLI paths are looked up once per run; a missing CLI is looked up again next time.
const executables = new Map();
function executable(name) {
  if (!executables.has(name)) {
    executables.set(name, resolveExecutable(name).then((found) => {
      if (!found) executables.delete(name);
      return found;
    }));
  }
  return executables.get(name);
}

ipcMain.handle("agent:start-turn", async (_event, request) => {
  const images = decodeImages(request.images);
  const prompt = await expandSkillPrompt(request.cwd, request.prompt);
  const command = await executable(request.provider === "codex" ? "codex" : "claude");
  return agents.startTurn({ ...request, prompt, images, command });
});

ipcMain.handle("agent:interrupt", (_event, chatId) => agents.interrupt(chatId));

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

  if (!app.isPackaged) {
    window.loadURL(process.env.MILAGRE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  } else {
    window.loadFile(path.join(__dirname, "../dist/index.html"));
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
