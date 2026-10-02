import { useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectionType,
  ChatMessage,
  AgentSession,
  ImageAttachment,
  CoordinatorState,
  Isolation,
  MODEL_CATALOG,
  ModelOption,
  OpenProject,
  PermissionDecision,
  QuestionAnswers,
  PermissionMode,
  EffortLevel,
  ModelCapabilities,
  capabilityFor,
  effortFor,
  createInitialState,
  sessionForWorktree,
  sortedWorktrees,
} from "./model";
import { useAgentRuns } from "./components/useAgentRuns";
import { chatInProject, chatKey, chatsRunning, chatsWaitingForUser, modelForChat, sentDecision, sentReply, sessionIdFromKey } from "./lib/agent-runs";
import { attentionNotice } from "./lib/attention";
import { chatMark, chatTitle, patchSession } from "./lib/chat-list";
import { useWorktreeDiffs } from "./components/useWorktreeDiffs";
import { usePastedImages } from "./components/usePastedImages";
import { ChatComposer } from "./components/ChatComposer";
import { DotBackground } from "./components/DotBackground";
import SidebarNav from "./components/SidebarNav";
import { SettingsNav, SettingsPanel } from "./components/Settings";
import type { SettingsSection } from "./components/Settings";
import { getSettings, useApplyTheme, useSettings } from "./lib/settings";
import { renameWorktree } from "./lib/worktree-rename";
import { PermissionCard } from "./components/agents/PermissionCard";
import { QuestionCard } from "./components/agents/QuestionCard";
import type { UpdateState } from "./electron";
import { SidebarUsage } from "./components/usage/SidebarUsage";
import { visibleProviders } from "./components/usage/format";
import { useUsage } from "./components/usage/useUsage";

const connectionTypes: ConnectionType[] = ["Information", "Dependency", "Review", "Blocking"];

// The chat with the most recent message, or none so the app opens on a new chat. Archived chats don't count.
function latestSessionId(state: CoordinatorState) {
  return state.messages
    .filter((message) => !state.sessions[message.session_id]?.archived)
    .reduce<ChatMessage | null>((latest, message) => (!latest || message.id > latest.id ? message : latest), null)?.session_id ?? null;
}

function App() {
  const [project, setProject] = useState<OpenProject | null>(null);
  const [projectImage, setProjectImage] = useState<{ path: string; src: string | null } | null>(null);
  const projectRef = useRef<OpenProject | null>(null);
  projectRef.current = project;
  const [state, setState] = useState<CoordinatorState | null>(null);
  const stateRef = useRef<CoordinatorState | null>(null);
  stateRef.current = state;
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const openSessionRef = useRef<number | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelOption>(() => MODEL_CATALOG.find((model) => model.id === getSettings().defaultModelId) ?? MODEL_CATALOG[0]);
  const [effort, setEffortState] = useState<EffortLevel>(() => (localStorage.getItem("milagre.effort") as EffortLevel | null) ?? "high");
  const setEffort = (level: EffortLevel) => { setEffortState(level); localStorage.setItem("milagre.effort", level); };
  const [ultracode, setUltracodeState] = useState(() => localStorage.getItem("milagre.ultracode") === "on");
  const setUltracode = (on: boolean) => { setUltracodeState(on); localStorage.setItem("milagre.ultracode", on ? "on" : "off"); };
  const [capabilities, setCapabilities] = useState<ModelCapabilities | null>(null);
  useEffect(() => { void window.milagre.getModelCapabilities().then(setCapabilities).catch(() => undefined); }, []);
  const selectedCapability = capabilityFor(selectedModel, capabilities);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => getSettings().defaultPermissionMode);
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [isolation, setIsolation] = useState<Isolation>("local");
  const [branches, setBranches] = useState<string[]>([]);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  useApplyTheme();

  useEffect(() => {
    const projectPath = project?.path;
    if (!projectPath) return;
    let cancelled = false;
    window.milagre.getProjectImage(projectPath).then((src) => {
      if (!cancelled) setProjectImage({ path: projectPath, src });
    }).catch(() => {
      if (!cancelled) setProjectImage({ path: projectPath, src: null });
    });
    return () => { cancelled = true; };
  }, [project?.path]);

  useEffect(() => {
    window.milagre.getCurrentProject().then((current) => {
      setProject(current);
      const nextState = current.state ?? createInitialState(current.name, current.path);
      setState(nextState);
      selectInitialChat(nextState);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};
    window.milagre.getUpdateState().then(setUpdate);
    unsubscribe = window.milagre.onUpdateState(setUpdate);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (project) void window.milagre.listBranches(project.path).then(setBranches);
  }, [project?.path]);

  const worktrees = useMemo(() => (state ? sortedWorktrees(state) : []), [state]);
  const firstWorktree = worktrees[0];
  const secondWorktree = worktrees[1];
  const firstSession = state && firstWorktree ? sessionForWorktree(state, firstWorktree.id) : undefined;
  const secondSession = state && secondWorktree ? sessionForWorktree(state, secondWorktree.id) : undefined;
  const selectedSession = state && selectedSessionId !== null ? state.sessions[selectedSessionId] : undefined;
  const selectedWorktree = worktrees.find((worktree) => worktree.id === (selectedSession?.worktree_id ?? selectedWorktreeId)) ?? firstWorktree;
  const imageDraft = usePastedImages(selectedWorktree?.path ?? project?.path ?? "");
  const connection = state ? Object.values(state.connections)[0] : undefined;
  const messages = state && selectedSession ? state.messages.filter((message) => message.session_id === selectedSession.id) : [];

  // The chat on screen; a turn that ends anywhere else leaves its chat unread.
  openSessionRef.current = view === "chat" ? selectedSessionId : null;
  const agentRuns = useAgentRuns(project?.path ?? "", () => stateRef.current, commit, (sessionId) => openSessionRef.current === sessionId);
  useWorktreeDiffs(project?.path ?? "", () => stateRef.current, commit);
  const run = project && selectedSession ? agentRuns.runs[chatKey(project.path, selectedSession.id)] : undefined;
  const isSending = preparing || Boolean(run);
  const usage = useUsage();
  const { showUsageInSidebar } = useSettings();
  const runningCount = Object.keys(agentRuns.runs).length;
  const previousRunningCount = useRef(runningCount);

  // A turn just ended: plan usage has moved, so re-read it.
  useEffect(() => {
    if (runningCount < previousRunningCount.current) void usage.refresh();
    previousRunningCount.current = runningCount;
  }, [runningCount, usage.refresh]);
  const pendingApproval = run?.approvals[0];
  // Approvals come first; a question shows once none is waiting.
  const pendingQuestion = pendingApproval ? undefined : run?.questions[0];

  // A running turn takes the new mode at once instead of at its next message.
  function changePermissionMode(mode: PermissionMode) {
    setPermissionMode(mode);
    if (project && selectedSession) void window.milagre.setAgentPermissionMode(chatKey(project.path, selectedSession.id), mode).catch(() => {});
  }

  function answerApproval(decision: PermissionDecision) {
    if (!project || !selectedSession || !pendingApproval) return;
    // The run keeps the answer; if it doesn't reach the agent, the card goes back to pending.
    void agentRuns.respond(chatKey(project.path, selectedSession.id), pendingApproval.requestId, decision).catch(() => {});
  }

  /** Sends the answers to the open question, or dismisses it (null). */
  function answerQuestion(answers: QuestionAnswers | null) {
    if (!project || !selectedSession || !pendingQuestion) return;
    void agentRuns.answerQuestion(chatKey(project.path, selectedSession.id), pendingQuestion.requestId, answers).catch(() => {});
  }

  // A chat stays on the agent it started with; the picker follows the open chat.
  useEffect(() => {
    if (!selectedSession?.provider) return;
    const next = modelForChat(selectedModel, selectedSession.provider, messages, MODEL_CATALOG);
    if (next.id !== selectedModel.id) setSelectedModel(next);
  }, [selectedSession?.id, selectedSession?.provider]);

  // Every state change goes through here, so turns finishing in two chats can't overwrite each other.
  function commit(next: CoordinatorState) {
    stateRef.current = next;
    setState(next);
    if (project) void window.milagre.saveProject(project.path, next);
  }

  async function persist(nextState: CoordinatorState) {
    commit(nextState);
  }

  // Approvals never time out, so mark chats that wait on one (the open chat too: its card may be scrolled away).
  const waiting = useMemo(() => chatsWaitingForUser(agentRuns.runs, project?.path ?? ""), [agentRuns.runs, project?.path]);
  const running = useMemo(() => chatsRunning(agentRuns.runs, project?.path ?? ""), [agentRuns.runs, project?.path]);
  const chats = useMemo(() => {
    if (!state) return [];
    return Object.values(state.sessions)
      .filter((session) => !session.archived)
      .map((session) => ({ session, sessionMessages: state.messages.filter((message) => message.session_id === session.id) }))
      .filter(({ sessionMessages }) => sessionMessages.length > 0)
      .sort((a, b) => (b.sessionMessages.at(-1)?.id ?? 0) - (a.sessionMessages.at(-1)?.id ?? 0))
      .map(({ session, sessionMessages }) => {
        const worktree = state.worktrees[session.worktree_id];
        const lastReply = [...sessionMessages].reverse().find((message) => message.role === "assistant");
        return {
          id: String(session.id),
          label: chatTitle(session, sessionMessages),
          mark: chatMark({ waiting: waiting.has(session.id), running: running.has(session.id), unread: Boolean(session.unread) }),
          unread: Boolean(session.unread),
          details: {
            branch: worktree?.name,
            path: worktree?.path,
            diff: worktree?.diff,
            failed: lastReply?.outcome === "failed",
          },
        };
      });
  }, [state, waiting, running]);

  // Chat row actions build on the latest state, so a turn that finished since the last render isn't lost.
  function patchChat(sessionId: number, patch: Parameters<typeof patchSession>[2]) {
    const latest = stateRef.current;
    if (!latest) return;
    const next = patchSession(latest, sessionId, patch);
    if (next !== latest) commit(next);
  }

  function openChat(sessionId: number) {
    setSelectedSessionId(sessionId);
    setSelectedWorktreeId(stateRef.current?.sessions[sessionId]?.worktree_id ?? null);
    setView("chat");
  }

  // Opening a chat reads it. Only on opening: "Mark as unread" on the open chat sticks until it's opened again.
  useEffect(() => {
    if (view === "chat" && selectedSessionId !== null) patchChat(selectedSessionId, { unread: false });
  }, [selectedSessionId, view, project?.path]);

  // Archiving hides the chat for good; a turn still running in it is stopped first.
  function archiveChat(sessionId: number) {
    if (!project) return;
    const key = chatKey(project.path, sessionId);
    if (agentRuns.runs[key]) void agentRuns.interrupt(key).catch(() => {});
    patchChat(sessionId, { archived: true, unread: false });
    if (selectedSessionId === sessionId) startNewChat();
  }

  function revealChat(sessionId: number) {
    const latest = stateRef.current;
    const worktree = latest?.worktrees[latest.sessions[sessionId]?.worktree_id ?? -1];
    if (worktree) void window.milagre.revealWorktree(worktree.path).catch(() => {});
  }

  // A chat that waits on the user while Milagre is in the background gets a system notification.
  useEffect(() => window.milagre.onAgentEvent(({ chatId, event }) => {
    const current = projectRef.current;
    const latest = stateRef.current;
    if (!current || !latest || !getSettings().notifyWhenWaiting || !chatInProject(current.path, chatId)) return;
    const session = latest.sessions[sessionIdFromKey(chatId)];
    const notice = attentionNotice(event, {
      projectName: current.name,
      worktreeName: session ? latest.worktrees[session.worktree_id]?.name : undefined,
      chatTitle: session ? chatTitle(session, latest.messages.filter((message) => message.session_id === session.id)) : undefined,
      provider: session?.provider,
    });
    if (notice && "requestId" in event) void window.milagre.notifyAttention({ chatId, requestId: event.requestId, ...notice }).catch(() => {});
  }), []);

  // A new worktree's branch is renamed a few seconds in, once its chat's name is picked.
  useEffect(() => window.milagre.onWorktreeRenamed((rename) => {
    const latest = stateRef.current;
    if (projectRef.current?.path !== rename.projectPath || !latest) return;
    const next = renameWorktree(latest, rename);
    // Not commit(): this listener outlives the render whose `project` that would save under.
    if (next !== latest) {
      stateRef.current = next;
      setState(next);
      void window.milagre.saveProject(rename.projectPath, next);
    }
    void window.milagre.listBranches(rename.projectPath).then(setBranches);
  }), []);

  // Clicking a notification opens its chat.
  useEffect(() => window.milagre.onOpenChat((chatId) => {
    const current = projectRef.current;
    const session = current && chatInProject(current.path, chatId) ? stateRef.current?.sessions[sessionIdFromKey(chatId)] : undefined;
    if (session) openChat(session.id);
  }), []);

  function startNewChat() {
    setSelectedSessionId(null);
    setDraft("");
    setNewChatError(null);
    setView("chat");
  }

  function selectInitialChat(nextState: CoordinatorState) {
    const sessionId = latestSessionId(nextState);
    setSelectedSessionId(sessionId);
    setSelectedWorktreeId(sessionId !== null ? nextState.sessions[sessionId]?.worktree_id ?? null : sortedWorktrees(nextState)[0]?.id ?? null);
  }

  async function openProject() {
    const nextProject = await window.milagre.openProject();
    if (!nextProject) return;
    setProject(nextProject);
    const nextState = nextProject.state ?? createInitialState(nextProject.name, nextProject.path);
    setState(nextState);
    selectInitialChat(nextState);
    setDraft("");
  }

  // Where a message goes, without building state: an open chat keeps its session, a new local chat
  // (session null) gets one from the latest state at commit time, and a new chat in "New worktree"
  // isolation gets its own worktree first. Callers merge into the latest state, never a stale copy.
  async function resolveSendTarget(body: string) {
    if (!state || !project || !selectedWorktree) return null;
    if (selectedSession) return { session: selectedSession as AgentSession | null, worktree: selectedWorktree, createdNextId: undefined as number | undefined };
    if (isolation === "local") return { session: null, worktree: selectedWorktree, createdNextId: undefined };
    const created = await window.milagre.createWorktree({ projectPath: project.path, baseBranch: baseBranch ?? selectedWorktree.name, prompt: body });
    const worktree = created.project.state.worktrees[created.worktreeId];
    const session = sessionForWorktree(created.project.state, worktree.id);
    if (!session) throw new Error(`No chat session was created for ${worktree.name}.`);
    setIsolation("local");
    setBaseBranch(null);
    void window.milagre.listBranches(project.path).then(setBranches);
    return { session: session as AgentSession | null, worktree, createdNextId: created.project.state.next_id };
  }

  async function executeSend(body: string, mode: PermissionMode, images: ImageAttachment[] = imageDraft.images) {
    if ((!body && !images.length) || !state || !selectedWorktree || !project || preparing || imageDraft.loading) return;
    setPreparing(true);
    setNewChatError(null);

    let target: Awaited<ReturnType<typeof resolveSendTarget>>;
    try {
      target = await resolveSendTarget(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNewChatError(`Could not create the worktree: ${message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}`);
      setPreparing(false);
      return;
    }
    if (!target || projectRef.current?.path !== project.path) {
      setPreparing(false);
      return;
    }
    // A message sent while this chat's turn runs steers it; the reply streamed so far is saved first,
    // so it stays above the new message.
    if (target.session) agentRuns.splitForSteer(chatKey(project.path, target.session.id));
    // Read the state only now: a turn in another chat may have finished while the target resolved.
    const latest = stateRef.current;
    if (!latest) {
      setPreparing(false);
      return;
    }
    const { worktree } = target;
    let nextId = Math.max(latest.next_id, target.createdNextId ?? 0);
    const worktrees = target.createdNextId !== undefined ? { ...latest.worktrees, [worktree.id]: worktree } : latest.worktrees;
    let session = target.session;
    if (!session) {
      session = Object.values(latest.sessions).find((item) => item.worktree_id === worktree.id && !latest.messages.some((message) => message.session_id === item.id))
        ?? { id: nextId++, worktree_id: worktree.id, agent_name: worktree.name, status: "Created" as const };
    }
    const chatSession = session;

    const model = modelForChat(selectedModel, chatSession.provider, latest.messages.filter((message) => message.session_id === chatSession.id), MODEL_CATALOG);
    const userMessage = {
      id: nextId++,
      session_id: chatSession.id,
      body,
      images,
      context: null,
      role: "user" as const,
      model: model.id,
    };
    commit({
      ...latest,
      next_id: nextId,
      worktrees,
      sessions: { ...latest.sessions, [chatSession.id]: { ...chatSession, provider: model.provider } },
      messages: [...latest.messages, userMessage],
    });
    setSelectedSessionId(chatSession.id);
    setSelectedWorktreeId(worktree.id);
    setDraft("");
    imageDraft.clear();
    setPreparing(false);
    await agentRuns.start({
      chatId: chatKey(project.path, chatSession.id),
      provider: model.provider,
      model: model.id,
      cwd: worktree.path,
      permissionMode: mode,
      effort: effortFor(capabilityFor(model, capabilities), effort),
      ultracode: capabilityFor(model, capabilities).ultracode && ultracode,
      prompt: body || "Describe the attached images.",
      images,
      resumeId: chatSession.native_session_id,
    });
  }

  async function sendMessage() {
    const body = draft.trim();
    if ((!body && !imageDraft.images.length) || !state || !selectedWorktree || !project || preparing || imageDraft.loading) return;
    await executeSend(body, permissionMode);
  }

  // Built from the latest state, so a turn that finished since the last render isn't lost.
  async function toggleSession(worktreeId: number) {
    const latest = stateRef.current;
    if (!latest) return;
    const session = sessionForWorktree(latest, worktreeId);
    if (!session) return;
    const nextStatus = session.status === "Running" ? "Stopped" : "Running";
    await persist({
      ...latest,
      sessions: {
        ...latest.sessions,
        [session.id]: { ...session, status: nextStatus },
      },
    });
  }

  async function cycleConnection() {
    const latest = stateRef.current;
    const current = latest ? Object.values(latest.connections)[0] : undefined;
    if (!latest || !current) return;
    const nextKind = connectionTypes[(connectionTypes.indexOf(current.kind) + 1) % connectionTypes.length];
    await persist({
      ...latest,
      connections: { ...latest.connections, [current.id]: { ...current, kind: nextKind } },
    });
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key === ",") {
        event.preventDefault();
        setView("settings");
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        startNewChat();
      } else if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openProject();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      // A menu, picker or search that Escape closed has already consumed it.
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (view === "settings") {
        event.preventDefault();
        setView("chat");
        return;
      }
      if (run && project && selectedSession) {
        event.preventDefault();
        // Escape denies the open approval or dismisses the open question; once that's sent, Escape stops the turn.
        const approval = run.approvals[0];
        const question = approval ? undefined : run.questions[0];
        if (approval && !run.answered[approval.requestId]) answerApproval("deny");
        else if (question && !run.answered[question.requestId]) answerQuestion(null);
        else void agentRuns.interrupt(chatKey(project.path, selectedSession.id));
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [run, project?.path, selectedSession?.id, view]);

  if (loading || !project || !state) {
    return <div className="grid h-screen place-items-center overflow-hidden bg-page text-sm text-ink-3">Loading workspace…</div>;
  }

  return (
    <DotBackground>
      <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-10 [-webkit-app-region:drag]" />
      {update?.status === "downloaded" && (
        <div className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm text-ink shadow-lg [-webkit-app-region:no-drag]">
          <span>Milagre {update.version} está pronto para atualizar.</span>
          <button className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700" onClick={() => void window.milagre.installUpdate()}>
            Atualizar e reiniciar
          </button>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden text-ink">
      <div className={`min-h-0 shrink-0 pt-[60px] pb-3 pl-3 ${view === "chat" ? "flex" : "hidden"}`}>
      <SidebarNav
        key={project.path}
        fill
        workspaceName={project.name}
        workspaceImage={projectImage?.path === project.path ? projectImage.src : null}
        onOpenProject={() => void openProject()}
        recents={chats}
        activeId={selectedSession ? String(selectedSession.id) : null}
        onPick={(id) => openChat(Number(id))}
        chatActions={{
          onRename: (id, title) => patchChat(Number(id), { title }),
          onMarkUnread: (id, unread) => patchChat(Number(id), { unread }),
          onReveal: (id) => revealChat(Number(id)),
          onArchive: (id) => archiveChat(Number(id)),
        }}
        onNewChat={startNewChat}
        onOpenSettings={() => setView("settings")}
        usage={showUsageInSidebar && usage.snapshot && visibleProviders(usage.snapshot).length > 0 ? <SidebarUsage usage={usage} /> : undefined}
      />
      </div>
      {view === "settings" && (
        <div className="flex shrink-0 py-3 pl-3">
          <SettingsNav section={settingsSection} onSelect={setSettingsSection} onBack={() => setView("chat")} />
        </div>
      )}

      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent pr-3 pb-3">
        {view === "settings" && <SettingsPanel section={settingsSection} />}
        <div className={`min-h-0 flex-1 overflow-hidden ${view === "chat" ? "" : "hidden"}`}>
          <ChatComposer
            key={project.path}
            messages={messages}
            imageDraft={imageDraft}
            projectPath={selectedWorktree?.path ?? project.path}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void sendMessage()}
            isSending={isSending}
            sendBlocked={preparing}
            streamingText={run?.text}
            streamingSteps={run?.steps}
            waitingStepIds={run?.approvals.flatMap((request) => (request.stepId ? [request.stepId] : []))}
            runModelName={run ? MODEL_CATALOG.find((model) => model.id === run.model)?.name ?? run.model : undefined}
            lockedProvider={messages.length > 0 ? selectedSession?.provider : undefined}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            capability={selectedCapability}
            effort={effortFor(selectedCapability, effort)}
            onEffortChange={setEffort}
            ultracode={selectedCapability.ultracode && ultracode}
            onUltracodeChange={setUltracode}
            permissionMode={permissionMode}
            onPermissionModeChange={changePermissionMode}
            worktreeSummary={worktrees.length > 0 ? worktrees.map((worktree) => worktree.name).join(" ↔ ") : "No Git worktrees detected"}
            connectionSummary={connection?.kind ?? "No connection"}
            eventsCount={state.events.length}
            firstWorktreeName={firstWorktree?.name ?? "No worktree"}
            secondWorktreeName={secondWorktree?.name}
            firstAgentRunning={firstSession?.status === "Running"}
            secondAgentRunning={secondSession?.status === "Running"}
            onToggleFirst={() => { if (firstWorktree) void toggleSession(firstWorktree.id); }}
            onToggleSecond={() => { if (secondWorktree) void toggleSession(secondWorktree.id); }}
            onCycleConnection={() => void cycleConnection()}
            onRecommendationSelect={(option) => void executeSend(option, permissionMode)}
            worktrees={worktrees.map((worktree) => ({ id: worktree.id, name: worktree.name, path: worktree.path }))}
            selectedWorktreeId={selectedWorktree?.id}
            onWorktreeChange={setSelectedWorktreeId}
            isolation={isolation}
            onIsolationChange={(next) => { setIsolation(next); setNewChatError(null); }}
            branches={branches}
            baseBranch={baseBranch ?? selectedWorktree?.name ?? branches[0] ?? ""}
            onBaseBranchChange={setBaseBranch}
            newChatError={newChatError}
            approval={pendingApproval ? (
              <PermissionCard
                key={`${chatKey(project.path, selectedSession?.id ?? 0)}:${pendingApproval.requestId}`}
                request={pendingApproval}
                waiting={(run?.approvals.length ?? 1) - 1}
                answering={sentDecision(run, pendingApproval.requestId)}
                onAnswer={answerApproval}
              />
            ) : pendingQuestion ? (
              <QuestionCard
                key={`${chatKey(project.path, selectedSession?.id ?? 0)}:${pendingQuestion.requestId}`}
                request={pendingQuestion}
                waiting={(run?.questions.length ?? 1) - 1}
                answering={sentReply(run, pendingQuestion.requestId)}
                onAnswer={answerQuestion}
              />
            ) : undefined}
          />
        </div>
      </main>
      </div>
    </DotBackground>
  );
}

export default App;
