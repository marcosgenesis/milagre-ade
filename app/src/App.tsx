import { useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectionType,
  ImageAttachment,
  CoordinatorState,
  MODEL_CATALOG,
  ModelOption,
  OpenProject,
  PermissionMode,
  createInitialState,
  sessionForWorktree,
  sortedWorktrees,
} from "./model";
import { usePastedImages } from "./components/usePastedImages";
import { ChatComposer } from "./components/ChatComposer";
import { DotBackground } from "./components/DotBackground";
import SidebarNav from "./components/SidebarNav";
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

function App() {
  const [project, setProject] = useState<OpenProject | null>(null);
  const [state, setState] = useState<CoordinatorState | null>(null);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelOption>(MODEL_CATALOG[0]);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("ask");
  const [approvalImages, setApprovalImages] = useState<ImageAttachment[]>([]);
  const [approvalPrompt, setApprovalPrompt] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<ToolApprovalStatus>("pending");
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const approvalTimerRef = useRef<number | null>(null);

  useEffect(() => {
    window.milagre.getCurrentProject().then((current) => {
      setProject(current);
      const nextState = current.state ?? createInitialState(current.name, current.path);
      setState(nextState);
      setSelectedWorktreeId(sortedWorktrees(nextState)[0]?.id ?? null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};
    window.milagre.getUpdateState().then(setUpdate);
    unsubscribe = window.milagre.onUpdateState(setUpdate);
    return unsubscribe;
  }, []);

  const worktrees = useMemo(() => (state ? sortedWorktrees(state) : []), [state]);
  const firstWorktree = worktrees[0];
  const secondWorktree = worktrees[1];
  const firstSession = state && firstWorktree ? sessionForWorktree(state, firstWorktree.id) : undefined;
  const secondSession = state && secondWorktree ? sessionForWorktree(state, secondWorktree.id) : undefined;
  const selectedWorktree = worktrees.find((worktree) => worktree.id === selectedWorktreeId) ?? firstWorktree;
  const imageDraft = usePastedImages(selectedWorktree?.path ?? project?.path ?? "");
  const selectedSession = state && selectedWorktree ? sessionForWorktree(state, selectedWorktree.id) : undefined;
  const connection = state ? Object.values(state.connections)[0] : undefined;
  const messages = state && selectedSession ? state.messages.filter((message) => message.session_id === selectedSession.id) : [];

  async function persist(nextState: CoordinatorState) {
    setState(nextState);
    if (project) await window.milagre.saveProject(project.path, nextState);
  }

  async function openProject() {
    const nextProject = await window.milagre.openProject();
    if (!nextProject) return;
    setProject(nextProject);
    const nextState = nextProject.state ?? createInitialState(nextProject.name, nextProject.path);
    setState(nextState);
    setSelectedWorktreeId(sortedWorktrees(nextState)[0]?.id ?? null);
    setDraft("");
  }

  async function executeSend(body: string, mode: PermissionMode, images: ImageAttachment[] = imageDraft.images) {
    if ((!body && !images.length) || !state || !selectedSession || !project || isSending || imageDraft.loading) return;
    const userMessage = {
      id: state.next_id,
      session_id: selectedSession.id,
      body,
      images,
      context: null,
      role: "user" as const,
      model: selectedModel.id,
    };
    const stateWithUserMessage: CoordinatorState = {
      ...state,
      next_id: state.next_id + 1,
      messages: [...state.messages, userMessage],
    };
    setDraft("");
    imageDraft.clear();
    setIsSending(true);

    try {
      await persist(stateWithUserMessage);
      const response = await window.milagre.sendToAgent({
        provider: selectedModel.provider,
        model: selectedModel.id,
        projectPath: selectedWorktree.path,
        prompt: body || "Describe the attached images.",
        images,
        permissionMode: mode,
      });
      await persist({
        ...stateWithUserMessage,
        next_id: stateWithUserMessage.next_id + 1,
        messages: [
          ...stateWithUserMessage.messages,
          {
            id: stateWithUserMessage.next_id,
            session_id: selectedSession.id,
            body: response,
            context: null,
            role: "assistant",
            model: selectedModel.id,
          },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The agent could not respond.";
      await persist({
        ...stateWithUserMessage,
        next_id: stateWithUserMessage.next_id + 1,
        messages: [
          ...stateWithUserMessage.messages,
          {
            id: stateWithUserMessage.next_id,
            session_id: selectedSession.id,
            body: message === "Agent cancelled by user" ? "Agent run cancelled." : `Agent error: ${message}`,
            context: null,
            role: "assistant",
            model: selectedModel.id,
          },
        ],
      });
    } finally {
      setIsSending(false);
    }
  }

  async function sendMessage() {
    const body = draft.trim();
    if ((!body && !imageDraft.images.length) || !state || !selectedSession || !project || isSending || imageDraft.loading) return;
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
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (approvalPrompt) {
        event.preventDefault();
        denyPending();
        return;
      }
      if (isSending) {
        event.preventDefault();
        void window.milagre.cancelAgent();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [approvalPrompt, isSending]);

  if (loading || !project || !state) {
    return <div className="grid h-screen place-items-center overflow-hidden bg-page text-sm text-ink-3">Loading workspace…</div>;
  }

  return (
    <DotBackground>
      {update?.status === "downloaded" && (
        <div className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm text-ink shadow-lg">
          <span>Milagre {update.version} está pronto para atualizar.</span>
          <button className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700" onClick={() => void window.milagre.installUpdate()}>
            Atualizar e reiniciar
          </button>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden text-ink">
      <SidebarNav
        key={project.path}
        fill
        workspaceName={project.name}
        onOpenProject={() => void openProject()}
        recents={worktrees.map((worktree) => ({ id: String(worktree.id), label: worktree.name }))}
        onPick={(id) => setSelectedWorktreeId(Number(id))}
        onNewChat={() => setDraft("")}
        footerLabel="Records & Context"
        onFooterClick={() => void openProject()}
      />

      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        <div className="min-h-0 flex-1 overflow-hidden">
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
            onRecommendationSelect={(option) => void executeSend(option, permissionMode)}
            approval={approvalPrompt ? (
              <ToolApproval
                tool="agent.run"
                title="Allow this agent to run?"
                description={`The agent wants to work inside ${selectedWorktree?.name ?? "the selected worktree"}. Choose how this run can access files and execute operations.`}
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
