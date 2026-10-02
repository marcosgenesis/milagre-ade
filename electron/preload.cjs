const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("milagre", {
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
  revealInFolder: (folder) => ipcRenderer.invoke("project:reveal", folder),
  git: {
    changes: (request) => ipcRenderer.invoke("git:changes", request),
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
  switchProject: (projectPath) => ipcRenderer.invoke("project:switch", projectPath),
  forgetProject: (projectPath) => ipcRenderer.invoke("project:forget", projectPath),
  onProjectState: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on("project:state", listener);
    return () => ipcRenderer.removeListener("project:state", listener);
  },
  sendMessage: (request) => ipcRenderer.invoke("chat:send", request),
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
  syncNotifications: (state) => ipcRenderer.invoke("notification:state", state),
  notifyCompletion: (notice) => ipcRenderer.invoke("notification:completed", notice),
  onOpenChat: (callback) => {
    const listener = (_event, chatId) => callback(chatId);
    ipcRenderer.on("notification:open-chat", listener);
    return () => ipcRenderer.removeListener("notification:open-chat", listener);
  },
});
