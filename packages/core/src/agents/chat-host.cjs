const { ChatImages } = require("../chat-images.cjs");
const { storeImages } = require("../project-content.cjs");
const { ipcErrorMessage } = require("@milagre/shared/result");
const { applyAgentEvent, chatKey, isTurnEnd, projectOfKey, recordAnswers, sessionIdFromKey } = require("@milagre/shared/agent-runs");
const { patchSession } = require("@milagre/shared/project-edits");
const { chatTitle } = require("@milagre/shared/chats");
const { renderTranscript, providerName } = require("./handover.cjs");

// A chat stopped longer ago than this waits for the user instead of continuing by itself.
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;
const RESUME_BODY = "Milagre restarted. Continue where you left off.";
const RESUME_PROMPT =
  "Milagre, the app running you, closed while you were working and has just opened again, so your last turn was cut off. Continue where you left off. Check what is already done before repeating any of it.";

// Saves every chat's turns, in whatever project, whether or not the window shows it. Agent events
// are folded into the chat's project state (see ProjectStates), and each one is published to the
// windows along with the state it changed, so a reply never shows twice or goes missing between
// its stream ending and its message appearing. A message is saved before its turn starts, and a
// message sent while the chat's turn runs splits the reply streamed so far above it, and a note added
// while it runs (what the commit dialog did) waits for the turn to end, so it lands after the reply. Every event
// folded into the runs is numbered, so a window that loads mid-turn takes the runs (see `snapshot`)
// and skips the events they already hold.
// A message the user sends replaces the brief waiting as a draft and any resume a quit left.
const withoutDraft = ({ handoverDraft, resumeTurn, ...rest }) => rest;

// A new chat in a worktree takes its chat that has no messages yet, if there is one (not a handover still
// waiting for its brief or holding it as a draft); otherwise one is made. Resolves the state with it.
function starterChat(latest, worktree) {
  const existing = Object.values(latest.sessions).find(
    (item) =>
      item.worktree_id === worktree.id &&
      !item.handoverPending &&
      item.handoverDraft === undefined &&
      !latest.messages.some((message) => message.session_id === item.id),
  );
  if (existing) return { state: latest, session: existing };
  const session = { id: latest.next_id, worktree_id: worktree.id, agent_name: worktree.name, status: "Created" };
  return { state: { ...latest, next_id: latest.next_id + 1, sessions: { ...latest.sessions, [session.id]: session } }, session };
}

class ChatHost {
  /**
   * `startTurn(request)` starts or steers the agent's turn (see SessionManager.startTurn);
   * `publish(chatId, event, state, seq)` sends an event to the windows, with the project's state when the
   * event changed it, and its number when it was folded into the runs; `broadcast(projectPath, state)` tells
   * them of a change no agent event made. `isFocused()` says whether a Milagre
   * window has focus: a turn that ends in the open chat while it hasn't leaves the chat unread too.
   */
  constructor({
    states,
    startTurn,
    publish,
    broadcast,
    isFocused = () => true,
    isChatFocused,
    nameChat = async () => {},
    readSubagents = async () => [],
    handoverTools,
    now = Date.now,
  }) {
    Object.assign(this, { states, startTurn, publish, broadcast, isFocused, isChatFocused, nameChat, readSubagents, handoverTools, now });
    this.pendingHandovers = new Map();
    this.subagentRecoveries = new Map();
    this.runs = {};
    this.images = new ChatImages({ states, runs: () => this.runs, broadcast });
    this.seq = 0;
    this.openChat = null;
    this.notes = new Map();
    // The options of each chat's latest turn, so a turn a quit stops can start again the same way.
    this.turns = new Map();
    this.quitting = false;
  }

  /** The turns streaming now, in every project, and the number of the last event they hold. */
  snapshot() {
    return { runs: this.runs, seq: this.seq };
  }

  /** The settings of the chat's latest turn this run (provider, model, permission mode…), or null. */
  turnSettings(chatId) {
    if (!this.turns.has(chatId)) return null;
    const { prompt: _prompt, ...settings } = this.turns.get(chatId);
    return settings;
  }

  /** A worktree's chat with no messages yet, made when it has none: where a message Milagre sends opens a new chat. Resolves with its id. */
  async emptyChat(projectPath, worktreeId) {
    let sessionId;
    const { state, changed } = await this.states.update(projectPath, (latest) => {
      const worktree = latest.worktrees[worktreeId];
      if (!worktree) throw new Error("That worktree is no longer in the project.");
      if (worktree.sharedChat) throw new Error("This Worktree belongs to a shared Link Chat. Open its Link instead.");
      const result = starterChat(latest, worktree);
      sessionId = result.session.id;
      return result.state;
    });
    if (changed) this.broadcast(projectPath, state);
    return sessionId;
  }

  /** The chat on screen, by chat key, or null. A turn that ends in any other chat leaves it unread. */
  setOpenChat(chatId) {
    this.openChat = typeof chatId === "string" ? chatId : null;
  }

  /** Recover saved unknown outcomes from provider history without starting a conversation turn. */
  recoverSubagents(chatId) {
    if (this.subagentRecoveries.has(chatId)) return this.subagentRecoveries.get(chatId);
    const pending = (async () => {
      const projectPath = projectOfKey(chatId);
      const sessionId = sessionIdFromKey(chatId);
      if (!this.states.has(projectPath) || this.runs[chatId] || this.quitting) return;
      const saved = await this.states.get(projectPath);
      const session = saved.sessions[sessionId];
      const cwd = session?.workspacePath ?? saved.worktrees?.[session?.worktree_id]?.path;
      if (!cwd || session?.provider !== "codex" || !session.native_session_id || session.archived) return;
      const unknown = (session.subagents ?? []).filter((agent) => agent.status === "unknown" && !agent.archived && agent.id !== session.native_session_id);
      if (!unknown.length) return;
      const events = await this.readSubagents({ cwd, agents: unknown });
      if (!events.length) return;
      const { state, changed } = await this.states.update(projectPath, (latest) => {
        const current = latest.sessions[sessionId];
        if (
          this.quitting ||
          this.runs[chatId] ||
          !current ||
          current.archived ||
          current.provider !== session.provider ||
          current.native_session_id !== session.native_session_id ||
          current.worktree_id !== session.worktree_id ||
          (current.workspacePath ?? latest.worktrees?.[current.worktree_id]?.path) !== cwd
        )
          return latest;
        let next = latest;
        for (const event of events) {
          if (event.type !== "subagent-update" || !["completed", "failed", "cancelled"].includes(event.agent?.status)) continue;
          const previous = unknown.find((agent) => agent.id === event.agent.id);
          // A new live event or an archive while history loads takes precedence over this snapshot.
          if (!previous || current.subagents?.find((agent) => agent.id === previous.id) !== previous) continue;
          next = applyAgentEvent(next, this.runs, projectPath, chatId, event).state;
        }
        return next;
      });
      if (changed) this.broadcast(projectPath, state);
    })().finally(() => this.subagentRecoveries.delete(chatId));
    this.subagentRecoveries.set(chatId, pending);
    return pending;
  }

  /** Folds one agent event into its chat's project, then publishes it. Events are published in the order they arrive. */
  receive(chatId, event) {
    // A turn the quit stops says so in its reply.
    if (this.quitting && event.type === "turn-cancelled") event = { ...event, quit: true };
    const projectPath = projectOfKey(chatId);
    const sessionId = sessionIdFromKey(chatId);
    let seq;
    let added = [];
    return this.states
      .update(
        projectPath,
        (state) => {
          const result = applyAgentEvent(state, this.runs, projectPath, chatId, event);
          this.runs = result.runs;
          seq = ++this.seq;
          if (!result.changed) return state;
          const visible = this.isChatFocused ? this.isChatFocused(chatId) : chatId === this.openChat && this.isFocused();
          const unread = isTurnEnd(event) && !visible && !result.state.sessions[sessionId]?.archived;
          const next = unread ? patchSession(result.state, sessionId, { unread: true }) : result.state;
          const recorded = isTurnEnd(event) ? this.withNotes(next, chatId) : next;
          const previousIds = new Set(state.messages.map((message) => message.id));
          added = recorded.messages.filter((message) => !previousIds.has(message.id) && message.role === "assistant");
          return recorded;
        },
        { persist: event.type !== "subagent-update" },
      )
      .then(
        async ({ state, changed }) => {
          this.publish(
            chatId,
            event.type === "subagent-update" && changed
              ? { ...event, agent: state.sessions[sessionId].subagents.find((agent) => agent.id === event.agent.id) }
              : event,
            changed && event.type !== "subagent-update" ? state : undefined,
            seq,
          );
          await this.captureImages(projectPath, state, added);
        },
        (error) => {
          console.warn(`Milagre couldn't record an agent event for ${chatId}:`, error.message);
          this.publish(chatId, event);
        },
      );
  }

  /** Capture newly saved replies after publication, outside the state mutation queue. */
  async captureImages(projectPath, state, messages) {
    for (const message of messages) {
      const captured = await this.images.capture(projectPath, state, message);
      if (captured === message) continue;
      const saved = await this.states
        .update(projectPath, (latest) => {
          const current = latest.messages.find((item) => item.id === message.id);
          if (current !== message) return latest;
          return { ...latest, messages: latest.messages.map((item) => (item === message ? captured : item)) };
        })
        .catch(() => null);
      if (saved?.changed) this.broadcast(projectPath, saved.state);
    }
  }

  /**
   * Saves the user's answers to a question as their message, after the reply streamed so far, and tells the
   * windows with an "answers-sent" event. Resolves with the message's id, or null when there's nothing to save.
   */
  async recordAnswers(chatId, body) {
    const projectPath = projectOfKey(chatId);
    let pendingId = null;
    await this.states.update(projectPath, (latest) => {
      const sessionId = sessionIdFromKey(chatId);
      const run = this.runs[chatId];
      if (!latest.sessions[sessionId] || !run || !body) return latest;
      pendingId = latest.next_id;
      return {
        ...latest,
        next_id: pendingId + 1,
        messages: [...latest.messages, { id: pendingId, session_id: sessionId, body, role: "user", context: null, model: run.model }],
      };
    });
    if (pendingId === null) return null;
    try {
      await this.states.flush(projectPath);
    } catch (error) {
      await this.takeBack(chatId, pendingId);
      throw error;
    }
    let messageId = null;
    let seq;
    let added = [];
    const { state } = await this.states.update(projectPath, (latest) => {
      const withoutPending = { ...latest, messages: latest.messages.filter((message) => message.id !== pendingId) };
      const result = recordAnswers(withoutPending, this.runs, projectPath, chatId, body);
      added = result.state.messages.slice(withoutPending.messages.length).filter((message) => message.role === "assistant");
      this.runs = result.runs;
      messageId = result.messageId;
      seq = ++this.seq;
      return result.state;
    });
    // No disk await between the current mutation and publication.
    this.publish(chatId, { type: "answers-sent" }, state, seq);
    await this.captureImages(projectPath, state, added);
    return messageId;
  }

  /** Removes a message again, such as answers that never reached the agent. */
  async takeBack(chatId, messageId) {
    const projectPath = projectOfKey(chatId);
    const { state, changed } = await this.states.update(projectPath, (latest) =>
      latest.messages.some((message) => message.id === messageId)
        ? { ...latest, messages: latest.messages.filter((message) => message.id !== messageId) }
        : latest,
    );
    if (changed) this.broadcast(projectPath, state);
  }

  /** Adds an assistant line that isn't a reply to a chat (`context` says what it is), after its running turn if it has one. */
  async addNote(chatId, { body, context }) {
    this.notes.set(chatId, [...(this.notes.get(chatId) ?? []), { body, context }]);
    if (this.runs[chatId]) return;
    const { state, changed } = await this.states.update(projectOfKey(chatId), (latest) => (this.runs[chatId] ? latest : this.withNotes(latest, chatId)));
    if (changed) this.broadcast(projectOfKey(chatId), state);
  }

  /** The state with the chat's waiting notes added. */
  withNotes(state, chatId) {
    const notes = this.notes.get(chatId);
    const sessionId = sessionIdFromKey(chatId);
    this.notes.delete(chatId);
    if (!notes || !state.sessions[sessionId]) return state;
    const messages = notes.map((note, index) => ({
      id: state.next_id + index,
      session_id: sessionId,
      body: note.body,
      context: note.context,
      role: "assistant",
    }));
    return { ...state, next_id: state.next_id + messages.length, messages: [...state.messages, ...messages] };
  }

  /**
   * Saves a message in its chat, a new one in the worktree when `sessionId` is null, then starts the
   * chat's turn, or steers the one running. Resolves with the chat's session id once the message is
   * saved, and with `started`: the turn starts in the background, and `started` resolves with what started it
   * ({ turnId, steered }), or null when it couldn't start (that fails in the chat).
   */
  async send(request) {
    const { projectPath, body, images = [], files = [], provider, model } = request;
    const execution = this.states.executionContext && request.sessionId != null ? await this.states.executionContext(projectPath, request.sessionId) : null;
    const storedImages = await storeImages(this.states.storageDirectory?.(projectPath) ?? projectPath, images);
    let target = null;
    let brief;
    let pendingId;
    let originalSession;
    let stagedSession;
    await this.states.update(projectPath, (latest) => {
      let session = request.sessionId == null ? undefined : latest.sessions[request.sessionId];
      if (request.sessionId != null && !session) throw new Error("That chat is no longer in the project.");
      // A chat runs in its own worktree; a new one goes to the worktree asked for.
      const worktree = session?.workspacePath ? { path: session.workspacePath } : latest.worktrees[session?.worktree_id ?? request.worktreeId];
      if (!worktree) throw new Error("That worktree is no longer in the project.");
      if (worktree.sharedChat) throw new Error("This Worktree belongs to a shared Link Chat. Open its Link instead.");
      const started = session ? { state: latest, session } : starterChat(latest, worktree);
      session = started.session;
      const firstMessage = !latest.messages.some((message) => message.session_id === session.id);
      // A handed-over chat's first message carries its brief; the body is only what the user typed.
      brief = firstMessage ? session.handoverDraft : undefined;
      const chatId = chatKey(projectPath, session.id);
      const withSession = started.state;
      // Persist the input before splitting or starting its run. Tokens keep flowing
      // while this save is pending; rejected input never changes a live run.
      const next = withSession;
      originalSession = session;
      // `context` marks a message no person typed, such as a Delegation from another Chat.
      const message = {
        id: next.next_id,
        session_id: session.id,
        body,
        images: storedImages,
        ...(files.length ? { files } : {}),
        ...(brief !== undefined ? { handoverBrief: brief } : {}),
        context: request.context ?? null,
        ...(request.operationId ? { operationId: request.operationId } : {}),
        role: "user",
        model,
      };
      pendingId = message.id;
      if (typeof request.clientMessageId === "string") message.clientMessageId = request.clientMessageId;
      stagedSession = {
        ...withoutDraft(session),
        provider,
        ...(firstMessage && body?.trim() && !session.title && !session.generatedTitle ? { titlePending: true } : {}),
      };
      target = { chatId, sessionId: session.id, cwd: worktree.path, resumeId: session.native_session_id };
      return {
        ...next,
        next_id: next.next_id + 1,
        sessions: { ...next.sessions, [session.id]: stagedSession },
        messages: [...next.messages, message],
      };
    });
    try {
      await this.states.flush(projectPath);
    } catch (error) {
      const { state } = await this.states.update(projectPath, (latest) => {
        const session = { ...latest.sessions[target.sessionId] };
        for (const field of ["provider", "titlePending", "handoverDraft", "resumeTurn"]) {
          if (session[field] !== stagedSession[field]) continue;
          if (Object.hasOwn(originalSession, field)) session[field] = originalSession[field];
          else delete session[field];
        }
        return {
          ...latest,
          sessions: { ...latest.sessions, [target.sessionId]: session },
          messages: latest.messages.filter((message) => message.id !== pendingId),
        };
      });
      this.broadcast(projectPath, state);
      throw error;
    }
    let seq;
    let added = [];
    const { state } = await this.states.update(projectPath, (latest) => {
      const message = latest.messages.find((item) => item.id === pendingId);
      const withoutPending = { ...latest, messages: latest.messages.filter((item) => item.id !== pendingId) };
      const sent = applyAgentEvent(withoutPending, this.runs, projectPath, target.chatId, { type: "message-sent", model });
      added = sent.state.messages.slice(withoutPending.messages.length).filter((message) => message.role === "assistant");
      this.runs = sent.runs;
      seq = ++this.seq;
      return { ...sent.state, messages: [...sent.state.messages, message] };
    });
    this.publish(target.chatId, { type: "message-sent", model }, state, seq);
    if (state.sessions[target.sessionId].titlePending) void this.nameChat(projectPath, target.sessionId).catch(() => {});
    const turn = {
      provider,
      model,
      permissionMode: request.permissionMode,
      effort: request.effort,
      ultracode: request.ultracode,
      fastMode: request.fastMode,
      replies: request.replies,
      tldrEnabled: request.tldrEnabled,
      prompt:
        brief !== undefined
          ? [brief, request.prompt || body].filter((part) => part?.trim()).join("\n\n")
          : request.prompt || body || "Describe the attached images.",
    };
    this.turns.set(target.chatId, turn);
    const started = this.startTurn({ ...turn, ...execution, chatId: target.chatId, cwd: target.cwd, images, resumeId: target.resumeId }).catch((error) => {
      void this.receive(target.chatId, { type: "turn-failed", message: ipcErrorMessage(error) });
      return null;
    });
    await this.captureImages(projectPath, state, added);
    return { sessionId: target.sessionId, started };
  }

  /**
   * Opens a chat on the other provider in the source chat's worktree, linked both ways, and resolves with its
   * id at once. The transcript and brief are written in the background; the brief waits in the chat as a draft for the user to review and send.
   */
  async handover(request) {
    const { projectPath, sessionId, provider } = request;
    if (this.runs[chatKey(projectPath, sessionId)]) throw new Error("Stop the turn or wait for it to finish to hand over.");
    let target = null;
    const { state } = await this.states.update(projectPath, (latest) => {
      const source = latest.sessions[sessionId];
      if (!source) throw new Error("That chat is no longer in the project.");
      if (source.provider === provider) throw new Error(`This chat already runs on ${providerName(provider)}.`);
      // A handover still being prepared, or waiting as a draft, is opened again rather than made twice.
      const earlier = latest.sessions[source.handedOverTo];
      if (earlier && (earlier.handoverPending || earlier.handoverDraft !== undefined)) {
        target = earlier.id;
        return latest;
      }
      target = latest.next_id;
      return {
        ...latest,
        next_id: target + 1,
        sessions: {
          ...latest.sessions,
          [sessionId]: { ...source, handedOverTo: target },
          [target]: {
            id: target,
            ...(source.workspacePath ? { workspacePath: source.workspacePath, worktrees: source.worktrees } : { worktree_id: source.worktree_id }),
            agent_name: source.agent_name,
            status: "Created",
            provider,
            handedOverFrom: sessionId,
            handoverPending: true,
            generatedTitle: `${providerName(provider)} · ${chatTitle(
              source,
              latest.messages.filter((item) => item.session_id === sessionId),
            )}`,
          },
        },
      };
    });
    const key = chatKey(projectPath, target);
    if (!this.pendingHandovers.has(key)) {
      this.broadcast(projectPath, state);
      const task = this.completeHandover(request, state, target).finally(() => this.pendingHandovers.delete(key));
      this.pendingHandovers.set(key, task);
    }
    return { sessionId: target };
  }

  async completeHandover(request, state, target) {
    const { projectPath, sessionId } = request;
    let transcriptPath = null;
    try {
      const source = state.sessions[sessionId];
      const transcript = renderTranscript(state, sessionId);
      transcriptPath = await this.handoverTools.writeTranscript({ projectPath, sessionId, markdown: transcript });
      const lastUserMessage =
        state.messages.filter((item) => item.session_id === sessionId && item.role !== "assistant" && item.body?.trim()).at(-1)?.body ?? "";
      const body = await this.handoverTools.brief({
        transcript,
        transcriptPath,
        provider: source.provider,
        lastUserMessage,
        worktrees: source.worktrees,
        cwd: source.workspacePath ?? state.worktrees[source.worktree_id].path,
      });
      await this.settleHandover(projectPath, target, body);
    } catch (error) {
      await this.settleHandover(projectPath, target);
      await this.addNote(chatKey(projectPath, target), {
        body: `Couldn't hand over: ${ipcErrorMessage(error).replace(/\.$/, "")}.${transcriptPath ? ` The transcript is at ${transcriptPath}.` : ""}`,
        context: "handover",
      });
    }
  }

  /** Clears the target chat's pending mark, keeping the brief as its draft when there is one. Resolves true when it was still set. */
  async settleHandover(projectPath, target, draft) {
    const { state, changed } = await this.states.update(projectPath, (latest) => {
      const session = latest.sessions[target];
      if (!session?.handoverPending) return latest;
      const { handoverPending, ...rest } = session;
      return { ...latest, sessions: { ...latest.sessions, [target]: draft === undefined ? rest : { ...rest, handoverDraft: draft } } };
    });
    if (changed) this.broadcast(projectPath, state);
    return Boolean(changed);
  }

  /** Replaces a handed-over chat's brief while it is still a draft (no messages yet). Resolves true when it changed. */
  async setHandoverDraft(projectPath, sessionId, text) {
    const { state, changed } = await this.states.update(projectPath, (latest) => {
      const session = latest.sessions[sessionId];
      if (session?.handoverDraft === undefined || latest.messages.some((message) => message.session_id === sessionId)) return latest;
      return { ...latest, sessions: { ...latest.sessions, [sessionId]: { ...session, handoverDraft: text } } };
    });
    if (changed) this.broadcast(projectPath, state);
    return Boolean(changed);
  }

  /**
   * Before a quit stops the agents: every chat whose turn runs is saved with what it needs to start again
   * (`resumeTurn`), and the cancelled turns that follow say the quit stopped them. A chat whose agent never
   * started keeps its prompt, since no session holds it yet.
   */
  async suspendRunning() {
    this.quitting = true;
    const stoppedAt = this.now();
    const byProject = new Map();
    for (const chatId of Object.keys(this.runs)) {
      const turn = this.turns.get(chatId);
      if (!turn) continue;
      byProject.set(projectOfKey(chatId), [...(byProject.get(projectOfKey(chatId)) ?? []), [sessionIdFromKey(chatId), turn]]);
    }
    await Promise.all(
      [...byProject].map(([projectPath, chats]) =>
        this.states
          .update(projectPath, (latest) => {
            let sessions = latest.sessions;
            for (const [sessionId, { prompt, ...turn }] of chats) {
              const session = sessions[sessionId];
              if (!session) continue;
              sessions = { ...sessions, [sessionId]: { ...session, resumeTurn: { ...turn, stoppedAt, ...(session.native_session_id ? {} : { prompt }) } } };
            }
            return sessions === latest.sessions ? latest : { ...latest, sessions };
          })
          .catch((error) => console.warn(`Milagre couldn't save the running chats of ${projectPath}:`, error.message)),
      ),
    );
  }

  /**
   * Chats a quit stopped mid-turn (see `suspendRunning`) continue when their project opens. One stopped longer
   * than RESUME_WINDOW_MS ago keeps its mark instead, and waits for the user to continue it (see `resumeChat`).
   */
  async resumeInterrupted(projectPath, state) {
    for (const session of Object.values(state.sessions)) {
      if (!session.resumeTurn || this.now() - (session.resumeTurn.stoppedAt ?? 0) > RESUME_WINDOW_MS) continue;
      await this.resumeChat(projectPath, session.id).catch((error) => console.warn(`Milagre couldn't resume a chat in ${projectPath}:`, error.message));
    }
  }

  /** Continues one chat a quit stopped, on the turn's saved options. Resolves false when it has nothing to continue. */
  async resumeChat(projectPath, sessionId) {
    if (this.runs[chatKey(projectPath, sessionId)]) return false;
    await this.states.executionContext?.(projectPath, sessionId);
    let turn = null;
    // Taken from the latest state, so a chat resumes once.
    const { state, changed } = await this.states.update(projectPath, (latest) => {
      const current = latest.sessions[sessionId];
      if (!current?.resumeTurn) return latest;
      const { resumeTurn, ...rest } = current;
      turn = resumeTurn;
      return { ...latest, sessions: { ...latest.sessions, [sessionId]: rest } };
    });
    if (!turn) return false;
    if (changed) this.broadcast(projectPath, state);
    const { prompt, stoppedAt: _stoppedAt, ...options } = turn;
    await this.send({ ...options, projectPath, sessionId, body: RESUME_BODY, prompt: prompt ?? RESUME_PROMPT, images: [], files: [] });
    return true;
  }

  /** A handover still marked pending when its project opens was cut off by a quit: it gets a note instead. */
  async recoverHandovers(projectPath, state) {
    for (const session of Object.values(state.sessions)) {
      if (!session.handoverPending || this.pendingHandovers.has(chatKey(projectPath, session.id))) continue;
      // The state passed in can be stale: a handover that finished since has nothing left to recover.
      if (!(await this.settleHandover(projectPath, session.id))) continue;
      await this.addNote(chatKey(projectPath, session.id), {
        body: "Milagre closed before this handover finished. Hand over again from the original chat.",
        context: "handover",
      });
    }
  }
}

module.exports = { ChatHost };
