// @ts-check
/** @typedef {typeof import("../app/src/electron.d.ts")} BridgeTypes */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

/** @type {Window["milagre"]} */
const bridge = {
  simulators: {
    list: (request) => ipcRenderer.invoke("simulator:list", request),
    attach: (request) => ipcRenderer.invoke("simulator:attach", request),
    detach: (request) => ipcRenderer.invoke("simulator:detach", request),
    open: (request) => ipcRenderer.invoke("simulator:open", request),
    offer: (request) => ipcRenderer.invoke("simulator:offer", request),
    status: (request) => ipcRenderer.invoke("simulator:status", request),
    control: (request) => ipcRenderer.invoke("simulator:control", request),
    input: (request) => ipcRenderer.invoke("simulator:input", request),
    close: (request) => ipcRenderer.invoke("simulator:close", request),
  },
  browsers: {
    list: (request) => ipcRenderer.invoke("browser:list", request),
    attach: (request) => ipcRenderer.invoke("browser:attach", request),
    open: (request) => ipcRenderer.invoke("browser:open", request),
    frame: (request) => ipcRenderer.invoke("browser:frame", request),
    status: (request) => ipcRenderer.invoke("browser:status", request),
    control: (request) => ipcRenderer.invoke("browser:control", request),
    input: (request) => ipcRenderer.invoke("browser:input", request),
    close: (request) => ipcRenderer.invoke("browser:close", request),
  },
  terminals: {
    list: (request) => ipcRenderer.invoke("terminal:list", request),
    open: (request) => ipcRenderer.invoke("terminal:open", request),
    read: (request) => ipcRenderer.invoke("terminal:read", request),
    input: (request) => ipcRenderer.invoke("terminal:input", request),
    resize: (request) => ipcRenderer.invoke("terminal:resize", request),
    close: (request) => ipcRenderer.invoke("terminal:close", request),
  },
  onTerminalsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:changed", listener);
    return () => ipcRenderer.removeListener("terminal:changed", listener);
  },
  // ⌘W closes the focused Terminal instead of the window; the main process needs to know where focus is to decide.
  setTerminalFocused: (focused) => ipcRenderer.send("app:terminal-focused", focused === true),
  onCloseFocusedTerminal: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:close-focused-terminal", listener);
    return () => ipcRenderer.removeListener("app:close-focused-terminal", listener);
  },
  artifacts: {
    get: (request) => ipcRenderer.invoke("artifact:get", request),
    list: (request) => ipcRenderer.invoke("artifact:list", request),
    addComments: (request) => ipcRenderer.invoke("artifact:add-comments", request),
    comments: (request) => ipcRenderer.invoke("artifact:comments", request),
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
  readAttachment: (file) => ipcRenderer.invoke("attachment:preview", file),
  searchProjectFiles: (root, query) => ipcRenderer.invoke("project:files", root, query),
  listSkills: (projectPath) => ipcRenderer.invoke("skills:list", projectPath),
  readSkill: (projectPath, file) => ipcRenderer.invoke("skills:read", projectPath, file),
  openSkill: (request) => ipcRenderer.invoke("skills:open", request),
  revealSkill: (projectPath, file) => ipcRenderer.invoke("skills:reveal", projectPath, file),
  listBranches: (projectPath) => ipcRenderer.invoke("project:branches", projectPath),
  getProjectImage: (projectPath) => ipcRenderer.invoke("project:image", projectPath),
  setProjectIcon: (projectPath, icon) => ipcRenderer.invoke("project:set-icon", projectPath, icon),
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
  readMainSync: (projectPath) => ipcRenderer.invoke("main-sync:read", projectPath),
  saveMainSync: (projectPath, override) => ipcRenderer.invoke("main-sync:save", projectPath, override),
  readMainSyncDefault: () => ipcRenderer.invoke("main-sync:default:read"),
  saveMainSyncDefault: (value) => ipcRenderer.invoke("main-sync:default:save", value),
  onMainSyncStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("main-sync:status", listener);
    return () => ipcRenderer.removeListener("main-sync:status", listener);
  },
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
  setProjectHidden: (projectPath, hidden) => ipcRenderer.invoke("project:set-hidden", projectPath, hidden),
  readProject: (projectPath) => ipcRenderer.invoke("project:read", projectPath),
  listNamedLinks: () => ipcRenderer.invoke("link:list"),
  createNamedLink: (request) => ipcRenderer.invoke("link:create", request),
  updateNamedLink: (request) => ipcRenderer.invoke("link:update", request),
  openNamedLink: (id) => ipcRenderer.invoke("link:open", id),
  readLink: (id) => ipcRenderer.invoke("link:snapshot", id),
  sendLinkMessage: (request) => ipcRenderer.invoke("link:send", request),
  onLinkState: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on("link:state", listener);
    return () => ipcRenderer.removeListener("link:state", listener);
  },
  listProjects: () => ipcRenderer.invoke("project:registry"),
  setProjectPosition: (id, position) => ipcRenderer.invoke("project:position", id, position),
  getCanvas: () => ipcRenderer.invoke("canvas:snapshot"),
  addLink: (a, b) => ipcRenderer.invoke("canvas:link-add", a, b),
  removeLink: (id) => ipcRenderer.invoke("canvas:link-remove", id),
  setWorktreePosition: (id, worktreePath, position) => ipcRenderer.invoke("canvas:worktree-position", id, worktreePath, position),
  openCanvasProject: (projectPath) => ipcRenderer.invoke("canvas:open-project", projectPath),
  getLinkedWork: () => ipcRenderer.invoke("linked:snapshot"),
  stopNegotiation: (id) => ipcRenderer.invoke("linked:stop-negotiation", id),
  onAppShortcut: (callback) => {
    const listener = (_event, key) => callback(key);
    ipcRenderer.on("app:shortcut", listener);
    return () => ipcRenderer.removeListener("app:shortcut", listener);
  },
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
  patchChat: (projectPath, sessionId, patch) => ipcRenderer.invoke("chat:patch", projectPath, sessionId, patch),
  archiveSubagent: (projectPath, sessionId, id, archived) => ipcRenderer.invoke("chat:archive-subagent", projectPath, sessionId, id, archived),
  archiveFinishedSubagents: (projectPath, sessionId) => ipcRenderer.invoke("chat:archive-finished-subagents", projectPath, sessionId),
  addGitNote: (chatId, body) => ipcRenderer.invoke("chat:git-note", chatId, body),
  setOpenChat: (chatId) => ipcRenderer.invoke("chat:set-open", chatId),
  getRuns: () => ipcRenderer.invoke("chat:runs"),
  getMessage: (scope, id) => ipcRenderer.invoke("chat:message", scope, id),
  readState: (scope) => ipcRenderer.invoke("state:read", scope),
  readChatMessages: (scope, chatId, options) => ipcRenderer.invoke("chat:messages", scope, chatId, options),
  searchChats: (scope, query, options) => ipcRenderer.invoke("chat:search", scope, query, options),
  listAccountScopes: () => ipcRenderer.invoke("accounts:scopes"),
  getProjectAccounts: (scopeKey, refresh) => ipcRenderer.invoke("accounts:scope", scopeKey, refresh),
  assignProjectAccount: (scopeKey, provider, accountId) => ipcRenderer.invoke("accounts:assign", scopeKey, provider, accountId),
  getModels: (scopeKey) => ipcRenderer.invoke("agent:models", scopeKey),
  getCliStatus: (scopeKey) => ipcRenderer.invoke("agent:cli-status", scopeKey),
  updateCli: (provider) => ipcRenderer.invoke("agent:update-cli", provider),
  stopAdvisor: (chatId, id) => ipcRenderer.invoke("advisor:stop", chatId, id),
  retryAdvisor: (chatId, id) => ipcRenderer.invoke("advisor:retry", chatId, id),
  onCliProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("agent:cli-progress", listener);
    return () => ipcRenderer.removeListener("agent:cli-progress", listener);
  },
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
  getReleaseChannel: () => ipcRenderer.invoke("update:channel"),
  setReleaseChannel: (channel) => ipcRenderer.invoke("update:set-channel", channel),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  getPhoneStatus: () => ipcRenderer.invoke("phone:status"),
  setPhoneEnabled: (enabled) => ipcRenderer.invoke("phone:set-enabled", enabled),
  setPhoneLan: (enabled) => ipcRenderer.invoke("phone:set-lan", enabled),
  resetPhoneAccess: () => ipcRenderer.invoke("phone:reset"),
  openPhonePairing: () => ipcRenderer.invoke("phone:open-pairing"),
  onPhoneStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("phone:status", listener);
    return () => ipcRenderer.removeListener("phone:status", listener);
  },
  listAccounts: (refresh = false) => ipcRenderer.invoke("accounts:list", refresh),
  accountAction: (action, provider, value) => ipcRenderer.invoke(`accounts:${action}`, provider, value),
  onAccountsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("accounts:changed", listener);
    return () => ipcRenderer.removeListener("accounts:changed", listener);
  },
  readUsage: (scopeKey) => ipcRenderer.invoke("usage:read", scopeKey),
  setKeepAwake: (enabled) => ipcRenderer.invoke("app:set-keep-awake", enabled),
  getCachedUsage: (scopeKey) => ipcRenderer.invoke("usage:cached", scopeKey),
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
