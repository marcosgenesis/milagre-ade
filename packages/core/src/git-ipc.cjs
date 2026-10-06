const fs = require("node:fs/promises");
const path = require("node:path");
const { createGitActions } = require("./git-actions.cjs");
const { createGitDiff } = require("./git-diff.cjs");
const { GENERATION_FAILED, claudeModel, codexModel, generateGitText } = require("./git-text.cjs");

const NOT_A_CHAT_FOLDER = "This folder isn't one of the open project's chats.";

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
 * git:open-pr, plus git:diff-files and git:diff-file for the Changes panel's diff view. They only act in a chat's folder: one of `knownFolders()` (the open projects'
 * checkouts), and the top of its checkout (git-actions checks that). Every call waits for `ready()`
 * (the login shell's environment), so git and gh are found from a Finder launch; commands run in the
 * folder with that environment. `cli(name)` is main's CLI check: `{ command, problem }`, the path the
 * SDK and Codex start directly, without a shell.
 */
function registerGitHandlers(ipcMain, { cli, ready = () => undefined, clientVersion, env = process.env, actions = createGitActions({ env }), diff = createGitDiff({ env }), models, knownFolders } = {}) {
  const command = (name) => async () => {
    const status = await cli(name);
    return status?.problem ? null : status ?? null;
  };
  const textModels = models ?? {
    claude: claudeModel({ getCommand: command("claude") }),
    codex: codexModel({ getCommand: command("codex"), clientVersion }),
  };

  async function folder(cwd) {
    if (typeof cwd !== "string" || !path.isAbsolute(cwd)) throw new Error("The chat's folder must be an absolute path.");
    await ready();
    if (knownFolders) {
      const real = await fs.realpath(cwd).catch(() => null);
      const known = await Promise.all((await knownFolders()).map((item) => fs.realpath(item).catch(() => null)));
      if (!real || !known.includes(real)) throw new Error(NOT_A_CHAT_FOLDER);
    }
    return cwd;
  }

  ipcMain.handle("git:changes", async (_event, { cwd, base } = {}) => actions.readChanges({ cwd: await folder(cwd), base }));
  ipcMain.handle("git:diff-files", async (_event, { cwd, base, mode } = {}) => diff.listDiffFiles({ cwd: await folder(cwd), base, mode }));
  ipcMain.handle("git:diff-file", async (_event, { cwd, base, mode, path: file, oldPath, untracked } = {}) => diff.readDiffFile({ cwd: await folder(cwd), base, mode, path: file, oldPath, untracked }));
  ipcMain.handle("git:generate", async (_event, { cwd, base, provider, chat } = {}) => {
    const checked = await folder(cwd);
    try {
      const context = await actions.readTextContext({ cwd: checked, base });
      return await generateGitText({ ...chatContext(chat), ...context }, { provider: provider === "codex" ? "codex" : "claude", models: textModels });
    } catch {
      return { ok: false, message: GENERATION_FAILED };
    }
  });
  ipcMain.handle("git:commit", async (_event, { cwd, message } = {}) => actions.commit({ cwd: await folder(cwd), message }));
  ipcMain.handle("git:push", async (_event, { cwd } = {}) => actions.push({ cwd: await folder(cwd) }));
  ipcMain.handle("git:open-pr", async (_event, { cwd, base, title, body } = {}) => actions.openPr({ cwd: await folder(cwd), base, title, body }));
}

module.exports = { NOT_A_CHAT_FOLDER, registerGitHandlers };
