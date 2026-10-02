const path = require("node:path");
const { createGitActions } = require("./git-actions.cjs");
const { GENERATION_FAILED, claudeModel, codexModel, generateGitText } = require("./git-text.cjs");

function folder(cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) throw new Error("The chat's folder must be an absolute path.");
  return cwd;
}

const text = (value, limit = 20_000) => (typeof value === "string" ? value.slice(0, limit) : "");

/** The chat context the renderer sends for the dialog's text, kept to the fields the prompt uses. */
function chatContext(chat = {}) {
  return {
    chatTitle: text(chat.chatTitle, 500),
    firstMessage: text(chat.firstMessage),
    recentMessages: Array.isArray(chat.recentMessages) ? chat.recentMessages.slice(-10).map((message) => text(message)) : [],
    testCommands: Array.isArray(chat.testCommands) ? chat.testCommands.slice(-20).map((item) => ({ command: text(item?.command, 500), status: item?.status === "failed" ? "failed" : "done" })) : [],
  };
}

/**
 * Handlers for the "Commit and open PR" dialog: git:changes, git:generate, git:commit, git:push and
 * git:open-pr. Commands run in the chat's folder with the app's environment.
 */
function registerGitHandlers(ipcMain, { executable, clientVersion, env = process.env, actions = createGitActions({ env }), models } = {}) {
  const textModels = models ?? {
    claude: claudeModel({ getCommand: () => executable("claude") }),
    codex: codexModel({ getCommand: () => executable("codex"), clientVersion }),
  };
  ipcMain.handle("git:changes", (_event, { cwd, base } = {}) => actions.readChanges({ cwd: folder(cwd), base }));
  ipcMain.handle("git:generate", async (_event, { cwd, base, provider, chat } = {}) => {
    try {
      const context = await actions.readTextContext({ cwd: folder(cwd), base });
      return await generateGitText({ ...chatContext(chat), ...context }, { provider: provider === "codex" ? "codex" : "claude", models: textModels });
    } catch {
      return { ok: false, message: GENERATION_FAILED };
    }
  });
  ipcMain.handle("git:commit", (_event, { cwd, message } = {}) => actions.commit({ cwd: folder(cwd), message }));
  ipcMain.handle("git:push", (_event, { cwd } = {}) => actions.push({ cwd: folder(cwd) }));
  ipcMain.handle("git:open-pr", (_event, { cwd, base, title, body } = {}) => actions.openPr({ cwd: folder(cwd), base, title, body }));
}

module.exports = { registerGitHandlers };
