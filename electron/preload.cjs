const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("milagre", {
  getPathForFile: (file) => webUtils.getPathForFile(file),
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
  onWorktreeRenamed: (callback) => {
    const listener = (_event, rename) => callback(rename);
    ipcRenderer.on("worktree:renamed", listener);
    return () => ipcRenderer.removeListener("worktree:renamed", listener);
  },
  readDiffStat: (worktreePath, base) => ipcRenderer.invoke("worktree:diffstat", worktreePath, base),
  revealWorktree: (worktreePath) => ipcRenderer.invoke("worktree:reveal", worktreePath),
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
  saveProject: (projectPath, state) => ipcRenderer.invoke("project:save", projectPath, state),
  startTurn: (request) => ipcRenderer.invoke("agent:start-turn", request),
  getModels: () => ipcRenderer.invoke("agent:models"),
  getCliStatus: () => ipcRenderer.invoke("agent:cli-status"),
  interruptAgent: (chatId) => ipcRenderer.invoke("agent:interrupt", chatId),
  respondToPermission: (chatId, requestId, decision) => ipcRenderer.invoke("agent:respond-permission", { chatId, requestId, decision }),
  answerQuestion: (chatId, requestId, answers) => ipcRenderer.invoke("agent:answer-question", { chatId, requestId, answers }),
  setAgentPermissionMode: (chatId, mode) => ipcRenderer.invoke("agent:set-permission-mode", { chatId, mode }),
  onAgentEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  getUpdateState: () => ipcRenderer.invoke("update:state"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  readUsage: () => ipcRenderer.invoke("usage:read"),
  setKeepAwake: (enabled) => ipcRenderer.invoke("app:set-keep-awake", enabled),
  getCachedUsage: () => ipcRenderer.invoke("usage:cached"),
  notifyAttention: (notice) => ipcRenderer.invoke("notification:attention", notice),
  onOpenChat: (callback) => {
    const listener = (_event, chatId) => callback(chatId);
    ipcRenderer.on("notification:open-chat", listener);
    return () => ipcRenderer.removeListener("notification:open-chat", listener);
  },
});
