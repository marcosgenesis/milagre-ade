const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, powerSaveBlocker, shell, protocol, net } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRuntime } = require("@milagre/core");
const { KeepAwake } = require("@milagre/core/keep-awake");
const { detectEditors, openInEditor } = require("@milagre/core/editors");
const { copyImage, saveImage } = require("./generated-images.cjs");
const { revealFolder } = require("./reveal.cjs");
const { guardNavigation } = require("./links.cjs");
const { AttentionNotifier } = require("./notifications.cjs");
const { createMediaHandler } = require("./media.cjs");
protocol.registerSchemesAsPrivileged([{ scheme: "milagre-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const appIconPath = path.join(__dirname, "../app/public/logo-milagre-image.png");
let updateState = { status: "idle", version: null, progress: 0 };
let updateCheck = null;
function publishUpdateState(nextState) {
  updateState = { ...updateState, ...nextState };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("update:state", updateState);
  }
  return updateState;
}

function checkForUpdates() {
  if (!app.isPackaged) return Promise.resolve(publishUpdateState({ status: "unavailable" }));
  if (updateState.status === "downloading" || updateState.status === "downloaded") return Promise.resolve(updateState);
  if (updateCheck) return updateCheck;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  publishUpdateState({ status: "checking", version: null, progress: 0 });
  updateCheck = autoUpdater.checkForUpdates().then(
    () => updateState.status === "checking" ? publishUpdateState({ status: "up-to-date" }) : updateState,
    (error) => {
      console.warn("Milagre update check failed:", error.message);
      return publishUpdateState({ status: "error" });
    },
  ).finally(() => { updateCheck = null; });
  return updateCheck;
}

ipcMain.handle("update:state", () => updateState);
ipcMain.handle("update:check", () => checkForUpdates());
// The update installs on a quit too: running chats stop first and continue once the new version opens.
ipcMain.handle("update:install", async () => {
  await prepareQuit();
  autoUpdater.quitAndInstall();
});

// A project or worktree folder in the file manager; only a checkout's top folder opens (see reveal.cjs).
ipcMain.handle("project:reveal", (_event, folder) => revealFolder(folder, { open: (target) => shell.openPath(target) }));

// An image in a chat, generated or attached: copied to the clipboard, saved where the user picks, or either from its right-click menu (see generated-images.cjs).
const copyImageFile = (file) => copyImage(file, { createFromPath: (target) => nativeImage.createFromPath(target), createFromBuffer: (bytes) => nativeImage.createFromBuffer(bytes), writeImage: (image) => clipboard.writeImage(image) });
const saveImageFile = (event, file, name) => saveImage(file, { downloads: app.getPath("downloads"), showSaveDialog: (options) => dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), options) }, name);
ipcMain.handle("image:copy", (_event, file) => copyImageFile(file));
ipcMain.handle("image:save", (event, file, name) => saveImageFile(event, file, name));
ipcMain.handle("image:menu", (event, file, name) => {
  Menu.buildFromTemplate([
    { label: "Copy Image", click: () => void copyImageFile(file).catch(() => {}) },
    { label: "Save Image…", click: () => void saveImageFile(event, file, name).catch(() => {}) },
  ]).popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

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
  setBadge: value => app.dock?.setBadge(value),
});

// The window reports the "Notify when waiting" setting, kept with its other settings.
let notifyWhenWaiting = true;
ipcMain.handle("settings:notify-when-waiting", (_event, on) => {
  notifyWhenWaiting = on === true;
});

ipcMain.handle("notification:state", (_event, state) => notifier.sync(state));
ipcMain.handle("notification:completed", (_event, notice) => Notification.isSupported() ? notifier.notifyCompletion(notice) : false);


const runtime = createRuntime({
  dataDir: app.getPath("userData"),
  version: app.getVersion(),
  cwd: process.cwd(),
  worktreeRoot: !app.isPackaged ? process.env.MILAGRE_WORKTREE_ROOT : undefined,
  keepAwake: new KeepAwake({ powerSaveBlocker }),
  isFocused: () => Boolean(BrowserWindow.getFocusedWindow()),
  observeAgentEvent: (chatId, event) => notifier.observe(chatId, event),
  notifyWaiting: notice => { if (notifyWhenWaiting && Notification.isSupported()) notifier.notify(notice); },
  emit(channel, payload) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload);
    }
  },
});
const environmentReady = runtime.environmentReady;
for (const method of runtime.methods) ipcMain.handle(method, (_event, ...args) => runtime.invoke(method, args));
ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog({ title: "Open project", properties: ["openDirectory", "createDirectory"] });
  return result.canceled || !result.filePaths[0] ? null : runtime.openProject(result.filePaths[0]);
});
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
  // On macOS the close button hides the window, so agents keep running; a quit closes it for real.
  if (process.platform === "darwin") {
    window.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      // A full-screen window hidden as is leaves a black space behind.
      if (window.isFullScreen()) {
        window.once("leave-full-screen", () => window.hide());
        window.setFullScreen(false);
      } else {
        window.hide();
      }
    });
  }
  guardNavigation(window.webContents, { appUrl, openExternal: (url) => shell.openExternal(url).catch(() => {}) });
  // A reload keeps every turn running: the main process saves them, and the renderer takes the
  // turns streaming now, with their approval and question cards, from "chat:runs".
  if (!app.isPackaged) {
    window.loadURL(appUrl);
  } else {
    window.loadFile(indexFile);
  }
}

app.whenReady().then(async () => {
  protocol.handle("milagre-media", createMediaHandler((url, options) => net.fetch(url, options)));
  app.setName("Milagre");
  if (process.platform === "darwin" && app.dock) {
    const appIcon = nativeImage.createFromPath(appIconPath);
    if (!appIcon.isEmpty()) app.dock.setIcon(appIcon);
  }
  createWindow();
  void runtime.resumeRecentProjects();
  app.on("browser-window-focus", () => {
    void runtime.focused().catch(() => {});
  });
  autoUpdater.on("update-available", (info) => publishUpdateState({ status: "downloading", version: info.version }));
  autoUpdater.on("update-not-available", () => publishUpdateState({ status: "up-to-date" }));
  autoUpdater.on("download-progress", (progress) => publishUpdateState({ status: "downloading", progress: progress.percent }));
  autoUpdater.on("update-downloaded", (info) => publishUpdateState({ status: "downloaded", version: info.version, progress: 100 }));
  autoUpdater.on("error", () => publishUpdateState({ status: "error" }));
  await checkForUpdates();
  app.on("activate", () => {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (window) window.show();
    else createWindow();
  });
});

// Only a quit closes the last window on macOS; elsewhere closing it quits.
app.on("window-all-closed", () => {
  // A quit Electron started for a termination signal can end here, windows closed and the app still running.
  if (process.platform !== "darwin" || quitReady) app.quit();
});

// Stops everything a quit has to stop, once, within 5 seconds. Running chats are saved first so they
// continue on the next launch; agents run in their own process groups, so they are stopped before the app exits.
let quitting = false;
let quitPrepared = null;
function prepareQuit() {
  quitting = true;
  quitPrepared ??= (async () => {
    notifier.closeAll();
    await runtime.close();
  })();
  return Promise.race([quitPrepared, new Promise((resolve) => setTimeout(resolve, 5000))]);
}

let quitReady = false;
app.on("before-quit", (event) => {
  quitting = true;
  if (quitReady) return;
  event.preventDefault();
  void prepareQuit().finally(() => {
    quitReady = true;
    app.quit();
  });
});
