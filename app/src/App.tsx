import { useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectionType,
  ChatMessage,
  ImageAttachment,
  CoordinatorState,
  Isolation,
  MODEL_CATALOG,
  ModelOption,
  OpenProject,
  PermissionMode,
  createInitialState,
  sessionForWorktree,
  sortedWorktrees,
} from "./model";
import { useAgentRuns } from "./components/useAgentRuns";
import { modelForChat } from "./lib/agent-runs";
import { usePastedImages } from "./components/usePastedImages";
import { ChatComposer } from "./components/ChatComposer";
import { DotBackground } from "./components/DotBackground";
import SidebarNav from "./components/SidebarNav";
import { SettingsNav, SettingsPanel } from "./components/Settings";
import type { SettingsSection } from "./components/Settings";
import { getSettings, useApplyTheme } from "./lib/settings";
import { ToolApproval, ToolApprovalCode } from "./components/agents/tool-approval";
import type { ToolApprovalStatus } from "./components/agents/tool-approval";
import type { UpdateState } from "./electron";

const connectionTypes: ConnectionType[] = ["Information", "Dependency", "Review", "Blocking"];

const MUTATING_INTENT = /\b(add|adicion(e|ar)|alter(e|ar|ado|ada)|atualiz(e|ar)|change|configur(e|ar)|corrij(a|e|ar)|crie|criar|create|delete|delet(e|ar)|edite|editar|edit|exclu(a|ir)|escrev(a|er)|faça|faca|implement(e|ar)|instal(e|ar)|mude|modifiqu(e|ar)|mov(a|er)|rebatiz(e|ar)|remove|remov(e|ar)|renome(i|ar)|salv(e|ar)|substitu(a|ir)|troqu(e|ar)|write)\b/i;
const READ_ONLY_INTENT = /^(como|o que|qual|por que|porque|explique|mostre|liste|analise|analisa|revise|revisa|verifique|verifica|inspecione|inspeciona|status|me diga|pode me dizer|how|what|which|why|explain|show|list|analy[sz]e|review|inspect|check)\b/i;
const EXPLICIT_MUTATION = /\b(e|and)\s+(add|adicion(e|ar)|alter(e|ar)|atualiz(e|ar)|change|configur(e|ar)|corrij(a|e|ar)|crie|criar|create|delete|delet(e|ar)|edite|editar|edit|exclu(a|ir)|escrev(a|er)|faça|faca|implement(e|ar)|instal(e|ar)|modifiqu(e|ar)|remove|remov(e|ar)|renome(i|ar)|salv(e|ar)|substitu(a|ir)|troqu(e|ar)|write)\b/i;

function requiresApproval(prompt: string) {
  const normalized = prompt.trim();
  if (!MUTATING_INTENT.test(normalized)) return false;
  return !READ_ONLY_INTENT.test(normalized) || EXPLICIT_MUTATION.test(normalized);
}

// The chat with the most recent message, or none so the app opens on a new chat.
function latestSessionId(state: CoordinatorState) {
  return state.messages.reduce<ChatMessage | null>((latest, message) => (!latest || message.id > latest.id ? message : latest), null)?.session_id ?? null;
}

function chatTitle(messages: ChatMessage[], fallback: string) {
  const line = messages.find((message) => message.role !== "assistant" && message.body.trim())?.body.trim().split("\n")[0] ?? "";
  if (!line) return fallback;
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

function App() {
  const [project, setProject] = useState<OpenProject | null>(null);
  const [state, setState] = useState<CoordinatorState | null>(null);
  const stateRef = useRef<CoordinatorState | null>(null);
  stateRef.current = state;
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelOption>(() => MODEL_CATALOG.find((model) => model.id === getSettings().defaultModelId) ?? MODEL_CATALOG[0]);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => getSettings().defaultPermissionMode);
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [isolation, setIsolation] = useState<Isolation>("local");
  const [branches, setBranches] = useState<string[]>([]);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [approvalImages, setApprovalImages] = useState<ImageAttachment[]>([]);
  const [approvalPrompt, setApprovalPrompt] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<ToolApprovalStatus>("pending");
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const approvalTimerRef = useRef<number | null>(null);
  useApplyTheme();

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

  const agentRuns = useAgentRuns(() => stateRef.current, commit);
  const run = selectedSession ? agentRuns.runs[String(selectedSession.id)] : undefined;
  const isSending = preparing || Boolean(run);

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

  const chats = useMemo(() => {
    if (!state) return [];
    return Object.values(state.sessions)
      .map((session) => ({ session, sessionMessages: state.messages.filter((message) => message.session_id === session.id) }))
      .filter(({ sessionMessages }) => sessionMessages.length > 0)
      .sort((a, b) => (b.sessionMessages.at(-1)?.id ?? 0) - (a.sessionMessages.at(-1)?.id ?? 0))
      .map(({ session, sessionMessages }) => ({ id: String(session.id), label: chatTitle(sessionMessages, session.agent_name) }));
  }, [state]);

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

  // An open chat keeps its session. A new chat in "New worktree" isolation gets its own worktree
  // before the first message goes out; a new local chat gets a session in the selected worktree.
  async function resolveSendTarget(body: string) {
    if (!state || !project || !selectedWorktree) return null;
    if (selectedSession) return { baseState: state, session: selectedSession, worktree: selectedWorktree };
    if (isolation === "local") {
      const idle = Object.values(state.sessions).find((session) => session.worktree_id === selectedWorktree.id && !state.messages.some((message) => message.session_id === session.id));
      const session = idle ?? { id: state.next_id, worktree_id: selectedWorktree.id, agent_name: selectedWorktree.name, status: "Created" as const };
      setSelectedSessionId(session.id);
      return { baseState: idle ? state : { ...state, next_id: state.next_id + 1, sessions: { ...state.sessions, [session.id]: session } }, session, worktree: selectedWorktree };
    }
    const created = await window.milagre.createWorktree({ projectPath: project.path, baseBranch: baseBranch ?? selectedWorktree.name, prompt: body });
    const worktree = created.project.state.worktrees[created.worktreeId];
    const session = sessionForWorktree(created.project.state, worktree.id);
    if (!session) throw new Error(`No chat session was created for ${worktree.name}.`);
    setState(created.project.state);
    setSelectedSessionId(session.id);
    setSelectedWorktreeId(worktree.id);
    setIsolation("local");
    setBaseBranch(null);
    void window.milagre.listBranches(project.path).then(setBranches);
    return { baseState: created.project.state, session, worktree };
  }

  async function executeSend(body: string, mode: PermissionMode, images: ImageAttachment[] = imageDraft.images) {
    if ((!body && !images.length) || !state || !selectedWorktree || !project || isSending || imageDraft.loading) return;
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
    if (!target) {
      setPreparing(false);
      return;
    }
    const { baseState, session, worktree } = target;

    const model = modelForChat(selectedModel, session.provider, baseState.messages.filter((message) => message.session_id === session.id), MODEL_CATALOG);
    const userMessage = {
      id: baseState.next_id,
      session_id: session.id,
      body,
      images,
      context: null,
      role: "user" as const,
      model: model.id,
    };
    commit({
      ...baseState,
      next_id: baseState.next_id + 1,
      messages: [...baseState.messages, userMessage],
      sessions: { ...baseState.sessions, [session.id]: { ...session, provider: model.provider } },
    });
    setDraft("");
    imageDraft.clear();
    setPreparing(false);
    await agentRuns.start({
      chatId: String(session.id),
      provider: model.provider,
      model: model.id,
      cwd: worktree.path,
      permissionMode: mode,
      prompt: body || "Describe the attached images.",
      images,
      resumeId: session.native_session_id,
    });
  }

  async function sendMessage() {
    const body = draft.trim();
    if ((!body && !imageDraft.images.length) || !state || !selectedWorktree || !project || isSending || imageDraft.loading) return;
    if (permissionMode === "ask" && (requiresApproval(body) || /(^|\s)\/[a-zA-Z0-9][\w.:-]*(?=\s|$)/.test(body))) {
      setApprovalImages([...imageDraft.images]);
      setApprovalStatus("pending");
      setApprovalPrompt(body);
      return;
    }
    await executeSend(body, permissionMode);
  }

  async function toggleSession(worktreeId: number) {
    if (!state) return;
    const session = sessionForWorktree(state, worktreeId);
    if (!session) return;
    const nextStatus = session.status === "Running" ? "Stopped" : "Running";
    await persist({
      ...state,
      sessions: {
        ...state.sessions,
        [session.id]: { ...session, status: nextStatus },
      },
    });
  }

  async function cycleConnection() {
    if (!state || !connection) return;
    const nextKind = connectionTypes[(connectionTypes.indexOf(connection.kind) + 1) % connectionTypes.length];
    await persist({
      ...state,
      connections: { ...state.connections, [connection.id]: { ...connection, kind: nextKind } },
    });
  }

  function approvePending(mode: PermissionMode) {
    const body = approvalPrompt;
    if (!body) return;
    if (mode === "auto") setPermissionMode("auto");
    setApprovalStatus("approving");
    if (approvalTimerRef.current !== null) window.clearTimeout(approvalTimerRef.current);
    approvalTimerRef.current = window.setTimeout(() => {
      approvalTimerRef.current = null;
      setApprovalPrompt(null);
      void executeSend(body, mode, approvalImages);
    }, 350);
  }

  function denyPending() {
    if (approvalTimerRef.current !== null) {
      window.clearTimeout(approvalTimerRef.current);
      approvalTimerRef.current = null;
    }
    setApprovalStatus("denied");
    approvalTimerRef.current = window.setTimeout(() => {
      approvalTimerRef.current = null;
      setApprovalPrompt(null);
    }, 300);
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
      if (event.key !== "Escape") return;
      if (view === "settings") {
        event.preventDefault();
        setView("chat");
        return;
      }
      if (approvalPrompt) {
        event.preventDefault();
        denyPending();
        return;
      }
      if (run && selectedSession) {
        event.preventDefault();
        void agentRuns.interrupt(String(selectedSession.id));
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [approvalPrompt, run, selectedSession?.id, view]);

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
      <div className={`shrink-0 py-3 pl-3 ${view === "chat" ? "flex" : "hidden"}`}>
      <SidebarNav
        key={project.path}
        fill
        workspaceName={project.name}
        onOpenProject={() => void openProject()}
        recents={chats}
        activeId={selectedSession ? String(selectedSession.id) : null}
        onPick={(id) => {
          setSelectedSessionId(Number(id));
          setSelectedWorktreeId(state.sessions[id]?.worktree_id ?? null);
          setView("chat");
        }}
        onNewChat={startNewChat}
        onOpenSettings={() => setView("settings")}
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
            sessions={state.sessions}
            imageDraft={imageDraft}
            projectPath={selectedWorktree?.path ?? project.path}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void sendMessage()}
            isSending={isSending}
            streamingText={run?.text}
            lockedProvider={messages.length > 0 ? selectedSession?.provider : undefined}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            permissionMode={permissionMode}
            onPermissionModeChange={setPermissionMode}
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
            worktrees={worktrees.map((worktree) => ({ id: worktree.id, name: worktree.name, path: worktree.path }))}
            selectedWorktreeId={selectedWorktree?.id}
            onWorktreeChange={setSelectedWorktreeId}
            isolation={isolation}
            onIsolationChange={(next) => { setIsolation(next); setNewChatError(null); }}
            branches={branches}
            baseBranch={baseBranch ?? selectedWorktree?.name ?? branches[0] ?? ""}
            onBaseBranchChange={setBaseBranch}
            newChatError={newChatError}
            approval={approvalPrompt ? (
              <ToolApproval
                tool="agent.run"
                title="Allow this agent to run?"
                description={`The agent wants to work inside ${isolation === "worktree" && !selectedSession ? `a new worktree from ${baseBranch ?? selectedWorktree?.name}` : selectedWorktree?.name ?? "the selected worktree"}. Choose how this run can access files and execute operations.`}
                status={approvalStatus}
                defaultOpen
                parameters={[
                  {
                    id: "request",
                    label: "Request",
                    value: <span className="whitespace-pre-wrap">{approvalPrompt}</span>,
                  },
                  { id: "worktree", label: "Worktree", value: selectedWorktree?.path ?? "Selected project worktree" },
                  { id: "access", label: "Access", value: "Write access inside this worktree" },
                  {
                    id: "command",
                    label: "Command preview",
                    value: <ToolApprovalCode code={`${selectedModel.provider} · ${selectedModel.id}`} language="text" />,
                  },
                ]}
                onApprove={() => approvePending("ask")}
                onAlwaysAllow={() => approvePending("auto")}
                onDeny={denyPending}
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
