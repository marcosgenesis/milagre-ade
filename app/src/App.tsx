import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ChatMessage,
  ImageAttachment,
  CoordinatorState,
  Isolation,
  MODEL_CATALOG,
  ModelOption,
  ModelProvider,
  OpenProject,
  PermissionDecision,
  QuestionAnswers,
  PermissionMode,
  EffortLevel,
  AgentCliStatus,
  AgentModels,
  capabilityFor,
  effortFor,
  supportsFastMode,
  sessionForWorktree,
  sortedWorktrees,
} from "./model";
import { useAgentRuns } from "./components/useAgentRuns";
import { useAgentPorts } from "./lib/ports";
import { chatInProject, chatKey, chatsAskingUser, chatsRunning, chatsWaitingForUser, lastUserModel, modelForChat, projectOfKey, sentDecision, sentReply, sessionIdFromKey } from "./lib/agent-runs";
import { attachmentPrompt } from "./lib/media";
import { BLOCKERS, blockerPrompt, isBlockerDismissed, pullRequestBlockers } from "./lib/pr-blockers";
import { capabilitiesFrom, keepIfSame, mergeModels, nextSelection, providerForId, resolveModel } from "./lib/models";
import { chatMark, chatTitle, orderChats } from "./lib/chat-list";
import type { SessionPatch } from "../../electron/shared/project-edits.mjs";
import { isMilagreWorktree, worktreeShared } from "./lib/archive";
import { archiveChat as runArchive } from "./lib/archive-flow";
import type { ArchiveMode, ArchivePlan } from "./lib/archive";
import { ChangesPanel } from "./components/changes/ChangesPanel";
import { ChangesPanelSlot } from "./components/changes/ChangesPanelSlot";
import { ChangesToggle, DiffBar } from "./components/changes/ChangesChrome";
import { AnimatePresence } from "motion/react";
import { useDiffComments } from "./components/changes/useDiffComments";
import { formatCommentsMessage } from "./lib/diff-comments";
import { DiffToolbar, DiffView, useDiffPreferences, useDiffPresence } from "./components/changes/DiffView";
import { useChanges } from "./components/changes/useChanges";
import { GitActionsDialog } from "./components/GitActionsDialog";
import { gitChatContext, isGitNote, type GitChatContext } from "./lib/git-dialog";
import { useWorktreePullRequests } from "./components/useWorktreePullRequests";
import { chatPullRequests, pullRequestRefs } from "./lib/chat-pull-requests";
import { usePastedImages } from "./components/usePastedImages";
import { ChatComposer } from "./components/ChatComposer";
import { DotBackground } from "./components/DotBackground";
import { StartupSplash } from "./components/StartupSplash";
import SidebarNav from "./components/SidebarNav";
import { SettingsNav, SettingsPanel } from "./components/Settings";
import { chatRevealPath } from "./lib/reveal";
import type { SettingsSection } from "./components/Settings";
import { handoverLinks, handoverModel, isHandoverChat } from "./lib/handover";
import { getSettings, toggleTheme, updateSettings, useApplyTheme, useSettings } from "./lib/settings";
import { EditorLinks, Notice } from "./components/editor-links";
// Notice above is editor-links' toast; this is the dismissable notice card.
import { Notice as NoticeCard } from "./components/Notice";
import { openInEditor } from "./lib/editors";
import { PermissionCard } from "./components/agents/PermissionCard";
import { QuestionCard } from "./components/agents/QuestionCard";
import type { UpdateState } from "./electron";
import { SidebarUsage } from "./components/usage/SidebarUsage";
import { visibleProviders } from "./components/usage/format";
import { useUsage } from "./components/usage/useUsage";
import { loadChatPreferences, saveChatPreferences } from "./lib/chat-preferences";
import { CommandPalette } from "./components/CommandPalette";
import { settingsCommands } from "./lib/settings-commands";
import type { Command } from "./lib/commands";
import type { RecentProject } from "./lib/project-list";
import { isModalOpen } from "./lib/modal";

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
  // The latest state of every project the main process has sent this window; it's their only writer
  // (see ADR-0001). The ref leads, so callbacks read a state that arrived since the last render.
  const [states, setStates] = useState<Record<string, CoordinatorState>>({});
  const statesRef = useRef(states);
  const state = project ? states[project.path] ?? null : null;
  /** The open project's latest state. */
  const openState = () => (projectRef.current ? statesRef.current[projectRef.current.path] : undefined);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const selectedSessionRef = useRef<number | null>(null);
  selectedSessionRef.current = selectedSessionId;
  const [draft, setDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelOption>(() => resolveModel(MODEL_CATALOG, getSettings().defaultModelId, providerForId(getSettings().defaultModelId)));
  const [effort, setEffortState] = useState<EffortLevel>(() => (localStorage.getItem("milagre.effort") as EffortLevel | null) ?? "high");
  const setEffort = (level: EffortLevel) => { setEffortState(level); localStorage.setItem("milagre.effort", level); };
  const [ultracode, setUltracodeState] = useState(() => localStorage.getItem("milagre.ultracode") === "on");
  const setUltracode = (on: boolean) => { setUltracodeState(on); localStorage.setItem("milagre.ultracode", on ? "on" : "off"); };
  const [fastMode, setFastModeState] = useState(() => localStorage.getItem("milagre.fastMode") === "on");
  const setFastMode = (on: boolean) => { setFastModeState(on); localStorage.setItem("milagre.fastMode", on ? "on" : "off"); };
  // The agents' own model lists; the maintained list stands in until they arrive, and for a missing CLI.
  const [reported, setReported] = useState<AgentModels | null>(null);
  const models = useMemo(() => mergeModels(reported, MODEL_CATALOG), [reported]);
  // Whether each agent's CLI is missing, outdated, broken or logged out, for the model picker. Loaded at
  // startup and again each time the picker opens, so a fix shows without a restart.
  const [cliStatus, setCliStatus] = useState<AgentCliStatus | null>(null);
  // The model lists come along: the main process keeps a good list for the run but asks again for an agent
  // that had none (a CLI that was missing, or Claude Code before it was logged in).
  const refreshCliStatus = () => {
    // A refetch that changed nothing keeps the old objects, so opening the picker doesn't re-render the app or
    // re-apply anything that depends on the lists.
    void window.milagre.getCliStatus().then((next) => setCliStatus((previous) => keepIfSame(previous, next))).catch(() => undefined);
    void window.milagre.getModels().then((next) => setReported((previous) => keepIfSame(previous, next))).catch(() => undefined);
  };
  useEffect(refreshCliStatus, []);
  const capabilities = useMemo(() => capabilitiesFrom(reported), [reported]);
  // The Settings default applies once, when the agents' lists first arrive, if the user hasn't picked a model
  // and the open chat isn't on the other agent. After that a model the agents don't offer only gives way to
  // its provider's recommended model (see nextSelection).
  const pickedModel = useRef(false);
  const appliedDefault = useRef(false);
  const lockedProviderRef = useRef<ModelProvider | undefined>(undefined);
  useEffect(() => {
    const applyDefault = reported !== null && !appliedDefault.current && !pickedModel.current;
    if (reported !== null) appliedDefault.current = true;
    setSelectedModel((current) => nextSelection(models, current, { defaultId: getSettings().defaultModelId, applyDefault, lockedProvider: lockedProviderRef.current }));
  }, [models]);
  const chooseModel = (model: ModelOption) => { pickedModel.current = true; setSelectedModel(model); updateSettings({ defaultModelId: model.id }); };
  const selectedCapability = capabilityFor(selectedModel, capabilities);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => getSettings().defaultPermissionMode);
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  useEffect(() => {
    if (!commandPaletteOpen) return;
    let cancelled = false;
    window.milagre.listRecentProjects().then((projects) => {
      if (!cancelled) setRecentProjects(projects);
    }).catch(() => { if (!cancelled) setRecentProjects([]); });
    return () => { cancelled = true; };
  }, [commandPaletteOpen]);
  const [isolation, setIsolation] = useState<Isolation>(() => loadChatPreferences(localStorage, "").isolation);
  const [branches, setBranches] = useState<string[]>([]);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [newChatError, setNewChatError] = useState<string | null>(null);
  // A short message about something that happened off to the side (a worktree that wouldn't go).
  const [notice, setNotice] = useState<string | null>(null);
  const [updatingCli, setUpdatingCli] = useState<ModelProvider | null>(null);

  const updateCli = async (provider: ModelProvider) => {
    setUpdatingCli(provider);
    try {
      const result = await window.milagre.updateCli(provider);
      if (result.status) {
        setCliStatus((previous) => (previous ? { ...previous, [provider]: result.status! } : previous));
      }
      refreshCliStatus();
      if (result.ok) {
        setNotice(`${provider === "codex" ? "Codex" : "Claude Code"} updated to version ${result.version ?? "latest"} successfully!`);
      } else {
        setNotice(result.error ?? `Failed to update ${provider === "codex" ? "Codex" : "Claude Code"}.`);
      }
    } catch (error) {
      setNotice(`Error updating ${provider === "codex" ? "Codex" : "Claude Code"}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUpdatingCli(null);
    }
  };
  // Every finished message card gets this (an outdated CLI's reply shows an Update button), so it keeps one identity
  // across renders: a new function per keystroke or streamed batch would re-render the whole transcript (see sendRecommendation).
  const updateCliRef = useRef(updateCli);
  updateCliRef.current = updateCli;
  const handleUpdateCli = useCallback((provider: ModelProvider) => updateCliRef.current(provider), []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [gitDialog, setGitDialog] = useState<{ sessionId: number; worktreeId: number; cwd: string; base?: string; provider?: ModelProvider; chat: GitChatContext } | null>(null);
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
      adoptProject(current);
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
  const selectedSession = state && selectedSessionId !== null ? state.sessions[selectedSessionId] : undefined;
  const selectedWorktree = worktrees.find((worktree) => worktree.id === (selectedSession?.worktree_id ?? selectedWorktreeId)) ?? firstWorktree;
  const imageDraft = usePastedImages(`${project?.path ?? ""}:${selectedSessionId ?? "new"}:${selectedWorktree?.path ?? ""}`);
  const messages = state && selectedSession ? state.messages.filter((message) => message.session_id === selectedSession.id) : [];
  // A handed-over chat's brief, attached to its first message until it is sent.
  const handoverDraft = messages.length === 0 ? selectedSession?.handoverDraft : undefined;
  lockedProviderRef.current = messages.length > 0 || isHandoverChat(selectedSession) ? selectedSession?.provider : undefined;

  const agentRuns = useAgentRuns(receiveState, (chatId) => {
    const latest = statesRef.current[projectOfKey(chatId)];
    return latest ? lastUserModel(latest, sessionIdFromKey(chatId)) : "";
  });
  const { pullRequests, chatPullRequests: chatPrs, dismissedBlockers, dismissBlockerAction } = useWorktreePullRequests(project?.path ?? "", state);
  const changes = useChanges({
    cwd: selectedWorktree?.path,
    base: selectedWorktree?.base,
    chatId: project && selectedSession ? chatKey(project.path, selectedSession.id) : null,
    available: view === "chat" && Boolean(selectedSession && selectedWorktree),
  });
  const diffComments = useDiffComments(project && selectedSession ? chatKey(project.path, selectedSession.id) : null, changes);
  const diffPrefs = useDiffPreferences();
  const diffShowing = changes.diffOpen;
  const diffPresence = useDiffPresence(diffShowing);
  const changesAvailable = view === "chat" && Boolean(selectedSession && selectedWorktree);
  const changesAvailableRef = useRef(false);
  changesAvailableRef.current = changesAvailable;
  const selectedPullRequest = selectedWorktree && pullRequests[selectedWorktree.path];
  const pullRequestBlocker = selectedPullRequest
    ? pullRequestBlockers(selectedPullRequest).find((blocker) => !isBlockerDismissed(dismissedBlockers, blocker, selectedPullRequest))
    : undefined;
  const run = project && selectedSession ? agentRuns.runs[chatKey(project.path, selectedSession.id)] : undefined;
  const agentPorts = useAgentPorts();
  const isSending = preparing || Boolean(run);
  const usage = useUsage();
  const { chatOrder, showUsageInSidebar, keepAwake, defaultModelId, defaultPermissionMode, notifyOnCompletion, showDockBadge, notifyWhenWaiting } = useSettings();

  // Visiting an old chat can change its displayed model, but never the preference for new chats.
  useEffect(() => {
    if (selectedSessionId !== null) return;
    setSelectedModel(resolveModel(models, defaultModelId, providerForId(defaultModelId)));
    setPermissionMode(defaultPermissionMode);
  }, [selectedSessionId, defaultModelId, defaultPermissionMode, models]);

  const effectiveBaseBranch = baseBranch && branches.includes(baseBranch)
    ? baseBranch : selectedWorktree?.name ?? branches[0] ?? "";

  function restoreProjectChoices(nextState: CoordinatorState, path: string) {
    const saved = loadChatPreferences(localStorage, path);
    setSelectedWorktreeId(sortedWorktrees(nextState).find((tree) => tree.path === saved.worktreePath)?.id ?? sortedWorktrees(nextState)[0]?.id ?? null);
    setBaseBranch(saved.baseBranch ?? null);
  }
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
    updateSettings({ defaultPermissionMode: mode });
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
    const next = modelForChat(selectedModel, selectedSession.provider, messages, models);
    if (next.id !== selectedModel.id) setSelectedModel(next);
  }, [selectedSession?.id, selectedSession?.provider]);

  function receiveState(projectPath: string, next: CoordinatorState) {
    statesRef.current = { ...statesRef.current, [projectPath]: next };
    setStates(statesRef.current);
  }

  useEffect(() => window.milagre.onProjectState(({ path, state: next }) => receiveState(path, next)), []);

  // Approvals never time out, so mark chats that wait on one (the open chat too: its card may be scrolled away).
  const waiting = useMemo(() => chatsWaitingForUser(agentRuns.runs, project?.path ?? ""), [agentRuns.runs, project?.path]);
  const asking = useMemo(() => chatsAskingUser(agentRuns.runs, project?.path ?? ""), [agentRuns.runs, project?.path]);
  const running = useMemo(() => chatsRunning(agentRuns.runs, project?.path ?? "", state?.sessions), [agentRuns.runs, project?.path, state?.sessions]);
  const chats = useMemo(() => {
    if (!state) return [];
    const withMessages = Object.values(state.sessions)
      .filter((session) => !session.archived)
      .map((session) => ({ session, sessionMessages: state.messages.filter((message) => message.session_id === session.id) }))
      .filter(({ session, sessionMessages }) => sessionMessages.length > 0 || isHandoverChat(session));
    return orderChats(withMessages, chatOrder)
      .map(({ session, sessionMessages }) => {
        const worktree = state.worktrees[session.worktree_id];
        // The commit dialog's notes aren't replies: they don't hide a failed turn.
        const lastReply = [...sessionMessages].reverse().find((message) => message.role === "assistant" && !isGitNote(message));
        return {
          id: String(session.id),
          label: chatTitle(session, sessionMessages),
          mark: chatMark({ asking: asking.has(session.id), waiting: waiting.has(session.id), running: running.has(session.id), unread: Boolean(session.unread) }),
          unread: Boolean(session.unread),
          details: {
            branch: worktree?.name,
            path: worktree?.path,
            diff: worktree?.diff,
            pullRequests: worktree ? chatPullRequests(pullRequestRefs(sessionMessages), chatPrs[worktree.path] ?? {}, pullRequests[worktree.path] ?? undefined) : [],
            failed: lastReply?.outcome === "failed",
            ports: project ? agentPorts[chatKey(project.path, session.id)] : undefined,
          },
        };
      });
  }, [state, chatOrder, asking, waiting, running, pullRequests, chatPrs, agentPorts, project]);
  // The main process applies chat row actions to the latest state, so a turn that finished since the last render isn't lost.
  function patchChat(sessionId: number, patch: SessionPatch) {
    const current = projectRef.current;
    if (current) void window.milagre.patchChat(current.path, sessionId, patch).catch(() => {});
  }

  function archiveChild(id: string, archived: boolean) {
    const current = projectRef.current;
    const parentId = selectedSessionRef.current;
    if (current && parentId !== null) void window.milagre.archiveSubagent(current.path, parentId, id, archived).catch(() => {});
  }

  function archiveFinishedChildren() {
    const current = projectRef.current;
    const parentId = selectedSessionRef.current;
    if (current && parentId !== null) void window.milagre.archiveFinishedSubagents(current.path, parentId).catch(() => {});
  }

  function openChat(sessionId: number) {
    setSelectedSessionId(sessionId);
    setSelectedWorktreeId(openState()?.sessions[sessionId]?.worktree_id ?? null);
    setView("chat");
  }

  // The main process reads the chat on screen (on opening it, and when the window regains focus over it),
  // and leaves a chat unread when its turn ends anywhere else, or while no window has focus.
  useEffect(() => {
    void window.milagre.setOpenChat(view === "chat" && project && selectedSessionId !== null ? chatKey(project.path, selectedSessionId) : null).catch(() => {});
  }, [selectedSessionId, view, project?.path]);

  // Archiving hides the chat for good; a turn still running in it is stopped first. The steps and their order
  // live in lib/archive-flow.ts, which is passed what it touches.
  function archiveChat(sessionId: number, mode: ArchiveMode, plan: ArchivePlan | null) {
    if (!project) return Promise.resolve();
    const projectPath = project.path;
    const key = chatKey(projectPath, sessionId);
    const wasOpen = selectedSessionId === sessionId;
    return runArchive({
      projectPath,
      chatId: key,
      getState: () => openState() ?? null,
      currentProjectPath: () => projectRef.current?.path,
      stop: () => (agentRuns.runs[key] ? agentRuns.interrupt(key).catch(() => {}) : undefined),
      hide: () => {
        patchChat(sessionId, { archived: true, unread: false });
        if (selectedSessionId === sessionId) startNewChat();
      },
      // The worktree stays, so the chat comes back with it; it is reopened only if it was open and nothing else has been since.
      restore: () => {
        patchChat(sessionId, { archived: false });
        if (wasOpen && selectedSessionRef.current === null) openChat(sessionId);
      },
      remove: (worktree, options) => window.milagre.removeWorktree(worktree.path, options),
      // The main process has dropped the worktree and its chats; a removal that drops the open chat or the picked
      // worktree moves the selection on.
      applyRemoval: (removed) => {
        setSelectedSessionId((current) => (current !== null && removed.sessionIds.includes(current) ? null : current));
        setSelectedWorktreeId((current) => (current === removed.worktreeId ? null : current));
      },
      refreshBranches: () => void window.milagre.listBranches(projectPath).then(setBranches).catch(() => {}),
      notify: setNotice,
    }, sessionId, mode, plan);
  }

  // What the archive menu offers depends on the chat's worktree: whether Milagre made it, whether another chat
  // uses it, and what it would lose.
  async function checkArchive(sessionId: number): Promise<ArchivePlan> {
    const latest = openState();
    const worktree = latest ? latest.worktrees[latest.sessions[sessionId]?.worktree_id ?? -1] : undefined;
    if (!latest || !isMilagreWorktree(worktree, await window.milagre.getWorktreeRoots())) return { milagreOwned: false, shared: false, status: null };
    if (worktreeShared(latest, sessionId)) return { milagreOwned: true, shared: true, status: null };
    return { milagreOwned: true, shared: false, status: await window.milagre.getWorktreeStatus(worktree.path, worktree.base!) };
  }

  // "Commit and open PR…" opens the chat, with the dialog over it.
  function openGitDialog(sessionId: number) {
    const latest = openState();
    const session = latest?.sessions[sessionId];
    const worktree = session ? latest.worktrees[session.worktree_id] : undefined;
    if (!latest || !session || !worktree) return;
    const sessionMessages = latest.messages.filter((message) => message.session_id === sessionId);
    openChat(sessionId);
    setGitDialog({ sessionId, worktreeId: worktree.id, cwd: worktree.path, base: worktree.base, provider: session.provider, chat: gitChatContext(chatTitle(session, sessionMessages), sessionMessages) });
  }

  // What the dialog did goes on record as a short line in the chat; the main process holds it back while the
  // chat's turn runs, so it lands after the reply instead of inside it.
  function recordGitNote(sessionId: number, body: string) {
    const current = projectRef.current;
    if (current) void window.milagre.addGitNote(chatKey(current.path, sessionId), body).catch(() => {});
  }

  function revealChat(sessionId: number) {
    if (!project) return;
    void window.milagre.revealInFolder(chatRevealPath(openState() ?? null, sessionId, project.path)).catch(() => {});
  }

  function openChatInEditor(sessionId: number) {
    const latest = openState();
    const worktree = latest?.worktrees[latest.sessions[sessionId]?.worktree_id ?? -1];
    if (worktree) void openInEditor(worktree.path);
  }

  // The main process keeps the Mac awake while a turn runs, if the setting says so.
  useEffect(() => { void window.milagre.setKeepAwake(keepAwake).catch(() => {}); }, [keepAwake]);

  const unreadChatIds = state && project ? Object.values(state.sessions).filter(session => session.unread && !session.archived).map(session => chatKey(project.path, session.id)) : [];
  useEffect(() => {
    if (!project) return;
    void window.milagre.syncNotifications({ projectPath: project.path, activeChatId: view === "chat" && selectedSessionId !== null ? chatKey(project.path, selectedSessionId) : null, unread: unreadChatIds, notifyOnCompletion, showDockBadge }).catch(() => {});
  }, [project?.path, view, selectedSessionId, JSON.stringify(unreadChatIds), notifyOnCompletion, showDockBadge]);

  // The main process notifies about a chat that waits on the user while Milagre is in the background.
  useEffect(() => {
    void window.milagre.setNotifyWhenWaiting(notifyWhenWaiting).catch(() => {});
  }, [notifyWhenWaiting]);

  // A turn that ends in the open project while Milagre is in the background gets a completion alert.
  useEffect(() => window.milagre.onAgentEvent(({ chatId, event }) => {
    const current = projectRef.current;
    const latest = openState();
    if (!current || !latest || !chatInProject(current.path, chatId)) return;
    const session = latest.sessions[sessionIdFromKey(chatId)];
    if (!session || session.archived) return;
    if (event.type === "turn-completed" || event.type === "turn-failed") {
      void window.milagre.notifyCompletion({ chatId, title: current.name, subtitle: chatTitle(session, latest.messages.filter((message) => message.session_id === session.id)) }).catch(() => {});
    }
  }), []);

  // A new worktree's branch is renamed a few seconds in, once its chat's name is picked; the main process saves the new name.
  useEffect(() => window.milagre.onWorktreeRenamed((rename) => {
    if (projectRef.current?.path === rename.projectPath) void window.milagre.listBranches(rename.projectPath).then(setBranches);
  }), []);

  const pendingNotificationChat = useRef<string | null>(null);
  // Clicking a notification opens its chat, in another project too.
  useEffect(() => window.milagre.onOpenChat((chatId) => {
    const current = projectRef.current;
    const session = current && chatInProject(current.path, chatId) ? openState()?.sessions[sessionIdFromKey(chatId)] : undefined;
    if (session) { openChat(session.id); return; }
    const separator = chatId.lastIndexOf("#");
    if (separator <= 0) return;
    pendingNotificationChat.current = chatId;
    void switchProject(chatId.slice(0, separator));
  }), []);

  function startNewChat() {
    const latest = openState();
    if (latest && projectRef.current) restoreProjectChoices(latest, projectRef.current.path);
    setSelectedSessionId(null);
    setDraft("");
    setNewChatError(null);
    setView("chat");
    // The composer may only mount on this render (coming from settings), so focus after it lands.
    window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]')?.focus());
  }

  function selectInitialChat(nextState: CoordinatorState, path: string) {
    restoreProjectChoices(nextState, path);
    const target = pendingNotificationChat.current;
    const targetId = target && chatInProject(path, target) ? sessionIdFromKey(target) : null;
    const sessionId = targetId !== null && nextState.sessions[targetId] ? targetId : latestSessionId(nextState);
    pendingNotificationChat.current = null;
    setSelectedSessionId(sessionId);
    if (sessionId !== null) setSelectedWorktreeId(nextState.sessions[sessionId]?.worktree_id ?? null);
  }

  // Switching projects leaves the other project's turns running; their marks come back with it.
  function adoptProject(nextProject: OpenProject) {
    receiveState(nextProject.path, nextProject.state);
    projectRef.current = nextProject;
    // The project's remembered worktree and base branch come back with it; nothing about the old project's chats
    // carries over, the commit dialog included (it names a chat by id, and every project has a chat 2).
    flushSync(() => {
      setProject(nextProject);
      selectInitialChat(nextProject.state, nextProject.path);
      setDraft("");
      setGitDialog(null);
      setView("chat");
    });
  }

  // Opens a project in place of the one shown; a cancelled dialog, or the project already open, changes nothing.
  async function replaceProject(load: () => Promise<OpenProject | null>) {
    try {
      const next = await load();
      if (next && next.path !== projectRef.current?.path) adoptProject(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  }

  const openProject = () => replaceProject(() => window.milagre.openProject());
  const switchProject = (projectPath: string) => replaceProject(() => window.milagre.switchProject(projectPath));

  // Where a message goes: an open chat keeps its session, a new local chat (session null) gets one
  // from the main process, and a new chat in "New worktree" isolation gets its own worktree first.
  async function resolveSendTarget(body: string) {
    if (!state || !project || !selectedWorktree) return null;
    if (selectedSession) return { sessionId: selectedSession.id as number | null, worktreeId: selectedWorktree.id };
    if (isolation === "local") return { sessionId: null, worktreeId: selectedWorktree.id };
    setBaseBranch(effectiveBaseBranch);
    saveChatPreferences(localStorage, project.path, { baseBranch: effectiveBaseBranch });
    const created = await window.milagre.createWorktree({ projectPath: project.path, baseBranch: effectiveBaseBranch, prompt: body });
    const session = sessionForWorktree(created.project.state, created.worktreeId);
    if (!session) throw new Error(`No chat session was created for ${created.project.state.worktrees[created.worktreeId]?.name}.`);
    if (created.setupNote) setNotice(created.setupNote);
    void window.milagre.listBranches(project.path).then(setBranches);
    return { sessionId: session.id as number | null, worktreeId: created.worktreeId };
  }

  const ipcError = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

  async function executeSend(body: string, mode: PermissionMode, images: ImageAttachment[] = imageDraft.images, files: string[] = imageDraft.files, preserveComposer = false): Promise<boolean> {
    // The brief is sent with the main process's copy of the draft, so the message may be empty.
    const briefAttached = handoverDraft !== undefined;
    if ((!body && !images.length && !files.length && !briefAttached) || !state || !selectedWorktree || !project || preparing || imageDraft.loading) return false;
    setPreparing(true);
    setNewChatError(null);

    let target: Awaited<ReturnType<typeof resolveSendTarget>>;
    try {
      target = await resolveSendTarget(body);
    } catch (error) {
      setNewChatError(`Could not create the worktree: ${ipcError(error)}`);
      setPreparing(false);
      return false;
    }
    if (!target || projectRef.current?.path !== project.path) {
      setPreparing(false);
      return false;
    }
    // The main process saves the message, then starts the chat's turn, or steers the one running.
    const latest = openState();
    const session = target.sessionId !== null ? latest?.sessions[target.sessionId] : undefined;
    const model = modelForChat(selectedModel, session?.provider, latest?.messages.filter((message) => message.session_id === target.sessionId) ?? [], models);
    try {
      const { sessionId } = await agentRuns.send({
        projectPath: project.path,
        sessionId: target.sessionId,
        worktreeId: target.worktreeId,
        body,
        images,
        files,
        // With the brief there is no fallback text for an empty message: the brief is the prompt.
        prompt: briefAttached && !body ? (files.length ? `Attached files:\n${files.join("\n")}` : "") : attachmentPrompt(body, files),
        provider: model.provider,
        model: model.id,
        permissionMode: mode,
        effort: effortFor(capabilityFor(model, capabilities), effort),
        ultracode: capabilityFor(model, capabilities).ultracode && ultracode,
        fastMode: supportsFastMode(model) && fastMode,
        replies: getSettings().claudeReplies,
        tldrEnabled: getSettings().tldrEnabled,
      });
      if (projectRef.current?.path === project.path) {
        setSelectedSessionId(sessionId);
        setSelectedWorktreeId(openState()?.sessions[sessionId]?.worktree_id ?? target.worktreeId);
        if (!preserveComposer) {
          setDraft("");
          imageDraft.clear();
        }
      }
      return true;
    } catch (error) {
      setNewChatError(`Could not send the message: ${ipcError(error)}`);
      return false;
    } finally {
      setPreparing(false);
    }
  }

  // Every comment that still matches the diff goes out as one message, like any send (a running turn is steered).
  async function sendDiffComments() {
    const sent = diffComments.sendable;
    if (sent.length === 0) return;
    const base = changes.list.state === "ready" && changes.list.isRepo ? changes.list.base : null;
    // Back to the chat first, so the message shows up as it lands.
    changes.closeDiff();
    if (await executeSend(formatCommentsMessage(sent, { mode: changes.mode, base }), permissionMode, [], [], true)) diffComments.removeMany(sent.map((comment) => comment.id));
  }

  async function sendMessage() {
    const body = draft.trim();
    if ((!body && !imageDraft.images.length && !imageDraft.files.length && handoverDraft === undefined) || !state || !selectedWorktree || !project || preparing || imageDraft.loading) return;
    await executeSend(body, permissionMode);
  }

  async function handover(provider: ModelProvider) {
    if (!project || selectedSessionId === null) return;
    const target = handoverModel(selectedModel, provider, openState()?.messages ?? [], models);
    if (!target) return;
    const capability = capabilityFor(target, capabilities);
    try {
      const { sessionId } = await window.milagre.handover({
        projectPath: project.path,
        sessionId: selectedSessionId,
        provider,
        model: target.id,
        permissionMode,
        effort: effortFor(capability, effort),
        ultracode: capability.ultracode && ultracode,
        fastMode: supportsFastMode(target) && fastMode,
        replies: getSettings().claudeReplies,
        tldrEnabled: getSettings().tldrEnabled,
      });
      if (projectRef.current?.path !== project.path) return;
      setSelectedSessionId(sessionId);
      setSelectedModel(target);
    } catch (error) {
      setNotice(`Could not hand over: ${ipcError(error)}`);
    }
  }

  // Keep finished message cards out of the typing render path. Recommendations still use
  // the current model and permission mode when clicked.
  const recommendationRef = useRef<(option: string) => void>(() => {});
  recommendationRef.current = (option) => { void executeSend(option, permissionMode); };
  const sendRecommendation = useCallback((option: string) => recommendationRef.current(option), []);

  // The find bar belongs to one open chat; ⌘F again while it is open refocuses and selects its text.
  const [findOpen, setFindOpen] = useState(false);
  const [findSignal, setFindSignal] = useState(0);
  const findRef = useRef({ open: false, canOpen: false });
  findRef.current = { open: findOpen, canOpen: view === "chat" && messages.length > 0 };
  function openFind() {
    if (!findRef.current.canOpen) return;
    setFindOpen(true);
    setFindSignal((current) => current + 1);
  }
  useEffect(() => setFindOpen(false), [selectedSession?.id, view]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || isModalOpen()) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.shiftKey) {
        if (event.key.toLowerCase() === "t") {
          event.preventDefault();
          toggleTheme();
        } else if (event.key.toLowerCase() === "d" && changesAvailableRef.current) {
          event.preventDefault();
          changes.toggle();
        }
        return;
      }
      if (event.key.toLowerCase() === "f") {
        if (!findRef.current.canOpen) return;
        event.preventDefault();
        openFind();
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      } else if (event.key === ",") {
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
      if (findRef.current.open) {
        event.preventDefault();
        setFindOpen(false);
        return;
      }
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

  useEffect(() => {
    function jumpToChat(event: KeyboardEvent) {
      if (view !== "chat" || event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || !/^[1-9]$/.test(event.key)) return;
      if (isModalOpen() || document.querySelector('[role="menu"], [aria-label="Chat name"]')) return;
      const chat = chats[Number(event.key) - 1];
      if (!chat) return;
      event.preventDefault();
      openChat(Number(chat.id));
    }
    window.addEventListener("keydown", jumpToChat);
    return () => window.removeEventListener("keydown", jumpToChat);
  }, [chats, view]);

  // Fast loads would cut the startup animation off at the bare legs, so the splash stays until the logo is whole,
  // then fades out over the app while the panes slide in. Same key in both trees keeps the logo from restarting.
  const [splash, setSplash] = useState<"intro" | "done" | "gone">("intro");
  const [appEntered, setAppEntered] = useState(false);
  const splashOverlay = (leaving: boolean) => splash === "gone" ? null : (
    <StartupSplash key="startup-splash" leaving={leaving} onIntroEnd={() => setSplash((current) => (current === "intro" ? "done" : current))} onLeft={() => setSplash("gone")} />
  );

  if (loading || !project || !state || splash === "intro") {
    return <>{splashOverlay(false)}</>;
  }

  const modifier = /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
  const commands: Command[] = [
    { id: "new-chat", label: "New chat", group: "Actions", icon: "add", shortcut: `${modifier}N`, keywords: "create agent session", run: startNewChat },
    { id: "open-project", label: "Open project…", group: "Actions", icon: "folder", shortcut: `${modifier}O`, keywords: "add repository workspace folder", run: () => openProject() },
    { id: "settings", label: "Settings", group: "Actions", icon: "settings", shortcut: `${modifier},`, keywords: "preferences model permissions", run: () => { setSettingsSection("general"); setView("settings"); } },
    { id: "appearance", label: "Appearance settings", group: "Actions", icon: "settings", keywords: "theme preferences", run: () => { setSettingsSection("appearance"); setView("settings"); } },
    { id: "toggle-theme", label: "Toggle theme", group: "Actions", icon: "settings", shortcut: modifier === "⌘" ? "⌘⇧T" : "Ctrl+Shift+T", keywords: "appearance switch color mode", run: toggleTheme },
    { id: "project-settings", label: "Project settings", group: "Actions", icon: "settings", detail: project.name, keywords: "worktree setup files", run: () => { setSettingsSection("project"); setView("settings"); } },
  ];
  if (view === "settings") commands.push({ id: "back-to-chat", label: "Back to chat", group: "Actions", icon: "chat", run: () => setView("chat") });
  commands.push(...settingsCommands(getSettings(), updateSettings));
  if (selectedSession && view === "chat") {
    const sessionId = selectedSession.id;
    commands.unshift(
      { id: "git", label: "Commit and open PR…", group: "Current chat", icon: "git", keywords: "git changes pull request push", run: () => openGitDialog(sessionId) },
      { id: "editor", label: "Open in editor", group: "Current chat", icon: "editor", keywords: "code vscode cursor", run: () => openChatInEditor(sessionId) },
      { id: "reveal", label: "Reveal folder", group: "Current chat", icon: "folder", keywords: "finder explorer worktree", run: () => revealChat(sessionId) },
      ...(messages.length ? [{ id: "find", label: "Find in chat", group: "Current chat", icon: "search" as const, shortcut: `${modifier}F`, keywords: "search text messages", run: openFind }] : []),
      { id: "unread", label: selectedSession.unread ? "Mark as read" : "Mark as unread", group: "Current chat", icon: "unread", run: () => patchChat(sessionId, { unread: !selectedSession.unread }) },
    );
    if (selectedWorktree) commands.splice(3, 0, { id: "copy-path", label: "Copy worktree path", group: "Current chat", icon: "copy", run: () => navigator.clipboard.writeText(selectedWorktree.path) });
  }
  commands.push(...chats.map((chat): Command => ({
    id: `chat:${chat.id}`, label: chat.label, group: "Chats", icon: "chat",
    detail: [chat.mark === "waiting" || chat.mark === "question" ? "Needs you" : chat.mark === "running" ? "Working" : chat.unread ? "Unread" : "", chat.details.branch].filter(Boolean).join(" · "),
    keywords: [chat.details.path, ...chat.details.pullRequests.flatMap((pr) => [pr.title, `#${pr.number}`])].filter(Boolean).join(" "),
    run: () => openChat(Number(chat.id)),
  })));
  commands.push(...recentProjects.filter((recent) => recent.path !== project.path).map((recent): Command => ({
    id: `project:${recent.path}`, label: recent.name, group: "Projects", icon: "folder", detail: recent.path,
    run: () => switchProject(recent.path),
  })));

  return (
    <>
    <DotBackground key="app">
      <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-10 [-webkit-app-region:drag]" />
      {changesAvailable && <ChangesToggle open={changes.open} onToggle={changes.toggle} />}
      {update?.status === "downloaded" && (
        <div className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm text-ink shadow-lg [-webkit-app-region:no-drag]">
          <span>Milagre {update.version} is ready to update.</span>
          <button className="rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700" onClick={() => void window.milagre.installUpdate()}>
            Update and restart
          </button>
        </div>
      )}
      <div
        className={`flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden text-ink ${appEntered ? "" : "app-enter"}`}
        onAnimationEnd={(event) => { if (event.animationName === "app-enter-main") setAppEntered(true); }}
      >
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
          onOpenInEditor: (id) => openChatInEditor(Number(id)),
          onCommit: (id) => openGitDialog(Number(id)),
          onArchiveCheck: (id) => checkArchive(Number(id)),
          onArchive: (id, mode, plan) => void archiveChat(Number(id), mode, plan),
        }}
        onNewChat={startNewChat}
        onOpenSettings={() => setView("settings")}
        onOpenCommands={() => setCommandPaletteOpen(true)}
        hintsEnabled={view === "chat" && !commandPaletteOpen && !gitDialog}
        projectPath={project.path}
        onSwitchProject={(path) => void switchProject(path)}
        onOpenProjectSettings={() => { setSettingsSection("project"); setView("settings"); }}
        usage={showUsageInSidebar && usage.snapshot && visibleProviders(usage.snapshot).length > 0 ? <SidebarUsage usage={usage} /> : undefined}
      />
      </div>
      {view === "settings" && (
        <div className="flex shrink-0 py-3 pl-3">
          <SettingsNav section={settingsSection} projectName={project.name} onSelect={setSettingsSection} onBack={() => setView("chat")} />
        </div>
      )}

      <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent pr-3 pb-3">
        <DiffBar open={diffShowing} onBack={changes.closeDiff} send={{ count: diffComments.sendable.length, onSend: () => void sendDiffComments() }} trailing={<DiffToolbar changes={changes} prefs={diffPrefs} />} />
        <AnimatePresence initial={false} onExitComplete={diffPresence.onExitComplete}>
          {diffShowing && <DiffView key="diff" changes={changes} prefs={diffPrefs} comments={diffComments} />}
        </AnimatePresence>
        {view === "settings" && (
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            {notice && <NoticeCard className="mx-auto mt-2 mb-1 max-w-2xl" onDismiss={() => setNotice(null)}>{notice}</NoticeCard>}
            <SettingsPanel section={settingsSection} projectPath={project.path} models={models} update={update} />
          </div>
        )}
        {/* Fades back in when the diff has gone: a display:none element restarts its animation when shown. */}
        <div className={`min-h-0 flex-1 overflow-hidden ${view === "chat" && !diffPresence.occupied ? "" : "hidden"}`} style={{ animation: "fade-in 160ms ease-out both" }}>
          <EditorLinks root={selectedWorktree?.path ?? project.path}>
          <ChatComposer
            key={project.path}
            messages={messages}
            imageDraft={imageDraft}
            projectPath={selectedWorktree?.path ?? project.path}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void sendMessage()}
            pullRequestAction={selectedSession && selectedPullRequest && pullRequestBlocker
              ? {
                label: BLOCKERS[pullRequestBlocker].action,
                tone: BLOCKERS[pullRequestBlocker].tone,
                onRun: () => {
                  dismissBlockerAction(selectedPullRequest, pullRequestBlocker);
                  void executeSend(blockerPrompt(pullRequestBlocker, selectedPullRequest), permissionMode, [], [], true);
                },
              }
              : undefined}
            isSending={isSending}
            sendBlocked={preparing || Boolean(selectedSession?.handoverPending)}
            streamingText={run?.text}
            streamingSteps={run?.steps}
            subagents={selectedSession?.subagents}
            onArchiveFinishedSubagents={archiveFinishedChildren}
            onArchiveSubagent={archiveChild}
            waitingForSubagents={run?.waitingForSubagents}
            tasks={run?.tasks}
            ports={project && selectedSession ? agentPorts[chatKey(project.path, selectedSession.id)] : undefined}
            onStopPort={project && selectedSession ? (pid) => window.milagre.stopAgentPort(chatKey(project.path, selectedSession.id), pid) : undefined}
            waitingStepIds={run?.approvals.flatMap((request) => (request.stepId ? [request.stepId] : []))}
            asking={Boolean(run?.questions.length)}
            runModelName={run ? models.find((model) => model.id === run.model)?.name ?? run.model : undefined}
            lockedProvider={messages.length > 0 || isHandoverChat(selectedSession) ? selectedSession?.provider : undefined}
            onHandover={(provider) => void handover(provider)}
            canHandover={messages.length > 0}
            handoverBrief={project && selectedSession && handoverDraft !== undefined ? {
              chatId: chatKey(project.path, selectedSession.id),
              brief: handoverDraft,
              onSave: (text) => window.milagre.setHandoverDraft(project.path, selectedSession.id, text),
            } : undefined}
            resume={project && selectedSession?.resumeTurn ? { onContinue: () => void window.milagre.resumeChat(project.path, selectedSession.id).catch((error) => setNotice(`Couldn't continue the chat: ${error instanceof Error ? error.message : String(error)}`)) } : undefined}
            handover={state ? { ...handoverLinks(selectedSession, state), onOpen: (id) => { setSelectedSessionId(id); setSelectedWorktreeId(state.sessions[id]?.worktree_id ?? null); } } : undefined}
            models={models}
            cliStatus={cliStatus}
            onModelPickerOpen={refreshCliStatus}
            onUpdateCli={handleUpdateCli}
            updatingCli={updatingCli}
            selectedModel={selectedModel}
            onModelChange={chooseModel}
            capability={selectedCapability}
            effort={effortFor(selectedCapability, effort)}
            onEffortChange={setEffort}
            ultracode={selectedCapability.ultracode && ultracode}
            onUltracodeChange={setUltracode}
            fastMode={fastMode}
            onFastModeChange={setFastMode}
            permissionMode={permissionMode}
            onPermissionModeChange={changePermissionMode}
            onRecommendationSelect={sendRecommendation}
            worktrees={worktrees.map((worktree) => ({ id: worktree.id, name: worktree.name, path: worktree.path }))}
            selectedWorktreeId={selectedWorktree?.id}
            onWorktreeChange={(id) => {
              setSelectedWorktreeId(id);
              saveChatPreferences(localStorage, project.path, { worktreePath: state.worktrees[id]?.path });
            }}
            isolation={isolation}
            onIsolationChange={(next) => { setIsolation(next); saveChatPreferences(localStorage, project.path, { isolation: next }); setNewChatError(null); }}
            branches={branches}
            baseBranch={effectiveBaseBranch}
            onBaseBranchChange={(branch) => { setBaseBranch(branch); saveChatPreferences(localStorage, project.path, { baseBranch: branch }); }}
            newChatError={newChatError}
            findOpen={findOpen}
            findSignal={findSignal}
            onFindClose={() => setFindOpen(false)}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
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
          </EditorLinks>
        </div>
      </main>
      <ChangesPanelSlot open={changes.open}>
        <ChangesPanel list={changes.list} mode={changes.mode} onModeChange={changes.setMode} onRefresh={() => void changes.refresh()} onSelectFile={changes.selectFile} activePath={changes.activePath} commentCounts={diffComments.counts} />
      </ChangesPanelSlot>
      </div>
      {commandPaletteOpen && <CommandPalette commands={commands} onClose={() => setCommandPaletteOpen(false)} onError={setNotice} />}
      {gitDialog && (
        <GitActionsDialog
          key={gitDialog.sessionId}
          cwd={gitDialog.cwd}
          base={gitDialog.base}
          provider={gitDialog.provider}
          chat={gitDialog.chat}
          turnRunning={Boolean(agentRuns.runs[chatKey(project.path, gitDialog.sessionId)])}
          onClose={() => setGitDialog(null)}
          // The dialog's chat is the open one; a message sent while its turn runs steers it.
          onSendToAgent={(text) => {
            if (selectedSession?.id === gitDialog.sessionId) void executeSend(text, permissionMode, []);
            else {
              openChat(gitDialog.sessionId);
              setDraft(text);
            }
          }}
          onRan={(note) => {
            recordGitNote(gitDialog.sessionId, note);
            void window.milagre.refreshDiffs(project.path, [gitDialog.worktreeId]).catch(() => {});
          }}
        />
      )}
      <Notice />
    </DotBackground>
    {splashOverlay(true)}
    </>
  );
}

export default App;
