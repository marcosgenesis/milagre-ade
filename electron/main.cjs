const { ChatTitles, createChatTitleModels, generateChatTitle } = require("./chat-title.cjs");
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerSaveBlocker, shell, protocol, net } = require("electron");
const { copyImage, saveImage } = require("./generated-images.cjs");
const { autoUpdater } = require("electron-updater");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const { realpathSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");
const { decodeImages } = require("./image-input.cjs");
const { detectEditors, openInEditor } = require("./editors.cjs");
const { revealFolder } = require("./reveal.cjs");
const { KeepAwake } = require("./keep-awake.cjs");
const { applyTranslucency, OPAQUE_BACKGROUND } = require("./window-translucency.cjs");
const { guardNavigation } = require("./links.cjs");
const { AttentionNotifier } = require("./notifications.cjs");
const { ClaudeSession } = require("./agents/claude-provider.cjs");
const { CodexSession, recoverCodexSubagents } = require("./agents/codex-provider.cjs");
const { createCliCache, inspectCli } = require("./agents/cli.cjs");
const { runCliUpdate, linkNewestClaudeVersion } = require("./agents/cli-update.cjs");
const { loadLoginEnvironment, refreshInstallPath } = require("./agents/environment.cjs");
const { failedWith, loginMessage } = require("./agents/events.cjs");
const { createModelCache } = require("./agents/models.cjs");
const { cliWhenLoggedIn, createCliStatus } = require("./agents/status.cjs");
const { SessionManager } = require("./agents/session-manager.cjs");
const { PortWatcher } = require("./agents/ports.cjs");
const { ChatHost } = require("./agents/chat-host.cjs");
const { writeTranscript, generateBrief, createHandoverModels } = require("./agents/handover.cjs");
const { discoverSkills, expandSkillPrompt } = require("./skills.cjs");
const { DEFAULT_WORKTREE_ROOT, createWorktree, listBranches, renameWorktreeBranch } = require("./worktrees.cjs");
const { suggestWorktreeName } = require("./worktree-name.cjs");
const { removeWorktree, worktreeStatus } = require("./worktree-cleanup.cjs");
const { previewFilesToCopy } = require("./worktree-files.cjs");
const { createProjectSettings } = require("./project-settings.cjs");
const { WorktreeSetups, resolveSetupCommand } = require("./worktree-setup.cjs");
const { readDiffStat } = require("./diffstat.cjs");
const { registerGitHandlers } = require("./git-ipc.cjs");
const { readPullRequest, readPullRequests } = require("./pull-request.cjs");
const { reconcileState, markDisconnectedSubagents } = require("./project-state.cjs");
const { ProjectStates } = require("./project-states.cjs");
const { DiffRefresher } = require("./diff-refresh.cjs");
const { projectOfKey, sessionIdFromKey } = require("./shared/agent-runs.mjs");
const { archiveFinishedSubagents, archiveSubagent, patchSession, renameWorktree } = require("./shared/project-edits.mjs");
const { attentionContext, attentionNotice } = require("./shared/attention.mjs");
const { resolveProjectImage } = require("./project-image.cjs");
const { saveProjectState, stateFile } = require("./project-store.cjs");
const { createRecentProjects, launchProject, rememberProject, switchTarget } = require("./recent-projects.cjs");
const { createUsageReader } = require("./usage.cjs");
const { createUsageStore, cachedSnapshot } = require("./usage-cache.cjs");

const { createFileSearch } = require("./project-files.cjs");
const searchFiles = createFileSearch();
const { createMediaHandler } = require("./media.cjs");
protocol.registerSchemesAsPrivileged([{ scheme: "milagre-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const execFileAsync = promisify(execFile);

const appIconPath = path.join(__dirname, "../app/public/logo-milagre-image.png");
let updateState = { status: "idle", version: null, progress: 0 };
let updateCheck = null;
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

async function readStoredState(projectPath) {
  try {
    return JSON.parse(await fs.readFile(stateFile(projectPath), "utf8"));
  } catch {
    return null;
  }
}

const projectName = (projectPath) => path.basename(projectPath) || "Untitled project";

// Every project's state goes through here: the main process is its only writer (see ADR-0001).
const states = new ProjectStates({
  read: async (projectPath) => reconcileState(await readStoredState(projectPath), projectName(projectPath), await discoverWorktrees(projectPath)),
  save: saveProjectState,
});

function broadcastProjectState(projectPath, state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send("project:state", { path: projectPath, state });
  }
}

/** Applies a change to a project's state and tells the windows when it changed. */
async function updateProject(projectPath, change) {
  const result = await states.update(projectPath, change);
  if (result.changed) broadcastProjectState(projectPath, result.state);
  return result.state;
}

const diffs = new DiffRefresher({ states, readDiffStat, update: updateProject });

// Reading a project matches its worktrees with the ones git lists now. A project read before keeps the
// state this run has built, so a chat's turn that's still running isn't lost.
// A subagent saved as running without a live agent session behind it (after a restart) is marked disconnected.
async function readProject(projectPath) {
  const discovered = await discoverWorktrees(projectPath);
  const live = (sessionId) => {
    const entry = agents.sessions.get(`${projectPath}#${sessionId}`);
    return Boolean(entry && !entry.session.closed);
  };
  let state = await updateProject(projectPath, (current) => {
    const next = reconcileState(current, projectName(projectPath), discovered);
    return markDisconnectedSubagents(next, new Set(Object.keys(next.sessions).map(Number).filter(live)));
  });
  // A chat a quit stopped continues now; its message is saved before the project is returned, so the window shows it.
  await chats.resumeInterrupted(projectPath, state).catch((error) => console.warn("Milagre couldn't resume a chat:", error.message));
  state = await states.get(projectPath);
  chatTitles.resume(projectPath, state);
  void chats.recoverHandovers(projectPath, state).catch((error) => console.warn("Milagre couldn't recover a handover:", error.message));
  void diffs.refresh(projectPath).catch(() => {});
  return { path: projectPath, name: projectName(projectPath), state };
}

ipcMain.handle("project:files", async (_event, root, query) => {
  const known = (await Promise.all(states.projects().map(discoverWorktrees))).flat();
  if (!known.some(worktree => worktree.path === root)) throw new Error("Choose an open project's worktree.");
  return searchFiles(root, query);
});
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
  const result = await removeWorktree({
    path: worktreePath,
    root: worktreeRoot(),
    projectPath,
    base,
    seen,
    force: Boolean(force),
    closeSession: typeof chatId === "string" ? async () => {
      await worktreeSetups.cancel(chatId);
      worktreeSetups.forget(worktreePath);
      return agents.closeChat(chatId);
    } : undefined,
  });
  // Read again, the project drops the worktree git no longer lists, with its chats.
  if (states.has(projectPath)) await readProject(projectPath);
  return result;
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
// The setup command new worktrees run: the repo's .milagre/worktree.json, else the project's setting.
async function readSetupCommand(projectPath) {
  const { setupCommand } = await projectSettings().get(projectPath);
  return { setupCommand, ...(await resolveSetupCommand(projectPath, setupCommand)) };
}
ipcMain.handle("worktree-setup:read", (_event, projectPath) => readSetupCommand(projectPath));
ipcMain.handle("worktree-setup:save", async (_event, projectPath, command) => {
  await projectSettings().setSetupCommand(projectPath, typeof command === "string" ? command : "");
  return readSetupCommand(projectPath);
});

// A new worktree starts on its prompt's first words; a better name replaces its branch's once Haiku
// picks one, so the chat never waits on it.
async function nameWorktree(sender, projectPath, created, prompt) {
  // The CLI check waits for the login environment and resolves the path the SDK starts directly (no shell). A
  // missing or broken Claude has no command, and the name stays the prompt's first words.
  const cli = await agentCli("claude");
  const slug = await suggestWorktreeName(prompt, { command: cli.problem ? null : cli.command, timeoutMs: 15_000 });
  const name = await renameWorktreeBranch({ worktreePath: created.path, branch: created.branch, slug });
  if (!name) return;
  await updateProject(projectPath, (state) => renameWorktree(state, { path: created.path, from: created.branch, name }));
  if (!sender.isDestroyed()) sender.send("worktree:renamed", { projectPath, path: created.path, from: created.branch, name });
}

ipcMain.handle("worktree:create", async (event, { projectPath, baseBranch, prompt }) => {
  // Only these fields come from the renderer: the worktree folder and the files copied into it are main's call.
  const request = { projectPath, baseBranch, prompt };
  await environmentReady;
  const settings = await projectSettings().get(projectPath);
  // The files are copied into the folder git just made; the rename that follows only changes the branch, so the path holds.
  const created = await createWorktree({ ...request, root: worktreeRoot(), copyPatterns: settings.filesToCopy });
  if (created.copy?.notes.length) console.warn("Milagre worktree file copy:", created.copy.notes.join(" "));
  // The setup command runs before the chat's first turn (see agent:start-turn).
  const resolved = await resolveSetupCommand(projectPath, settings.setupCommand);
  await worktreeSetups.prepare({ worktreePath: created.path, projectPath, resolved });
  const project = await readProject(request.projectPath);
  const listed = Object.values(project.state.worktrees).find((item) => item.name === created.branch);
  if (!listed) throw new Error(`Created ${created.branch}, but git did not list it as a worktree.`);
  const state = await updateProject(request.projectPath, (latest) => {
    const worktree = latest.worktrees[listed.id];
    return worktree ? { ...latest, worktrees: { ...latest.worktrees, [worktree.id]: { ...worktree, base: created.base } } } : latest;
  });
  void nameWorktree(event.sender, request.projectPath, created, request.prompt ?? "").catch(() => {});
  return { project: { ...project, state }, worktreeId: listed.id, ...(resolved.note ? { setupNote: resolved.note } : {}) };
});
// Re-reads some worktrees' diff stats at once, e.g. after a commit from the "Commit and open PR" dialog.
ipcMain.handle("worktree:refresh-diffs", (_event, projectPath, worktreeIds) => {
  if (!states.has(projectPath) || !Array.isArray(worktreeIds)) return undefined;
  return diffs.refresh(projectPath, worktreeIds.filter((id) => Number.isInteger(id)));
});
ipcMain.handle("worktree:pull-request", async (_event, worktreePath) => {
  await environmentReady;
  return readPullRequest(worktreePath);
});
ipcMain.handle("worktree:pull-requests", async (_event, worktreePath, refs) => {
  await environmentReady;
  return readPullRequests(worktreePath, refs);
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

// A chat that waits on the user while Milagre is in the background gets a system notification, whatever its project.
async function notifyIfWaiting(chatId, event) {
  const projectPath = projectOfKey(chatId);
  if (!notifyWhenWaiting || !Notification.isSupported() || !states.has(projectPath) || !("requestId" in event)) return;
  const notice = attentionNotice(event, attentionContext(await states.get(projectPath), projectName(projectPath), sessionIdFromKey(chatId)));
  if (notice) notifier.notify({ chatId, requestId: event.requestId, ...notice });
}

ipcMain.handle("notification:state", (_event, state) => notifier.sync(state));
ipcMain.handle("notification:completed", (_event, notice) => Notification.isSupported() ? notifier.notifyCompletion(notice) : false);

// While any chat's turn or a new worktree's setup runs the Mac stays awake (the screen can still sleep).
// On until the renderer pushes the saved setting.
const keepAwake = new KeepAwake({ powerSaveBlocker });
ipcMain.handle("app:set-keep-awake", (_event, enabled) => keepAwake.setEnabled(enabled === true));

// The "Translucent window" appearance setting, pushed by the renderer with the theme it resolved.
ipcMain.handle("settings:window-translucent", (event, { on, theme } = {}) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window && !window.isDestroyed()) applyTranslucency({ window, nativeTheme }, { on: on === true, theme });
});

function publishAgentEvent(chatId, event, state, seq) {
  notifier.observe(chatId, event);
  keepAwake.observe(chatId, event);
  void notifyIfWaiting(chatId, event).catch(() => {});
  diffs.observe(chatId, event);
  // A turn that just failed on a login problem makes a "ready" picker status out of date.
  if (event.type === "turn-failed" && event.login) {
    for (const name of ["claude", "codex"]) if (event.message === loginMessage(name)) agentCliStatus.invalidate(name);
  }
  for (const window of BrowserWindow.getAllWindows()) {
    // A window can be mid-teardown while agents shut down on quit.
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send("agent:event", { chatId, event, ...(state ? { state } : {}), ...(seq ? { seq } : {}) });
  }
}

const agents = new SessionManager({
  createSession: (provider, options) => (provider === "codex"
    ? new CodexSession({ ...options, clientVersion: app.getVersion() })
    : new ClaudeSession(options)),
  onSessionClosed: (chatId) => keepAwake.chatClosed(chatId),
  onTurnStarted: () => ports.wake(),
  send: (chatId, event) => void chats.receive(chatId, event),
});

// lsof reports real paths (/private/var for /var).
function realCwd(cwd) {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

// The ports each chat's commands listen on, polled while any agent runs or anything it started still does.
const ports = new PortWatcher({
  roots: () => new Map([...agents.processes()].map(([chatId, root]) => [chatId, { ...root, cwd: realCwd(root.cwd) }])),
  publish: (next) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      window.webContents.send("agent:ports", next);
    }
  },
});
ipcMain.handle("agent:ports", () => ports.snapshot());
// The renderer is untrusted: only a pid the chat's port list shows can be stopped.
ipcMain.handle("agent:stop-port", (_event, chatId, pid) => (typeof chatId === "string" && Number.isInteger(pid) ? ports.stopPort(chatId, pid) : false));

async function startAgentTurn(request) {
  const images = decodeImages(request.images);
  const prompt = await expandSkillPrompt(request.cwd, request.prompt);
  const cli = await agentCli(request.provider === "codex" ? "codex" : "claude");
  // A CLI that is missing, too old or doesn't start fails the turn like any other failure, with its own message.
  if (cli.problem) {
    await chats.receive(request.chatId, failedWith(cli.problem));
    return { turnId: null, steered: false };
  }
  // A new worktree's first turn waits for its setup command; one that failed tells the agent, one that was stopped stops the turn.
  const setup = await worktreeSetups.beforeTurn(request.chatId, request.cwd);
  if (setup.cancelled) {
    await chats.receive(request.chatId, { type: "turn-cancelled" });
    return { turnId: null, steered: false };
  }
  try {
    return await agents.startTurn({ ...request, prompt: setup.note ? `${prompt}\n\n${setup.note}` : prompt, images, command: cli.command });
  } catch (error) {
    // A start that throws sends no event, so the hold a setup handed to this turn would never be released.
    keepAwake.turnNotStarted(request.chatId);
    throw error;
  }
}

// Built on the first handover: agentCli is declared after the chats.
let handoverModels;

const chats = new ChatHost({
  states,
  startTurn: startAgentTurn,
  readSubagents: async ({ cwd, agents }) => {
    const cli = await agentCli("codex");
    return cli.problem ? [] : recoverCodexSubagents({ cwd, agents, command: cli.command, clientVersion: app.getVersion() });
  },
  nameChat: (projectPath, sessionId) => chatTitles.name(projectPath, sessionId),
  publish: publishAgentEvent,
  broadcast: broadcastProjectState,
  isFocused: () => Boolean(BrowserWindow.getFocusedWindow()),
  handoverTools: {
    writeTranscript: (input) => writeTranscript({ ...input, dir: path.join(app.getPath("userData"), "handovers") }),
    brief: ({ cwd, ...input }) => generateBrief({
      ...input,
      changedFiles: async () => (await execFileAsync("git", ["-C", cwd, "status", "--porcelain"], { encoding: "utf8" })).stdout.split("\n").filter(Boolean).map((line) => line.slice(3)),
    }, { models: (handoverModels ??= createHandoverModels({ cli: agentCli, clientVersion: app.getVersion() })) }),
  },
});

// A setup's steps show in the chat's turn like the agent's own.
const worktreeSetups = new WorktreeSetups({ send: (chatId, event) => void chats.receive(chatId, event), keepAwake });

// Each CLI is found and its version checked once per run; a missing or outdated one is checked again on the next message.
const agentCli = createCliCache({ ready: () => environmentReady, refresh: () => refreshInstallPath() });

const titleModels = createChatTitleModels({ cli: agentCli, clientVersion: app.getVersion() });
const chatTitles = new ChatTitles({ states, update: updateProject, generate: request => generateChatTitle(request, { models: titleModels }) });

ipcMain.handle("usage:read", () => readUsage());
ipcMain.handle("usage:cached", () => cachedSnapshot(usageStore, Date.now()));

// The "Commit and open PR" dialog: Milagre runs git and gh itself, in the chat's folder, once the login
// environment is in (gh from a Finder launch). Its one-shot text call starts the CLI agentCli found.
registerGitHandlers(ipcMain, {
  cli: (name) => agentCli(name),
  ready: () => environmentReady,
  clientVersion: app.getVersion(),
  knownFolders: async () => (await Promise.all(states.projects().map(discoverWorktrees))).flat().map((worktree) => worktree.path),
});

ipcMain.handle("chat:send", (_event, request) => {
  if (!states.has(request?.projectPath)) throw new Error("Open the project before sending to its chats.");
  return chats.send(request);
});
ipcMain.handle("chat:resume", (_event, projectPath, sessionId) => {
  if (!states.has(projectPath)) throw new Error("Open the project before continuing its chats.");
  return chats.resumeChat(projectPath, Number(sessionId));
});
ipcMain.handle("chat:handover", (_event, request) => {
  if (!states.has(request?.projectPath)) throw new Error("Open the project before handing over its chats.");
  return chats.handover(request);
});
ipcMain.handle("chat:handover-draft", (_event, projectPath, sessionId, text) => {
  if (!states.has(projectPath) || typeof sessionId !== "number" || typeof text !== "string") return undefined;
  return chats.setHandoverDraft(projectPath, sessionId, text).then(() => {});
});
ipcMain.handle("chat:patch", (_event, projectPath, sessionId, patch) => (states.has(projectPath) ? updateProject(projectPath, (state) => patchSession(state, sessionId, patch ?? {})).then(() => {}) : undefined));
// Opening a chat reads it. Only on opening: "Mark as unread" on the open chat sticks until it's opened again.
ipcMain.handle("chat:archive-subagent", (_event, projectPath, sessionId, id, archived) => (states.has(projectPath) ? updateProject(projectPath, (state) => archiveSubagent(state, sessionId, String(id), archived === true)).then(() => {}) : undefined));
ipcMain.handle("chat:archive-finished-subagents", (_event, projectPath, sessionId) => (states.has(projectPath) ? updateProject(projectPath, (state) => archiveFinishedSubagents(state, sessionId)).then(() => {}) : undefined));
// What the "Commit and open PR" dialog did, as a line in its chat.
ipcMain.handle("chat:git-note", (_event, chatId, body) => {
  if (typeof chatId !== "string" || typeof body !== "string" || !states.has(projectOfKey(chatId))) return undefined;
  return chats.addNote(chatId, { body, context: { kind: "git-action" } });
});
/** Reads the chat on screen: on opening it, and when a window regains focus over it. */
async function readOpenChat() {
  const chatId = chats.openChat;
  if (chatId && states.has(projectOfKey(chatId))) {
    await updateProject(projectOfKey(chatId), (state) => patchSession(state, sessionIdFromKey(chatId), { unread: false }));
    void chats.recoverSubagents(chatId).catch((error) => console.warn("Milagre couldn't refresh subagent outcomes:", error.message));
  }
}
ipcMain.handle("chat:set-open", (_event, chatId) => {
  chats.setOpenChat(chatId);
  return readOpenChat();
});
// A window that loads (or reloads) mid-turn picks the turns up where they are, cards included.
ipcMain.handle("chat:runs", () => chats.snapshot());

// What the model picker flags per agent: missing, outdated, broken or logged out. A ready CLI is looked at again
// after 5 minutes, a problem on every call.
const agentCliStatus = createCliStatus({ cli: agentCli, cwd: require("node:os").homedir(), clientVersion: app.getVersion() });
ipcMain.handle("agent:cli-status", () => agentCliStatus());
ipcMain.handle("agent:update-cli", async (_event, provider) => {
  const result = await runCliUpdate(provider);
  agentCli.invalidate(provider);
  agentCliStatus.invalidate(provider);
  const status = await agentCliStatus();
  return { ...result, status: status[provider] };
});

const agentModels = createModelCache({ cli: cliWhenLoggedIn(agentCli, agentCliStatus), cwd: require("node:os").homedir(), clientVersion: app.getVersion() });
ipcMain.handle("agent:models", () => agentModels());

ipcMain.handle("agent:interrupt", async (_event, chatId) => {
  await worktreeSetups.cancel(chatId);
  await agents.interrupt(chatId);
});

ipcMain.handle("agent:respond-permission", (_event, { chatId, requestId, decision }) => agents.respondToPermission(chatId, requestId, decision));

// The answers show in the chat as the user's message (`summary`), and are taken back if they don't reach the agent.
ipcMain.handle("agent:answer-question", async (_event, { chatId, requestId, answers, summary } = {}) => {
  const messageId = answers && typeof summary === "string" && summary && typeof chatId === "string" && states.has(projectOfKey(chatId)) ? await chats.recordAnswers(chatId, summary) : null;
  try {
    const accepted = await agents.answerQuestion(chatId, requestId, answers);
    if (!accepted && messageId !== null) await chats.takeBack(chatId, messageId);
    return accepted;
  } catch (error) {
    if (messageId !== null) await chats.takeBack(chatId, messageId);
    throw error;
  }
});

ipcMain.handle("agent:set-permission-mode", (_event, { chatId, mode }) => agents.setPermissionMode(chatId, mode));

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

let recentStore = null;
const recentProjects = () => (recentStore ??= createRecentProjects(path.join(app.getPath("userData"), "recent-projects.json")));
// Each way a project opens (launch, the folder dialog, a switch) puts it at the top of the recent list.
async function openProject(projectPath) {
  const project = await readProject(projectPath);
  await rememberProject(recentProjects(), projectPath);
  return project;
}

ipcMain.handle("project:current", async () => openProject(await launchProject(recentProjects(), process.cwd())));

// Chats a quit stopped continue on launch in every recent project, not only the one on screen.
async function resumeRecentProjects() {
  for (const { path: projectPath } of await recentProjects().list()) {
    const stored = states.has(projectPath) ? null : await readStoredState(projectPath);
    if (!Object.values(stored?.sessions ?? {}).some((session) => session.resumeTurn)) continue;
    await readProject(projectPath).catch((error) => console.warn(`Milagre couldn't resume the chats of ${projectPath}:`, error.message));
  }
}
ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open project",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return openProject(result.filePaths[0]);
});
ipcMain.handle("project:recent", () => recentProjects().list());
ipcMain.handle("project:switch", async (_event, requested) => openProject(await switchTarget(recentProjects(), requested)));
ipcMain.handle("project:forget", (_event, projectPath) => recentProjects().forget(projectPath));

app.whenReady().then(async () => {
  protocol.handle("milagre-media", createMediaHandler((url, options) => net.fetch(url, options)));
  app.setName("Milagre");
  if (process.platform === "darwin" && app.dock) {
    const appIcon = nativeImage.createFromPath(appIconPath);
    if (!appIcon.isEmpty()) app.dock.setIcon(appIcon);
  }
  createWindow();
  void resumeRecentProjects();
  app.on("browser-window-focus", () => {
    diffs.focused();
    void readOpenChat().catch(() => {});
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
    keepAwake.quit();
    ports.close();
    // Saved at once, so the chats resume even when stopping the agents runs out the clock.
    await chats.suspendRunning();
    await states.flush();
    await Promise.all([worktreeSetups.cancelAll(), agents.closeAll()]);
    await states.flush();
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
