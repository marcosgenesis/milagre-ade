const { applyAgentEvent, chatKey, isTurnEnd, projectOfKey, recordAnswers, sessionIdFromKey } = require("../shared/agent-runs.mjs");
const { patchSession } = require("../shared/project-edits.mjs");
const { renderTranscript, providerName } = require("./handover.cjs");

/** The part of an IPC error the user should read. */
function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

// Saves every chat's turns, in whatever project, whether or not the window shows it. Agent events
// are folded into the chat's project state (see ProjectStates), and each one is published to the
// windows along with the state it changed, so a reply never shows twice or goes missing between
// its stream ending and its message appearing. A message is saved before its turn starts, and a
// message sent while the chat's turn runs splits the reply streamed so far above it, and a note added
// while it runs (what the commit dialog did) waits for the turn to end, so it lands after the reply. Every event
// folded into the runs is numbered, so a window that loads mid-turn takes the runs (see `snapshot`)
// and skips the events they already hold.
class ChatHost {
  /**
   * `startTurn(request)` starts or steers the agent's turn (see SessionManager.startTurn);
   * `publish(chatId, event, state, seq)` sends an event to the windows, with the project's state when the
   * event changed it, and its number when it was folded into the runs; `broadcast(projectPath, state)` tells
   * them of a change no agent event made. `isFocused()` says whether a Milagre
   * window has focus: a turn that ends in the open chat while it hasn't leaves the chat unread too.
   */
  constructor({ states, startTurn, publish, broadcast, isFocused = () => true, nameChat = async () => {}, handoverTools }) {
    Object.assign(this, { states, startTurn, publish, broadcast, isFocused, nameChat, handoverTools });
    this.pendingHandovers = new Map();
    this.runs = {};
    this.seq = 0;
    this.openChat = null;
    this.notes = new Map();
  }

  /** The turns streaming now, in every project, and the number of the last event they hold. */
  snapshot() {
    return { runs: this.runs, seq: this.seq };
  }

  /** The chat on screen, by chat key, or null. A turn that ends in any other chat leaves it unread. */
  setOpenChat(chatId) {
    this.openChat = typeof chatId === "string" ? chatId : null;
  }

  /** Folds one agent event into its chat's project, then publishes it. Events are published in the order they arrive. */
  receive(chatId, event) {
    const projectPath = projectOfKey(chatId);
    const sessionId = sessionIdFromKey(chatId);
    let seq;
    return this.states.update(projectPath, (state) => {
      const result = applyAgentEvent(state, this.runs, projectPath, chatId, event);
      this.runs = result.runs;
      seq = ++this.seq;
      if (!result.changed) return state;
      const unread = isTurnEnd(event) && (chatId !== this.openChat || !this.isFocused()) && !result.state.sessions[sessionId]?.archived;
      const next = unread ? patchSession(result.state, sessionId, { unread: true }) : result.state;
      return isTurnEnd(event) ? this.withNotes(next, chatId) : next;
    }).then(
      ({ state, changed }) => this.publish(chatId, event, changed ? state : undefined, seq),
      (error) => {
        console.warn(`Milagre couldn't record an agent event for ${chatId}:`, error.message);
        this.publish(chatId, event);
      },
    );
  }

  /**
   * Saves the user's answers to a question as their message, after the reply streamed so far, and tells the
   * windows with an "answers-sent" event. Resolves with the message's id, or null when there's nothing to save.
   */
  async recordAnswers(chatId, body) {
    const projectPath = projectOfKey(chatId);
    let messageId = null;
    let seq;
    const { state, changed } = await this.states.update(projectPath, (latest) => {
      const result = recordAnswers(latest, this.runs, projectPath, chatId, body);
      if (result.messageId === null) return latest;
      this.runs = result.runs;
      seq = ++this.seq;
      messageId = result.messageId;
      return result.state;
    });
    if (changed) this.publish(chatId, { type: "answers-sent" }, state, seq);
    return messageId;
  }

  /** Removes a message again, such as answers that never reached the agent. */
  async takeBack(chatId, messageId) {
    const projectPath = projectOfKey(chatId);
    const { state, changed } = await this.states.update(projectPath, (latest) => (latest.messages.some((message) => message.id === messageId) ? { ...latest, messages: latest.messages.filter((message) => message.id !== messageId) } : latest));
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
    const messages = notes.map((note, index) => ({ id: state.next_id + index, session_id: sessionId, body: note.body, context: note.context, role: "assistant" }));
    return { ...state, next_id: state.next_id + messages.length, messages: [...state.messages, ...messages] };
  }

  /**
   * Saves a message in its chat, a new one in the worktree when `sessionId` is null, then starts the
   * chat's turn, or steers the one running. Resolves with the chat's session id once the message is
   * saved; the turn starts in the background, and a turn that can't start fails in the chat.
   */
  async send(request) {
    const { projectPath, body, images = [], files = [], provider, model } = request;
    let target = null;
    let seq;
    const { state } = await this.states.update(projectPath, (latest) => {
      let session = request.sessionId == null ? undefined : latest.sessions[request.sessionId];
      if (request.sessionId != null && !session) throw new Error("That chat is no longer in the project.");
      // A chat runs in its own worktree; a new one goes to the worktree asked for.
      const worktree = latest.worktrees[session?.worktree_id ?? request.worktreeId];
      if (!worktree) throw new Error("That worktree is no longer in the project.");
      let nextId = latest.next_id;
      // A new chat takes the worktree's chat that has no messages yet, if there is one.
      session ??= Object.values(latest.sessions).find((item) => item.worktree_id === worktree.id && !latest.messages.some((message) => message.session_id === item.id))
        ?? { id: nextId++, worktree_id: worktree.id, agent_name: worktree.name, status: "Created" };
      const firstMessage = !latest.messages.some(message => message.session_id === session.id);
      const chatId = chatKey(projectPath, session.id);
      const withSession = { ...latest, next_id: nextId, sessions: { ...latest.sessions, [session.id]: session } };
      // A running turn's reply so far is saved first, so it stays above the new message.
      const sent = applyAgentEvent(withSession, this.runs, projectPath, chatId, { type: "message-sent", model });
      this.runs = sent.runs;
      seq = ++this.seq;
      const next = sent.state;
      const message = { id: next.next_id, session_id: session.id, body, images, ...(files.length ? { files } : {}), context: null, role: "user", model };
      target = { chatId, sessionId: session.id, cwd: worktree.path, resumeId: session.native_session_id };
      return {
        ...next,
        next_id: next.next_id + 1,
        sessions: { ...next.sessions, [session.id]: { ...next.sessions[session.id], provider, ...(firstMessage && body?.trim() && !session.title ? { titlePending: true } : {}) } },
        messages: [...next.messages, message],
      };
    });
    this.publish(target.chatId, { type: "message-sent", model }, state, seq);
    if (state.sessions[target.sessionId].titlePending) void this.nameChat(projectPath, target.sessionId).catch(() => {});
    this.startTurn({
      chatId: target.chatId,
      provider,
      model,
      cwd: target.cwd,
      permissionMode: request.permissionMode,
      effort: request.effort,
      ultracode: request.ultracode,
      fastMode: request.fastMode,
      replies: request.replies,
      tldrEnabled: request.tldrEnabled,
      prompt: request.prompt || body || "Describe the attached images.",
      images,
      resumeId: target.resumeId,
    }).catch((error) => this.receive(target.chatId, { type: "turn-failed", message: errorMessage(error) }));
    return { sessionId: target.sessionId };
  }

  /**
   * Opens a chat on the other provider in the source chat's worktree, linked both ways, and resolves with its
   * id at once. The transcript and brief are written in the background; the brief is sent as its first message.
   */
  async handover(request) {
    const { projectPath, sessionId, provider } = request;
    if (this.runs[chatKey(projectPath, sessionId)]) throw new Error("Stop the turn or wait for it to finish to hand over.");
    let target = null;
    const { state } = await this.states.update(projectPath, (latest) => {
      const source = latest.sessions[sessionId];
      if (!source) throw new Error("That chat is no longer in the project.");
      if (source.provider === provider) throw new Error(`This chat already runs on ${providerName(provider)}.`);
      const earlier = latest.sessions[source.handedOverTo];
      if (earlier?.handoverPending) {
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
          [target]: { id: target, worktree_id: source.worktree_id, agent_name: source.agent_name, status: "Created", provider, handedOverFrom: sessionId, handoverPending: true },
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
      const lastUserMessage = state.messages.filter((item) => item.session_id === sessionId && item.role !== "assistant").at(-1)?.body ?? "";
      const body = await this.handoverTools.brief({ transcript, transcriptPath, provider: source.provider, lastUserMessage, cwd: state.worktrees[source.worktree_id].path });
      await this.send({ ...request, sessionId: target, body, prompt: body, images: [], files: [] });
      await this.settleHandover(projectPath, target);
    } catch (error) {
      await this.settleHandover(projectPath, target);
      await this.addNote(chatKey(projectPath, target), { body: `Couldn't hand over: ${errorMessage(error)}.${transcriptPath ? ` The transcript is at ${transcriptPath}.` : ""}`, context: "handover" });
    }
  }

  /** Clears the target chat's pending mark. */
  async settleHandover(projectPath, target) {
    const { state, changed } = await this.states.update(projectPath, (latest) => {
      const session = latest.sessions[target];
      if (!session?.handoverPending) return latest;
      const { handoverPending, ...rest } = session;
      return { ...latest, sessions: { ...latest.sessions, [target]: rest } };
    });
    if (changed) this.broadcast(projectPath, state);
  }

  /** A handover still marked pending when its project opens was cut off by a quit: it gets a note instead. */
  async recoverHandovers(projectPath, state) {
    for (const session of Object.values(state.sessions)) {
      if (!session.handoverPending || this.pendingHandovers.has(chatKey(projectPath, session.id))) continue;
      await this.settleHandover(projectPath, session.id);
      await this.addNote(chatKey(projectPath, session.id), { body: "Milagre closed before this handover finished. Hand over again from the original chat.", context: "handover" });
    }
  }
}

module.exports = { ChatHost };
