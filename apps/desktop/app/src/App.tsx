import { UpdateShell, useAppUpdates } from "./components/UpdateNotice";
import { LinkWorkspace } from "./components/LinkWorkspace";
import { LinkProjectDialog } from "./components/LinkProjectDialog";
import { createScopeDrafts } from "./lib/link-scope";
import type { LinkState, NamedProjectLink, OpenLink } from "@milagre/shared/model";
import { scopeKey, isLinkScopeKey, scopeFromKey } from "@milagre/shared/chat-scopes";
import { reconcileState } from "@milagre/shared/reconcile";
import { applyAgentEvent } from "@milagre/shared/agent-runs";
import { attentionLabel, chatsNeedingAttention, waitingFor } from "@milagre/shared/attention";
import { reportChatAction } from "./lib/chat-action";
import { stateEvents } from "./lib/state-events";
import { chatSummary } from "@milagre/shared/chat-summary";
import { ipcErrorMessage } from "@milagre/shared/result";
import { cliName } from "@milagre/shared/providers";
import { useCallback, useEffect, useMemo, useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import {
  ChatMessage,
  ImageAttachment,
  AgentSession,
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
  sessionForWorktree,
  sortedWorktrees,
} from "./model";
import { useAgentRuns } from "./components/useAgentRuns";
import { useAgentPorts } from "./lib/ports";
import {
  chatInProject,
  chatKey,
  chatsAskingUser,
  chatsRunning,
  chatsWaitingForUser,
  lastUserModel,
  modelForChat,
  projectOfKey,
  sentDecision,
  sentReply,
  sessionIdFromKey,
} from "./lib/agent-runs";
import { attachmentPrompt } from "./lib/media";
import { BLOCKERS, blockerPrompt, isBlockerDismissed, pullRequestBlockers } from "./lib/pr-blockers";
import { capabilitiesFrom, keepIfSame, mergeModels, nextSelection, providerForId, resolveModel } from "./lib/models";
import { chatMark, chatTitle, orderChats } from "./lib/chat-list";
import type { SessionPatch } from "@milagre/shared/project-edits";
import { isMilagreWorktree, worktreeShared } from "./lib/archive";
import { archiveChat as runArchive } from "./lib/archive-flow";
import type { ArchiveMode, ArchivePlan } from "./lib/archive";
import { ChangesPanel } from "./components/changes/ChangesPanel";
import { isMac } from "./lib/shortcut-hints";
import { CORNER_PITCH, PanelToggles, sidePanelCount, useSidePanels } from "./components/agents/PanelToggles";
import { ChangesPanelSlot } from "./components/changes/ChangesPanelSlot";
import { AttentionButton, ChangesToggle, DiffBar } from "./components/changes/ChangesChrome";
import { AnimatePresence } from "motion/react";
import { useDiffComments } from "./components/changes/useDiffComments";
import { formatCommentsMessage } from "./lib/diff-comments";
import { DiffToolbar, useDiffPreferences, useDiffPresence } from "./components/changes/DiffPrefs";
import { useChanges } from "./components/changes/useChanges";
import { gitChatContext, type GitChatContext } from "./lib/git-dialog";
import { useWorktreePullRequests } from "./components/useWorktreePullRequests";
import { chatPullRequests, pullRequestRefsCache } from "./lib/chat-pull-requests";
import { usePastedImages } from "./components/usePastedImages";
import { DotBackground } from "./components/DotBackground";
import { StartupSplash } from "./components/StartupSplash";
import SidebarNav from "./components/SidebarNav";
import { cachedProjectCopy, rememberProjectCopy, runKeys } from "./lib/sidebar-scopes";
import { chatRevealPath } from "./lib/reveal";
import type { SettingsSection } from "./components/Settings";
import { createPendingChat, isListedChat, pendingChatSessionId, withPendingChat, type PendingChat } from "@milagre/shared/chats";
import { getSettings, toggleTheme, updateSettings, useApplyTheme, useSettings } from "./lib/settings";
import { EditorLinks, Notice } from "./components/editor-links";
// Notice above is editor-links' toast; this is the dismissable notice card.
import { Notice as NoticeCard } from "./components/Notice";
import { openInEditor } from "./lib/editors";
import type { RuntimeConnection } from "./electron";
import { SidebarUsage } from "./components/usage/SidebarUsage";
import { visibleProviders } from "./components/usage/format";
import { useUsage } from "./components/usage/useUsage";
import { loadChatPreferences, saveChatPreferences } from "./lib/chat-preferences";
import { settingsCommands } from "./lib/settings-commands";
import type { Command } from "./lib/commands";
import { messageCommands } from "./lib/message-commands";
import { RECENT_PROJECTS_CHANGED, type RecentProject } from "./lib/project-list";
import { useProjectImages } from "./lib/project-images";
import { isModalOpen } from "./lib/modal";
import { createDraftStore, draftKey } from "./lib/draft-store";
import { restoredChatsNotice } from "./lib/restored-chats";
import { lazyView } from "./lib/lazy-view";
import { MediaLightbox } from "./components/motion/LazyMediaLightbox";
import { reuseRows, useEvent, useStableSet } from "./lib/stable";
import { delegatedChats, useLinkedWork } from "./lib/linked-work";
import { DraftChatComposer } from "./components/DraftChatComposer";
import type { ChatRowActions, SidebarRecent } from "./components/sidebar/ChatRow";

// Not on screen at first paint, so each loads as its own chunk; the effect in App fetches them once the window is idle.
const DiffView = lazyView(() => import("./components/changes/DiffView").then((module) => module.DiffView));
const GitActionsDialog = lazyView(() => import("./components/GitActionsDialog").then((module) => module.GitActionsDialog));
const SettingsNav = lazyView(() => import("./components/Settings").then((module) => module.SettingsNav));
const SettingsPanel = lazyView(() => import("./components/Settings").then((module) => module.SettingsPanel));
const CommandPalette = lazyView(() => import("./components/CommandPalette").then((module) => module.CommandPalette));
const PermissionCard = lazyView(() => import("./components/agents/PermissionCard").then((module) => module.PermissionCard));
const QuestionCard = lazyView(() => import("./components/agents/QuestionCard").then((module) => module.QuestionCard));
const CanvasView = lazyView(() => import("./components/CanvasView").then((module) => module.CanvasView));
const LAZY_VIEWS = [DiffView, GitActionsDialog, SettingsNav, CommandPalette, MediaLightbox, PermissionCard, QuestionCard];

// The chat with the most recent message, or none so the app opens on a new chat. Archived chats don't count.
function latestSessionId(state: CoordinatorState) {
  const sessions = Object.values(state.sessions).filter((session) => !session.archived);
  if (sessions.every((session) => session.summary)) {
    const latest = sessions.reduce<AgentSession | null>(
      (best, session) => ((session.summary!.lastId ?? -1) > (best?.summary!.lastId ?? -1) ? session : best),
      null,
    );
    return latest?.summary!.lastId === undefined ? null : latest.id;
  }
  return (
    state.messages
      .filter((message) => !state.sessions[message.session_id]?.archived)
      .reduce<ChatMessage | null>((latest, message) => (!latest || message.id > latest.id ? message : latest), null)?.session_id ?? null
  );
}

const NO_MESSAGES: ChatMessage[] = [];
const NO_REFS: string[] = [];
// `sent`: the main process saved the message; the preview stays until the saved message reaches the window's state.
type PendingSend = PendingChat & { view: number; projectPath: string; originSessionId: number | null; originWorktreeId: number; sent?: boolean };
const NO_WORKTREE = -1;
type PreparedSendTarget = { view: number; projectPath: string; sessionId: number | null; worktreeId: number };
type FailedSend = PendingSend & { draft: string; error: string; target: PreparedSendTarget | null };

function App() {
  const [project, setProject] = useState<OpenProject | null>(null);
  const projectRef = useRef<OpenProject | null>(null);
  const projectsSeen = useRef(new Map<string, Pick<OpenProject, "path" | "name">>());
  const projectNavigation = useRef(0);
  projectRef.current = project;
  // The latest state of every project the main process has sent this window; it's their only writer
  // (see ADR-0001). The ref leads, so callbacks read a state that arrived since the last render.
  const [selectedLink, setSelectedLink] = useState<OpenLink | null>(null);
  const selectedLinkRef = useRef(selectedLink);
  selectedLinkRef.current = selectedLink;
  const [linkInitialSession, setLinkInitialSession] = useState<number | undefined>();
  // `true` creates a Link; a Link edits that one.
  const [linkDialogOpen, setLinkDialogOpen] = useState<boolean | NamedProjectLink>(false);
  // oxlint-disable-next-line react/use-memo -- useMemo is given a factory function reference so the instance is created once
  const scopeDrafts = useMemo(createScopeDrafts, []);
  const [linkStates, setLinkStates] = useState<Record<string, LinkState>>({});
  const linkStatesRef = useRef(linkStates);
  linkStatesRef.current = linkStates;
  const [states, setStates] = useState<Record<string, CoordinatorState>>({});
  const statesRef = useRef(states);
  const state = project ? (states[project.path] ?? null) : null;
  /** The open project's latest state. */
  const openState = () => (projectRef.current ? statesRef.current[projectRef.current.path] : undefined);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionState] = useState<number | null>(null);
  const selectedSessionRef = useRef<number | null>(null);
  selectedSessionRef.current = selectedSessionId;
  // The draft lives outside React state: a keystroke re-renders the composer (DraftChatComposer), not the whole app.
  // oxlint-disable-next-line react/use-memo -- useMemo is given a factory function reference so the instance is created once
  const draftStore = useMemo(createDraftStore, []);
  const setDraft = draftStore.set;
  // Each Chat, and each project's new-chat screen, keeps its own draft. The store switches with the selection, before
  // the render, so a draft written right after picking a Chat lands in that Chat.
  function setSelectedSessionId(next: SetStateAction<number | null>) {
    const value = typeof next === "function" ? next(selectedSessionRef.current) : next;
    selectedSessionRef.current = value;
    draftStore.select(draftKey(projectRef.current?.path ?? "", value));
    setSelectedSessionState(value);
  }
  // Catches a project change that did not go through the setter above.
  useLayoutEffect(() => draftStore.select(draftKey(project?.path ?? "", selectedSessionId)), [project?.path, selectedSessionId]);
  const [selectedModel, setSelectedModel] = useState<ModelOption>(() =>
    resolveModel(MODEL_CATALOG, getSettings().defaultModelId, providerForId(getSettings().defaultModelId)),
  );
  const [effort, setEffortState] = useState<EffortLevel>(() => (localStorage.getItem("milagre.effort") as EffortLevel | null) ?? "high");
  const setEffort = (level: EffortLevel) => {
    setEffortState(level);
    localStorage.setItem("milagre.effort", level);
  };
  const [ultracode, setUltracodeState] = useState(() => localStorage.getItem("milagre.ultracode") === "on");
  const setUltracode = (on: boolean) => {
    setUltracodeState(on);
    localStorage.setItem("milagre.ultracode", on ? "on" : "off");
  };
  const [fastMode, setFastModeState] = useState(() => localStorage.getItem("milagre.fastMode") === "on");
  const setFastMode = (on: boolean) => {
    setFastModeState(on);
    localStorage.setItem("milagre.fastMode", on ? "on" : "off");
  };
  // The agents' own model lists; the maintained list stands in until they arrive, and for a missing CLI.
  const accountScope = selectedLink ? `milagre-link:${selectedLink.link.id}` : project?.path;
  const accountScopeRef = useRef(accountScope);
  accountScopeRef.current = accountScope;
  const accountGeneration = useRef(0);
  const [loadedAccountScope, setLoadedAccountScope] = useState<string | undefined>(undefined);
  const [rawReported, setReported] = useState<AgentModels | null>(null);
  const reported = loadedAccountScope === accountScope ? rawReported : null;
  const models = useMemo(() => mergeModels(reported, MODEL_CATALOG), [reported]);
  // Whether each agent's CLI is missing, outdated, broken or logged out, for the model picker. Loaded at
  // startup and again each time the picker opens, so a fix shows without a restart.
  const [rawCliStatus, setCliStatus] = useState<AgentCliStatus | null>(null);
  // The model lists come along: the main process keeps a good list for the run but asks again for an agent
  // that had none (a CLI that was missing, or Claude Code before it was logged in).
  const cliStatus = loadedAccountScope === accountScope ? rawCliStatus : null;
  const refreshCliStatus = () => {
    const generation = ++accountGeneration.current;
    const live = () => generation === accountGeneration.current && accountScopeRef.current === accountScope;
    // A refetch that changed nothing keeps the old objects, so opening the picker doesn't re-render the app or
    // re-apply anything that depends on the lists.
    void window.milagre
      .getCliStatus(accountScope)
      .then((next) => {
        if (live()) {
          setLoadedAccountScope(accountScope);
          setCliStatus((previous) => keepIfSame(previous, next));
          if (accountScope) providerCache.current.set(accountScope, { reported: providerCache.current.get(accountScope)?.reported ?? null, cliStatus: next });
        }
      })
      .catch(() => undefined);
    void window.milagre
      .getModels(accountScope)
      .then((next) => {
        if (live()) {
          setLoadedAccountScope(accountScope);
          setReported((previous) => keepIfSame(previous, next));
          if (accountScope) providerCache.current.set(accountScope, { reported: next, cliStatus: providerCache.current.get(accountScope)?.cliStatus ?? null });
        }
      })
      .catch(() => undefined);
  };
  // Each Project's or Link's last model lists and CLI status, shown at once when switching back while they reload.
  const providerCache = useRef(new Map<string, { reported: AgentModels | null; cliStatus: AgentCliStatus | null }>());
  useEffect(() => {
    const reset = (dropCache: boolean) => {
      if (dropCache) providerCache.current.clear();
      const hit = accountScope ? providerCache.current.get(accountScope) : undefined;
      setReported(hit?.reported ?? null);
      setCliStatus(hit?.cliStatus ?? null);
      if (hit) setLoadedAccountScope(accountScope);
      refreshCliStatus();
    };
    reset(false);
    const off = window.milagre.onAccountsChanged?.(() => reset(true));
    return () => {
      accountGeneration.current++;
      off?.();
    };
  }, [accountScope]);
  const capabilities = useMemo(() => capabilitiesFrom(reported), [reported]);
  // The Settings default applies once, when the agents' lists first arrive, if the user hasn't picked a model
  // and the open chat isn't on the other agent. After that a model the agents don't offer only gives way to
  // its provider's recommended model (see nextSelection).
  const pickedModel = useRef(false);
  const appliedDefault = useRef(false);
  const preferredProviderRef = useRef<ModelProvider | undefined>(undefined);
  useEffect(() => {
    const applyDefault = reported !== null && !appliedDefault.current && !pickedModel.current;
    if (reported !== null) appliedDefault.current = true;
    setSelectedModel((current) =>
      nextSelection(models, current, { defaultId: getSettings().defaultModelId, applyDefault, preferredProvider: preferredProviderRef.current }),
    );
  }, [models]);
  const chooseModel = (model: ModelOption) => {
    pickedModel.current = true;
    setSelectedModel(model);
    updateSettings({ defaultModelId: model.id });
  };
  const selectedCapability = capabilityFor(selectedModel, capabilities);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => getSettings().defaultPermissionMode);
  const [view, setView] = useState<"chat" | "canvas" | "settings">("chat");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  useEffect(() => {
    if (!commandPaletteOpen) return;
    let cancelled = false;
    window.milagre
      .listRecentProjects()
      .then((projects) => {
        if (!cancelled) setRecentProjects(projects);
      })
      .catch(() => {
        if (!cancelled) setRecentProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [commandPaletteOpen]);
  const [isolation, setIsolation] = useState<Isolation>(() => loadChatPreferences(localStorage, "").isolation);
  const [branches, setBranches] = useState<string[]>([]);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [newChatError, setNewChatError] = useState<string | null>(null);
  // A short message about something that happened off to the side (a worktree that wouldn't go).
  const [quitError, setQuitError] = useState<string | null>(null);
  useEffect(() => window.milagre.onQuitFailed?.(setQuitError), []);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatingCli, setUpdatingCli] = useState<ModelProvider | null>(null);

  const refreshCliStatusRef = useRef(refreshCliStatus);
  refreshCliStatusRef.current = refreshCliStatus;
  const updateCli = async (provider: ModelProvider) => {
    setUpdatingCli(provider);
    try {
      const result = await window.milagre.updateCli(provider);
      // Updating the CLI is global; read authentication and models for the scope open now.
      refreshCliStatusRef.current();
      if (result.ok) {
        setNotice(`${cliName(provider)} updated to version ${result.version ?? "latest"} successfully!`);
      } else {
        setNotice(result.error ?? `Failed to update ${cliName(provider)}.`);
      }
    } catch (error) {
      setNotice(`Error updating ${cliName(provider)}: ${error instanceof Error ? error.message : String(error)}`);
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
  // Which Project the Settings page shows; any recent Project can be picked there, the open one by default.
  const [settingsProject, setSettingsProject] = useState<{ path: string; name: string } | null>(null);
  // A send may finish after the user opens another Chat. Its feedback and completion belong to the view that sent it.
  const chatView = useRef(0);
  const nextChatView = useRef(0);
  const [, setChatView] = useState(0);
  function advanceChatView() {
    chatView.current = ++nextChatView.current;
    setChatView(chatView.current);
  }
  const sendInFlight = useRef(false);
  const [preparingView, setPreparingView] = useState<number | null>(null);
  const preparing = preparingView !== null;
  const preparingHere = preparingView === chatView.current;
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  // If persistence fails after setup, retry in the Worktree already prepared for this Chat.
  const preparedTarget = useRef<PreparedSendTarget | null>(null);
  const [failedSends, setFailedSends] = useState<FailedSend[]>([]);
  const [restoringSend, setRestoringSend] = useState<FailedSend | null>(null);
  const [loading, setLoading] = useState(true);
  const [hostConnection, setHostConnection] = useState<RuntimeConnection>({ connected: true });
  const [restartingHost, setRestartingHost] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const update = useAppUpdates();
  const [gitDialog, setGitDialog] = useState<{
    sessionId: number;
    worktreeId: number;
    cwd: string;
    base?: string;
    provider?: ModelProvider;
    chat: GitChatContext;
  } | null>(null);
  useApplyTheme();
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1000));
    idle(() => {
      for (const view of LAZY_VIEWS) view.preload();
    });
  }, []);

  const projectImage = useProjectImages([project?.path ?? ""]);

  async function loadInitialProject() {
    setLoading(true);
    setStartupError(null);
    try {
      // oxlint-disable-next-line react/immutability -- React Compiler heuristic: the ref or handler is assigned or called after render, not during it
      adoptProject(await window.milagre.getCurrentProject());
    } catch (error) {
      setStartupError(ipcErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInitialProject();
  }, []);
  useEffect(() => stateEvents.onLinkState((update) => setLinkStates((previous) => ({ ...previous, [update.linkId]: update.state }))), []);

  useEffect(() => {
    let updated = false;
    const off = window.milagre.onRuntimeConnection?.((state) => {
      updated = true;
      setHostConnection(state);
      if (state.notice) setNotice(state.notice);
    });
    void window.milagre
      .getRuntimeConnection?.()
      .then((state) => {
        if (!updated) setHostConnection(state);
      })
      .catch(() => {});
    const snapshotOff = window.milagre.onRuntimeSnapshot?.((snapshot) => {
      // oxlint-disable-next-line react/immutability -- React Compiler heuristic: the ref or handler is assigned or called after render, not during it
      for (const next of snapshot.projects) receiveState(next.path, next.state);
      for (const next of snapshot.links ?? []) setLinkStates((previous) => ({ ...previous, [next.linkId]: next.state }));
    });
    return () => {
      updated = true;
      off?.();
      snapshotOff?.();
    };
  }, []);

  useEffect(() => {
    if (project) void window.milagre.listBranches(project.path).then(setBranches);
  }, [project?.path]);

  const worktrees = useMemo(() => (state ? sortedWorktrees(state) : []), [state]);
  const firstWorktree = worktrees[0];
  const selectedSession = state && selectedSessionId !== null ? state.sessions[selectedSessionId] : undefined;
  const subagents = useMemo(
    () => selectedSession?.subagents?.filter((agent) => agent.id !== selectedSession.native_session_id),
    // oxlint-disable-next-line react/preserve-manual-memoization -- the callback reads selectedSession.subagents and selectedSession.native_session_id, both listed; the compiler infers the whole selectedSession object from the property access
    [selectedSession?.subagents, selectedSession?.native_session_id],
  );
  const selectedWorktree = worktrees.find((worktree) => worktree.id === (selectedSession?.worktree_id ?? selectedWorktreeId)) ?? firstWorktree;
  // Assigning a new Chat its persisted id keeps attachments for the next message; navigating away clears them.
  const imageDraft = usePastedImages(`${project?.path ?? ""}:${chatView.current}`);
  useEffect(() => {
    if (!restoringSend) return;
    imageDraft.restore(restoringSend.message.images ?? [], restoringSend.message.files ?? []);
    setRestoringSend(null);
  }, [restoringSend]);
  const messages = useMemo(
    () => (state && selectedSession ? state.messages.filter((message) => message.session_id === selectedSession.id) : NO_MESSAGES),
    [state?.messages, selectedSession?.id],
  );
  const pendingHere = pendingSend?.view === chatView.current && pendingSend.projectPath === project?.path;
  const pendingCanonicalId = state && pendingSend?.projectPath === project?.path ? pendingChatSessionId(state, pendingSend) : null;
  // A large Project's state can reach the window after the send's reply; dropping the preview then would hide the new chat until it does.
  useEffect(() => {
    if (!pendingSend?.sent) return;
    const latest = states[pendingSend.projectPath];
    if (!latest || pendingChatSessionId(latest, pendingSend) !== null) setPendingSend(null);
  }, [pendingSend, states]);
  const sidebarState = useMemo(() => {
    if (!state) return state;
    const recovered = failedSends.filter((send) => send.projectPath === project?.path).reduce((current, send) => withPendingChat(current, send), state);
    return pendingSend?.projectPath === project?.path ? withPendingChat(recovered, pendingSend) : recovered;
  }, [state, pendingSend, failedSends, project?.path]);
  // The renderer's preview never enters project state. The main process still owns the persisted transcript.
  const displayedMessages = useMemo(
    () =>
      pendingHere && pendingSend
        ? pendingCanonicalId !== null
          ? state!.messages.filter((message) => message.session_id === pendingCanonicalId)
          : [...messages, pendingSend.message]
        : messages,
    // oxlint-disable-next-line react/preserve-manual-memoization -- the callback reads state!.messages (non-null assertion) and the list names state?.messages, the same value; the compiler infers state itself from the assertion
    [pendingHere, pendingSend, pendingCanonicalId, state?.messages, messages],
  );
  preferredProviderRef.current = messages.length > 0 ? selectedSession?.provider : undefined;

  const agentRuns = useAgentRuns(receiveState, (chatId) => {
    const owner = projectOfKey(chatId);
    const latest = isLinkScopeKey(owner) ? linkStatesRef.current[owner.slice("milagre-link:".length)] : statesRef.current[owner];
    return latest ? lastUserModel(latest, sessionIdFromKey(chatId)) : "";
  });
  const { pullRequests, chatPullRequests: chatPrs, dismissedBlockers, dismissBlockerAction } = useWorktreePullRequests(project?.path ?? "", state);
  const sidePanels = useSidePanels();
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
  const waitingStepIds = useMemo(() => run?.approvals.flatMap((request) => (request.stepId ? [request.stepId] : [])), [run?.approvals]);
  const agentPorts = useAgentPorts();
  const isSending = preparingHere || Boolean(run);
  const usage = useUsage(accountScope);
  const {
    chatOrder,
    showUsageInSidebar,
    keepAwake,
    defaultModelId,
    defaultPermissionMode,
    notifyOnCompletion,
    showDockBadge,
    notifyWhenWaiting,
    showAttentionButton,
  } = useSettings();

  // Visiting an old chat can change its displayed model, but never the preference for new chats.
  useEffect(() => {
    if (selectedSessionId !== null) return;
    setSelectedModel(resolveModel(models, defaultModelId, providerForId(defaultModelId)));
    setPermissionMode(defaultPermissionMode);
  }, [selectedSessionId, defaultModelId, defaultPermissionMode, models]);

  const effectiveBaseBranch = baseBranch && branches.includes(baseBranch) ? baseBranch : (selectedWorktree?.name ?? branches[0] ?? "");

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

  function receiveState(projectPath: string, next: CoordinatorState | LinkState) {
    if (isLinkScopeKey(projectPath)) {
      setLinkStates((previous) => ({
        ...previous,
        [scopeFromKey(projectPath).kind === "link" ? projectPath.slice("milagre-link:".length) : projectPath]: next as LinkState,
      }));
      return;
    }
    if (!("worktrees" in next)) return;
    statesRef.current = { ...statesRef.current, [projectPath]: reconcileState(statesRef.current[projectPath], next) };
    setStates(statesRef.current);
    const seen = projectsSeen.current.get(projectPath);
    if (seen) rememberProjectCopy({ ...seen, state: statesRef.current[projectPath] });
  }

  useEffect(() => stateEvents.onProjectState(({ path, state: next }) => receiveState(path, next)), []);

  // Approvals never time out, so mark chats that wait on one (the open chat too: its card may be scrolled away).
  // The sets are rebuilt on every streamed batch; keeping the old one while its members hold keeps the sidebar rows still.
  const waiting = useStableSet(useMemo(() => chatsWaitingForUser(agentRuns.runs, project?.path ?? ""), [agentRuns.runs, project?.path]));
  const asking = useStableSet(useMemo(() => chatsAskingUser(agentRuns.runs, project?.path ?? ""), [agentRuns.runs, project?.path]));
  const running = useStableSet(
    useMemo(() => chatsRunning(agentRuns.runs, project?.path ?? "", state?.sessions), [agentRuns.runs, project?.path, state?.sessions]),
  );
  const linkedWork = useLinkedWork();
  // Chats in other projects that wait on an approval or question. Joined, so a streamed batch that changes nothing keeps the arrays.
  const attentionKey = chatsNeedingAttention(agentRuns.runs, project?.path ?? "").join("\n");
  const attentionChats = useMemo(() => (attentionKey ? attentionKey.split("\n") : []), [attentionKey]);
  const attentionPaths = useMemo(() => [...new Set(attentionChats.map(projectOfKey))], [attentionChats]);
  const projectName = useCallback(
    (path: string) => recentProjects.find((recent) => recent.path === path)?.name ?? path.split("/").pop() ?? path,
    [recentProjects],
  );
  // Each waiting chat's project and title, for the attention menu. Titles change with state, not with each streamed batch.
  const attentionTitles = useMemo(
    () =>
      attentionChats.map((key) => {
        const path = projectOfKey(key);
        const other = states[path];
        const session = other?.sessions[sessionIdFromKey(key)];
        return {
          key,
          project: projectName(path),
          title: session
            ? chatTitle(
                session,
                other.messages.filter((message) => message.session_id === session.id),
              )
            : undefined,
        };
      }),
    [attentionChats, states, projectName],
  );
  const delegated = useStableSet(useMemo(() => delegatedChats(linkedWork, project?.path ?? ""), [linkedWork, project?.path]));
  // Chats carry a summary of their messages; only an older host's state, without one, is grouped message by message.
  const messagesBySession = useMemo(() => {
    const grouped = new Map<number, ChatMessage[]>();
    if (!Object.values(sidebarState?.sessions ?? {}).some((session) => !session.summary)) return grouped;
    for (const message of sidebarState?.messages ?? []) {
      const list = grouped.get(message.session_id);
      if (list) list.push(message);
      else grouped.set(message.session_id, [message]);
    }
    return grouped;
  }, [sidebarState?.messages, sidebarState?.sessions]);
  // oxlint-disable-next-line react/use-memo -- useMemo is given a factory function reference so the instance is created once
  const readPullRequestRefs = useMemo(pullRequestRefsCache, []);
  const previousChats = useRef<SidebarRecent[]>([]);
  const chats = useMemo(() => {
    const state = sidebarState;
    if (!state) return [];
    const withMessages = Object.values(state.sessions)
      .filter((session) => !session.archived)
      .map((session) => ({ session, sessionMessages: messagesBySession.get(session.id) ?? NO_MESSAGES }))
      .filter(({ session, sessionMessages }) => isListedChat(session, chatSummary(session, sessionMessages).count));
    const rows = orderChats(withMessages, chatOrder).map(({ session, sessionMessages }) => {
      const worktree = state.worktrees[session.worktree_id];
      const failed = failedSends.find((send) => send.projectPath === project?.path && session.id === send.session.id);
      const pending = Boolean(pendingSend && pendingSend.projectPath === project?.path && session.id === (pendingCanonicalId ?? pendingSend.session.id));
      // The commit dialog's notes aren't replies: they don't hide a failed turn (see summarizeChat).
      const summary = chatSummary(session, sessionMessages);
      return {
        id: String(session.id),
        label: chatTitle(session, sessionMessages),
        pending: pending || Boolean(failed),
        pinned: Boolean(session.pinned),
        pinOrder: session.pin_order,
        mark: chatMark({
          asking: asking.has(session.id),
          waiting: waiting.has(session.id),
          delegated: delegated.has(session.id),
          running: running.has(session.id) || pending,
          unread: Boolean(session.unread),
        }),
        unread: Boolean(session.unread),
        details: {
          branch: worktree?.name,
          path: worktree?.path,
          diff: worktree?.diff,
          pullRequests: worktree
            ? chatPullRequests(
                session.summary ? (summary.pullRequests ?? NO_REFS) : readPullRequestRefs(chatKey(project?.path ?? "", session.id), sessionMessages),
                chatPrs[worktree.path] ?? {},
                pullRequests[worktree.path] ?? undefined,
              )
            : [],
          failed: Boolean(failed) || summary.lastOutcome === "failed",
          ports: project ? agentPorts[chatKey(project.path, session.id)] : undefined,
        },
      };
    });
    // Rows that came out the same stay the same objects, so only a changed chat's row renders.
    return (previousChats.current = reuseRows<SidebarRecent>(previousChats.current, rows));
  }, [
    sidebarState,
    pendingSend,
    failedSends,
    pendingCanonicalId,
    messagesBySession,
    chatOrder,
    asking,
    waiting,
    delegated,
    running,
    pullRequests,
    chatPrs,
    agentPorts,
    project,
  ]);
  const latest = useRef({ patchChat, revealChat, openChatInEditor, openGitDialog, checkArchive, archiveChat });
  latest.current = { patchChat, revealChat, openChatInEditor, openGitDialog, checkArchive, archiveChat };
  // The main process applies chat row actions to the latest state, so a turn that finished since the last render isn't lost.
  function patchChat(sessionId: number, patch: SessionPatch) {
    const current = projectRef.current;
    if (current) void reportChatAction(window.milagre.patchChat(current.path, sessionId, patch), "Could not update Chat", setNotice);
  }

  function controlAdvisor(action: "stop" | "retry", id: string) {
    const current = projectRef.current;
    const parentId = selectedSessionRef.current;
    if (current && parentId !== null)
      void reportChatAction(
        (action === "stop" ? window.milagre.stopAdvisor : window.milagre.retryAdvisor)(`${current.path}#${parentId}`, id),
        `Could not ${action} advisor`,
        setNotice,
      );
  }
  function archiveChild(id: string, archived: boolean) {
    const current = projectRef.current;
    const parentId = selectedSessionRef.current;
    if (current && parentId !== null)
      void reportChatAction(window.milagre.archiveSubagent(current.path, parentId, id, archived), "Could not update subagent", setNotice);
  }

  function archiveFinishedChildren() {
    const current = projectRef.current;
    const parentId = selectedSessionRef.current;
    if (current && parentId !== null)
      void reportChatAction(window.milagre.archiveFinishedSubagents(current.path, parentId), "Could not archive finished subagents", setNotice);
  }

  function openChat(sessionId: number) {
    const failed = failedSends.find((send) => send.projectPath === projectRef.current?.path && send.session.id === sessionId);
    if (failed) {
      chatView.current = failed.view;
      setChatView(failed.view);
      setSelectedSessionId(failed.originSessionId);
      setSelectedWorktreeId(failed.originWorktreeId);
      setView("chat");
      setDraft([failed.draft, draftStore.get()].filter(Boolean).join("\n\n"));
      setNewChatError(failed.error);
      preparedTarget.current = failed.target;
      setRestoringSend(failed);
      setFailedSends((current) => current.filter((send) => send !== failed));
      return;
    }
    if (pendingSend && pendingSend.projectPath === projectRef.current?.path && (sessionId === pendingSend.session.id || sessionId === pendingCanonicalId)) {
      chatView.current = pendingSend.view;
      setChatView(chatView.current);
      setSelectedSessionId(pendingSend.originSessionId);
      setSelectedWorktreeId(pendingSend.originWorktreeId);
      setView("chat");
      return;
    }
    if (sessionId !== selectedSessionRef.current) advanceChatView();
    setSelectedSessionId(sessionId);
    setSelectedWorktreeId(openState()?.sessions[sessionId]?.worktree_id ?? null);
    setView("chat");
  }

  // The main process reads the chat on screen (on opening it, and when the window regains focus over it),
  // and leaves a chat unread when its turn ends anywhere else, or while no window has focus.
  useEffect(() => {
    if (selectedLink) return;
    void window.milagre.setOpenChat(view === "chat" && project && selectedSessionId !== null ? chatKey(project.path, selectedSessionId) : null).catch(() => {});
  }, [selectedSessionId, view, project?.path, selectedLink?.link.id]);

  // Archiving hides the chat for good; a turn still running in it is stopped first. The steps and their order
  // live in lib/archive-flow.ts, which is passed what it touches.
  function archiveChat(sessionId: number, mode: ArchiveMode, plan: ArchivePlan | null) {
    if (!project) return Promise.resolve();
    const projectPath = project.path;
    const key = chatKey(projectPath, sessionId);
    const wasOpen = selectedSessionId === sessionId;
    return runArchive(
      {
        projectPath,
        chatId: key,
        getState: () => openState() ?? null,
        currentProjectPath: () => projectRef.current?.path,
        stop: () => (agentRuns.runs[key] ? agentRuns.interrupt(key).catch(() => {}) : undefined),
        hide: async () => {
          await window.milagre.patchChat(projectPath, sessionId, { archived: true, unread: false });
          if (projectRef.current?.path === projectPath && selectedSessionRef.current === sessionId) startNewChat();
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
          if (removed.sessionIds.includes(selectedSessionRef.current ?? -1) || removed.worktreeId === selectedWorktree?.id) advanceChatView();
          setSelectedSessionId((current) => (current !== null && removed.sessionIds.includes(current) ? null : current));
          setSelectedWorktreeId((current) => (current === removed.worktreeId ? null : current));
        },
        refreshBranches: () =>
          void window.milagre
            .listBranches(projectPath)
            .then(setBranches)
            .catch(() => {}),
        notify: setNotice,
      },
      sessionId,
      mode,
      plan,
    ).catch((error) => setNotice(`Could not archive Chat: ${ipcErrorMessage(error)}`));
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
    setGitDialog({
      sessionId,
      worktreeId: worktree.id,
      cwd: worktree.path,
      base: worktree.base,
      provider: session.provider,
      chat: gitChatContext(chatTitle(session, sessionMessages), sessionMessages),
    });
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
  useEffect(() => {
    void window.milagre.setKeepAwake(keepAwake).catch(() => {});
  }, [keepAwake]);

  const unreadChatIds = useMemo(
    () =>
      state && project
        ? Object.values(state.sessions)
            .filter((session) => session.unread && !session.archived)
            .map((session) => chatKey(project.path, session.id))
        : [],
    [state?.sessions, project?.path],
  );
  useEffect(() => {
    if (!project || selectedLink) return;
    void window.milagre
      .syncNotifications({
        projectPath: project.path,
        activeChatId: view === "chat" && selectedSessionId !== null ? chatKey(project.path, selectedSessionId) : null,
        unread: unreadChatIds,
        notifyOnCompletion,
        showDockBadge,
      })
      .catch(() => {});
  }, [selectedLink?.link.id, project?.path, view, selectedSessionId, unreadChatIds.join("\n"), notifyOnCompletion, showDockBadge]);

  // The main process notifies about a chat that waits on the user while Milagre is in the background.
  useEffect(() => {
    void window.milagre.setNotifyWhenWaiting(notifyWhenWaiting).catch(() => {});
  }, [notifyWhenWaiting]);

  // A turn that ends in the open project while Milagre is in the background gets a completion alert.
  useEffect(
    () =>
      window.milagre.onAgentEvent(({ chatId, event }) => {
        if (event.type === "subagent-update") {
          const path = projectOfKey(chatId);
          const linkId = isLinkScopeKey(path) ? path.slice("milagre-link:".length) : null;
          if (linkId)
            setLinkStates((previous) => {
              const cached = previous[linkId];
              return cached ? { ...previous, [linkId]: applyAgentEvent(cached, {}, path, chatId, event).state } : previous;
            });
          const cached = statesRef.current[path];
          if (cached) receiveState(path, applyAgentEvent(cached, {}, path, chatId, event).state);
        }
        const link = selectedLinkRef.current;
        if (link && chatInProject(scopeKey({ kind: "link", linkId: link.link.id }), chatId)) {
          const latest = linkStatesRef.current[link.link.id] ?? link.state;
          const session = latest.sessions[sessionIdFromKey(chatId)];
          if (session && !session.archived && (event.type === "turn-completed" || event.type === "turn-failed"))
            void window.milagre
              .notifyCompletion({
                chatId,
                title: link.link.name,
                subtitle: chatTitle(
                  session,
                  latest.messages.filter((message) => message.session_id === session.id),
                ),
              })
              .catch(() => {});
          return;
        }
        const current = projectRef.current;
        const latest = openState();
        if (!current || !latest || !chatInProject(current.path, chatId)) return;
        const session = latest.sessions[sessionIdFromKey(chatId)];
        if (!session || session.archived) return;
        if (event.type === "turn-completed" || event.type === "turn-failed") {
          void window.milagre
            .notifyCompletion({
              chatId,
              title: current.name,
              subtitle: chatTitle(
                session,
                latest.messages.filter((message) => message.session_id === session.id),
              ),
            })
            .catch(() => {});
        }
      }),
    [],
  );

  // A new worktree's branch is renamed a few seconds in, once its chat's name is picked; the main process saves the new name.
  useEffect(
    () =>
      window.milagre.onWorktreeRenamed((rename) => {
        if (projectRef.current?.path === rename.projectPath) void window.milagre.listBranches(rename.projectPath).then(setBranches);
      }),
    [],
  );

  const pendingNotificationChat = useRef<string | null>(null);
  // Opens a chat by its key, in another project too: a notification's, or the one the attention button points at.
  const openChatByKey = useEvent((chatId: string) => {
    const owner = projectOfKey(chatId);
    if (isLinkScopeKey(owner)) {
      // oxlint-disable-next-line react/immutability -- React Compiler heuristic: the ref or handler is assigned or called after render, not during it
      void selectLink(owner.slice("milagre-link:".length), sessionIdFromKey(chatId));
      return;
    }
    const current = projectRef.current;
    const session = current && chatInProject(current.path, chatId) ? openState()?.sessions[sessionIdFromKey(chatId)] : undefined;
    if (session) {
      openChat(session.id);
      return;
    }
    const separator = chatId.lastIndexOf("#");
    if (separator <= 0) return;
    pendingNotificationChat.current = chatId;
    // oxlint-disable-next-line react/immutability -- React Compiler heuristic: the ref or handler is assigned or called after render, not during it
    void switchProject(chatId.slice(0, separator));
  });
  useEffect(() => window.milagre.onOpenChat(openChatByKey), []);

  // Clicking the "phone paired" notification opens Settings → Phone, where access can be reset.
  useEffect(
    () =>
      window.milagre.onOpenPhoneSettings(() => {
        setSettingsSection("phone");
        setView("settings");
      }),
    [],
  );

  function startNewChat(draftText = "") {
    advanceChatView();
    const latest = openState();
    if (latest && projectRef.current) restoreProjectChoices(latest, projectRef.current.path);
    setSelectedSessionId(null);
    // The new-chat screen keeps its own draft; only text handed in replaces it.
    if (draftText) setDraft(draftText);
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
    if (!selectedLinkRef.current && projectRef.current)
      scopeDrafts.save({ kind: "project", projectPath: projectRef.current.path }, { text: draftStore.get(), sessionId: selectedSessionRef.current });
    setSelectedLink(null);
    projectsSeen.current.set(nextProject.path, { path: nextProject.path, name: nextProject.name });
    advanceChatView();
    setStartupError(null);
    setLoading(false);
    receiveState(nextProject.path, nextProject.state);
    projectRef.current = nextProject;
    // The project's remembered worktree and base branch come back with it; nothing about the old project's chats
    // carries over, the commit dialog included (it names a chat by id, and every project has a chat 2).
    flushSync(() => {
      setProject(nextProject);
      selectInitialChat(nextProject.state, nextProject.path);
      const remembered = scopeDrafts.read({ kind: "project", projectPath: nextProject.path });
      if (remembered.sessionId !== null && nextProject.state.sessions[remembered.sessionId]) setSelectedSessionId(remembered.sessionId);
      setGitDialog(null);
      setView("chat");
    });
    const restored = restoredChatsNotice(nextProject.restoredChats);
    if (restored) setNotice(restored);
  }

  // Opens a project in place of the one shown; a cancelled dialog, or the project already open, changes nothing.
  async function replaceProject(load: () => Promise<OpenProject | null>, path?: string) {
    const navigation = ++projectNavigation.current;
    const cached = path ? projectsSeen.current.get(path) : undefined;
    const cachedState = path ? statesRef.current[path] : undefined;
    const instant = cached && cachedState ? { ...cached, state: cachedState } : path ? cachedProjectCopy(path) : undefined;
    if (instant && (instant.path !== projectRef.current?.path || selectedLinkRef.current)) adoptProject(instant);
    const adopted = path ? statesRef.current[path] : undefined;
    try {
      const next = await load();
      if (navigation !== projectNavigation.current || !next) return;
      if (next.path !== projectRef.current?.path || selectedLinkRef.current) adoptProject(next);
      else {
        // Revalidation updates the list without resetting a Chat or draft picked while it was in flight.
        projectsSeen.current.set(next.path, { path: next.path, name: next.name });
        // Host events may have supplied a newer state while this request was pending.
        if (!path || statesRef.current[next.path] === adopted) receiveState(next.path, next.state);
        setProject(next);
        const restored = restoredChatsNotice(next.restoredChats);
        if (restored) setNotice(restored);
      }
    } catch (error) {
      if (navigation !== projectNavigation.current) return;
      if (!projectRef.current) setStartupError(ipcErrorMessage(error));
      setNotice(ipcErrorMessage(error));
    }
  }

  const openProject = () => replaceProject(() => window.milagre.openProject());
  const switchProject = (projectPath: string) => replaceProject(() => window.milagre.switchProject(projectPath), projectPath);
  async function selectLink(id: string, sessionId?: number) {
    const navigation = ++projectNavigation.current;
    try {
      const next = await window.milagre.openNamedLink(id);
      if (navigation !== projectNavigation.current) return;
      if (!selectedLinkRef.current && projectRef.current)
        scopeDrafts.save({ kind: "project", projectPath: projectRef.current.path }, { text: draftStore.get(), sessionId: selectedSessionRef.current });
      advanceChatView();
      setLinkStates((previous) => ({ ...previous, [id]: next.state }));
      setLinkInitialSession(sessionId);
      setSelectedLink(next);
      setView("chat");
      setNewChatError(null);
    } catch (error) {
      setNotice(ipcErrorMessage(error));
    }
  }
  async function openCanvasChat(projectPath: string, sessionId: number) {
    if (isLinkScopeKey(projectPath)) {
      await selectLink(projectPath.slice("milagre-link:".length), sessionId);
      return;
    }
    if (!selectedLinkRef.current && projectRef.current?.path === projectPath) {
      openChat(sessionId);
      return;
    }
    const navigation = ++projectNavigation.current;
    // The last copy shows at once; the main process's answer then refreshes it in place, so the switch never waits.
    const cachedState = statesRef.current[projectPath];
    const seen = projectsSeen.current.get(projectPath);
    const instant = cachedState && seen ? { ...seen, state: cachedState } : cachedProjectCopy(projectPath);
    if (instant) {
      adoptProject(instant);
      openChat(sessionId);
    }
    const adopted = statesRef.current[projectPath];
    try {
      const next = await window.milagre.openCanvasProject(projectPath);
      if (navigation !== projectNavigation.current) return;
      if (!instant || next.path !== projectRef.current?.path || selectedLinkRef.current) {
        adoptProject(next);
        openChat(sessionId);
        return;
      }
      projectsSeen.current.set(next.path, { path: next.path, name: next.name });
      if (statesRef.current[next.path] === adopted) receiveState(next.path, next.state);
      setProject(next);
      const restored = restoredChatsNotice(next.restoredChats);
      if (restored) setNotice(restored);
    } catch (error) {
      if (navigation === projectNavigation.current) setNotice(ipcErrorMessage(error));
    }
  }

  // Where a message goes: an open chat keeps its session, a new local chat (session null) gets one
  // from the main process, and a new chat in "New worktree" isolation gets its own worktree first.
  async function resolveSendTarget(body: string) {
    if (!state || !project || !selectedWorktree) return null;
    if (preparedTarget.current?.view === chatView.current && preparedTarget.current.projectPath === project.path) return preparedTarget.current;
    if (selectedSession) return { sessionId: selectedSession.id as number | null, worktreeId: selectedWorktree.id };
    if (isolation === "local") return { sessionId: null, worktreeId: selectedWorktree.id };
    setBaseBranch(effectiveBaseBranch);
    saveChatPreferences(localStorage, project.path, { baseBranch: effectiveBaseBranch });
    const created = await window.milagre.createWorktree({ projectPath: project.path, baseBranch: effectiveBaseBranch, prompt: body });
    receiveState(project.path, created.project.state);
    const session = sessionForWorktree(created.project.state, created.worktreeId);
    if (!session) throw new Error(`No chat session was created for ${created.project.state.worktrees[created.worktreeId]?.name}.`);
    if (created.setupNote) setNotice(created.setupNote);
    void window.milagre
      .listBranches(project.path)
      .then((next) => {
        // oxlint-disable-next-line promise/no-callback-in-promise -- the handler receives the resolved value, not a Node-style callback
        if (projectRef.current?.path === project.path) setBranches(next);
      })
      .catch(() => {});
    return { sessionId: session.id as number | null, worktreeId: created.worktreeId };
  }

  async function executeSend(
    body: string,
    mode: PermissionMode,
    images: ImageAttachment[] = imageDraft.images,
    files: string[] = imageDraft.files,
    preserveComposer = false,
  ): Promise<boolean> {
    if ((!body && !images.length && !files.length) || !state || !selectedWorktree || !project || sendInFlight.current || imageDraft.loading) return false;
    sendInFlight.current = true;
    const view = chatView.current;
    const stillHere = () => projectRef.current?.path === project.path && chatView.current === view;
    setPreparingView(view);
    setNewChatError(null);
    // The picker decides the provider: a chat on another one hands off to it.
    const model = selectedModel;
    const firstMessage = messages.length === 0;
    const submittedDraft = draftStore.get();
    // A chat bound for a worktree that doesn't exist yet shows no worktree (and none of its PRs) until it does.
    const prepared = preparedTarget.current?.view === view && preparedTarget.current.projectPath === project.path ? preparedTarget.current : null;
    const previewWorktreeId = prepared?.worktreeId ?? (selectedSession || isolation === "local" ? selectedWorktree.id : NO_WORKTREE);
    const preview = createPendingChat({
      state,
      sessionId: selectedSession?.id,
      worktreeId: previewWorktreeId,
      body,
      images,
      files,
      model: model.id,
      provider: model.provider,
    });
    setPendingSend({
      ...preview,
      view,
      projectPath: project.path,
      originSessionId: selectedSession?.id ?? null,
      originWorktreeId: selectedWorktree.id,
    });
    if (!preserveComposer) {
      setDraft("");
      imageDraft.clear();
    }
    // Capture the user's choices before setup runs in the background.
    const options = {
      provider: model.provider,
      model: model.id,
      permissionMode: mode,
      effort: effortFor(capabilityFor(model, capabilities), effort),
      ultracode: capabilityFor(model, capabilities).ultracode && ultracode,
      fastMode: capabilityFor(model, capabilities).fastMode && fastMode,
      replies: getSettings().claudeReplies,
      tldrEnabled: getSettings().tldrEnabled,
    };
    let target: Awaited<ReturnType<typeof resolveSendTarget>> = null;
    let sent = false;
    try {
      target = await resolveSendTarget(body);
      if (!target) return false;
      if (firstMessage && stillHere()) preparedTarget.current = { ...target, view, projectPath: project.path };
      setPendingSend((pending) =>
        pending ? { ...pending, targetSessionId: target!.sessionId, session: { ...pending.session, worktree_id: target!.worktreeId } } : pending,
      );
      // The main process saves the message, then starts the Chat's turn, even if the user has navigated away.
      const { sessionId } = await agentRuns.send({
        projectPath: project.path,
        clientMessageId: preview.message.clientMessageId,
        sessionId: target.sessionId,
        worktreeId: target.worktreeId,
        body,
        images,
        files,
        prompt: attachmentPrompt(body, files),
        ...options,
      });
      if (preparedTarget.current?.view === view) preparedTarget.current = null;
      sent = true;
      setPendingSend((pending) =>
        pending && pending.message.clientMessageId === preview.message.clientMessageId
          ? { ...pending, sent: true, originSessionId: sessionId, originWorktreeId: target!.worktreeId }
          : pending,
      );
      if (stillHere()) {
        // Text typed while a new chat was being created belongs to that chat, not to the next new one.
        const carried = draftStore.get();
        setDraft("");
        setSelectedSessionId(sessionId);
        setDraft([draftStore.get(), carried].filter(Boolean).join("\n\n"));
        setSelectedWorktreeId(openState()?.sessions[sessionId]?.worktree_id ?? target.worktreeId);
      }
      return true;
    } catch (error) {
      const message = `${target ? "Could not send the message" : "Could not create the worktree"}: ${ipcErrorMessage(error)}`;
      if (stillHere()) {
        setNewChatError(message);
        if (!preserveComposer) {
          const nextDraft = draftStore.get();
          setDraft([submittedDraft || body, nextDraft].filter(Boolean).join("\n\n"));
          imageDraft.restore(images, files);
        }
      } else {
        if (!preserveComposer)
          setFailedSends((current) => [
            ...current,
            {
              ...preview,
              view,
              projectPath: project.path,
              originSessionId: selectedSession?.id ?? null,
              originWorktreeId: selectedWorktree.id,
              draft: submittedDraft || body,
              error: message,
              target: target ? { ...target, view, projectPath: project.path } : null,
            },
          ]);
        setNotice(message);
      }
      return false;
    } finally {
      if (!sent) setPendingSend(null);
      sendInFlight.current = false;
      setPreparingView(null);
    }
  }

  // Every comment that still matches the diff goes out as one message, like any send (a running turn is steered).
  async function sendDiffComments() {
    const sent = diffComments.sendable;
    if (sent.length === 0) return;
    const base = changes.list.state === "ready" && changes.list.isRepo ? changes.list.base : null;
    // Back to the chat first, so the message shows up as it lands.
    changes.closeDiff();
    if (await executeSend(formatCommentsMessage(sent, { mode: changes.mode, base }), permissionMode, [], [], true))
      diffComments.removeMany(sent.map((comment) => comment.id));
  }

  async function sendMessage() {
    const body = draftStore.get().trim();
    if ((!body && !imageDraft.images.length && !imageDraft.files.length) || !state || !selectedWorktree || !project || preparing || imageDraft.loading) return;
    await executeSend(body, permissionMode);
  }

  // Keep finished message cards out of the typing render path. Recommendations still use
  // the current model and permission mode when clicked.
  const recommendationRef = useRef<(option: string) => void>(() => {});
  recommendationRef.current = (option) => {
    void executeSend(option, permissionMode);
  };
  const sendRecommendation = useCallback((option: string) => recommendationRef.current(option), []);

  // The find bar belongs to one open chat; ⌘F again while it is open refocuses and selects its text.
  const [findOpen, setFindOpen] = useState(false);
  const [findSignal, setFindSignal] = useState(0);
  // Text the find bar starts with, from a ⌘K message result; ⌘F clears it.
  const [findSeed, setFindSeed] = useState<string | undefined>();
  const findRef = useRef({ open: false, canOpen: false });
  findRef.current = { open: findOpen, canOpen: view === "chat" && messages.length > 0 };
  function openFind(seed?: string) {
    if (!findRef.current.canOpen) return;
    setFindSeed(seed);
    setFindOpen(true);
    setFindSignal((current) => current + 1);
  }
  useEffect(() => setFindOpen(false), [selectedSession?.id, view]);
  // A ⌘K message result opens its chat first; the find bar opens once that chat's messages are on screen.
  const pendingFind = useRef<{ sessionId: number; term: string } | null>(null);
  useEffect(() => {
    const pending = pendingFind.current;
    if (!pending || view !== "chat" || selectedSession?.id !== pending.sessionId || !messages.length) return;
    pendingFind.current = null;
    openFind(pending.term);
  }, [selectedSession?.id, view, messages.length]);
  function openMessage(sessionId: number, term: string) {
    if (view === "chat" && selectedSession?.id === sessionId) {
      openFind(term);
      return;
    }
    pendingFind.current = { sessionId, term };
    openChat(sessionId);
  }

  // The main process sends on the app's ⌘⇧ shortcuts pressed inside an embedded frame (a design, the simulator), which
  // the window's listeners never see; replayed here, every handler takes them as if pressed in the window.
  useEffect(
    () =>
      window.milagre.onAppShortcut?.((key) =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: isMac, ctrlKey: !isMac, shiftKey: true, bubbles: true, cancelable: true })),
      ),
    [],
  );
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (selectedLinkRef.current) return;
      if (event.defaultPrevented || event.isComposing || isModalOpen()) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.shiftKey) {
        if (event.key.toLowerCase() === "t") {
          event.preventDefault();
          toggleTheme();
        } else if (event.key.toLowerCase() === "d" && changesAvailableRef.current) {
          event.preventDefault();
          changes.toggle();
        } else if (event.key.toLowerCase() === "l") {
          event.preventDefault();
          changes.closeDiff();
          setView("canvas");
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
      if (selectedLinkRef.current) return;
      // A menu, picker or search that Escape closed has already consumed it.
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (findRef.current.open) {
        event.preventDefault();
        setFindOpen(false);
        return;
      }
      if (view === "settings" || view === "canvas") {
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
      if (selectedLinkRef.current) return;
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

  // The sidebar is memo()'d: these keep one identity across renders (each runs the latest closure) so a streamed
  // batch or another pane's state change doesn't re-render it.
  const pickChat = useEvent((id: string) => openChat(Number(id)));
  const chatActions = useMemo<ChatRowActions>(
    () => ({
      onRename: (id, title) => latest.current.patchChat(Number(id), { title }),
      onMarkUnread: (id, unread) => latest.current.patchChat(Number(id), { unread }),
      onPin: (id, order) => latest.current.patchChat(Number(id), order == null ? { pinned: false, pin_order: undefined } : { pinned: true, pin_order: order }),
      onReveal: (id) => latest.current.revealChat(Number(id)),
      onOpenInEditor: (id) => latest.current.openChatInEditor(Number(id)),
      onCommit: (id) => latest.current.openGitDialog(Number(id)),
      onArchiveCheck: (id) => latest.current.checkArchive(Number(id)),
      onArchive: (id, mode, plan) => void latest.current.archiveChat(Number(id), mode, plan),
    }),
    [],
  );
  const startNewChatFromSidebar = useEvent(() => startNewChat());
  const openProjectFromSidebar = useEvent(() => void openProject());
  const switchProjectFromSidebar = useEvent((path: string) => void switchProject(path));
  // "+" on another Project's header switches to it (from its last copy, so at once) and starts a chat there.
  const newChatInScope = useEvent((key: string) => {
    if (isLinkScopeKey(key)) {
      void selectLink(key.slice("milagre-link:".length));
      return;
    }
    if (!selectedLinkRef.current && projectRef.current?.path === key) {
      startNewChat();
      return;
    }
    // A new chat left unsent there comes back with its draft; a draft for one of its chats stays with that chat.
    const remembered = scopeDrafts.read({ kind: "project", projectPath: key });
    const start = () => startNewChat(remembered.sessionId === null ? remembered.text : "");
    const switched = switchProject(key);
    if (!selectedLinkRef.current && projectRef.current?.path === key) start();
    else
      void switched.then(() => {
        if (!selectedLinkRef.current && projectRef.current?.path === key) start();
      });
  });
  const sidebarRunKeys = runKeys(agentRuns.runs);
  const openScopeChat = useEvent((scopeKey: string, id: string) => void openCanvasChat(scopeKey, Number(id)));
  const openSettings = useEvent(() => setView("settings"));
  const openCanvas = useEvent(() => {
    changes.closeDiff();
    setView("canvas");
  });
  const openProjectSettings = useEvent((path?: string) => {
    setSettingsProject(path && path !== projectRef.current?.path ? { path, name: projectName(path) } : null);
    setSettingsSection("project");
    setView("settings");
  });
  const openCommandPalette = useEvent(() => setCommandPaletteOpen(true));
  // Saved message cards also receive this callback: keep their memoization during sends and streamed updates.
  const openLinkedChat = useEvent((key: string) => void openCanvasChat(projectOfKey(key), sessionIdFromKey(key)));
  const sidebarUsage = useMemo(
    () => (showUsageInSidebar && usage.snapshot && visibleProviders(usage.snapshot).length > 0 ? <SidebarUsage usage={usage} /> : undefined),
    [showUsageInSidebar, usage.snapshot, usage.loading],
  );
  const composerWorktrees = useMemo(
    () => worktrees.filter((worktree) => !worktree.sharedChat).map((worktree) => ({ id: worktree.id, name: worktree.name, path: worktree.path })),
    [worktrees],
  );

  // Fast loads would cut the startup animation off at the bare legs, so the splash stays until the logo is whole,
  // then fades out over the app while the panes slide in. Same key in both trees keeps the logo from restarting.
  const [splash, setSplash] = useState<"intro" | "done" | "gone">("intro");
  const [appEntered, setAppEntered] = useState(false);
  const splashOverlay = (leaving: boolean) =>
    splash === "gone" ? null : (
      <StartupSplash
        key="startup-splash"
        leaving={leaving}
        onIntroEnd={() => setSplash((current) => (current === "intro" ? "done" : current))}
        onLeft={() => setSplash("gone")}
      />
    );

  if (startupError) {
    return (
      <main data-startup-error className="flex min-h-screen items-center justify-center p-8 text-ink">
        <section className="w-full max-w-xl rounded-2xl border border-line bg-surface p-6 shadow-overlay" aria-labelledby="startup-error-title">
          <h1 id="startup-error-title" className="text-lg font-semibold">
            Project could not open
          </h1>
          <p role="alert" className="mt-3 break-words text-sm leading-relaxed text-ink-2">
            {startupError}
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => void loadInitialProject()}
            >
              Retry
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => void openProject()}
            >
              Open another project
            </button>
          </div>
        </section>
      </main>
    );
  }

  async function editLink(id: string) {
    try {
      const link = (await window.milagre.listNamedLinks()).find((item) => item.id === id);
      if (!link) throw new Error("Link no longer exists");
      setLinkDialogOpen(link);
    } catch (error) {
      setNotice(ipcErrorMessage(error));
    }
  }
  // An edited Link that is open reloads in place, so its header and member Projects follow.
  async function linkEdited(link: NamedProjectLink) {
    window.dispatchEvent(new Event(RECENT_PROJECTS_CHANGED));
    if (selectedLinkRef.current?.link.id !== link.id) return;
    try {
      const next = await window.milagre.openNamedLink(link.id);
      if (selectedLinkRef.current?.link.id === link.id) setSelectedLink(next);
    } catch (error) {
      setNotice(ipcErrorMessage(error));
    }
  }
  const linkDialog = linkDialogOpen ? (
    <LinkProjectDialog
      link={typeof linkDialogOpen === "object" ? linkDialogOpen : undefined}
      onClose={() => setLinkDialogOpen(false)}
      onCreated={(link) => {
        const edited = typeof linkDialogOpen === "object";
        setLinkDialogOpen(false);
        void (edited ? linkEdited(link) : selectLink(link.id));
      }}
    />
  ) : null;
  if (selectedLink && view === "settings")
    return (
      <DotBackground>
        <div className="flex h-screen gap-3 p-3 pt-10">
          <SettingsNav
            showProjectSettings={false}
            section={settingsSection}
            onSelectProject={() => {}}
            onSelect={setSettingsSection}
            onBack={() => setView("chat")}
          />
          <main className="min-w-0 flex-1">
            <SettingsPanel section={settingsSection} accountScope={accountScope} models={models} update={update} onSectionChange={setSettingsSection} />
          </main>
        </div>
      </DotBackground>
    );
  if (selectedLink)
    return (
      <>
        <LinkWorkspace
          key={selectedLink.link.id}
          opened={selectedLink}
          state={linkStates[selectedLink.link.id] ?? selectedLink.state}
          hostConnection={hostConnection}
          ports={agentPorts}
          agents={agentRuns}
          drafts={scopeDrafts}
          initialSessionId={linkInitialSession}
          preferences={{
            models,
            selectedModel,
            onModelChange: chooseModel,
            cliStatus,
            onModelPickerOpen: refreshCliStatus,
            onUpdateCli: handleUpdateCli,
            updatingCli,
            capability: selectedCapability,
            effort: effortFor(selectedCapability, effort),
            onEffortChange: setEffort,
            ultracode,
            onUltracodeChange: setUltracode,
            fastMode,
            onFastModeChange: setFastMode,
            permissionMode,
            onPermissionModeChange: setPermissionMode,
          }}
          onSwitchProject={(path) => void switchProject(path)}
          onSwitchLink={(id) => void selectLink(id)}
          onLinkProject={() => setLinkDialogOpen(true)}
          onEditLink={(id) => void editLink(id)}
          onOpenProject={() => void openProject()}
          onSettings={() => {
            setSettingsSection("project-accounts");
            setView("settings");
          }}
          linkedWork={linkedWork}
          onCanvasChat={(path, id) => void openCanvasChat(path, id)}
          usage={sidebarUsage}
          onNewChatInScope={newChatInScope}
        />
        {linkDialog}
      </>
    );

  if (loading || !project || !state || splash === "intro") {
    return <>{splashOverlay(false)}</>;
  }

  // Only the open palette reads the list, so it is built then and not on every render.
  function buildCommands(current: OpenProject): Command[] {
    const modifier = /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
    const commands: Command[] = [
      { id: "new-chat", label: "New chat", group: "Actions", icon: "add", shortcut: `${modifier}N`, keywords: "create agent session", run: startNewChat },
      {
        id: "open-project",
        label: "Add project…",
        group: "Actions",
        icon: "folder",
        shortcut: `${modifier}O`,
        keywords: "add repository workspace folder",
        run: () => openProject(),
      },
      {
        id: "canvas",
        label: "Projects and Links",
        group: "Actions",
        icon: "git",
        shortcut: `${modifier}⇧L`,
        keywords: "canvas linked worktrees",
        run: openCanvas,
      },
      {
        id: "settings",
        label: "Settings",
        group: "Actions",
        icon: "settings",
        shortcut: `${modifier},`,
        keywords: "preferences model permissions",
        run: () => {
          setSettingsSection("general");
          setView("settings");
        },
      },
      {
        id: "appearance",
        label: "Appearance settings",
        group: "Actions",
        icon: "settings",
        keywords: "theme preferences",
        run: () => {
          setSettingsSection("appearance");
          setView("settings");
        },
      },
      {
        id: "toggle-theme",
        label: "Toggle theme",
        group: "Actions",
        icon: "settings",
        shortcut: modifier === "⌘" ? "⌘⇧T" : "Ctrl+Shift+T",
        keywords: "appearance switch color mode",
        run: toggleTheme,
      },
      {
        id: "project-settings",
        label: "Project settings",
        group: "Actions",
        icon: "settings",
        detail: current.name,
        keywords: "worktree setup files",
        run: openProjectSettings,
      },
    ];
    if (view === "settings") commands.push({ id: "back-to-chat", label: "Back to chat", group: "Actions", icon: "chat", run: () => setView("chat") });
    commands.push(...settingsCommands(getSettings(), updateSettings));
    if (selectedSession && view === "chat") {
      const sessionId = selectedSession.id;
      commands.unshift(
        {
          id: "git",
          label: "Commit and open PR…",
          group: "Current chat",
          icon: "git",
          keywords: "git changes pull request push",
          run: () => openGitDialog(sessionId),
        },
        {
          id: "editor",
          label: "Open in editor",
          group: "Current chat",
          icon: "editor",
          keywords: "code vscode cursor",
          run: () => openChatInEditor(sessionId),
        },
        { id: "reveal", label: "Reveal folder", group: "Current chat", icon: "folder", keywords: "finder explorer worktree", run: () => revealChat(sessionId) },
        ...(messages.length
          ? [
              {
                id: "find",
                label: "Find in chat",
                group: "Current chat",
                icon: "search" as const,
                shortcut: `${modifier}F`,
                keywords: "search text messages",
                run: openFind,
              },
            ]
          : []),
        {
          id: "unread",
          label: selectedSession.unread ? "Mark as read" : "Mark as unread",
          group: "Current chat",
          icon: "unread",
          run: () => patchChat(sessionId, { unread: !selectedSession.unread }),
        },
      );
      if (selectedWorktree)
        commands.splice(3, 0, {
          id: "copy-path",
          label: "Copy worktree path",
          group: "Current chat",
          icon: "copy",
          run: () => navigator.clipboard.writeText(selectedWorktree.path),
        });
    }
    commands.push(
      ...chats.map((chat): Command => ({
        id: `chat:${chat.id}`,
        label: chat.label,
        group: "Chats",
        icon: "chat",
        detail: [
          chat.mark === "waiting" || chat.mark === "question" ? "Needs you" : chat.mark === "running" ? "Working" : chat.unread ? "Unread" : "",
          chat.details?.branch,
        ]
          .filter(Boolean)
          .join(" · "),
        keywords: [chat.details?.path, ...(chat.details?.pullRequests ?? []).flatMap((pr) => [pr.title, `#${pr.number}`])].filter(Boolean).join(" "),
        run: () => openChat(Number(chat.id)),
      })),
    );
    commands.push(
      ...recentProjects
        .filter((recent) => recent.path !== current.path)
        .map((recent): Command => ({
          id: `project:${recent.path}`,
          label: recent.name,
          group: "Projects",
          icon: "folder",
          detail: recent.path,
          run: () => switchProject(recent.path),
        })),
    );
    return commands;
  }

  return (
    <>
      <DotBackground key="app">
        {hostConnection.connected && hostConnection.hostOutdated && (
          <div
            role="status"
            data-host-outdated
            className="fixed inset-x-4 top-12 z-50 mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-2.5 text-[13px] leading-snug text-ink shadow-overlay [-webkit-app-region:no-drag]"
          >
            <span>{hostConnection.message ?? "Restart Milagre's background host to load large projects."}</span>
            <button
              type="button"
              disabled={restartingHost}
              onClick={() => {
                setRestartingHost(true);
                void window.milagre
                  .restartHost()
                  .catch((error) => setNotice(`Couldn't restart the host: ${ipcErrorMessage(error)}`))
                  .finally(() => setRestartingHost(false));
              }}
              className="shrink-0 rounded-control bg-ink px-2.5 py-1 font-medium text-surface transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-40"
            >
              {restartingHost ? "Restarting…" : "Restart host"}
            </button>
          </div>
        )}
        {!hostConnection.connected && (
          <div
            role="status"
            data-host-disconnected
            className="fixed inset-x-4 top-12 z-50 mx-auto max-w-2xl rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink shadow-overlay [-webkit-app-region:no-drag]"
          >
            {hostConnection.failed ? (
              <>
                <p className="font-medium">Couldn't restart Milagre's background host</p>
                <p className="mt-1 text-ink-2">{hostConnection.message} Your draft is kept here. Quit and reopen Milagre to try again.</p>
              </>
            ) : (
              <>
                <p className="font-medium">Reconnecting to your computer</p>
                <p className="mt-1 text-ink-2">Your draft is kept here. Messages will be available when the host reconnects.</p>
              </>
            )}
          </div>
        )}
        <div aria-hidden className="title-drag fixed inset-x-0 top-0 z-50 h-10" />
        {changesAvailable && <ChangesToggle open={changes.open} onToggle={changes.toggle} />}
        <PanelToggles right={changesAvailable ? 12 + CORNER_PITCH : 12} />
        {showAttentionButton && attentionChats[0] && (
          <AttentionButton
            label={attentionLabel(attentionPaths.map(projectName))}
            items={attentionTitles.map((item) => ({
              ...item,
              asking: !agentRuns.runs[item.key]?.approvals.length,
              waitingFor: waitingFor(agentRuns.runs[item.key]),
            }))}
            offset={(changesAvailable ? 1 : 0) + sidePanelCount(sidePanels)}
            onOpen={openChatByKey}
          />
        )}
        <div
          className={`flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden text-ink ${appEntered ? "" : "app-enter"}`}
          onAnimationEnd={(event) => {
            if (event.animationName === "app-enter-main") setAppEntered(true);
          }}
        >
          <div className={`min-h-0 shrink-0 pt-[60px] pb-3 pl-3 ${view === "chat" || view === "canvas" ? "flex" : "hidden"}`}>
            <SidebarNav
              fill
              workspaceName={project.name}
              workspaceImage={projectImage(project.path)}
              onSwitchLink={(id) => void selectLink(id)}
              onLinkProject={() => setLinkDialogOpen(true)}
              onEditLink={(id) => void editLink(id)}
              onOpenProject={openProjectFromSidebar}
              recents={chats}
              activeId={
                view === "chat"
                  ? pendingHere && pendingSend
                    ? String(pendingCanonicalId ?? pendingSend.session.id)
                    : selectedSession
                      ? String(selectedSession.id)
                      : null
                  : null
              }
              onPick={pickChat}
              chatActions={chatActions}
              onNewChat={startNewChatFromSidebar}
              onOpenSettings={openSettings}
              onOpenCanvas={openCanvas}
              canvasActive={view === "canvas"}
              onOpenCommands={openCommandPalette}
              hintsEnabled={view === "chat" && !commandPaletteOpen && !gitDialog}
              projectPath={project.path}
              onSwitchProject={switchProjectFromSidebar}
              attentionPaths={attentionPaths}
              onOpenProjectSettings={openProjectSettings}
              onNewChatInScope={newChatInScope}
              usage={sidebarUsage}
              runningKeys={sidebarRunKeys.running}
              waitingKeys={sidebarRunKeys.waiting}
              askingKeys={sidebarRunKeys.asking}
              onOpenScopeChat={openScopeChat}
            />
          </div>
          {view === "settings" && (
            <div className="flex shrink-0 py-3 pl-3">
              <SettingsNav
                section={settingsSection}
                project={settingsProject ?? project}
                current={project}
                onSelect={setSettingsSection}
                onSelectProject={(picked) => {
                  setSettingsProject(picked);
                  setSettingsSection("project");
                }}
                onBack={() => setView("chat")}
              />
            </div>
          )}

          <main data-workspace-main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent pr-3 pb-3">
            <DiffBar
              open={diffShowing}
              onBack={changes.closeDiff}
              send={{ count: diffComments.sendable.length, onSend: () => void sendDiffComments() }}
              trailing={<DiffToolbar changes={changes} prefs={diffPrefs} />}
            />
            <AnimatePresence initial={false} onExitComplete={diffPresence.onExitComplete}>
              {diffShowing && <DiffView key="diff" changes={changes} prefs={diffPrefs} comments={diffComments} />}
            </AnimatePresence>
            {view === "settings" && (
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                {notice && (
                  <NoticeCard className="mx-auto mt-2 mb-1 max-w-2xl" onDismiss={() => setNotice(null)}>
                    {notice}
                  </NoticeCard>
                )}
                <SettingsPanel
                  section={settingsSection}
                  project={settingsProject ?? project}
                  models={models}
                  update={update}
                  onSectionChange={setSettingsSection}
                />
              </div>
            )}
            {view === "canvas" && (
              <CanvasView
                states={states}
                runs={agentRuns.runs}
                linkedWork={linkedWork}
                onOpenChat={(path, id) => void openCanvasChat(path, id)}
                onBack={() => setView("chat")}
              />
            )}
            {/* Fades back in when the diff has gone: a display:none element restarts its animation when shown. */}
            <div
              data-chat-pane
              className={`min-h-0 flex-1 overflow-hidden ${view === "chat" && !diffPresence.occupied ? "" : "hidden"}`}
              style={{ animation: "fade-in 160ms ease-out" }}
            >
              <EditorLinks root={selectedWorktree?.path ?? project.path}>
                <DraftChatComposer
                  key={project.path}
                  store={draftStore}
                  messages={displayedMessages}
                  pendingMessageId={pendingHere && pendingCanonicalId === null ? pendingSend?.message.id : undefined}
                  imageDraft={imageDraft}
                  projectPath={selectedWorktree?.path ?? project.path}
                  messageScope={project.path}
                  onSend={() => void sendMessage()}
                  onSendDesignMessage={(text) => executeSend(text, permissionMode, [], [], true)}
                  onStop={run && selectedSession ? () => void agentRuns.interrupt(chatKey(project.path, selectedSession.id)) : undefined}
                  pullRequestAction={
                    selectedSession && selectedPullRequest && pullRequestBlocker
                      ? {
                          label: BLOCKERS[pullRequestBlocker].action,
                          tone: BLOCKERS[pullRequestBlocker].tone,
                          onRun: () => {
                            dismissBlockerAction(selectedPullRequest, pullRequestBlocker);
                            void executeSend(blockerPrompt(pullRequestBlocker, selectedPullRequest), permissionMode, [], [], true);
                          },
                        }
                      : undefined
                  }
                  isSending={isSending}
                  sendBlocked={preparing}
                  runStartedAt={run?.startedAt ?? (pendingHere ? pendingSend?.startedAt : undefined)}
                  streamingText={run?.text}
                  streamingSteps={run?.steps}
                  subagents={subagents}
                  onArchiveFinishedSubagents={archiveFinishedChildren}
                  onArchiveSubagent={archiveChild}
                  onStopAdvisor={(id) => controlAdvisor("stop", id)}
                  onRetryAdvisor={(id) => controlAdvisor("retry", id)}
                  waitingForSubagents={run?.waitingForSubagents}
                  tasks={run?.tasks}
                  contextUsage={run?.contextUsage ?? selectedSession?.contextUsage}
                  ports={project && selectedSession ? agentPorts[chatKey(project.path, selectedSession.id)] : undefined}
                  agentChatId={project && selectedSession ? chatKey(project.path, selectedSession.id) : undefined}
                  onStopPort={project && selectedSession ? (pid) => window.milagre.stopAgentPort(chatKey(project.path, selectedSession.id), pid) : undefined}
                  waitingStepIds={waitingStepIds}
                  asking={Boolean(run?.questions.length)}
                  sessionProvider={selectedSession?.provider}
                  runModelName={run ? (models.find((model) => model.id === run.model)?.name ?? run.model) : undefined}
                  resume={
                    project && selectedSession?.resumeTurn
                      ? {
                          onContinue: () =>
                            void window.milagre
                              .resumeChat(project.path, selectedSession.id)
                              .catch((error) => setNotice(`Couldn't continue the chat: ${error instanceof Error ? error.message : String(error)}`)),
                        }
                      : undefined
                  }
                  onOpenLinkedChat={openLinkedChat}
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
                  worktrees={composerWorktrees}
                  selectedWorktreeId={selectedWorktree?.id}
                  onWorktreeChange={(id) => {
                    advanceChatView();
                    setSelectedWorktreeId(id);
                    saveChatPreferences(localStorage, project.path, { worktreePath: state.worktrees[id]?.path });
                  }}
                  isolation={isolation}
                  onIsolationChange={(next) => {
                    preparedTarget.current = null;
                    setIsolation(next);
                    saveChatPreferences(localStorage, project.path, { isolation: next });
                    setNewChatError(null);
                  }}
                  branches={branches}
                  baseBranch={effectiveBaseBranch}
                  onBaseBranchChange={(branch) => {
                    preparedTarget.current = null;
                    setBaseBranch(branch);
                    saveChatPreferences(localStorage, project.path, { baseBranch: branch });
                  }}
                  newChatError={newChatError}
                  findOpen={findOpen}
                  findSignal={findSignal}
                  findSeed={findSeed}
                  onFindClose={() => setFindOpen(false)}
                  notice={notice}
                  onDismissNotice={() => setNotice(null)}
                  approval={
                    pendingApproval ? (
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
                    ) : undefined
                  }
                />
              </EditorLinks>
            </div>
          </main>
          <ChangesPanelSlot open={changes.open}>
            <ChangesPanel
              list={changes.list}
              mode={changes.mode}
              onModeChange={changes.setMode}
              onRefresh={() => void changes.refresh()}
              onSelectFile={changes.selectFile}
              activePath={changes.activePath}
              commentCounts={diffComments.counts}
            />
          </ChangesPanelSlot>
        </div>
        {linkDialog}
        {commandPaletteOpen && (
          <CommandPalette
            commands={buildCommands(project)}
            searchMessages={(query) =>
              messageCommands(sidebarState?.messages ?? NO_MESSAGES, query, new Map(chats.map((chat) => [Number(chat.id), chat.label])), openMessage)
            }
            onClose={() => setCommandPaletteOpen(false)}
            onError={setNotice}
          />
        )}
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
      {quitError && (
        <dialog
          ref={(element) => {
            if (element && !element.open) element.showModal();
          }}
          onCancel={(event) => event.preventDefault()}
          className="fixed inset-0 m-0 h-screen w-screen max-w-none max-h-none items-center justify-center bg-black/40 backdrop-blur-overlay p-6 open:flex"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="save-failure-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-ink shadow-xl">
            <h2 id="save-failure-title" className="text-lg font-semibold">
              Chats could not be saved
            </h2>
            <p className="mt-3 text-sm">Keep Milagre open while you fix the storage problem, then retry saving.</p>
            <p className="mt-3 break-words text-sm text-ink-2">{quitError}</p>
            <button
              autoFocus
              className="mt-5 rounded-lg bg-ink px-4 py-2 text-sm text-surface"
              onClick={() => void window.milagre.retryQuit().catch((error) => setQuitError(ipcErrorMessage(error)))}
            >
              Retry saving and quit
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

export default function AppWithUpdates() {
  return (
    <UpdateShell>
      <App />
    </UpdateShell>
  );
}
