const { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, powerSaveBlocker, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");
const { decodeImages } = require("./image-input.cjs");
const { detectEditors, openInEditor } = require("./editors.cjs");
const { revealFolder } = require("./reveal.cjs");
const { KeepAwake } = require("./keep-awake.cjs");
const { guardNavigation } = require("./links.cjs");
const { AttentionNotifier } = require("./notifications.cjs");
const { ClaudeSession } = require("./agents/claude-provider.cjs");
const { CodexSession } = require("./agents/codex-provider.cjs");
const { createCliCache } = require("./agents/cli.cjs");
const { loadLoginEnvironment, refreshInstallPath } = require("./agents/environment.cjs");
const { failedWith, loginMessage } = require("./agents/events.cjs");
const { createModelCache } = require("./agents/models.cjs");
const { cliWhenLoggedIn, createCliStatus } = require("./agents/status.cjs");
const { SessionManager } = require("./agents/session-manager.cjs");
const { discoverSkills, expandSkillPrompt } = require("./skills.cjs");
const { DEFAULT_WORKTREE_ROOT, createWorktree, listBranches, renameWorktreeBranch } = require("./worktrees.cjs");
const { suggestWorktreeName } = require("./worktree-name.cjs");
const { removeWorktree, worktreeStatus } = require("./worktree-cleanup.cjs");
const { previewFilesToCopy } = require("./worktree-files.cjs");
const { createProjectSettings } = require("./project-settings.cjs");
const { readDiffStat } = require("./diffstat.cjs");
const { registerGitHandlers } = require("./git-ipc.cjs");
const { readPullRequest } = require("./pull-request.cjs");
const { reconcileState } = require("./project-state.cjs");
const { resolveProjectImage } = require("./project-image.cjs");
const { saveProjectState, stateFile } = require("./project-store.cjs");
const { createUsageReader } = require("./usage.cjs");
const { createUsageStore, cachedSnapshot } = require("./usage-cache.cjs");

const execFileAsync = promisify(execFile);

const appIconPath = path.join(__dirname, "../app/public/logo-milagre-image.png");
let updateState = { status: "idle", version: null, progress: 0 };
// Opened from Finder or the Dock, the app has launchd's bare PATH. The login shell's environment is read
// once, in the background: windows open without waiting, and the first agent (and the usage lookup) waits for it.
const environmentReady = loadLoginEnvironment().then(({ source }) => {
  if (source === "fallback") console.warn("Milagre couldn't read your login shell's environment; looking for agents in common install folders.");
}, (error) => console.warn("Milagre couldn't read your login shell's environment:", error.message));
const usageStore = createUsageStore({ file: path.join(app.getPath("userData"), "usage-cache.json") });
const readUsage = createUsageReader({ ready: () => environmentReady, store: usageStore });

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

// Projects opened in this run: the commit dialog only acts in their checkouts.
const openedProjects = new Set();

async function readProject(projectPath) {
  openedProjects.add(projectPath);
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
// The avatar lookup runs `gh`, which a Finder launch only finds once the login environment is applied.
ipcMain.handle("project:image", async (_event, projectPath) => {
  await environmentReady;
  return resolveProjectImage(projectPath);
});
// Packaged builds get their release version from electron-builder metadata, not the source package.json.
ipcMain.handle("app:version", () => app.getVersion());
// Where Milagre's worktrees live. An unpackaged build can point it elsewhere (live checks use a temporary folder).
function worktreeRoot() {
  return (!app.isPackaged && process.env.MILAGRE_WORKTREE_ROOT) || DEFAULT_WORKTREE_ROOT;
}

let projectSettingsStore = null;
function projectSettings() {
  projectSettingsStore ??= createProjectSettings(path.join(app.getPath("userData"), "project-settings.json"));
  return projectSettingsStore;
}

ipcMain.handle("worktree:roots", async () => {
  const root = worktreeRoot();
  return [...new Set([root, await fs.realpath(root).catch(() => root)])];
});
// The git calls below wait for the login environment, so they run with the merged PATH.
ipcMain.handle("worktree:status", async (_event, worktreePath, base) => {
  await environmentReady;
  return worktreeStatus(worktreePath, base);
});
// The renderer sends what the user saw (base, status, chat) and the project; main re-checks after closing the chat's agent.
// The path and branch are read from git as they are now, so a branch renamed after creation is found as it is.
ipcMain.handle("worktree:remove", async (_event, worktreePath, options = {}) => {
  const { force, base, projectPath, chatId, seen } = options;
  await environmentReady;
  return removeWorktree({
    path: worktreePath,
    root: worktreeRoot(),
    projectPath,
    base,
    seen,
    force: Boolean(force),
    closeSession: typeof chatId === "string" ? () => agents.closeChat(chatId) : undefined,
  });
});
ipcMain.handle("files-to-copy:read", async (_event, projectPath) => {
  await environmentReady;
  const { filesToCopy } = await projectSettings().get(projectPath);
  return { filesToCopy, ...(await previewFilesToCopy(projectPath, filesToCopy)) };
});
ipcMain.handle("files-to-copy:preview", async (_event, projectPath, patterns) => {
  await environmentReady;
  return previewFilesToCopy(projectPath, patterns);
});
ipcMain.handle("files-to-copy:save", async (_event, projectPath, patterns) => {
  await environmentReady;
  const { filesToCopy } = await projectSettings().setFilesToCopy(projectPath, patterns);
  return { filesToCopy, ...(await previewFilesToCopy(projectPath, filesToCopy)) };
});
// A new worktree starts on its prompt's first words; a better name replaces its branch's once Haiku
// picks one, so the chat never waits on it.
async function nameWorktree(sender, projectPath, created, prompt) {
  // The CLI check waits for the login environment and resolves the path the SDK starts directly (no shell). A
  // missing or broken Claude has no command, and the name stays the prompt's first words.
  const cli = await agentCli("claude");
  const slug = await suggestWorktreeName(prompt, { command: cli.problem ? null : cli.command, timeoutMs: 15_000 });
  const name = await renameWorktreeBranch({ worktreePath: created.path, branch: created.branch, slug });
  if (name && !sender.isDestroyed()) sender.send("worktree:renamed", { projectPath, path: created.path, from: created.branch, name });
}

ipcMain.handle("worktree:create", async (event, { projectPath, baseBranch, prompt }) => {
  // Only these fields come from the renderer: the worktree folder and the files copied into it are main's call.
  const request = { projectPath, baseBranch, prompt };
  await environmentReady;
  // The files are copied into the folder git just made; the rename that follows only changes the branch, so the path holds.
  const created = await createWorktree({ ...request, root: worktreeRoot(), copyPatterns: (await projectSettings().get(projectPath)).filesToCopy });
  if (created.copy?.notes.length) console.warn("Milagre worktree file copy:", created.copy.notes.join(" "));
  const project = await readProject(request.projectPath);
  const listed = Object.values(project.state.worktrees).find((item) => item.name === created.branch);
  if (!listed) throw new Error(`Created ${created.branch}, but git did not list it as a worktree.`);
  const worktree = { ...listed, base: created.base };
  project.state.worktrees[worktree.id] = worktree;
  await saveProjectState(request.projectPath, project.state);
  void nameWorktree(event.sender, request.projectPath, created, request.prompt ?? "").catch(() => {});
  return { project, worktreeId: worktree.id };
});
ipcMain.handle("worktree:diffstat", (_event, worktreePath, base) => readDiffStat(worktreePath, base));
ipcMain.handle("worktree:pull-request", async (_event, worktreePath) => {
  await environmentReady;
  return readPullRequest(worktreePath);
});
// A project or worktree folder in the file manager; only a checkout's top folder opens (see reveal.cjs).
ipcMain.handle("project:reveal", (_event, folder) => revealFolder(folder, { open: (target) => shell.openPath(target) }));

// Installed editors are looked up once per run.
let editorsFound = null;
// Looked up after the login shell filled in PATH, so CLIs from a Finder launch are found.
// A failed lookup is not kept, so the next call looks again.
const editors = () => (editorsFound ??= environmentReady.then(() => detectEditors()).catch((error) => {
  editorsFound = null;
  throw error;
}));
ipcMain.handle("editor:list", async () => (await editors()).map(({ id, name }) => ({ id, name })));
// Resolves to null on success, or a short message to show as a notice.
ipcMain.handle("editor:open", async (_event, request) => {
  if (!request || typeof request.root !== "string") return "File not found";
  return openInEditor({ root: request.root, path: request.path, line: request.line, editor: request.editor }, { editors: await editors() });
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

// While any chat's turn runs the Mac stays awake (the screen can still sleep). On until the renderer
// pushes the saved setting.
const keepAwake = new KeepAwake({ powerSaveBlocker });
ipcMain.handle("app:set-keep-awake", (_event, enabled) => keepAwake.setEnabled(enabled === true));

function sendAgentEvent(chatId, event) {
  notifier.observe(chatId, event);
  keepAwake.observe(chatId, event);
  // A turn that just failed on a login problem makes a "ready" picker status out of date.
  if (event.type === "turn-failed" && event.login) {
    for (const name of ["claude", "codex"]) if (event.message === loginMessage(name)) agentCliStatus.invalidate(name);
  }
  for (const window of BrowserWindow.getAllWindows()) {
    // A window can be mid-teardown while agents shut down on quit.
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send("agent:event", { chatId, event });
  }
}

const agents = new SessionManager({
  createSession: (provider, options) => (provider === "codex"
    ? new CodexSession({ ...options, clientVersion: app.getVersion() })
    : new ClaudeSession(options)),
  onSessionClosed: (chatId) => keepAwake.chatClosed(chatId),
  send: sendAgentEvent,
});

// Each CLI is found and its version checked once per run; a missing or outdated one is checked again on the next message.
const agentCli = createCliCache({ ready: () => environmentReady, refresh: () => refreshInstallPath() });

ipcMain.handle("usage:read", () => readUsage());
ipcMain.handle("usage:cached", () => cachedSnapshot(usageStore, Date.now()));

// The "Commit and open PR" dialog: Milagre runs git and gh itself, in the chat's folder, once the login
// environment is in (gh from a Finder launch). Its one-shot text call starts the CLI agentCli found.
registerGitHandlers(ipcMain, {
  cli: (name) => agentCli(name),
  ready: () => environmentReady,
  clientVersion: app.getVersion(),
  knownFolders: async () => (await Promise.all([...openedProjects].map(discoverWorktrees))).flat().map((worktree) => worktree.path),
});

ipcMain.handle("agent:start-turn", async (_event, request) => {
  const images = decodeImages(request.images);
  const prompt = await expandSkillPrompt(request.cwd, request.prompt);
  const cli = await agentCli(request.provider === "codex" ? "codex" : "claude");
  // A CLI that is missing, too old or doesn't start fails the turn like any other failure, with its own message.
  if (cli.problem) {
    sendAgentEvent(request.chatId, failedWith(cli.problem));
    return { turnId: null, steered: false };
  }
  return agents.startTurn({ ...request, prompt, images, command: cli.command });
});

// What the model picker flags per agent: missing, outdated, broken or logged out. A ready CLI is looked at again
// after 5 minutes, a problem on every call.
const agentCliStatus = createCliStatus({ cli: agentCli, cwd: require("node:os").homedir(), clientVersion: app.getVersion() });
ipcMain.handle("agent:cli-status", () => agentCliStatus());

const agentModels = createModelCache({ cli: cliWhenLoggedIn(agentCli, agentCliStatus), cwd: require("node:os").homedir(), clientVersion: app.getVersion() });
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
  keepAwake.quit();
  // Agents run in their own process groups, so stop them before the app exits.
  Promise.race([agents.closeAll(), new Promise((resolve) => setTimeout(resolve, 5000))]).finally(() => app.quit());
});
