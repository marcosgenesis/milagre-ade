// @ts-check
/** @typedef {import("../app/src/electron.d.ts")} BridgeTypes */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

/** @type {Window["milagre"]} */
const bridge = {
  getRuntimeConnection: () => ipcRenderer.invoke("runtime:connection"),
  restartHost: () => ipcRenderer.invoke("runtime:restart-host"),
  onRuntimeConnection: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("runtime:connection", listener);
    return () => ipcRenderer.removeListener("runtime:connection", listener);
  },
  onRuntimeSnapshot: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("runtime:snapshot", listener);
    return () => ipcRenderer.removeListener("runtime:snapshot", listener);
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  searchProjectFiles: (root, query) => ipcRenderer.invoke("project:files", root, query),
  listSkills: (projectPath) => ipcRenderer.invoke("skills:list", projectPath),
  listBranches: (projectPath) => ipcRenderer.invoke("project:branches", projectPath),
  getProjectImage: (projectPath) => ipcRenderer.invoke("project:image", projectPath),
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  createWorktree: (request) => ipcRenderer.invoke("worktree:create", request),
  getWorktreeRoots: () => ipcRenderer.invoke("worktree:roots"),
  getWorktreeStatus: (worktreePath, base) => ipcRenderer.invoke("worktree:status", worktreePath, base),
  removeWorktree: (worktreePath, options) => ipcRenderer.invoke("worktree:remove", worktreePath, options),
  readFilesToCopy: (projectPath) => ipcRenderer.invoke("files-to-copy:read", projectPath),
  previewFilesToCopy: (projectPath, patterns) => ipcRenderer.invoke("files-to-copy:preview", projectPath, patterns),
  saveFilesToCopy: (projectPath, patterns) => ipcRenderer.invoke("files-to-copy:save", projectPath, patterns),
  readWorktreeSetup: (projectPath) => ipcRenderer.invoke("worktree-setup:read", projectPath),
  saveWorktreeSetup: (projectPath, command) => ipcRenderer.invoke("worktree-setup:save", projectPath, command),
  onWorktreeRenamed: (callback) => {
    const listener = (_event, rename) => callback(rename);
    ipcRenderer.on("worktree:renamed", listener);
    return () => ipcRenderer.removeListener("worktree:renamed", listener);
  },
  refreshDiffs: (projectPath, worktreeIds) => ipcRenderer.invoke("worktree:refresh-diffs", projectPath, worktreeIds),
  readPullRequest: (worktreePath) => ipcRenderer.invoke("worktree:pull-request", worktreePath),
  readPullRequests: (worktreePath, refs) => ipcRenderer.invoke("worktree:pull-requests", worktreePath, refs),
  revealInFolder: (folder) => ipcRenderer.invoke("project:reveal", folder),
  copyImage: (file) => ipcRenderer.invoke("image:copy", file),
  saveImage: (file, name) => ipcRenderer.invoke("image:save", file, name),
  showImageMenu: (file, name) => ipcRenderer.invoke("image:menu", file, name),
  git: {
    changes: (request) => ipcRenderer.invoke("git:changes", request),
    diffFiles: (request) => ipcRenderer.invoke("git:diff-files", request),
    diffFile: (request) => ipcRenderer.invoke("git:diff-file", request),
    generate: (request) => ipcRenderer.invoke("git:generate", request),
    commit: (request) => ipcRenderer.invoke("git:commit", request),
    push: (request) => ipcRenderer.invoke("git:push", request),
    openPr: (request) => ipcRenderer.invoke("git:open-pr", request),
  },
  listEditors: () => ipcRenderer.invoke("editor:list"),
  openInEditor: (request) => ipcRenderer.invoke("editor:open", request),
  getCurrentProject: () => ipcRenderer.invoke("project:current"),
  openProject: () => ipcRenderer.invoke("project:open"),
  listRecentProjects: () => ipcRenderer.invoke("project:recent"),
  listProjects: () => ipcRenderer.invoke("project:registry"),
  setProjectPosition: (id, position) => ipcRenderer.invoke("project:position", id, position),
  switchProject: (projectPath) => ipcRenderer.invoke("project:switch", projectPath),
  forgetProject: (projectPath) => ipcRenderer.invoke("project:forget", projectPath),
  retryQuit: () => ipcRenderer.invoke("app:retry-quit"),
  onQuitFailed: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("app:quit-failed", listener);
    return () => ipcRenderer.removeListener("app:quit-failed", listener);
  },
  onProjectState: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on("project:state", listener);
    return () => ipcRenderer.removeListener("project:state", listener);
  },
  sendMessage: (request) => ipcRenderer.invoke("chat:send", request),
  resumeChat: (projectPath, sessionId) => ipcRenderer.invoke("chat:resume", projectPath, sessionId),
  handover: (request) => ipcRenderer.invoke("chat:handover", request),
  setHandoverDraft: (projectPath, sessionId, text) => ipcRenderer.invoke("chat:handover-draft", projectPath, sessionId, text),
  patchChat: (projectPath, sessionId, patch) => ipcRenderer.invoke("chat:patch", projectPath, sessionId, patch),
  archiveSubagent: (projectPath, sessionId, id, archived) => ipcRenderer.invoke("chat:archive-subagent", projectPath, sessionId, id, archived),
  archiveFinishedSubagents: (projectPath, sessionId) => ipcRenderer.invoke("chat:archive-finished-subagents", projectPath, sessionId),
  addGitNote: (chatId, body) => ipcRenderer.invoke("chat:git-note", chatId, body),
  setOpenChat: (chatId) => ipcRenderer.invoke("chat:set-open", chatId),
  getRuns: () => ipcRenderer.invoke("chat:runs"),
  getModels: () => ipcRenderer.invoke("agent:models"),
  getCliStatus: () => ipcRenderer.invoke("agent:cli-status"),
  updateCli: (provider) => ipcRenderer.invoke("agent:update-cli", provider),
  interruptAgent: (chatId) => ipcRenderer.invoke("agent:interrupt", chatId),
  respondToPermission: (chatId, requestId, decision) => ipcRenderer.invoke("agent:respond-permission", { chatId, requestId, decision }),
  answerQuestion: (chatId, requestId, answers, summary) => ipcRenderer.invoke("agent:answer-question", { chatId, requestId, answers, summary }),
  setAgentPermissionMode: (chatId, mode) => ipcRenderer.invoke("agent:set-permission-mode", { chatId, mode }),
  onAgentEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  getAgentPorts: () => ipcRenderer.invoke("agent:ports"),
  stopAgentPort: (chatId, pid) => ipcRenderer.invoke("agent:stop-port", chatId, pid),
  onAgentPorts: (callback) => {
    const listener = (_event, ports) => callback(ports);
    ipcRenderer.on("agent:ports", listener);
    return () => ipcRenderer.removeListener("agent:ports", listener);
  },
  getUpdateState: () => ipcRenderer.invoke("update:state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  readUsage: () => ipcRenderer.invoke("usage:read"),
  setKeepAwake: (enabled) => ipcRenderer.invoke("app:set-keep-awake", enabled),
  getCachedUsage: () => ipcRenderer.invoke("usage:cached"),
  setNotifyWhenWaiting: (on) => ipcRenderer.invoke("settings:notify-when-waiting", on),
  setWindowTranslucent: (on, theme) => ipcRenderer.invoke("settings:window-translucent", { on, theme }),
  syncNotifications: (state) => ipcRenderer.invoke("notification:state", state),
  notifyCompletion: (notice) => ipcRenderer.invoke("notification:completed", notice),
  onOpenChat: (callback) => {
    const listener = (_event, chatId) => callback(chatId);
    ipcRenderer.on("notification:open-chat", listener);
    return () => ipcRenderer.removeListener("notification:open-chat", listener);
  },
};
contextBridge.exposeInMainWorld("milagre", bridge);
