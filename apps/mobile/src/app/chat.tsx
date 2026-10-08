import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Reanimated from "react-native-reanimated";
import { Alert, Image, Keyboard, Linking, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { LiquidGlassView } from "@sbaiahmed1/react-native-blur";
import { Redirect, Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  File01Icon,
  GitBranchIcon,
  GitForkIcon,
  LaptopIcon,
  StopIcon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { sessionForWorktree } from "@milagre/shared/model";
import { createPendingChat, pendingChatSessionId } from "@milagre/shared/chats";
import { messageNavigationIndices } from "@milagre/shared/message-navigation";
import type { Client, OpenProject } from "../client";
import { lastUserModel } from "@milagre/shared/agent-runs";
import { blockerPrompt, pullRequestBlockers } from "@milagre/shared/pr-blockers";
import { useComposer, usePendingChats, useSession } from "../session";
import { pickAttachments } from "../attachment-picker";
import { appendAttachments, attachmentPrompt, prepareAttachments } from "../attachments";
import { PullRequestAction, SubagentChip, usePullRequest } from "../status-indicators";
import { SimulatorChip } from "../simulator";
import { PortsChip } from "../ports";
import { KeyboardChatScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { ChatReply } from "../chat-reply";
import { HandoffDivider } from "../handoff-divider";
import { showBrief } from "../handoff-brief-store";
import { isHandoff } from "@milagre/shared/handoff";
import { ThinkingIndicator } from "../running-logo";
import { BottomFade, EdgeFade } from "../bottom-fade";
import { useDotBackground } from "../dot-background";
import { Approval, Questions } from "../questions";
import { AgentControls, PermissionChip } from "../agent-controls";
import { modelsFor, selectedModel, sendOptions } from "../turn-options";
import { Icon } from "../icons";
import { PanelSwipe, useSidePanels } from "../side-panels";
import { LoadingLogo } from "../loading-logo";
import { ArchiveProgress } from "../archive-progress";
import { useOpenProject } from "../use-open-project";
import { ErrorNotice, GlassIconButton, IconButton, PageScroll, PillButton, PullDown, colors, styles } from "../ui";
import { PromptField } from "../prompt-field";
import { ContextRing } from "../context-ring";
import { hex } from "../theme";
import { archiveFromPhone } from "../archive";
import { confirmSheet } from "../confirm-store";
import { randomUUID } from "expo-crypto";
import { runChatAction } from "../chat-actions";
import { MessageNavigation } from "../message-navigation";
import { AttentionPill } from "../attention";

const PAGE = 40;

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id?: string; worktreeId?: string; projectPath?: string; hostId?: string }>();
  const session = useSession();
  const composer = useComposer();
  const pendingStore = usePendingChats();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const [actionBusy, setBusy] = useState(false);
  const sendingRef = useRef(false);
  const [picking, setPicking] = useState(false);
  const [dockHeight, setDockHeight] = useState(140);
  const [error, setError] = useState("");
  const [isolation, setIsolation] = useState<"local" | "worktree">("local");
  const [baseBranch, setBaseBranch] = useState("");
  const [branchList, setBranchList] = useState<{ client: Client; path: string; items: string[]; error?: string } | null>(null);
  // A failed send can retry in the checkout already created for this draft.
  const preparedTarget = useRef<{ client: Client; path: string; base: string; worktreeId: number; sessionId: number } | null>(null);
  const scroll = useRef<Reanimated.ScrollView>(null);
  const dots = useDotBackground();
  const following = useRef(true);
  const contentHeight = useRef(0);
  const scrollKey = `${params.hostId || session.client?.url}|${params.projectPath || session.snapshot?.project.path}|${params.id ?? `new:${params.worktreeId}`}`;
  const [jumpState, setJumpState] = useState({ key: scrollKey, visible: false });
  const showJumpToBottom = jumpState.key === scrollKey && jumpState.visible;
  const onEndVisible = useCallback(
    (visible: boolean) => {
      setJumpState((current) => (current.key === scrollKey && current.visible === !visible ? current : { key: scrollKey, visible: !visible }));
    },
    [scrollKey],
  );
  const jumpToBottom = useCallback(() => {
    following.current = true;
    scroll.current?.scrollToEnd({ animated: false });
    setJumpState({ key: scrollKey, visible: false });
  }, [scrollKey]);
  useEffect(() => {
    following.current = true;
    contentHeight.current = 0;
  }, [scrollKey]);
  // Short transcripts never auto-scroll: a scroll to the end while the keyboard is up would stay offset after it hides.
  const viewport = useRef(0);
  // A Chat opens already at its newest message: the transcript stays hidden until the first jump to the end.
  const [placedKey, setPlacedKey] = useState<string | null>(null);
  const placed = placedKey === scrollKey;
  const place = () => {
    if (placed || !viewport.current || !contentHeight.current) return;
    if (contentHeight.current > viewport.current) scroll.current?.scrollToEnd({ animated: false });
    setPlacedKey(scrollKey);
  };
  const worktreeOf =
    session.snapshot?.project.state.worktrees[
      (params.id ? session.snapshot.project.state.sessions[Number(params.id)]?.worktree_id : Number(params.worktreeId)) ?? -1
    ];
  const pr = usePullRequest(session.snapshot?.project.link ? undefined : worktreeOf);
  // Stable props keep each memoized ChatReply from re-rendering on every keystroke and poll tick.
  const connected = session.client;
  const projectPath = session.snapshot?.project.path;
  const targetMatches = (!params.projectPath || params.projectPath === projectPath) && (!params.hostId || params.hostId === connected?.url);
  const originChatId = `${projectPath}#${params.id ?? `new:${params.worktreeId}`}`;
  const pending = targetMatches
    ? Object.values(pendingStore.pendingChats).find(
        (item) =>
          item.hostId === connected?.url &&
          item.projectPath === projectPath &&
          (item.originChatId === originChatId || (!!params.id && item.preview.targetSessionId === Number(params.id))),
      )
    : undefined;
  const pendingCanonicalId = pending && session.snapshot ? pendingChatSessionId(session.snapshot.project.state, pending.preview) : null;
  const [archiving, setArchiving] = useState(false);
  const archiveRequest = useRef(false);
  const busy = actionBusy || !!pending || archiving;
  const focused = useRef<object | null>(null);
  useFocusEffect(
    useCallback(() => {
      focused.current = { client: connected, projectPath, id: params.id, worktreeId: params.worktreeId };
      return () => {
        focused.current = null;
      };
    }, [connected, projectPath, params.id, params.worktreeId]),
  );
  useEffect(() => {
    let cancelled = false;
    if (connected && projectPath && !session.snapshot?.project.link && !params.id)
      void connected
        .call<string[]>("project:branches", [projectPath])
        .then((items) => {
          if (!cancelled) setBranchList({ client: connected, path: projectPath, items });
        })
        .catch((error) => {
          if (!cancelled) setBranchList({ client: connected, path: projectPath, items: [], error: (error as Error).message });
        });
    return () => {
      cancelled = true;
    };
  }, [connected, projectPath, params.id, session.snapshot?.project.link]);
  // A screen reopened from the drawer adopts its own acknowledged Chat; the original async handler may be unfocused.
  const acceptedSessionId = pending?.accepted ? pending.preview.targetSessionId : null;
  const pendingKey = pending ? `${pending.hostId}|${pending.originChatId}` : null;
  const { setPendingChats } = pendingStore;
  useFocusEffect(
    useCallback(() => {
      if (acceptedSessionId === null || pending?.promoted || !pendingKey) return;
      router.setParams({ id: String(acceptedSessionId) });
      setPendingChats((current) => (current[pendingKey] ? { ...current, [pendingKey]: { ...current[pendingKey], promoted: true } } : current));
    }, [acceptedSessionId, pending?.promoted, pendingKey, setPendingChats]),
  );
  const allMessages = session.snapshot?.project.state.messages;
  const media = useCallback((path: string) => connected!.image(projectPath!, path), [connected, projectPath]);
  const savedMessages = useMemo(
    () => (params.id && allMessages ? allMessages.filter((m) => m.session_id === Number(params.id)) : []),
    [allMessages, params.id],
  );
  const messages = useMemo(
    () =>
      pending
        ? pendingCanonicalId !== null
          ? (allMessages || []).filter((message) => message.session_id === pendingCanonicalId)
          : [...savedMessages, pending.preview.message]
        : savedMessages,
    [pending, pendingCanonicalId, allMessages, savedMessages],
  );
  // Long Chats mount their newest messages first; earlier ones load on request.
  const [shown, setShown] = useState({ id: params.id, count: PAGE });
  const visible = shown.id === params.id ? shown.count : PAGE;
  const navigationItems = useMemo(
    () =>
      messageNavigationIndices(messages.length).map((index) => ({
        index,
        label: `Go to ${messages[index].role} message ${index + 1} of ${messages.length}. ${messages[index].body.slice(0, 88)}`,
      })),
    [messages],
  );
  const messagePositions = useRef(new Map<number, number>());
  const navigationTarget = useRef<number | null>(null);
  useEffect(() => {
    messagePositions.current.clear();
    navigationTarget.current = null;
  }, [params.id]);
  const navigateToMessage = (index: number) => {
    if (index === messages.length - 1) {
      navigationTarget.current = null;
      following.current = true;
      scroll.current?.scrollToEnd({ animated: true });
      return;
    }
    following.current = false;
    const id = messages[index].id;
    navigationTarget.current = id;
    if (index < messages.length - visible) {
      messagePositions.current.clear();
      setShown({ id: params.id, count: messages.length - index });
    } else {
      const y = messagePositions.current.get(id);
      if (y !== undefined) {
        navigationTarget.current = null;
        scroll.current?.scrollTo({ y: Math.max(0, y - insets.top - 72), animated: true });
      }
    }
  };
  const handoffModels = useMemo(() => [...modelsFor("claude", session.models), ...modelsFor("codex", session.models)], [session.models]);
  const openBrief = useCallback((brief: string) => {
    showBrief(brief);
    router.push("/handoff-brief");
  }, []);
  const openActivity = useCallback((message: string) => router.push({ pathname: "/activity", params: { id: String(params.id), message } }), [params.id]);
  const { rememberChat } = session;
  const canRemember = !!params.id && !!session.snapshot?.project.state.sessions[Number(params.id)] && targetMatches;
  useFocusEffect(
    useCallback(() => {
      if (canRemember) rememberChat(Number(params.id));
    }, [canRemember, params.id, rememberChat]),
  );
  const panels = useSidePanels({
    chatId: pending ? (pendingCanonicalId ?? pending.preview.session.id) : params.id ? Number(params.id) : undefined,
    worktreeId: targetMatches && worktreeOf ? worktreeOf.id : undefined,
  });
  // A Chat picked in another Project opens that Project here, behind the splash mark, rather than in the navigation.
  const { wanted, error: openError, retry: retryOpen } = useOpenProject(params);
  // A new Chat picked without a Worktree starts in the Project's own checkout once the Project is here.
  const loaded = targetMatches && !!session.snapshot;
  const needsWorktree = !params.id && !params.worktreeId;
  const candidates = loaded && needsWorktree ? Object.values(session.snapshot!.project.state.worktrees) : [];
  const starterId = (candidates.find((item) => item.path === projectPath) || candidates[0])?.id;
  useEffect(() => {
    if (!needsWorktree || !loaded) return;
    if (starterId === undefined) router.replace("/projects");
    else router.setParams({ worktreeId: String(starterId) });
  }, [needsWorktree, loaded, starterId]);
  const sidebar = (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button icon="sidebar.left" accessibilityLabel="Open navigation" onPress={() => panels.show("left")} />
    </Stack.Toolbar>
  );
  if (!session.client || (!session.snapshot && !wanted)) return <Redirect href="/" />;
  if (!session.snapshot || !targetMatches || needsWorktree) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "", headerBackVisible: false, gestureEnabled: false }} />
        {sidebar}
        <PanelSwipe panels={panels}>
          <View
            accessible={!openError}
            accessibilityRole="progressbar"
            accessibilityLabel="Opening Chat…"
            style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}
          >
            {openError ? <ErrorNotice message={openError} retry={retryOpen} retryTitle="Try again" /> : wanted || needsWorktree ? <LoadingLogo /> : null}
          </View>
        </PanelSwipe>
      </View>
    );
  }
  const client = session.client;
  const { project, runs } = session.snapshot;
  const chat = params.id ? project.state.sessions[Number(params.id)] : null;
  const chatId = `${project.path}#${params.id ?? `new:${params.worktreeId}`}`;
  const draft = composer.drafts[chatId] || "";
  const attachments = composer.attachments[chatId] || [];
  const attachmentDisabled = busy || picking || attachments.length >= 4;
  const run = chat ? runs.runs[chatId] : undefined;
  const contextUsage = run?.contextUsage ?? chat?.contextUsage;
  const preferences = composer.preferences[chatId] || composer.defaults;
  const actualProvider = composer.preferences[chatId]?.provider ?? chat?.provider ?? composer.defaults.provider;
  const model = selectedModel(actualProvider, preferences.model || (chat ? lastUserModel(project.state, chat.id) : ""), session.models);
  const worktreeId = chat?.worktree_id ?? Number(params.worktreeId);
  const worktree = project.state.worktrees[worktreeId];
  const branches = branchList?.client === client && branchList.path === project.path ? branchList : null;
  const base =
    baseBranch && branches?.items.includes(baseBranch)
      ? baseBranch
      : worktree?.name && branches?.items.includes(worktree.name)
        ? worktree.name
        : branches?.items[0] || "";
  const newWorktree = !project.link && !params.id && isolation === "worktree";
  const targetDisabled = busy || picking;
  const branchDisabled = targetDisabled || (newWorktree && !branches?.items.length);
  const branchName = newWorktree ? base || "Choose branch" : worktree?.name || "Choose branch";
  const unavailable = session.cliStatus?.[actualProvider]?.state !== undefined && session.cliStatus[actualProvider].state !== "ready";
  const title = chat?.title || chat?.generatedTitle || pending?.preview.session.title || "New Chat";
  async function action(work: () => Promise<unknown>, allowPending = false) {
    if (actionBusy || (!allowPending && pending)) return false;
    setBusy(true);
    setError("");
    try {
      await work();
      session.expectActivity();
      await session.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function pick(kind: "photos" | "camera" | "files") {
    if (attachmentDisabled) return;
    setPicking(true);
    setError("");
    try {
      const added = await pickAttachments(kind);
      const next = appendAttachments(attachments, added);
      composer.setAttachments((current) => ({ ...current, [chatId]: next }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPicking(false);
    }
  }
  async function send(body = draft, withAttachments = true) {
    if (busy || sendingRef.current || pending || picking || (!body && !(withAttachments && attachments.length))) return;
    sendingRef.current = true;
    setBusy(true);
    setError("");
    const sent = body;
    const sendingProjectPath = project.path;
    const sending = withAttachments ? attachments : [];
    const focus = focused.current;
    const current = () => focus !== null && focused.current === focus && session.isSelected();
    const clearsDraft = sent === draft;
    const key = `${client.url}|${chatId}`;
    const operationId = project.link ? composer.linkOperations.forSend(key, JSON.stringify([sent, sending.map((item) => item.id)]), randomUUID) : null;
    const preview = createPendingChat({
      state: project.state,
      worktreeId,
      sessionId: params.id ? Number(params.id) : null,
      body: sent,
      images: sending.flatMap((item) => (item.image ? [item.image] : [])),
      files: sending.filter((item) => !item.image).map((item) => item.path || item.name),
      model: model.id,
      provider: actualProvider,
    });
    pendingStore.setPendingChats((current) => ({
      ...current,
      [key]: {
        preview,
        hostId: client.url,
        projectPath: sendingProjectPath,
        originChatId: chatId,
        originSessionId: params.id ? Number(params.id) : null,
        worktreeId,
        newWorktree,
        accepted: false,
      },
    }));
    if (clearsDraft) composer.setDrafts((current) => ({ ...current, [chatId]: "" }));
    const sentIds = new Set(sending.map((item) => item.id));
    composer.setAttachments((current) => ({ ...current, [chatId]: (current[chatId] || []).filter((item) => !sentIds.has(item.id)) }));
    following.current = true;
    Keyboard.dismiss();
    const options = sendOptions(model, preferences);
    let accepted = false;
    try {
      const media = await prepareAttachments(client, sendingProjectPath, sending);
      let target = { sessionId: params.id ? Number(params.id) : (null as number | null), worktreeId };
      if (newWorktree) {
        if (!base) throw new Error(branches?.error || "Choose a base branch before sending.");
        let ready = preparedTarget.current;
        if (!ready || ready.client !== client || ready.path !== sendingProjectPath || ready.base !== base) {
          const created = await client.call<{ project: OpenProject; worktreeId: number }>("worktree:create", [
            { projectPath: sendingProjectPath, baseBranch: base, prompt: sent },
          ]);
          const chat = sessionForWorktree(created.project.state, created.worktreeId);
          if (!chat) throw new Error("No Chat was created for the new worktree.");
          ready = { client, path: sendingProjectPath, base, worktreeId: created.worktreeId, sessionId: chat.id };
          preparedTarget.current = ready;
        }
        target = { sessionId: ready.sessionId, worktreeId: ready.worktreeId };
      }
      pendingStore.setPendingChats((current) =>
        current[key] ? { ...current, [key]: { ...current[key], preview: { ...current[key].preview, targetSessionId: target.sessionId } } } : current,
      );
      const result = project.link
        ? await client.call<{ sessionId: number }>("link:send", [
            {
              linkId: project.link.link.id,
              sessionId: params.id ? Number(params.id) : null,
              operationId,
              clientMessageId: preview.message.clientMessageId,
              body: sent,
              ...media,
              prompt: attachmentPrompt(sent, media.files),
              ...options,
            },
          ])
        : await client.call<{ sessionId: number }>("chat:send", [
            {
              projectPath: sendingProjectPath,
              ...target,
              clientMessageId: preview.message.clientMessageId,
              body: sent,
              ...media,
              prompt: attachmentPrompt(sent, media.files),
              ...options,
            },
          ]);
      accepted = true;
      if (operationId) composer.linkOperations.accepted(key, operationId);
      const promote = current();
      pendingStore.setPendingChats((current) =>
        current[key]
          ? {
              ...current,
              [key]: {
                ...current[key],
                accepted: true,
                promoted: promote,
                preview: { ...current[key].preview, targetSessionId: result.sessionId, acceptedSessionId: result.sessionId },
              },
            }
          : current,
      );
      const destination = `${sendingProjectPath}#${result.sessionId}`;
      if (clearsDraft || destination !== chatId)
        composer.setDrafts((current) => {
          const remaining = current[chatId] || "";
          const preserved = destination !== chatId ? current[destination] || "" : "";
          const next = { ...current, [destination]: [preserved, remaining].filter(Boolean).join("\n") };
          if (destination !== chatId) delete next[chatId];
          return next;
        });
      composer.setAttachments((current) => {
        const sentIds = new Set(sending.map((item) => item.id));
        const remaining = (current[chatId] || []).filter((item) => !sentIds.has(item.id));
        const preserved = destination !== chatId ? current[destination] || [] : [];
        const next = { ...current, [destination]: [...preserved, ...remaining] };
        if (destination !== chatId) delete next[chatId];
        return next;
      });
      composer.setPreferences((current) => {
        const next = { ...current, [destination]: { ...(current[chatId] || preferences), provider: actualProvider, model: model.id } };
        if (destination !== chatId) delete next[chatId];
        return next;
      });
      session.expectActivity();
      if (current()) {
        following.current = true;
        Keyboard.dismiss();
        if (!params.id) router.setParams({ id: String(result.sessionId) });
      }
      await session.refresh();
    } catch (e) {
      if (!accepted) {
        pendingStore.setPendingChats((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        if (clearsDraft) composer.setDrafts((current) => ({ ...current, [chatId]: [draft, current[chatId]].filter(Boolean).join("\n\n") }));
        composer.setAttachments((current) => ({
          ...current,
          [chatId]: [...sending, ...(current[chatId] || []).filter((item) => !sending.some((sent) => sent.id === item.id))],
        }));
      }
      if (current()) setError((e as Error).message);
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  }
  function headerAction(id: string) {
    if (id === "changes") panels.show("right");
    // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with -- pr comes unvalidated from the host's JSON response, so pr.url may be missing and startsWith would throw
    else if (id === "pr" && pr && /^https:\/\//.test(pr.url)) void Linking.openURL(pr.url).catch(() => {});
    else if (id === "agents" && chat) router.push({ pathname: "/agents", params: { id: String(chat.id) } });
    else if (id === "rename" && chat)
      Alert.prompt(
        "Rename Chat",
        undefined,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save",
            onPress: (value?: string) => {
              if (value?.trim()) void action(() => client.call("chat:patch", [project.path, chat.id, { title: value.trim() }]));
            },
          },
        ],
        "plain-text",
        title,
      );
    else if (id === "archive" && chat?.archived) void action(() => client.call("chat:patch", [project.path, chat.id, { archived: false }]));
    else if (id === "archive" && chat) void archive(chat);
  }
  // Archive asks first, as desktop does, with what removing the worktree would lose; a running turn is stopped. The
  // Chat is left once it is archived; one whose worktree stayed is brought back, and the notice shows here.
  async function archive(target: NonNullable<typeof chat>) {
    if (busy || archiveRequest.current) return;
    archiveRequest.current = true;
    const onConfirm = () => {
      setArchiving(true);
      session.expectActivity();
    };
    setError("");
    try {
      if (project.link) {
        const result = await runChatAction({
          action: "archive",
          client,
          projectPath: project.path,
          state: project.state,
          link: project.link,
          chat: target,
          running: !!run,
          onConfirm: () => setArchiving(true),
          expectActivity: session.expectActivity,
          refresh: session.refresh,
          notify: setError,
        });
        if (result === "hidden") router.replace("/projects");
        return;
      }
      const result = await archiveFromPhone({
        client,
        alert: confirmSheet,
        projectPath: project.path,
        state: project.state,
        chat: target,
        running: !!run,
        onConfirm,
        notify: setError,
        refresh: session.refresh,
      });
      if (result === "hidden" || result === "removed") router.replace("/projects");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      archiveRequest.current = false;
      setArchiving(false);
    }
  }
  const blockers = pullRequestBlockers(pr);
  const agents = (chat?.subagents || []).filter((agent) => !agent.archived);
  const diff = worktree?.diff;
  const header = archiving ? (
    <ArchiveProgress />
  ) : (
    <>
      <View style={{ alignItems: "center", maxWidth: 230 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 16, fontWeight: "600", flexShrink: 1 }}>
            {title}
          </Text>
        </View>
        {!project.link && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, opacity: worktree ? 1 : 0 }}>
            <Icon icon={GitBranchIcon} tone="ink3" size={11} />
            <Text numberOfLines={1} style={{ color: colors.ink2, fontSize: 12, flexShrink: 1 }}>
              {worktree?.name ?? ""}
            </Text>
            <Text style={{ fontSize: 12 }}>
              <Text style={{ color: colors.green }}>{diff && (diff.added > 0 || diff.removed > 0) ? `+${diff.added}` : ""}</Text>
              {diff && (diff.added > 0 || diff.removed > 0) ? " " : ""}
              <Text style={{ color: colors.red }}>{diff && (diff.added > 0 || diff.removed > 0) ? `−${diff.removed}` : ""}</Text>
            </Text>
          </View>
        )}
      </View>
    </>
  );
  const more = (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Chat actions">
        <Stack.Toolbar.MenuAction
          icon="doc.text.magnifyingglass"
          subtitle={diff ? `+${diff.added} −${diff.removed}` : undefined}
          onPress={() => headerAction("changes")}
        >
          View changes
        </Stack.Toolbar.MenuAction>
        {pr && (
          <Stack.Toolbar.MenuAction
            icon="arrow.triangle.pull"
            subtitle={blockers.length ? blockers.join(", ").replace(/-/g, " ") : pr.state === "MERGED" ? "Merged" : "Open on GitHub"}
            onPress={() => headerAction("pr")}
          >{`Pull request #${pr.number}`}</Stack.Toolbar.MenuAction>
        )}
        {agents.length > 0 && (
          <Stack.Toolbar.MenuAction icon="person.2" subtitle={String(agents.length)} onPress={() => headerAction("agents")}>
            Subagents
          </Stack.Toolbar.MenuAction>
        )}
        {chat && (
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.MenuAction icon="pencil" onPress={() => headerAction("rename")}>
              Rename
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon={chat.archived ? "tray.and.arrow.up" : "archivebox"} disabled={busy} onPress={() => headerAction("archive")}>
              {chat.archived ? "Restore" : "Archive"}
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        )}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
  const question = run?.questions[0];
  const pendingInput = pending && pendingCanonicalId === null ? pending.preview.message : null;
  const liveReply = run ? <ChatReply key="run" run={run} media={media} basePath={worktree?.path || project.path} onActivity={openActivity} /> : null;
  // The composer floats above the transcript and rides the keyboard, stopping 8pt above it.
  const dockPadding = Math.max(insets.bottom, 12);
  const lift = dockPadding - 8;
  return (
    <View style={[styles.screen, dots]}>
      <Stack.Screen options={{ title, headerTitle: () => header, headerBackVisible: false, gestureEnabled: false }} />
      {sidebar}
      {more}
      <PanelSwipe panels={panels}>
        {/* The header clearance is in paddingTop; an automatic iOS inset would add it a second time. */}
        <KeyboardChatScrollView
          key={scrollKey}
          ref={scroll}
          offset={lift}
          keyboardLiftBehavior="whenAtEnd"
          onEndVisible={onEndVisible}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 84, paddingLeft: 28, gap: 16, paddingBottom: dockHeight + 16 }]}
          scrollEventThrottle={32}
          onScroll={({ nativeEvent: e }) => {
            following.current = e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < 120;
          }}
          style={{ opacity: placed ? 1 : 0 }}
          onLayout={({ nativeEvent }) => {
            viewport.current = nativeEvent.layout.height;
            place();
          }}
          onContentSizeChange={(_, height) => {
            contentHeight.current = height;
            if (!placed) place();
            else if (following.current && height > viewport.current) scroll.current?.scrollToEnd({ animated: true });
          }}
        >
          {process.env.EXPO_PUBLIC_DEMO === "1" && <Text style={styles.caption}>Demo agent. Send tools, approval, question, or slow to try the controls.</Text>}
          {session.providerError ? <Text style={styles.caption}>{session.providerError}</Text> : null}
          {chat?.archived && (
            <View style={styles.card}>
              <Text style={styles.muted}>This Chat is archived. Restore it to send a message.</Text>
              <PillButton
                title="Restore Chat"
                disabled={busy}
                onPress={() => void action(() => client.call("chat:patch", [project.path, chat.id, { archived: false }]))}
                style={{ alignSelf: "flex-start" }}
              />
            </View>
          )}
          {!messages.length && !run && (
            <View style={{ paddingVertical: 48, alignItems: "center", gap: 8 }}>
              <Text style={styles.subtitle}>What are we working on?</Text>
              <Text style={[styles.muted, { textAlign: "center" }]}>
                {project.link
                  ? "One Chat, with a new Worktree in each linked Project on your computer."
                  : newWorktree
                    ? `Your agent starts in a new worktree from ${base || "the selected branch"} on your computer.`
                    : `Your agent runs in ${worktree?.name || "this Worktree"} on your computer.`}
              </Text>
            </View>
          )}
          {newWorktree && branches?.error ? <ErrorNotice message={branches.error} /> : null}
          {messages.length > visible && (
            <PillButton
              title={`Show earlier messages (${messages.length - visible})`}
              secondary
              onPress={() => {
                following.current = false;
                setShown({ id: params.id, count: visible + PAGE });
              }}
              style={{ alignSelf: "center" }}
            />
          )}
          {messages.slice(-visible).flatMap((message) => [
            ...(liveReply && message === pendingInput ? [liveReply] : []),
            <View
              key={message.clientMessageId ?? message.id}
              nativeID={`chat-message-${message.id}`}
              onLayout={({ nativeEvent: { layout } }) => {
                messagePositions.current.set(message.id, layout.y);
                if (navigationTarget.current === message.id) {
                  navigationTarget.current = null;
                  scroll.current?.scrollTo({ y: Math.max(0, layout.y - insets.top - 72), animated: true });
                }
              }}
            >
              {isHandoff(message) ? (
                <HandoffDivider context={message.context} models={handoffModels} onOpen={openBrief} />
              ) : (
                <ChatReply message={message} media={media} basePath={worktree?.path || project.path} onActivity={openActivity} />
              )}
            </View>,
          ])}
          {!pendingInput && liveReply}
          {(run || pending) && (
            <ThinkingIndicator
              startedAt={pending?.preview.startedAt ?? run?.startedAt}
              label={run?.waitingForSubagents ? "Waiting on subagents" : `Working with ${model.name}`}
            />
          )}
          {chat?.resumeTurn && !run && (
            <PillButton
              title="Continue interrupted turn"
              secondary
              disabled={busy}
              onPress={() => void action(() => client.call("chat:resume", [project.path, chat.id]))}
              style={{ alignSelf: "flex-start" }}
            />
          )}
          {error ? <ErrorNotice message={error} /> : null}
          {session.error ? <ErrorNotice message={session.error} retry={() => router.dismissTo("/")} /> : null}
        </KeyboardChatScrollView>
        {/* The transcript blurs and fades under the transparent header, as under the composer. iOS's own soft edge can't
        find this scroll view (it only follows each view's first child), so the blur is drawn here. It ends where the
        transcript's top padding does and gradually strengthens toward the status bar. */}
        <EdgeFade edge="top" height={insets.top + 84} />
        <AttentionPill projectPath={project.path} />
        <MessageNavigation items={navigationItems} onSelect={navigateToMessage} top={insets.top + 72} bottom={dockHeight + 12} keyboardOffset={lift} />
        <KeyboardStickyView pointerEvents="box-none" offset={{ closed: 0, opened: lift }} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
          {showJumpToBottom && (
            <View pointerEvents="box-none" style={{ height: 56, alignItems: "center", zIndex: 1 }}>
              <GlassIconButton label="Go to bottom" systemImage="chevron.down" icon={ArrowDown01Icon} onPress={jumpToBottom} />
            </View>
          )}
          {/* The transcript blurs and fades under the composer like desktop's. */}
          <BottomFade height={dockHeight + 48} />
          <View
            onLayout={({ nativeEvent }) => setDockHeight(Math.round(nativeEvent.layout.height))}
            style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: dockPadding, gap: 8 }}
          >
            {!question && (
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4, gap: 8 }}>
                {pr && blockers.length > 0 && chat && (
                  <PullRequestAction pr={pr} disabled={busy || !!run} onRun={() => void send(blockerPrompt(blockers[0], pr), false)} />
                )}
                <View style={{ flex: 1 }} />
                {params.id && Number(params.id) > 0 && <PortsChip key={`ports-${chatId}`} chatId={chatId} />}
                {params.id && Number(params.id) > 0 && <SimulatorChip key={chatId} chatId={chatId} />}
                {agents.length > 0 && <SubagentChip agents={agents} onPress={() => headerAction("agents")} />}
              </View>
            )}
            {run?.approvals.map((approval) => (
              <Approval
                key={approval.requestId}
                approval={approval}
                busy={actionBusy}
                respond={(decision) =>
                  void action(async () => {
                    const accepted = await client.call("agent:respond-permission", [{ chatId, requestId: approval.requestId, decision }]);
                    if (!accepted) throw new Error("This approval is no longer pending. Refresh the Chat.");
                  }, true)
                }
              />
            ))}
            {question ? (
              <Questions
                key={question.requestId}
                request={question}
                busy={actionBusy}
                submit={(answers, summary) =>
                  void action(async () => {
                    const accepted = await client.call("agent:answer-question", [{ chatId, requestId: question.requestId, answers, summary }]);
                    if (!accepted) throw new Error("This question is no longer pending. Refresh the Chat.");
                  }, true)
                }
              />
            ) : (
              <View
                style={{
                  backgroundColor: "transparent",
                  borderWidth: 1,
                  borderColor: colors.lineStrong,
                  borderRadius: 24,
                  borderCurve: "continuous",
                  overflow: "hidden",
                  paddingTop: 8,
                  paddingHorizontal: 8,
                  paddingBottom: 6,
                  gap: 4,
                  boxShadow: "0 4px 20px #0000000f",
                }}
              >
                <LiquidGlassView
                  pointerEvents="none"
                  glassType="clear"
                  isInteractive={false}
                  reducedTransparencyFallbackColor={hex(scheme).surface}
                  style={[StyleSheet.absoluteFill, { borderRadius: 24, borderCurve: "continuous" }]}
                />
                {!params.id && !project.link && (
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                    <PullDown
                      label="Choose isolation"
                      nativeTrigger={{
                        title: isolation === "local" ? "Local" : "New worktree",
                        systemImage: isolation === "local" ? "laptopcomputer" : "arrow.triangle.branch",
                        disabled: targetDisabled,
                      }}
                      sections={[
                        {
                          title: "Isolation",
                          items: [
                            { id: "local", title: "Local", systemImage: "laptopcomputer", checked: isolation === "local", disabled: targetDisabled },
                            {
                              id: "worktree",
                              title: "New worktree",
                              systemImage: "arrow.triangle.branch",
                              checked: isolation === "worktree",
                              disabled: targetDisabled,
                            },
                          ],
                        },
                      ]}
                      onSelect={(id) => {
                        if (!targetDisabled) setIsolation(id === "worktree" ? "worktree" : "local");
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          opacity: targetDisabled ? 0.35 : 1,
                        }}
                      >
                        <Icon icon={isolation === "local" ? LaptopIcon : GitForkIcon} tone="ink2" size={14} />
                        <Text style={styles.label}>{isolation === "local" ? "Local" : "New worktree"}</Text>
                        <Icon icon={UnfoldMoreIcon} tone="ink3" size={13} />
                      </View>
                    </PullDown>
                    <PullDown
                      label="Choose branch"
                      nativeTrigger={{ title: branchName, systemImage: "arrow.triangle.branch", disabled: branchDisabled, maxWidth: 180 }}
                      sections={[
                        {
                          title: newWorktree ? "Branch from" : "Choose a branch",
                          items: newWorktree
                            ? (branches?.items || []).map((item) => ({
                                id: item,
                                title: item,
                                checked: item === base,
                                systemImage: "arrow.triangle.branch",
                                disabled: branchDisabled,
                              }))
                            : Object.values(project.state.worktrees).map((item) => ({
                                id: String(item.id),
                                title: item.name,
                                checked: item.id === worktreeId,
                                systemImage: "arrow.triangle.branch",
                                disabled: targetDisabled,
                              })),
                        },
                      ]}
                      onSelect={(id) => {
                        if (!branchDisabled) {
                          if (newWorktree) setBaseBranch(id);
                          else router.setParams({ worktreeId: id });
                        }
                      }}
                    >
                      <View
                        style={{
                          maxWidth: 180,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          opacity: branchDisabled ? 0.35 : 1,
                        }}
                      >
                        <Icon icon={GitBranchIcon} tone="ink2" size={14} />
                        <Text numberOfLines={1} style={[styles.label, { flexShrink: 1 }]}>
                          {branchName}
                        </Text>
                        <Icon icon={UnfoldMoreIcon} tone="ink3" size={13} />
                      </View>
                    </PullDown>
                  </View>
                )}
                {!!attachments.length && (
                  <PageScroll horizontal contentContainerStyle={{ padding: 4, paddingBottom: 4, gap: 8 }}>
                    {attachments.map((item) => (
                      <View
                        key={item.id}
                        style={{
                          backgroundColor: colors.field,
                          borderRadius: 12,
                          borderCurve: "continuous",
                          paddingLeft: item.image ? 4 : 10,
                          flexDirection: "row",
                          alignItems: "center",
                          maxWidth: 220,
                        }}
                      >
                        {item.image ? (
                          <Image source={{ uri: item.uri }} accessibilityLabel={item.name} style={{ width: 44, height: 44, borderRadius: 8 }} />
                        ) : (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Preview ${item.name}`}
                            onPress={() =>
                              router.push({ pathname: "/file-preview", params: item.path ? { path: item.path } : { uri: item.uri, name: item.name } })
                            }
                            style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}
                          >
                            <Icon icon={File01Icon} tone="ink2" size={18} />
                            <Text numberOfLines={1} style={[styles.label, { flexShrink: 1, paddingLeft: 6 }]}>
                              {item.name}
                            </Text>
                          </Pressable>
                        )}
                        {item.image && (
                          <Text numberOfLines={1} style={[styles.label, { flexShrink: 1, paddingLeft: 6 }]}>
                            {item.name}
                          </Text>
                        )}
                        <IconButton
                          label={`Remove ${item.name}`}
                          icon={Cancel01Icon}
                          size={32}
                          disabled={busy || picking}
                          onPress={() =>
                            composer.setAttachments((current) => ({
                              ...current,
                              [chatId]: (current[chatId] || []).filter((attachment) => attachment.id !== item.id),
                            }))
                          }
                        />
                      </View>
                    ))}
                  </PageScroll>
                )}
                <PromptField
                  key={chatId}
                  client={client}
                  projectPath={worktree?.path || (project.link ? "" : project.path)}
                  draft={draft}
                  onChangeText={(value) => composer.setDrafts((current) => ({ ...current, [chatId]: value }))}
                />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <PullDown
                    label="Add photos or files"
                    nativeTrigger={{ systemImage: "plus", disabled: attachmentDisabled }}
                    sections={[
                      {
                        items: [
                          { id: "photos", title: "Photo Library", systemImage: "photo.on.rectangle", disabled: attachmentDisabled },
                          { id: "camera", title: "Take Photo", systemImage: "camera", disabled: attachmentDisabled },
                          { id: "files", title: "Choose Files", systemImage: "folder", disabled: attachmentDisabled },
                        ],
                      },
                    ]}
                    onSelect={(kind) => void pick(kind as "photos" | "camera" | "files")}
                  >
                    <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center", opacity: attachmentDisabled ? 0.35 : 1 }}>
                      <Icon icon={Add01Icon} tone="ink2" size={21} />
                    </View>
                  </PullDown>
                  <AgentControls
                    model={model}
                    onToggle={() => {
                      router.push({
                        pathname: "/model-sheet",
                        params: { chatId, model: model.id, provider: actualProvider, ...(run ? { busy: "1" } : {}) },
                      });
                    }}
                  />
                  <PermissionChip
                    mode={preferences.permissionMode}
                    onPress={() => router.push({ pathname: "/permission-sheet", params: { chatId, ...(run ? { busy: "1" } : {}) } })}
                  />
                  <View style={{ flex: 1 }} />
                  {contextUsage && contextUsage.size > 0 && <ContextRing {...contextUsage} />}
                  {run && !draft.trim() && !attachments.length && (
                    <IconButton
                      label="Stop"
                      icon={StopIcon}
                      filled
                      size={34}
                      disabled={actionBusy}
                      onPress={() => void action(() => client.call("agent:interrupt", [chatId]), true)}
                    />
                  )}
                  {(!run || !!draft.trim() || !!attachments.length) && (
                    <IconButton
                      label={busy ? "Sending..." : run ? "Send follow-up" : "Send message"}
                      icon={ArrowUp01Icon}
                      filled
                      size={34}
                      loading={busy}
                      disabled={
                        busy ||
                        picking ||
                        (newWorktree && !base) ||
                        (!draft.trim() && !attachments.length) ||
                        !!session.error ||
                        !!chat?.archived ||
                        unavailable
                      }
                      onPress={() => void send()}
                    />
                  )}
                </View>
              </View>
            )}
          </View>
        </KeyboardStickyView>
      </PanelSwipe>
    </View>
  );
}
