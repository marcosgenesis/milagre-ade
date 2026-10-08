const { ChatImages } = require("../chat-images.cjs");
const { storeImages } = require("../project-content.cjs");
const { ipcErrorMessage } = require("@milagre/shared/result");
const { applyAgentEvent, chatKey, isTurnEnd, lastUserModel, projectOfKey, recordAnswers, sessionIdFromKey } = require("@milagre/shared/agent-runs");
const { archiveFinishedSubagents, patchSession } = require("@milagre/shared/project-edits");
const { catchUpStart, handoffKind, isHandoff, lastTurnProvider } = require("@milagre/shared/handoff");
const { renderTranscript } = require("./handover.cjs");

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

const withLead = (lead, prompt) => [lead, prompt].filter((part) => part?.trim()).join("\n\n");

// A switch parks the native session of the provider left and resumes the one parked for the provider entered.
// `revertSwitch` is its inverse, for a handoff that did not happen.
function applySwitch(session, from, to) {
  const parked = { ...session.native_sessions };
  if (session.native_session_id) parked[from] = session.native_session_id;
  const resumeId = parked[to];
  delete parked[to];
  return withNativeSessions({ ...session, provider: to }, resumeId, parked);
}

function revertSwitch(session, from, to) {
  const parked = { ...session.native_sessions };
  if (session.native_session_id) parked[to] = session.native_session_id;
  const resumeId = parked[from];
  delete parked[from];
  return withNativeSessions({ ...session, provider: from }, resumeId, parked);
}

function withNativeSessions(session, current, parked) {
  const { native_session_id: _current, native_sessions: _parked, ...rest } = session;
  return { ...rest, ...(current ? { native_session_id: current } : {}), ...(Object.keys(parked).length ? { native_sessions: parked } : {}) };
}

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
    // Chats whose handoff is staged or its brief being written, by chat key: { controller, done, settle, ... }.
    // Stop and quit abort it (see cancelHandoff); a send meanwhile waits on `done` (see send).
    this.preparing = new Map();
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
      const events = await this.readSubagents({ cwd, agents: unknown, projectPath });
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
          // Subagents that ended during the turn are archived with it, so the track only lists what is still running.
          const recorded = isTurnEnd(event) ? this.withNotes(archiveFinishedSubagents(next, sessionId), chatId) : next;
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
    let handoff = null;
    let dividerId = null;
    let catchUp = null;
    let handoffFrom;
    // The provider and model this turn runs on: a message that steers a running turn keeps the chat's, whatever was asked for.
    let runProvider = provider;
    let runModel = model;
    let preparation = null;
    // A handoff still preparing when this message was sent: it steers into that turn once it starts.
    let waitFor = null;
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
      // A message that steers a running turn, or one whose handoff is still preparing, never hands off.
      waitFor = this.preparing.get(chatId) ?? null;
      const steering = Boolean(this.runs[chatId]) || Boolean(waitFor);
      handoff = steering ? null : handoffKind(withSession, session.id, provider);
      if (steering) {
        runProvider = session.provider ?? provider;
        runModel = this.runs[chatId]?.model || lastUserModel(withSession, session.id) || model;
      }
      // Persist the input before splitting or starting its run. Tokens keep flowing
      // while this save is pending; rejected input never changes a live run.
      const next = withSession;
      originalSession = session;
      // `context` marks a message no person typed, such as a Delegation from another Chat.
      if (handoff) dividerId = next.next_id;
      const message = {
        id: handoff ? next.next_id + 1 : next.next_id,
        session_id: session.id,
        body,
        images: storedImages,
        ...(files.length ? { files } : {}),
        ...(brief !== undefined ? { handoverBrief: brief } : {}),
        context: request.context ?? null,
        ...(request.operationId ? { operationId: request.operationId } : {}),
        role: "user",
        model: runModel,
      };
      pendingId = message.id;
      if (typeof request.clientMessageId === "string") message.clientMessageId = request.clientMessageId;
      // Switching providers parks the old native session and resumes the one parked for the new provider, if any.
      stagedSession = {
        ...withoutDraft(session),
        provider: runProvider,
        ...(firstMessage && body?.trim() && !session.title && !session.generatedTitle ? { titlePending: true } : {}),
      };
      if (handoff === "switch") {
        handoffFrom = lastTurnProvider(withSession, session.id);
        catchUp = catchUpStart(withSession, session.id, provider);
        stagedSession = applySwitch(stagedSession, handoffFrom, provider);
      } else if (handoff) {
        handoffFrom = provider;
      }
      target = { chatId, sessionId: session.id, cwd: worktree.path, resumeId: stagedSession.native_session_id };
      const fromModel = lastUserModel(withSession, session.id);
      const divider = handoff && {
        id: dividerId,
        session_id: session.id,
        body: "",
        role: "assistant",
        context: { kind: "handoff", from: { provider: handoffFrom, ...(fromModel ? { model: fromModel } : {}) }, to: { provider, model }, status: "preparing" },
      };
      if (handoff) {
        let settle;
        const done = new Promise((resolve) => (settle = resolve));
        preparation = { controller: new AbortController(), done, settle, dividerId, catchUp, from: handoffFrom, to: provider, sessionId: session.id };
        this.preparing.set(chatId, preparation);
      }
      return {
        ...next,
        next_id: message.id + 1,
        sessions: { ...next.sessions, [session.id]: stagedSession },
        messages: [...next.messages, ...(divider ? [divider] : []), message],
      };
    });
    try {
      await this.states.flush(projectPath);
    } catch (error) {
      if (preparation) {
        this.release(target.chatId, preparation);
        preparation.settle(null);
      }
      const { state } = await this.states.update(projectPath, (latest) => {
        const session = { ...latest.sessions[target.sessionId] };
        for (const field of ["provider", "titlePending", "handoverDraft", "resumeTurn", "native_session_id", "native_sessions"]) {
          if (session[field] !== stagedSession[field]) continue;
          if (Object.hasOwn(originalSession, field)) session[field] = originalSession[field];
          else delete session[field];
        }
        return {
          ...latest,
          sessions: { ...latest.sessions, [target.sessionId]: session },
          messages: latest.messages.filter((message) => message.id !== pendingId && message.id !== dividerId),
        };
      });
      this.broadcast(projectPath, state);
      throw error;
    }
    let seq;
    let added = [];
    const { state } = await this.states
      .update(projectPath, (latest) => {
        const message = latest.messages.find((item) => item.id === pendingId);
        const divider = latest.messages.find((item) => item.id === dividerId);
        const withoutPending = { ...latest, messages: latest.messages.filter((item) => item.id !== pendingId && item.id !== dividerId) };
        const sent = applyAgentEvent(withoutPending, this.runs, projectPath, target.chatId, { type: "message-sent", model: runModel });
        added = sent.state.messages.slice(withoutPending.messages.length).filter((message) => message.role === "assistant");
        this.runs = sent.runs;
        seq = ++this.seq;
        return { ...sent.state, messages: [...sent.state.messages, ...(divider ? [divider] : []), message] };
      })
      .catch((error) => {
        // The handoff never prepares: nothing may wait on it.
        if (preparation) {
          this.release(target.chatId, preparation);
          preparation.settle(null);
        }
        throw error;
      });
    this.publish(target.chatId, { type: "message-sent", model: runModel }, state, seq);
    if (state.sessions[target.sessionId].titlePending) void this.nameChat(projectPath, target.sessionId).catch(() => {});
    const turn = {
      provider: runProvider,
      model: runModel,
      permissionMode: request.permissionMode,
      effort: request.effort,
      ultracode: request.ultracode,
      fastMode: request.fastMode,
      replies: request.replies,
      tldrEnabled: request.tldrEnabled,
      prompt: brief !== undefined ? withLead(brief, request.prompt || body) : request.prompt || body || "Describe the attached images.",
    };
    this.turns.set(target.chatId, turn);
    // A message sent while a handoff prepares waits for its turn to start, then steers it with its own prompt.
    const ready = handoff
      ? this.prepareHandoff(projectPath, target, state, preparation)
      : waitFor
        ? waitFor.done.then((result) => (result === null ? null : ""))
        : Promise.resolve("");
    const started = ready
      .then((handoffBrief) => {
        // null: the handoff was cancelled or failed (see abandonHandoff), so no agent starts.
        if (handoffBrief === null) return null;
        const prompt = withLead(handoffBrief, turn.prompt);
        this.turns.set(target.chatId, { ...turn, prompt });
        return this.startTurn({ ...turn, prompt, ...execution, chatId: target.chatId, cwd: target.cwd, images, resumeId: target.resumeId });
      })
      .catch((error) => {
        void this.receive(target.chatId, { type: "turn-failed", message: ipcErrorMessage(error) });
        return null;
      });
    if (preparation) void started.then((result) => preparation.settle(result));
    await this.captureImages(projectPath, state, added);
    return { sessionId: target.sessionId, started };
  }

  /**
   * Writes the transcript and the brief for a handoff, then marks its divider done. Resolves with the brief, or
   * null when Stop or a quit cancelled it (see abandonHandoff). A failure abandons the handoff too, then throws.
   */
  async prepareHandoff(projectPath, target, state, preparation) {
    const { controller, dividerId, catchUp, from } = preparation;
    const aborted = new Promise((resolve) => controller.signal.addEventListener("abort", () => resolve(null), { once: true }));
    try {
      // The transcript is the chat up to the divider, on the provider it came from: the message sent with it travels as the prompt.
      const session = state.sessions[target.sessionId];
      const before = {
        ...state,
        sessions: { ...state.sessions, [target.sessionId]: { ...session, provider: from } },
        messages: state.messages.filter((item) => item.id < dividerId),
      };
      const transcriptPath = await this.handoverTools.writeTranscript({
        projectPath,
        sessionId: target.sessionId,
        markdown: renderTranscript(before, target.sessionId),
      });
      const lastUserMessage =
        before.messages.filter((item) => item.session_id === target.sessionId && item.role === "user" && item.body?.trim()).at(-1)?.body ?? "";
      const handoffBrief = await Promise.race([
        aborted,
        this.handoverTools.brief({
          projectPath,
          transcript: renderTranscript(before, target.sessionId, { after: catchUp ?? undefined }),
          transcriptPath,
          provider: from,
          catchUp: catchUp != null,
          lastUserMessage,
          worktrees: session.worktrees,
          cwd: target.cwd,
        }),
      ]);
      if (handoffBrief === null || controller.signal.aborted) return null;
      await this.updateDivider(projectPath, dividerId, { status: "done", brief: handoffBrief, transcriptPath });
      return controller.signal.aborted ? null : handoffBrief;
    } catch (error) {
      if (!controller.signal.aborted) await this.abandonHandoff(projectPath, preparation).catch(() => {});
      throw error;
    } finally {
      this.release(target.chatId, preparation);
    }
  }

  /** Forgets a chat's preparation once it ended, unless a newer one took its place. */
  release(chatId, preparation) {
    if (this.preparing.get(chatId) === preparation) this.preparing.delete(chatId);
  }

  /**
   * A handoff that did not happen (cancelled, failed or cut off by a quit): its divider fails and the chat goes back to
   * the provider and native sessions it had, so the next send redoes the handoff.
   */
  async abandonHandoff(projectPath, { dividerId, sessionId, from, to }) {
    const { state, changed } = await this.states.update(projectPath, (latest) => {
      const divider = latest.messages.find((item) => item.id === dividerId);
      if (!isHandoff(divider) || divider.context.status !== "preparing") return latest;
      const session = latest.sessions[sessionId];
      return {
        ...latest,
        sessions: session && from !== to && session.provider === to ? { ...latest.sessions, [sessionId]: revertSwitch(session, from, to) } : latest.sessions,
        messages: latest.messages.map((item) => (item === divider ? { ...item, context: { ...item.context, status: "failed" } } : item)),
      };
    });
    if (changed) this.broadcast(projectPath, state);
  }

  /** Merges `patch` into a handoff divider's context and tells the windows. */
  async updateDivider(projectPath, dividerId, patch) {
    const { state, changed } = await this.states.update(projectPath, (latest) => {
      const divider = latest.messages.find((item) => item.id === dividerId);
      // Only a divider still preparing changes: a cancelled one stays failed.
      if (!isHandoff(divider) || divider.context.status !== "preparing") return latest;
      return { ...latest, messages: latest.messages.map((item) => (item === divider ? { ...item, context: { ...item.context, ...patch } } : item)) };
    });
    if (changed) this.broadcast(projectPath, state);
  }

  /** Stop while a handoff brief is written: no agent session runs yet, so the turn is cancelled here. Resolves true when there was one. */
  async cancelHandoff(chatId) {
    const preparation = this.preparing.get(chatId);
    if (!preparation) return false;
    preparation.controller.abort();
    await this.abandonHandoff(projectOfKey(chatId), preparation);
    await this.receive(chatId, { type: "turn-cancelled" });
    return true;
  }

  /**
   * Before a quit stops the agents: every chat whose turn runs is saved with what it needs to start again
   * (`resumeTurn`), and the cancelled turns that follow say the quit stopped them. A chat whose agent never
   * started keeps its prompt, since no session holds it yet. A handoff still preparing is abandoned instead: its
   * agent never started, so the chat goes back to its old provider and the user's resend redoes the handoff.
   */
  async suspendRunning() {
    this.quitting = true;
    const stoppedAt = this.now();
    const abandoned = new Set();
    await Promise.all(
      [...this.preparing].map(async ([chatId, preparation]) => {
        abandoned.add(chatId);
        preparation.controller.abort();
        await this.abandonHandoff(projectOfKey(chatId), preparation).catch((error) =>
          console.warn(`Milagre couldn't cancel the handoff of ${chatId}:`, error.message),
        );
      }),
    );
    const byProject = new Map();
    for (const chatId of Object.keys(this.runs)) {
      const turn = this.turns.get(chatId);
      if (!turn || abandoned.has(chatId)) continue;
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

  /** On open: a divider still preparing was cut off by a quit and is failed; a legacy handover still pending is settled. */
  async recoverHandoffs(projectPath, _state) {
    const { state, changed } = await this.states.update(projectPath, (latest) => {
      let sessions = latest.sessions;
      for (const session of Object.values(latest.sessions)) {
        if (!session.handoverPending) continue;
        const { handoverPending: _pending, ...rest } = session;
        sessions = { ...sessions, [session.id]: rest };
      }
      const messages = latest.messages.map((item) =>
        isHandoff(item) && item.context.status === "preparing" && !this.preparing.has(chatKey(projectPath, item.session_id))
          ? { ...item, context: { ...item.context, status: "failed" } }
          : item,
      );
      const touched = sessions !== latest.sessions || messages.some((item, index) => item !== latest.messages[index]);
      return touched ? { ...latest, sessions, messages } : latest;
    });
    if (changed) this.broadcast(projectPath, state);
  }
}

module.exports = { ChatHost };
