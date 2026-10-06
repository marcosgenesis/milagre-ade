// @ts-check
/** @typedef {import("../app/src/electron.d.ts")} BridgeTypes */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

/** @type {Window["milagre"]} */
const bridge = {
  simulators: {
    list: () => ipcRenderer.invoke("simulator:list"),
    open: request => ipcRenderer.invoke("simulator:open", request),
    offer: request => ipcRenderer.invoke("simulator:offer", request),
    status: request => ipcRenderer.invoke("simulator:status", request),
    control: request => ipcRenderer.invoke("simulator:control", request),
    input: request => ipcRenderer.invoke("simulator:input", request),
    close: request => ipcRenderer.invoke("simulator:close", request),
  },
  browsers: {
    list: request => ipcRenderer.invoke("browser:list", request),
    attach: request => ipcRenderer.invoke("browser:attach", request),
    open: request => ipcRenderer.invoke("browser:open", request),
    frame: request => ipcRenderer.invoke("browser:frame", request),
    status: request => ipcRenderer.invoke("browser:status", request),
    control: request => ipcRenderer.invoke("browser:control", request),
    input: request => ipcRenderer.invoke("browser:input", request),
    close: request => ipcRenderer.invoke("browser:close", request),
  },
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
  listNamedLinks: () => ipcRenderer.invoke('link:list'),
  createNamedLink: request => ipcRenderer.invoke('link:create', request),
  openNamedLink: id => ipcRenderer.invoke('link:open', id),
  sendLinkMessage: request => ipcRenderer.invoke('link:send', request),
  onLinkState: callback => { const listener = (_event, update) => callback(update); ipcRenderer.on('link:state', listener); return () => ipcRenderer.removeListener('link:state', listener); },
  listProjects: () => ipcRenderer.invoke("project:registry"),
  setProjectPosition: (id, position) => ipcRenderer.invoke("project:position", id, position),
  getCanvas: () => ipcRenderer.invoke("canvas:snapshot"),
  addLink: (a, b) => ipcRenderer.invoke("canvas:link-add", a, b),
  removeLink: (id) => ipcRenderer.invoke("canvas:link-remove", id),
  setWorktreePosition: (id, worktreePath, position) => ipcRenderer.invoke("canvas:worktree-position", id, worktreePath, position),
  openCanvasProject: (projectPath) => ipcRenderer.invoke("canvas:open-project", projectPath),
  getLinkedWork: () => ipcRenderer.invoke("linked:snapshot"),
  stopNegotiation: (id) => ipcRenderer.invoke("linked:stop-negotiation", id),
  onLinkedWork: (callback) => {
    const listener = (_event, work) => callback(work);
    ipcRenderer.on("linked:changed", listener);
    return () => ipcRenderer.removeListener("linked:changed", listener);
  },
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
  getPhoneStatus: () => ipcRenderer.invoke("phone:status"),
  setPhoneEnabled: (enabled) => ipcRenderer.invoke("phone:set-enabled", enabled),
  resetPhoneAccess: () => ipcRenderer.invoke("phone:reset"),
  openPhonePairing: () => ipcRenderer.invoke("phone:open-pairing"),
  onPhoneStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("phone:status", listener);
    return () => ipcRenderer.removeListener("phone:status", listener);
  },
  listAccounts: (refresh = false) => ipcRenderer.invoke("accounts:list", refresh),
  accountAction: (action, provider, value) => ipcRenderer.invoke(`accounts:${action}`, provider, value),
  onAccountsChanged: (callback) => { const listener = () => callback(); ipcRenderer.on("accounts:changed", listener); return () => ipcRenderer.removeListener("accounts:changed", listener); },
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
  onOpenPhoneSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("notification:open-phone-settings", listener);
    return () => ipcRenderer.removeListener("notification:open-phone-settings", listener);
  },
};
contextBridge.exposeInMainWorld("milagre", bridge);
