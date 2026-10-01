const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("milagre", {
  listSkills: (projectPath) => ipcRenderer.invoke("skills:list", projectPath),
  listBranches: (projectPath) => ipcRenderer.invoke("project:branches", projectPath),
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  createWorktree: (request) => ipcRenderer.invoke("worktree:create", request),
  getCurrentProject: () => ipcRenderer.invoke("project:current"),
  openProject: () => ipcRenderer.invoke("project:open"),
  saveProject: (projectPath, state) => ipcRenderer.invoke("project:save", projectPath, state),
  sendToAgent: (request) => ipcRenderer.invoke("agent:send", request),
  cancelAgent: () => ipcRenderer.invoke("agent:cancel"),
  getUpdateState: () => ipcRenderer.invoke("update:state"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
});
