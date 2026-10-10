const { isLinkScopeKey } = require("@milagre/shared/chat-scopes");
const path = require("node:path");
const { chatKey, lastUserModel, projectOfKey, runStatus, sessionIdFromKey } = require("@milagre/shared/agent-runs");
const { activeWorktrees } = require("./project-identity.cjs");
const { linkedWorktrees } = require("./project-links.cjs");
const { Delegations, jsonFileStore } = require("./delegations.cjs");
const { chatLabel, createLinkedReads, delegationReply, linkedToolDefinitions } = require("./linked-tools.cjs");
const { createLinkedMcpServer } = require("./linked-mcp-server.cjs");

// Every turn and tool call of a linked Chat asks which Worktrees are active; git is asked again after this long.
const ACTIVE_TTL_MS = 3000;

/**
 * What a Chat gets from its Links (spec 003): the summary at the start of each turn, the linked tools for
 * either provider, and the Delegations they make. The runtime supplies its parts:
 *   registry() -> the Project registry; project(path) -> the Project's state, loading the Project if needed (it can
 *   leave out unloaded Chats' messages: see message-store.cjs); messages(path, chatIds) -> those Chats' messages, whole,
 *   or every message without chatIds; bodies(path, chatIds) -> their ids, roles and bodies
 *   chats -> the ChatHost; agents -> the SessionManager; emit(channel, payload) -> the windows
 */
function createLinkedWorktrees({
  dataDir,
  registry,
  project,
  messages = async (projectPath, chatIds) => {
    const all = (await project(projectPath)).messages;
    return chatIds ? all.filter((message) => chatIds.includes(message.session_id)) : all;
  },
  bodies = messages,
  chats,
  agents,
  emit,
  extraTools = () => [],
  store = jsonFileStore(path.join(dataDir, "delegations.json")),
}) {
  // Codex Chats whose provider refused the linked tools: they get the summary and receive Delegations only.
  const receiveOnly = new Set();
  const tools = new Map();
  const activeCache = new Map();

  function active(projectPath) {
    const cached = activeCache.get(projectPath);
    if (cached && Date.now() - cached.at < ACTIVE_TTL_MS) return cached.paths;
    const paths = activeWorktrees(projectPath).then(
      (worktrees) => worktrees.map((worktree) => worktree.path),
      () => [],
    );
    activeCache.set(projectPath, { at: Date.now(), paths });
    return paths;
  }

  /** The Worktrees a Chat can see, each with the Link that reaches it and the Chat's own Worktree. */
  async function sides(chatId) {
    const projectPath = projectOfKey(chatId);
    const { projects, links } = await registry().snapshot();
    const state = await project(projectPath);
    const session = state.sessions[sessionIdFromKey(chatId)];
    const ownBindings = isLinkScopeKey(projectPath)
      ? (session?.worktrees ?? [])
      : [{ projectId: projects.find((entry) => entry.path === projectPath)?.id, worktreePath: state.worktrees[session?.worktree_id]?.path }];
    const owned = new Set(ownBindings.map((member) => member.worktreePath));
    const found = new Map();
    for (const member of ownBindings) {
      const source = projects.find((entry) => entry.id === member.projectId);
      if (!source || !member.worktreePath) continue;
      const relevant = links.filter((link) => link.a.project_id === source.id || link.b.project_id === source.id);
      if (!relevant.length) continue;
      const ids = new Set([source.id, ...relevant.flatMap((link) => [link.a.project_id, link.b.project_id])]);
      const reach = Object.fromEntries(
        await Promise.all(
          [...ids].map(async (id) => {
            const entry = projects.find((item) => item.id === id);
            return [id, entry ? await active(entry.path) : []];
          }),
        ),
      );
      for (const item of linkedWorktrees({ project_id: source.id, worktree_path: member.worktreePath }, relevant, reach)) {
        if (owned.has(item.worktree_path)) continue;
        const entry = projects.find((candidate) => candidate.id === item.project_id);
        const key = `${item.project_id}\0${item.worktree_path}`;
        if (!found.has(key)) found.set(key, { ...item, projectPath: entry.path, projectName: entry.name, sourceWorktree: member.worktreePath });
      }
    }
    return [...found.values()];
  }

  const reads = createLinkedReads({
    sides,
    state: project,
    messages,
    bodies,
    runs: () => chats.runs,
    receiveOnly: (key) => receiveOnly.has(key),
    open: (side) => delegations.openBetween(side.sourceWorktree, side.worktree_path),
  });

  async function chat(key) {
    const projectPath = projectOfKey(key);
    const state = await project(projectPath).catch(() => null);
    const session = state?.sessions[sessionIdFromKey(key)];
    if (!session) return null;
    return {
      label: chatLabel(path.basename(projectPath), state, session.id),
      worktreePath: state.worktrees[session.worktree_id]?.path,
      archived: Boolean(session.archived),
    };
  }

  // A delivered message runs on the receiving Chat's latest turn settings. A Chat with none this run takes
  // its own provider and model, else the Project's last used, else the requesting Chat's; its permission
  // mode is Ask until the user picks one there.
  function turnOptions(key, state, requester) {
    const latest = chats.turnSettings(key);
    if (latest) return latest;
    const session = state.sessions[sessionIdFromKey(key)];
    const lastUsed = state.messages.findLast((message) => message.role === "user" && message.model && state.sessions[message.session_id]?.provider);
    const fallback = chats.turnSettings(requester) ?? {};
    return {
      provider: session?.provider ?? (lastUsed ? state.sessions[lastUsed.session_id].provider : (fallback.provider ?? "claude")),
      model: lastUserModel(state, session.id) || lastUsed?.model || fallback.model,
      permissionMode: "ask",
      tldrEnabled: fallback.tldrEnabled,
      replies: fallback.replies,
    };
  }

  // Resolves once the message is saved, with `started`: what took it (see Delegations' deliver port).
  async function deliver(key, { body, prompt, context }) {
    const projectPath = projectOfKey(key);
    let state = await project(projectPath);
    const session = state.sessions[sessionIdFromKey(key)];
    if (!session) throw new Error("that Chat is no longer in its Project");
    // The Project's last used model is read across every Chat, unloaded ones too, when the Chat has no turn this run.
    if (!chats.turnSettings(key)) state = { ...state, messages: await messages(projectPath) };
    const { started } = await chats.send({
      body,
      prompt,
      context,
      images: [],
      files: [],
      ...turnOptions(key, state, context.from),
      projectPath,
      sessionId: session.id,
      worktreeId: session.worktree_id,
    });
    return { started };
  }

  function setToolsAvailable(chatId, available) {
    if (available === !receiveOnly.has(chatId)) return;
    if (available) receiveOnly.delete(chatId);
    else receiveOnly.add(chatId);
    emit("linked:changed", snapshot());
  }

  const snapshot = () => ({ ...delegations.snapshot(), receiveOnly: [...receiveOnly] });

  const delegations = new Delegations({
    store,
    ports: {
      async target(fromChat, worktreePath) {
        const side = (await sides(fromChat)).find((item) => item.worktree_path === worktreePath);
        if (!side) return null;
        const state = await project(side.projectPath);
        const worktree = Object.values(state.worktrees).find((item) => item.path === worktreePath);
        if (worktree?.sharedChat) throw new Error("Delegation into a shared Link Chat is not supported. Read its canonical transcript instead.");
        return { link_id: side.link_id, projectPath: side.projectPath, projectName: side.projectName, branch: worktree?.name ?? path.basename(worktreePath) };
      },
      chat,
      async openChat(projectPath, worktreePath) {
        const state = await project(projectPath);
        const worktree = Object.values(state.worktrees).find((item) => item.path === worktreePath);
        if (!worktree) throw new Error("That Worktree is no longer in its Project.");
        return chatKey(projectPath, await chats.emptyChat(projectPath, worktree.id));
      },
      status: (key) => runStatus(chats.runs[key]),
      deliver,
      note: (key, note) => chats.addNote(key, note),
      reply: async (key, delegationId) => delegationReply(await messages(projectOfKey(key), [sessionIdFromKey(key)]), sessionIdFromKey(key), delegationId),
      permissionMode: (key) => agents.permissionMode(key),
      approve: (key, request) => agents.askApproval(key, request),
      changed: () => emit("linked:changed", snapshot()),
    },
  });

  const mcp = createLinkedMcpServer({ toolsFor });

  function toolsFor(chatId) {
    if (!tools.has(chatId))
      tools.set(
        chatId,
        linkedToolDefinitions(chatId, {
          reads,
          delegations: isLinkScopeKey(projectOfKey(chatId))
            ? {
                delegate: async () => {
                  throw new Error("Delegation from a shared Link Chat is not supported. Use its canvas read tools.");
                },
                conclude: async () => {
                  throw new Error("Shared Link Chats do not host Negotiations.");
                },
              }
            : delegations,
        }),
      );
    return [...tools.get(chatId), ...extraTools(chatId)];
  }

  return {
    /** What a new agent session of the Chat gets: its tools, the MCP endpoint Codex reaches them at, and a way to say whether Codex took them. */
    forChat: (chatId) => ({
      tools: toolsFor(chatId),
      url: () => mcp.url(chatId),
      toolsAvailable: (available) => setToolsAvailable(chatId, available),
    }),
    /** The summary for the start of a turn, or "" when nothing is linked. A failed read leaves it out. */
    context: (chatId) => reads.summary(chatId).catch(() => ""),
    observe: (chatId, event) => delegations.observe(chatId, event),
    linkRemoved: (id) => delegations.linkRemoved(id),
    /** "Always allow Delegations" from the sidebar's Link popover: the grant the approval card saves, set ahead. */
    async grant(chatId, linkId) {
      if (typeof chatId !== "string" || !chatId.includes("#")) throw new Error("Choose a Chat and a Link.");
      if (!(await registry().snapshot()).links.some((link) => link.id === linkId)) throw new Error("That Link no longer exists.");
      if (isLinkScopeKey(projectOfKey(chatId))) throw new Error("A shared Link Chat makes no Delegations.");
      await delegations.grant(chatId, linkId);
    },
    stop: (target) => delegations.stop(target),
    snapshot,
    close: () => mcp.close(),
  };
}

module.exports = { createLinkedWorktrees };
