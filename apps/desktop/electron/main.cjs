// @ts-check
const { createQuitHandler } = require("./quit.cjs");
const { createEditorOpener } = require("./editor-open.cjs");
const {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  shell,
  protocol,
  net,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { connectDesktopRuntime } = require("./daemon-runtime.cjs");
const { loadLoginEnvironment } = require("@milagre/core/agents/environment");
const { detectEditors, openInEditor, requireWorktreeRoot } = require("@milagre/core/editors");
const { copyImage, saveImage } = require("./generated-images.cjs");
const { revealFolder } = require("./reveal.cjs");
const { applyTranslucency, OPAQUE_BACKGROUND } = require("./window-translucency.cjs");
const { guardNavigation } = require("./links.cjs");
const { AttentionNotifier } = require("./notifications.cjs");
const { createMediaHandler } = require("./media.cjs");
protocol.registerSchemesAsPrivileged([{ scheme: "milagre-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
async function startDesktop() {
  const appIconPath = path.join(__dirname, "../app/public/logo-milagre-image.png");
  let updateState = { status: "idle", version: null, progress: 0 };
  /** @type {Promise<typeof updateState> | null} */
  let updateCheck = null;
  const { createReleaseChannelStore, configureUpdater, isChannelNotPublished } = require("./release-channel.cjs");
  const releaseChannel = createReleaseChannelStore({ file: path.join(app.getPath("userData"), "release-channel.json") });
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
    configureUpdater(autoUpdater, releaseChannel.get());
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    publishUpdateState({ status: "checking", version: null, progress: 0 });
    updateCheck = autoUpdater
      .checkForUpdates()
      .then(
        () => (updateState.status === "checking" ? publishUpdateState({ status: "up-to-date" }) : updateState),
        (error) => {
          if (isChannelNotPublished(error)) return publishUpdateState({ status: "up-to-date" });
          console.warn("Milagre update check failed:", error.message);
          return publishUpdateState({ status: "error" });
        },
      )
      .finally(() => {
        updateCheck = null;
      });
    return updateCheck;
  }

  ipcMain.handle("update:state", () => updateState);
  ipcMain.handle("update:check", () => checkForUpdates());
  ipcMain.handle("update:channel", () => releaseChannel.get());
  // The new channel is saved first. A running or finished download keeps its state; the channel applies on the next check.
  ipcMain.handle("update:set-channel", async (_event, channel) => {
    const next = releaseChannel.set(channel);
    if (updateState.status === "downloading" || updateState.status === "downloaded") return next;
    if (updateCheck) await updateCheck.catch(() => {});
    if (updateState.status === "downloading" || updateState.status === "downloaded") return next;
    publishUpdateState({ status: "idle", version: null, progress: 0 });
    void checkForUpdates();
    return next;
  });
  // Installing replaces the host bundle too. Save and stop it before the updater runs.
  ipcMain.handle("update:install", async () => {
    await runtime.close({ stopHost: true });
    await prepareQuit();
    autoUpdater.quitAndInstall();
  });

  // A project or worktree folder in the file manager; only a checkout's top folder opens (see reveal.cjs).
  ipcMain.handle("project:reveal", (_event, folder) =>
    revealFolder(folder, {
      checkRoot: async (root) => {
        await checkEditorRoot(root);
      },
      open: (target) => shell.openPath(target),
    }),
  );

  // An image in a chat, generated or attached: copied to the clipboard, saved where the user picks, or either from its right-click menu (see generated-images.cjs).
  const copyImageFile = (file) =>
    copyImage(file, {
      createFromPath: (target) => nativeImage.createFromPath(target),
      createFromBuffer: (bytes) => nativeImage.createFromBuffer(bytes),
      writeImage: (image) => clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(image.toPNG())], { type: "image/png" }) })]),
    });
  const saveImageFile = (event, file, name) =>
    saveImage(
      file,
      {
        downloads: app.getPath("downloads"),
        showSaveDialog: (options) =>
          BrowserWindow.fromWebContents(event.sender)
            ? dialog.showSaveDialog(/** @type {Electron.BrowserWindow} */ (BrowserWindow.fromWebContents(event.sender)), options)
            : dialog.showSaveDialog(options),
      },
      name,
    );
  ipcMain.handle("image:copy", (_event, file) => copyImageFile(file));
  ipcMain.handle("image:save", (event, file, name) => saveImageFile(event, file, name));
  ipcMain.handle("image:menu", (event, file, name) => {
    Menu.buildFromTemplate([
      { label: "Copy Image", click: () => void copyImageFile(file).catch(() => {}) },
      { label: "Save Image…", click: () => void saveImageFile(event, file, name).catch(() => {}) },
    ]).popup({ window: BrowserWindow.fromWebContents(event.sender) ?? undefined });
  });

  // Installed editors are looked up once per run.
  /** @type {Promise<import("@milagre/core/editors").DetectedEditor[]> | null} */
  let editorsFound = null;
  // Looked up after the login shell filled in PATH, so CLIs from a Finder launch are found.
  // A failed lookup is not kept, so the next call looks again.
  const editors = () =>
    (editorsFound ??= environmentReady
      .then(() => detectEditors())
      .catch((error) => {
        editorsFound = null;
        throw error;
      }));
  ipcMain.handle("editor:list", async () => (await editors()).map(({ id, name }) => ({ id, name })));
  async function checkEditorRoot(root) {
    try {
      return /** @type {string[]} */ (await runtime.invoke("link:workspace-roots", [root]));
    } catch {
      return requireWorktreeRoot(root);
    }
  }
  const openEditor = createEditorOpener({ editors, open: openInEditor, checkRoot: checkEditorRoot });
  ipcMain.handle("editor:open", (_event, request) => openEditor(request));
  // Settings > Skills opens or reveals a SKILL.md wherever it lives (~/.claude/skills is no checkout), but only a file the
  // Project's skill catalog lists, so the renderer can't name any other file.
  async function checkSkillFile(projectPath, file) {
    const { skills, shadowed = [] } = /** @type {import("@milagre/shared/model").SkillCatalog} */ (await runtime.invoke("skills:list", [projectPath]));
    if (typeof file !== "string" || ![...skills, ...shadowed].some((skill) => skill.path === file))
      throw new Error("That skill is no longer there. Reload the list.");
  }
  const openSkillFile = createEditorOpener({ editors, open: openInEditor, checkRoot: async () => {} });
  ipcMain.handle("skills:open", async (_event, { projectPath, file, editor } = {}) => {
    await checkSkillFile(projectPath, file);
    return openSkillFile({ root: path.dirname(file), path: path.basename(file), editor });
  });
  ipcMain.handle("skills:reveal", async (_event, projectPath, file) => {
    await checkSkillFile(projectPath, file);
    shell.showItemInFolder(file);
  });

  // Brings the window back from a notification click and tells it what to open.
  function openFromNotification(channel, ...args) {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    if (process.platform === "darwin") app.focus({ steal: true });
    window.focus();
    window.webContents.send(channel, ...args);
  }
  const openChatFromNotification = (chatId) => openFromNotification("notification:open-chat", chatId);

  const notifier = new AttentionNotifier({
    createNotification: ({ title, subtitle, body }) => new Notification({ title, body, ...(subtitle ? { subtitle } : {}) }),
    isAppFocused: () => Boolean(BrowserWindow.getFocusedWindow()),
    openChat: openChatFromNotification,
    openPhoneSettings: () => openFromNotification("notification:open-phone-settings"),
    setBadge: (value) => app.dock?.setBadge(value),
  });

  // The window reports the "Notify when waiting" setting, kept with its other settings.
  let notifyWhenWaiting = true;
  ipcMain.handle("settings:notify-when-waiting", (_event, on) => {
    notifyWhenWaiting = on === true;
  });

  ipcMain.handle("notification:state", (_event, state) => notifier.sync(state));
  ipcMain.handle("notification:completed", (_event, notice) => (Notification.isSupported() ? notifier.notifyCompletion(notice) : false));

  // The "Translucent window" appearance setting, pushed by the renderer with the theme it resolved.
  ipcMain.handle("settings:window-translucent", (event, { on, theme } = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) applyTranslucency({ window, nativeTheme }, { on: on === true, theme });
  });

  let connectionState = { connected: true };
  ipcMain.handle("runtime:connection", () => connectionState);
  let runtime;
  try {
    runtime = await connectDesktopRuntime({
      dataDir: app.getPath("userData"),
      version: app.getVersion(),
      cwd: process.cwd(),
      worktreeRoot: !app.isPackaged ? process.env.MILAGRE_WORKTREE_ROOT : undefined,
      emit(channel, payload) {
        if (channel === "agent:event") notifier.observe(payload.chatId, payload.event);
        if (channel === "notification:waiting" && notifyWhenWaiting && Notification.isSupported()) notifier.notify(payload);
        if (channel === "phone:paired" && Notification.isSupported()) notifier.notifyPhonePaired();
        if (channel === "runtime:connection") {
          connectionState = payload;
          // A host started again after it went away can be newer, with more commands. (Not yet set during the first connect.)
          if (payload.connected && runtime) registerHostMethods();
        }
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload);
        }
      },
    });
  } catch (error) {
    console.error("Milagre cannot open its saved state:", error);
    void app.whenReady().then(() => {
      dialog.showErrorBox("Milagre cannot open its saved state", error instanceof Error ? error.message : String(error));
      app.quit();
    });
    return;
  }
  const environmentReady = loadLoginEnvironment();
  // The host's commands. A restarted host can bring more (an older one lacked some), so this runs again after a restart.
  const registered = new Set(["app:version"]);
  function registerHostMethods() {
    for (const method of runtime.methods) {
      if (registered.has(method)) continue;
      registered.add(method);
      ipcMain.handle(method, (_event, ...args) => runtime.invoke(method, args));
    }
  }
  registerHostMethods();
  ipcMain.handle("app:version", () => app.getVersion());
  // An older host can't load very large Projects; the window offers to replace it with this desktop's own.
  ipcMain.handle("runtime:restart-host", async () => {
    await runtime.restartHost();
    registerHostMethods();
  });
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
      backgroundColor: OPAQUE_BACKGROUND,
      ...(process.platform === "darwin" ? { titleBarStyle: "hidden", trafficLightPosition: { x: 24, y: 22 } } : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const indexFile = path.join(__dirname, "../dist/index.html");
    const appUrl = app.isPackaged ? pathToFileURL(indexFile).href : process.env.MILAGRE_DEV_SERVER_URL || "http://127.0.0.1:5173";
    // On macOS the close button hides the window; the shared host also survives a desktop quit.
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
    protocol.handle(
      "milagre-media",
      createMediaHandler((url, options) => net.fetch(url, options)),
    );
    app.setName("Milagre");
    if (process.platform === "darwin" && app.dock) {
      const appIcon = nativeImage.createFromPath(appIconPath);
      if (!appIcon.isEmpty()) app.dock.setIcon(appIcon);
    }
    createWindow();
    void runtime.resumeRecentProjects().catch((error) => console.warn(error.message));
    app.on("browser-window-focus", () => {
      void runtime.setFocused(true).catch(() => {});
    });
    app.on("browser-window-blur", () => {
      void runtime.setFocused(false).catch(() => {});
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

  // Flushes accepted changes and disconnects desktop. The host and agents keep running.
  let quitting = false;
  /** @type {Promise<void> | null} */
  let quitPrepared = null;
  function prepareQuit() {
    quitting = true;
    quitPrepared ??= (async () => {
      notifier.closeAll();
      await runtime.close();
    })().catch((error) => {
      quitPrepared = null;
      quitting = false;
      throw error;
    });
    return quitPrepared;
  }

  let quitReady = false;
  const attemptQuit = createQuitHandler({
    prepare: prepareQuit,
    quit: () => {
      quitReady = true;
      app.quit();
    },
    failed: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.show();
          window.webContents.send("app:quit-failed", message);
        }
      }
    },
  });
  ipcMain.handle("app:retry-quit", () => {
    app.quit();
  });
  app.on("before-quit", (event) => {
    quitting = true;
    if (quitReady) return;
    event.preventDefault();
    void attemptQuit();
  });
}
void startDesktop().catch((error) => {
  console.error("Milagre could not start:", error);
  void app.whenReady().then(() => {
    dialog.showErrorBox("Milagre could not start", error.message);
    app.quit();
  });
});
