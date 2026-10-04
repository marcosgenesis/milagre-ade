const { PROVIDERS } = require("@milagre/shared/providers");
const { ChatTitles, createChatTitleModels, generateChatTitle } = require("./chat-title.cjs");
const { createGit } = require("./git/client.cjs");
const fs = require("node:fs/promises");
const { acquireOwnership } = require("./ownership.cjs");
const { mkdirSync, realpathSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { migrateImages } = require("./project-content.cjs");
const { decodeImages } = require("./image-input.cjs");
const { KeepAwake } = require("./keep-awake.cjs");
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
const { createPullRequestReader, readPullRequests } = require("./pull-request.cjs");
const { emptyState, reconcileState, markDisconnectedSubagents } = require("./project-state.cjs");
const { migrateWorktreeChats } = require("./worktree-chats.cjs");
const { ProjectStates } = require("./project-states.cjs");
const { DiffRefresher } = require("./diff-refresh.cjs");
const { projectOfKey, sessionIdFromKey } = require("@milagre/shared/agent-runs");
const { archiveFinishedSubagents, archiveSubagent, patchSession, renameWorktree } = require("@milagre/shared/project-edits");
const { attentionContext, attentionNotice } = require("@milagre/shared/attention");
const { resolveProjectImage } = require("./project-image.cjs");
const { saveProjectState, readProjectState, stateFile } = require("./project-store.cjs");
const { createRecentProjects, launchProject, rememberProject, switchTarget } = require("./recent-projects.cjs");
const { activeWorktrees, resolveProject } = require("./project-identity.cjs");
const { createProjectRegistry } = require("./project-registry.cjs");
const { createUsageReader } = require("./usage.cjs");
const { createUsageStore, cachedSnapshot } = require("./usage-cache.cjs");

const { createFileSearch } = require("./project-files.cjs");
const git = createGit().read;

// The composition root shared by Electron and the local daemon. Storage paths and
// OS/UI actions belong to the host; command names and payloads match the preload.
function createRuntime(options) {
  const { dataDir, version, cwd = process.cwd(), emit = () => {}, isFocused = () => false } = options;
  if (typeof dataDir !== "string" || !path.isAbsolute(dataDir)) throw new Error("An absolute data directory is required");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dataOwner = acquireOwnership(path.join(realpathSync(dataDir), "runtime.lock"));
  const projectOwners = new Map();
  const repositoryOwners = new Map();
  const active = new Set();
  const starting = new Set();
  const background = new Set();
  let closing = false;
  let closed;
  function track(work, set = active) {
    const task = Promise.resolve().then(work);
    set.add(task);
    task.then(() => set.delete(task), () => set.delete(task));
    return task;
  }
  function accept(work) {
    if (closing) return Promise.reject(new Error("Milagre runtime is closing"));
    return track(work);
  }
  async function ownProject(projectPath) {
    if (typeof projectPath !== "string" || !path.isAbsolute(projectPath)) throw new Error("An absolute Project path is required");
    const real = realpathSync(projectPath);
    const checkAlias = existing => {
      if (existing.openedAs !== projectPath) throw new Error(`Project is already open as ${existing.openedAs}`);
    };
    if (projectOwners.has(real)) { checkAlias(projectOwners.get(real)); return; }
    let common;
    try {
      common = await git.commonDir(real);
    } catch (error) {
      if (error.code !== 128 || !/not a git repository/i.test(error.stderr ?? "")) throw error;
    }
    // Another open of this path may have finished while git was running.
    if (projectOwners.has(real)) { checkAlias(projectOwners.get(real)); return; }
    let repositoryOwner;
    if (common && !repositoryOwners.has(common)) repositoryOwner = acquireOwnership(path.join(common, "milagre-runtime.lock"));
    try {
      const owner = acquireOwnership(path.join(real, ".milagre", "runtime.lock"));
      projectOwners.set(real, { openedAs: projectPath, owner });
      if (repositoryOwner) repositoryOwners.set(common, repositoryOwner);
    } catch (error) {
      repositoryOwner?.release();
      throw error;
    }
  }
  const handlers = new Map();
  const commands = { handle(name, handler) {
    if (handlers.has(name)) throw new Error(`Duplicate command: ${name}`);
    handlers.set(name, handler);
  } };
  const searchFiles = createFileSearch();
  const environmentReady = options.environmentReady ?? loadLoginEnvironment().then(({ source }) => {
    if (source === "fallback") console.warn("Milagre couldn't read your login shell's environment; looking for agents in common install folders.");
  }, (error) => console.warn("Milagre couldn't read your login shell's environment:", error.message));
  const usageStore = createUsageStore({ file: path.join(dataDir, "usage-cache.json") });
  const readUsage = createUsageReader({ ready: () => environmentReady, store: usageStore });

  async function discoverWorktrees(projectPath) {
    // A failed read is not evidence that every Worktree was removed.
    return activeWorktrees(projectPath);
  }

  async function readStoredState(projectPath) {
    await ownProject(projectPath);
    try {
      return await readProjectState(projectPath);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  /** The saved state as written, without hydrating subagent transcripts or taking ownership; null when there is none. */
  async function readRawState(projectPath) {
    try {
      return JSON.parse(await fs.readFile(stateFile(projectPath), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  const projectName = (projectPath) => path.basename(projectPath) || "Untitled project";
  // Revisions of one run never match another run's, so a client that outlives a host restart never trusts an old one.
  const runId = randomUUID().slice(0, 8);

  // Chats brought back from linked worktrees' old files, per project, until a window opening it shows the notice.
  const restoredChats = new Map();

  // Before #117 a linked worktree opened as a project kept its chats in its own file. They join the main checkout's
  // state on the first read, before anything uses it. This runs inside ProjectStates' read for the project, after
  // ownProject took the repository's owner lock, so neither another window nor another runtime merges at the same time.
  // Bringing chats back never stops a repository from opening: any failure leaves the files and keeps the stored state.
  async function withWorktreeChats(projectPath, stored, discovered) {
    try {
      if (discovered.length < 2 || await fs.realpath(discovered[0].path).catch(() => null) !== projectPath) return stored;
      const { state, restored } = await migrateWorktreeChats({
        projectPath,
        state: stored ?? emptyState(projectName(projectPath)),
        linkedWorktrees: discovered.slice(1),
        listed: new Set(discovered.map((worktree) => worktree.path)),
        save: saveProjectState,
      });
      if (!restored.length) return stored;
      restoredChats.set(projectPath, [...(restoredChats.get(projectPath) ?? []), ...restored]);
      return state;
    } catch (error) {
      console.warn(`Milagre couldn't bring back chats saved in ${projectPath}'s linked worktrees:`, error.message);
      return stored;
    }
  }

  // Every project's state goes through here: this runtime is its only writer (see ADR-0001 and ADR-0003).
  const states = new ProjectStates({
    read: async (projectPath) => {
      const stored = await readStoredState(projectPath);
      const discovered = await discoverWorktrees(projectPath);
      return reconcileState(await withWorktreeChats(projectPath, stored, discovered), projectName(projectPath), discovered);
    },
    save: saveProjectState,
  });

  function broadcastProjectState(projectPath, state) {
    emit("project:state", { path: projectPath, state });
  }

  /** Applies a change to a project's state and tells the windows when it changed. */
  async function updateProject(projectPath, change) {
    const result = await states.update(projectPath, change);
    if (result.changed) broadcastProjectState(projectPath, result.state);
    return result.state;
  }

  // Explicit user edits keep their existing error contract. The flush waits outside
  // the mutation queue, so other Chats continue receiving streaming events.
  async function editProject(projectPath, change) {
    const result = await states.update(projectPath, change);
    if (result.changed) broadcastProjectState(projectPath, result.state);
    await states.flush(projectPath);
  }

  const diffs = new DiffRefresher({ states, readDiffStat, update: updateProject });

  // Reading a project matches its worktrees with the ones git lists now. A project read before keeps the
  // state this run has built, so a chat's turn that's still running isn't lost.
  // A subagent saved as running without a live agent session behind it (after a restart) is marked disconnected.
  async function readProject(projectPath) {
    await ownProject(projectPath);
    const discovered = await discoverWorktrees(projectPath);
    const live = (sessionId) => {
      const entry = agents.sessions.get(`${projectPath}#${sessionId}`);
      return Boolean(entry && !entry.session.closed);
    };
    let state = await updateProject(projectPath, async (current) => {
      const next = reconcileState(current, projectName(projectPath), discovered);
      return migrateImages(projectPath, markDisconnectedSubagents(next, new Set(Object.keys(next.sessions).map(Number).filter(live))));
    });
    // A chat a quit stopped continues now; its message is saved before the project is returned, so the window shows it.
    await chats.resumeInterrupted(projectPath, state).catch((error) => console.warn("Milagre couldn't resume a chat:", error.message));
    state = await states.get(projectPath);
    chatTitles.resume(projectPath, state);
    void chats.recoverHandovers(projectPath, state).catch((error) => console.warn("Milagre couldn't recover a handover:", error.message));
    void diffs.refresh(projectPath).catch(() => {});
    return { path: projectPath, name: projectName(projectPath), state };
  }

  commands.handle("project:files", async (_event, root, query) => {
    if (!states.worktreePaths().includes(root)) throw new Error("Choose an open project's worktree.");
    return searchFiles(root, query);
  });
  // Path-taking commands only serve folders the user opened: an open project, one of its worktrees, or a recent
  // project (the switcher shows their avatars). Any renderer or paired phone script otherwise reaches any folder.
  async function knownFolder(folder) {
    if (typeof folder !== "string" || !path.isAbsolute(folder)) throw new Error("An absolute Project path is required");
    if (states.has(folder) || states.worktreePaths().includes(folder)) return;
    if ((await recentProjects().list()).some(item => item.path === folder)) return;
    throw new Error("Open this project in Milagre first.");
  }
  commands.handle("skills:list", async (_event, projectPath) => { await knownFolder(projectPath); return discoverSkills(projectPath); });
  commands.handle("project:branches", async (_event, projectPath) => { await knownFolder(projectPath); return listBranches(projectPath); });
  // The avatar lookup runs `gh`, which a Finder launch only finds once the login environment is applied.
  commands.handle("project:image", async (_event, projectPath) => {
    await knownFolder(projectPath);
    await environmentReady;
    return resolveProjectImage(projectPath);
  });
  // Packaged builds get their release version from electron-builder metadata, not the source package.json.
  commands.handle("app:version", () => version);
  // Where Milagre's worktrees live. An unpackaged build can point it elsewhere (live checks use a temporary folder).
  function worktreeRoot() {
    return options.worktreeRoot || DEFAULT_WORKTREE_ROOT;
  }

  let projectSettingsStore = null;
  function projectSettings() {
    projectSettingsStore ??= createProjectSettings(path.join(dataDir, "project-settings.json"));
    return projectSettingsStore;
  }

  commands.handle("worktree:roots", async () => {
    const root = worktreeRoot();
    return [...new Set([root, await fs.realpath(root).catch(() => root)])];
  });
  // The git calls below wait for the login environment, so they run with the merged PATH.
  commands.handle("worktree:status", async (_event, worktreePath, base) => {
    await knownFolder(worktreePath);
    await environmentReady;
    return worktreeStatus(worktreePath, base);
  });
  // The renderer sends what the user saw (base, status, chat) and the project; main re-checks after closing the chat's agent.
  // The path and branch are read from git as they are now, so a branch renamed after creation is found as it is.
  commands.handle("worktree:remove", async (_event, worktreePath, options = {}) => {
    const { force, base, projectPath, chatId, seen } = options;
    await ownProject(projectPath);
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
  commands.handle("files-to-copy:read", async (_event, projectPath) => {
    await knownFolder(projectPath);
    await environmentReady;
    const { filesToCopy } = await projectSettings().get(projectPath);
    return { filesToCopy, ...(await previewFilesToCopy(projectPath, filesToCopy)) };
  });
  commands.handle("files-to-copy:preview", async (_event, projectPath, patterns) => {
    await knownFolder(projectPath);
    await environmentReady;
    return previewFilesToCopy(projectPath, patterns);
  });
  commands.handle("files-to-copy:save", async (_event, projectPath, patterns) => {
    await knownFolder(projectPath);
    await environmentReady;
    const { filesToCopy } = await projectSettings().setFilesToCopy(projectPath, patterns);
    return { filesToCopy, ...(await previewFilesToCopy(projectPath, filesToCopy)) };
  });
  // The setup command new worktrees run: the repo's .milagre/worktree.json, else the project's setting.
  async function readSetupCommand(projectPath) {
    const { setupCommand } = await projectSettings().get(projectPath);
    return { setupCommand, ...(await resolveSetupCommand(projectPath, setupCommand)) };
  }
  commands.handle("worktree-setup:read", async (_event, projectPath) => { await knownFolder(projectPath); return readSetupCommand(projectPath); });
  commands.handle("worktree-setup:save", async (_event, projectPath, command) => {
    await knownFolder(projectPath);
    await projectSettings().setSetupCommand(projectPath, typeof command === "string" ? command : "");
    return readSetupCommand(projectPath);
  });

  // A new worktree starts on its prompt's first words; a better name replaces its branch's once Haiku
  // picks one, so the chat never waits on it.
  async function nameWorktree(projectPath, created, prompt) {
    // The CLI check waits for the login environment and resolves the path the SDK starts directly (no shell). A
    // missing or broken Claude has no command, and the name stays the prompt's first words.
    const cli = await agentCli("claude");
    const slug = await suggestWorktreeName(prompt, { command: cli.problem ? null : cli.command, timeoutMs: 15_000 });
    if (closing) return;
    const name = await renameWorktreeBranch({ worktreePath: created.path, branch: created.branch, slug });
    if (!name) return;
    await updateProject(projectPath, (state) => renameWorktree(state, { path: created.path, from: created.branch, name }));
    emit("worktree:renamed", { projectPath, path: created.path, from: created.branch, name });
  }

  commands.handle("worktree:create", async (event, { projectPath, baseBranch, prompt }) => {
    // Only these fields come from the renderer: the worktree folder and the files copied into it are main's call.
    const request = { projectPath, baseBranch, prompt };
    await ownProject(projectPath);
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
    void track(() => nameWorktree(request.projectPath, created, request.prompt ?? ""), background).catch(() => {});
    return { project: { ...project, state }, worktreeId: listed.id, ...(resolved.note ? { setupNote: resolved.note } : {}) };
  });
  // Re-reads some worktrees' diff stats at once, e.g. after a commit from the "Commit and open PR" dialog.
  commands.handle("worktree:refresh-diffs", (_event, projectPath, worktreeIds) => {
    if (!states.has(projectPath) || !Array.isArray(worktreeIds)) return undefined;
    return diffs.refresh(projectPath, worktreeIds.filter((id) => Number.isInteger(id)));
  });
  const readPullRequest = createPullRequestReader();
  commands.handle("worktree:pull-request", async (_event, worktreePath) => {
    await environmentReady;
    return readPullRequest(worktreePath);
  });
  commands.handle("worktree:pull-requests", async (_event, worktreePath, refs) => {
    await environmentReady;
    return readPullRequests(worktreePath, refs);
  });
  // While any chat's turn or a new worktree's setup runs the Mac stays awake (the screen can still sleep).
  // On until the renderer pushes the saved setting.
  const keepAwake = options.keepAwake ?? new KeepAwake({ powerSaveBlocker: { start: () => 0, isStarted: () => true, stop() {} }, enabled: false });
  commands.handle("app:set-keep-awake", (_event, enabled) => keepAwake.setEnabled(enabled === true));

  function publishAgentEvent(chatId, event, state, seq) {
    options.observeAgentEvent?.(chatId, event);
    keepAwake.observe(chatId, event);
    void notifyIfWaiting(chatId, event).catch(() => {});
    diffs.observe(chatId, event);
    // A turn that just failed on a login problem makes a "ready" picker status out of date.
    if (event.type === "turn-failed" && event.login) {
      for (const name of PROVIDERS) if (event.message === loginMessage(name)) agentCliStatus.invalidate(name);
    }
    emit("agent:event", { chatId, event, ...(state ? { state } : {}), ...(seq ? { seq } : {}) });
  }

  const agents = new SessionManager({
    createSession: options.createSession ?? ((provider, options) => (provider === "codex"
      ? new CodexSession({ ...options, clientVersion: version })
      : new ClaudeSession(options))),
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
    isRunning: () => [...agents.sessions.values()].some(entry => entry.session.turnActive),
    roots: () => new Map([...agents.processes()].map(([chatId, root]) => [chatId, { ...root, cwd: realCwd(root.cwd) }])),
    publish: (next) => {
      emit("agent:ports", next);
    },
  });
  commands.handle("agent:ports", () => ports.snapshot());
  // The renderer is untrusted: only a pid the chat's port list shows can be stopped.
  commands.handle("agent:stop-port", (_event, chatId, pid) => (typeof chatId === "string" && Number.isInteger(pid) ? ports.stopPort(chatId, pid) : false));

  async function startAgentTurn(request) {
    if (closing) return { turnId: null, steered: false };
    const images = decodeImages(request.images);
    const prompt = await expandSkillPrompt(request.cwd, request.prompt);
    const cli = await agentCli(request.provider === "codex" ? "codex" : "claude");
    // A CLI that is missing, too old or doesn't start fails the turn like any other failure, with its own message.
    if (cli.problem) {
      await chats.receive(request.chatId, failedWith(cli.problem));
      return { turnId: null, steered: false };
    }
    // A new worktree's first turn waits for its setup command; one that failed tells the agent, one that was stopped stops the turn.
    if (closing) return { turnId: null, steered: false };
    const setup = await worktreeSetups.beforeTurn(request.chatId, request.cwd);
    if (closing || setup.cancelled) {
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
    startTurn: request => track(() => startAgentTurn(request), starting),
    readSubagents: async ({ cwd, agents }) => {
      const cli = await agentCli("codex");
      return cli.problem ? [] : recoverCodexSubagents({ cwd, agents, command: cli.command, clientVersion: version });
    },
    nameChat: (projectPath, sessionId) => chatTitles.name(projectPath, sessionId),
    publish: publishAgentEvent,
    broadcast: broadcastProjectState,
    isFocused: () => isFocused(),
    isChatFocused: options.isChatFocused,
    handoverTools: {
      writeTranscript: (input) => track(() => writeTranscript({ ...input, dir: path.join(dataDir, "handovers") }), background),
      brief: ({ cwd, ...input }) => generateBrief({
        ...input,
        changedFiles: async () => (await git.text(cwd, ["status", "--porcelain"])).split("\n").filter(Boolean).map((line) => line.slice(3)),
      }, { models: (handoverModels ??= createHandoverModels({ cli: agentCli, clientVersion: version })) }),
    },
  });

  // A setup's steps show in the chat's turn like the agent's own.
  const worktreeSetups = new WorktreeSetups({ send: (chatId, event) => void chats.receive(chatId, event), keepAwake });

  // Each CLI is found and its version checked once per run; a missing or outdated one is checked again on the next message.
  const agentCli = options.agentCli ?? createCliCache({ ready: () => environmentReady, refresh: () => refreshInstallPath() });

  const titleModels = options.titleModels ?? createChatTitleModels({ cli: agentCli, clientVersion: version });
  const chatTitles = new ChatTitles({ states, update: updateProject, generate: request => generateChatTitle(request, { models: titleModels }) });

  commands.handle("usage:read", () => readUsage());
  commands.handle("usage:cached", () => cachedSnapshot(usageStore, Date.now()));

  // The "Commit and open PR" dialog: Milagre runs git and gh itself, in the chat's folder, once the login
  // environment is in (gh from a Finder launch). Its one-shot text call starts the CLI agentCli found.
  registerGitHandlers(commands, {
    cli: (name) => agentCli(name),
    ready: () => environmentReady,
    clientVersion: version,
    knownFolders: () => states.worktreePaths(),
  });

  commands.handle("chat:send", (_event, request) => {
    if (!states.has(request?.projectPath)) throw new Error("Open the project before sending to its chats.");
    return chats.send(request);
  });
  commands.handle("chat:resume", (_event, projectPath, sessionId) => {
    if (!states.has(projectPath)) throw new Error("Open the project before continuing its chats.");
    return chats.resumeChat(projectPath, Number(sessionId));
  });
  commands.handle("chat:handover", (_event, request) => {
    if (!states.has(request?.projectPath)) throw new Error("Open the project before handing over its chats.");
    return chats.handover(request);
  });
  commands.handle("chat:handover-draft", (_event, projectPath, sessionId, text) => {
    if (!states.has(projectPath) || typeof sessionId !== "number" || typeof text !== "string") return undefined;
    return chats.setHandoverDraft(projectPath, sessionId, text).then(() => {});
  });
  commands.handle("chat:patch", (_event, projectPath, sessionId, patch) => (states.has(projectPath) ? editProject(projectPath, (state) => patchSession(state, sessionId, patch ?? {})).then(() => {}) : undefined));
  // Opening a chat reads it. Only on opening: "Mark as unread" on the open chat sticks until it's opened again.
  commands.handle("chat:archive-subagent", (_event, projectPath, sessionId, id, archived) => (states.has(projectPath) ? editProject(projectPath, (state) => archiveSubagent(state, sessionId, String(id), archived === true)).then(() => {}) : undefined));
  commands.handle("chat:archive-finished-subagents", (_event, projectPath, sessionId) => (states.has(projectPath) ? editProject(projectPath, (state) => archiveFinishedSubagents(state, sessionId)).then(() => {}) : undefined));
  // What the "Commit and open PR" dialog did, as a line in its chat.
  commands.handle("chat:git-note", (_event, chatId, body) => {
    if (typeof chatId !== "string" || typeof body !== "string" || !states.has(projectOfKey(chatId))) return undefined;
    return chats.addNote(chatId, { body, context: { kind: "git-action" } });
  });
  /** Reads the chat on screen: on opening it, and when a window regains focus over it. */
  async function readOpenChat(chatId = chats.openChat) {
    if (chatId && states.has(projectOfKey(chatId))) {
      await updateProject(projectOfKey(chatId), (state) => patchSession(state, sessionIdFromKey(chatId), { unread: false }));
      void track(() => chats.recoverSubagents(chatId), background).catch((error) => console.warn("Milagre couldn't refresh subagent outcomes:", error.message));
    }
  }
  commands.handle("chat:set-open", (_event, chatId) => {
    chats.setOpenChat(chatId);
    return readOpenChat();
  });
  // A window that loads (or reloads) mid-turn picks the turns up where they are, cards included.
  commands.handle("chat:runs", () => chats.snapshot());

  // What the model picker flags per agent: missing, outdated, broken or logged out. A ready CLI is looked at again
  // after 5 minutes, a problem on every call.
  const agentCliStatus = createCliStatus({ cli: agentCli, cwd: require("node:os").homedir(), clientVersion: version });
  commands.handle("agent:cli-status", () => agentCliStatus());
  commands.handle("agent:update-cli", async (_event, provider) => {
    const result = await runCliUpdate(provider);
    agentCli.invalidate(provider);
    agentCliStatus.invalidate(provider);
    const status = await agentCliStatus();
    return { ...result, status: status[provider] };
  });

  const agentModels = createModelCache({ cli: cliWhenLoggedIn(agentCli, agentCliStatus), cwd: require("node:os").homedir(), clientVersion: version });
  commands.handle("agent:models", () => agentModels());

  commands.handle("agent:interrupt", async (_event, chatId) => {
    await worktreeSetups.cancel(chatId);
    await agents.interrupt(chatId);
  });

  commands.handle("agent:respond-permission", (_event, { chatId, requestId, decision }) => agents.respondToPermission(chatId, requestId, decision));

  // The answers show in the chat as the user's message (`summary`), and are taken back if they don't reach the agent.
  commands.handle("agent:answer-question", async (_event, { chatId, requestId, answers, summary } = {}) => {
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

  commands.handle("agent:set-permission-mode", (_event, { chatId, mode }) => agents.setPermissionMode(chatId, mode));


  async function notifyIfWaiting(chatId, event) {
    const projectPath = projectOfKey(chatId);
    if (!options.notifyWaiting || !states.has(projectPath) || !("requestId" in event)) return;
    const notice = attentionNotice(event, attentionContext(await states.get(projectPath), projectName(projectPath), sessionIdFromKey(chatId)));
    if (notice) options.notifyWaiting({ chatId, requestId: event.requestId, ...notice });
  }

  let shownProjectPath = null;
  let recentStore = null;
  const recentProjects = () => (recentStore ??= createRecentProjects(path.join(dataDir, "recent-projects.json")));
  let registryStore = null;
  const projectRegistry = () => (registryStore ??= createProjectRegistry(path.join(dataDir, "project-registry.json")));
  // Each way a project opens (launch, the folder dialog, a switch) puts it at the top of the recent list.
  async function openProject(projectPath) {
    const identity = await resolveProject(projectPath);
    const project = await readProject(identity.path);
    await projectRegistry().add(identity);
    await rememberProject(recentProjects(), identity.path);
    shownProjectPath = identity.path;
    // The first window to open the project after chats came back says so, once. A read at startup (resuming a turn)
    // or after removing a worktree keeps the notice for it.
    const restored = restoredChats.get(identity.path);
    restoredChats.delete(identity.path);
    return restored ? { ...project, restoredChats: restored } : project;
  }

  commands.handle("project:current", async () => openProject(await launchProject(recentProjects(), cwd)));

  // Chats a quit stopped continue on launch in every recent project, not only the one on screen.
  async function resumeRecentProjects() {
    const resolved = new Set();
    for (const { path: recentPath } of await recentProjects().list()) {
      let projectPath = recentPath;
      try {
        // An entry from before #117 can name a linked worktree. It is read as its repository, as opening it would be,
        // so its old file is never loaded as a project of its own (whose saves would recreate it after its chats came back).
        projectPath = (await resolveProject(recentPath)).path;
        if (resolved.has(projectPath)) continue;
        resolved.add(projectPath);
        // The raw JSON is enough to find a pending turn; only a project that has one is loaded (and hydrated) in full.
        const stored = states.has(projectPath) ? null : await readRawState(projectPath);
        if (!Object.values(stored?.sessions ?? {}).some((session) => session.resumeTurn)) continue;
        await readProject(projectPath);
      } catch (error) { console.warn(`Milagre couldn't resume the chats of ${projectPath}:`, error.message); }
    }
  }
  commands.handle("project:registry", () => projectRegistry().list());
  commands.handle("project:position", (_event, id, position) => projectRegistry().setPosition(id, position));
  commands.handle("project:recent", () => recentProjects().list());
  // `revision` names the state returned; a caller that passes the one it holds as `unlessRevision` (the phone's bridge,
  // polling) gets `unchanged: true` instead of the whole state again.
  commands.handle("project:snapshot", async (_event, projectPath, options) => {
    if (!states.has(projectPath)) throw new Error("Open the project before reading its snapshot.");
    const state = await states.get(projectPath);
    const revision = `${runId}.${states.revisionOf(state)}`;
    if (options?.unlessRevision === revision) return { path: projectPath, name: projectName(projectPath), revision, unchanged: true };
    return { path: projectPath, name: projectName(projectPath), revision, state };
  });
  // What the phone's media check needs, without the whole state.
  commands.handle("project:worktree-paths", async (_event, projectPath) => {
    if (!states.has(projectPath)) throw new Error("Open the project before reading its worktrees.");
    return Object.values((await states.get(projectPath)).worktrees ?? {}).map((worktree) => worktree.path);
  });
  commands.handle("project:switch", async (_event, requested) => openProject(await switchTarget(recentProjects(), requested)));
  commands.handle("project:forget", (_event, projectPath) => recentProjects().forget(projectPath));


  function close() {
    closing = true;
    closed ??= (async () => {
      await Promise.allSettled([...active]);
      keepAwake.quit();
      ports.close();
      diffs.close();
      if (!states.closed) {
        await chats.suspendRunning();
        // A failed early save must not leave provider processes running. The
        // final flush retries after their cancellation events have been recorded.
        await states.flush().catch(() => {});
        await Promise.allSettled([worktreeSetups.cancelAll(), agents.closeAll()]);
        await Promise.allSettled([...starting]);
        await agents.closeAll();
        await Promise.allSettled([...background, ...chatTitles.pending.values(), ...chats.pendingHandovers.values()]);
      }
      await states.close();
      await usageStore.idle();
      for (const { owner } of projectOwners.values()) owner.release();
      for (const owner of repositoryOwners.values()) owner.release();
      dataOwner.release();
    })().catch(error => {
      // Retain ownership and unsaved memory until the host reports the error and
      // retries. A rejected Promise must not permanently disable that retry.
      closed = undefined;
      throw error;
    });
    return closed;
  }

  return {
    methods: Object.freeze([...handlers.keys()]),
    invoke(method, args = []) {
      return accept(() => {
        if (!handlers.has(method)) throw new Error(`Unknown command: ${method}`);
        if (!Array.isArray(args)) throw new Error("Command arguments must be an array");
        return handlers.get(method)(null, ...args);
      });
    },
    openProject: projectPath => accept(() => openProject(projectPath)),
    resumeRecentProjects: () => accept(resumeRecentProjects),
    environmentReady,
    // Synchronous capture: the socket serializes this before another event can
    // mutate state, so its event watermark and run sequence describe one instant.
    snapshot: () => ({ projects: states.projects().map(projectPath => ({ path: projectPath, name: projectName(projectPath), state: states.states.get(projectPath) })), runs: chats.snapshot(), ports: ports.snapshot() }),
    focused: (view) => accept(() => { diffs.focused(view ? view.projectPath : shownProjectPath); return readOpenChat(view ? view.chatId : chats.openChat); }),
    flush: async () => { await Promise.allSettled([...active]); await states.flush(); await usageStore.idle(); },
    close,
  };
}

module.exports = { createRuntime };
