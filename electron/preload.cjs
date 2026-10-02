const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("milagre", {
  listSkills: (projectPath) => ipcRenderer.invoke("skills:list", projectPath),
  listBranches: (projectPath) => ipcRenderer.invoke("project:branches", projectPath),
  getProjectImage: (projectPath) => ipcRenderer.invoke("project:image", projectPath),
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  createWorktree: (request) => ipcRenderer.invoke("worktree:create", request),
  readDiffStat: (worktreePath, base) => ipcRenderer.invoke("worktree:diffstat", worktreePath, base),
  revealWorktree: (worktreePath) => ipcRenderer.invoke("worktree:reveal", worktreePath),
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
  notifyAttention: (notice) => ipcRenderer.invoke("notification:attention", notice),
  onOpenChat: (callback) => {
    const listener = (_event, chatId) => callback(chatId);
    ipcRenderer.on("notification:open-chat", listener);
    return () => ipcRenderer.removeListener("notification:open-chat", listener);
  },
});
