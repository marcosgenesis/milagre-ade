import { chatSummary } from "@milagre/shared/chat-summary";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Href } from "expo-router";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  FilterHorizontalIcon,
  FolderAddIcon,
  GitBranchIcon,
  LaptopIcon,
  Link04Icon,
  MoreHorizontalIcon,
  PinIcon,
  Search01Icon,
  Settings01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { chatMarkTone, chatPullRequests, comparePins, isListedChat, pendingChatSessionId, pullRequestRefs, withPendingChat } from "@milagre/shared/chats";
import { searchMessages } from "@milagre/shared/message-search";
import type { AgentSession, PullRequest } from "@milagre/shared/model";
import type { RegisteredProject } from "./client";
import { isLinkScopeKey } from "@milagre/shared/chat-scopes";
import { usePendingChats, useSession, type MobilePendingChat } from "./session";
import { chatMark, type ChatMark } from "./indicators";
import { ChatMarkIcon } from "./status-indicators";
import { Icon } from "./icons";
import { LoadingLogo } from "./loading-logo";
import { ErrorNotice, Field, IconButton, PullDown, colors, styles } from "./ui";
import { ProjectIcon, ProjectIcons } from "./project-icon";
import { ProjectSearch } from "./project-search";
import { chatMenu, runChatAction } from "./chat-actions";
import { confirm } from "./confirm-store";
import { ArchiveProgress } from "./archive-progress";
import { AttentionDot, useAttention } from "./attention";
import { projectOfKey } from "@milagre/shared/agent-runs";
import { useChatPullRequests } from "./use-chat-pull-requests";
import { ChatPullRequestChips } from "./chat-pull-request-chips";

type Destination = (href: Href, secondary?: boolean) => void;
type Row = { key: string; path: string } & (
  | { kind: "project"; name: string; expanded: boolean; members?: RegisteredProject[] }
  | { kind: "section"; name: string }
  | {
      kind: "chat";
      chat: AgentSession;
      worktree: string;
      mark: ChatMark;
      pending?: MobilePendingChat;
      prPath?: string;
      prRefs?: string[];
      pullRequests?: PullRequest[];
    }
  | { kind: "message"; chat: AgentSession; title: string; snippet: string; highlight: [number, number] }
  | { kind: "notice"; message: string; failed?: boolean }
);
type Show = "all" | "needs" | "running" | "archived";
const SHOW: [Show, string, string][] = [
  ["all", "All Chats", "bubble.left.and.bubble.right"],
  ["needs", "Needs me", "exclamationmark.bubble"],
  ["running", "Running", "play.circle"],
  ["archived", "Archived", "archivebox"],
];
const NEEDS: ChatMark[] = ["question", "waiting", "interrupted", "failed", "unread"];
const labels: Record<ChatMark, string> = {
  idle: "",
  running: "Running",
  question: "Needs reply",
  waiting: "Needs approval",
  interrupted: "Interrupted",
  failed: "Failed",
  unread: "Unread",
};

/** The same project tree is the first-run destination and the drawer over a Chat: every Project's Chats, their ⋯ actions and filters. */
type NavigationProps = { onNavigate: Destination; onClose?: () => void; activeChatId?: number };
export function ProjectNavigation(props: NavigationProps) {
  const { client } = useSession();
  // A computer's paths, errors and in-flight UI work never belong to another computer.
  return <ProjectNavigationContent key={client?.url || ""} {...props} />;
}

function ProjectNavigationContent({ onNavigate, onClose, activeChatId }: NavigationProps) {
  const session = useSession();
  const { pendingChats } = usePendingChats();
  const insets = useSafeAreaInsets();
  const attention = useAttention();
  const { reloadProjects, previewProject, cachedProject } = session;
  const currentPath = session.snapshot?.project.path;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([currentPath || session.recent[0]?.path].filter(Boolean) as string[]));
  // Snapshots live in the session, so closing the drawer or switching Projects keeps them.
  const [revision, setRevision] = useState(0);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [page, setPage] = useState<"add" | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState<Set<string>>(new Set());
  const archiveRequests = useRef(new Set<string>());
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  const pending = useRef(new Map<string, Promise<void>>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    void reloadProjects().catch((e) => setError(e.message));
  }, [reloadProjects]);
  const load = useCallback(
    (projectPath: string) => {
      const existing = pending.current.get(projectPath);
      if (existing) return existing;
      const work = previewProject(projectPath)
        .then(() => {
          if (!alive.current) return;
          setRevision((value) => value + 1);
          setFailures((previous) => {
            const next = { ...previous };
            delete next[projectPath];
            return next;
          });
        })
        .catch((e) => {
          if (alive.current) setFailures((previous) => ({ ...previous, [projectPath]: e.message }));
        })
        .finally(() => {
          pending.current.delete(projectPath);
        });
      pending.current.set(projectPath, work);
      return work;
    },
    [previewProject],
  );
  // A Project hidden in its settings stays out of the list, searches included; Links are always listed.
  const listed = useMemo(() => session.recent.filter((item) => !item.hidden), [session.recent]);
  // Searching or filtering reads every Project; ordinary browsing only reads expanded groups.
  const searching = !!query.trim() || show !== "all";
  useEffect(() => {
    const paths = listed.filter((item) => searching || expanded.has(item.path)).map((item) => item.path);
    // One slow Project must not hold up the other expanded groups.
    void Promise.all(paths.map(load));
  }, [expanded, searching, listed, load]);
  const rows = useMemo(() => {
    const result: Row[] = [];
    const needle = query.trim().toLowerCase();
    // Each Project's Chats under the current filter, for the message search below when no Chat title matches.
    const searchable: {
      path: string;
      messages: NonNullable<ReturnType<typeof cachedProject>>["project"]["state"]["messages"];
      chats: Map<number, AgentSession>;
    }[] = [];
    for (const project of listed) {
      const saved = project.path === currentPath && session.snapshot ? session.snapshot : cachedProject(project.path);
      const previews = Object.values(pendingChats).filter((item) => item.hostId === session.client?.url && item.projectPath === project.path);
      const projected = saved && previews.reduce((state, item) => withPendingChat(state, item.preview), saved.project.state);
      const copy = saved && projected ? { ...saved, project: { ...saved.project, state: projected } } : saved;
      const pendingById = new Map(
        previews.map((item) => [saved ? (pendingChatSessionId(saved.project.state, item.preview) ?? item.preview.session.id) : item.preview.session.id, item]),
      );
      const name = project.name || project.path.split("/").at(-1) || "Project";
      const open = searching || expanded.has(project.path);
      // Keep message lookup linear even in large Projects.
      const byChat = new Map<number, NonNullable<typeof copy>["project"]["state"]["messages"]>();
      for (const message of copy?.project.state.messages || []) {
        const list = byChat.get(message.session_id) || [];
        list.push(message);
        byChat.set(message.session_id, list);
      }
      const marked = Object.values(copy?.project.state.sessions || {}).map((chat) => {
        const run = copy?.runs.runs[`${copy.project.path}#${chat.id}`];
        const pending = pendingById.get(chat.id);
        const sortId =
          pending && !byChat.get(chat.id)?.some((message) => message.clientMessageId !== pending.preview.message.clientMessageId)
            ? pending.preview.sortId
            : chat.id;
        return { chat, run, pending, sortId, mark: pending && !pending.accepted ? ("running" as const) : chatMark(chat, run, byChat.get(chat.id) || []) };
      });
      // Like desktop's sidebar, a worktree's empty starter Chat stays out until it has a message or a turn is starting.
      const shown = marked
        .filter(({ chat, run }) => (show === "archived") === !!chat.archived && (run || isListedChat(chat, chatSummary(chat, byChat.get(chat.id)).count)))
        .filter(({ mark }) => show !== "needs" || NEEDS.includes(mark))
        .filter(({ mark }) => show !== "running" || mark === "running");
      if (needle && copy)
        searchable.push({
          path: project.path,
          messages: copy.project.state.messages,
          chats: new Map(shown.filter(({ pending }) => !pending).map(({ chat }) => [chat.id, chat])),
        });
      const chats = shown
        .filter(
          ({ chat }) =>
            !needle ||
            [name, chat.title, chat.generatedTitle, copy?.project.state.worktrees[chat.worktree_id]?.name].some((text) => text?.toLowerCase().includes(needle)),
        )
        // Pinned Chats first in their order, then the newest Chat first, by when it was created, so rows don't jump around as agents reply.
        .sort((a, b) => comparePins(a.chat, b.chat) || b.sortId - a.sortId);
      if (searching && copy && !chats.length && !(needle && name.toLowerCase().includes(needle)) && !failures[project.path]) continue;
      const section = project.link ? "Links" : "Projects";
      if (listed.some((item) => item.link) && !result.some((row) => row.kind === "section" && row.name === section))
        result.push({ key: `section:${section}`, path: "", kind: "section", name: section });
      result.push({ key: project.path, path: project.path, kind: "project", name, expanded: open, members: project.projects });
      if (!open) continue;
      for (const { chat, mark, pending } of chats)
        result.push({
          key: `${project.path}#${chat.id}`,
          path: project.path,
          kind: "chat",
          chat,
          pending,
          worktree: pending?.newWorktree ? "New worktree" : copy?.project.state.worktrees[chat.worktree_id]?.name || "Worktree",
          prPath: !pending && !copy?.project.link ? copy?.project.state.worktrees[chat.worktree_id]?.path : undefined,
          prRefs: chat.summary?.pullRequests ?? copy?.project.pullRequestRefs?.[chat.id] ?? pullRequestRefs(byChat.get(chat.id) || []),
          mark,
        });
      if (failures[project.path])
        result.push({
          key: `${project.path}:error`,
          path: project.path,
          kind: "notice",
          message: copy ? "Could not refresh chats. Tap to retry." : "Could not load chats. Tap to retry.",
          failed: true,
        });
      else if (!copy || !chats.length)
        result.push({
          key: `${project.path}:notice`,
          path: project.path,
          kind: "notice",
          message: !copy ? "Loading chats..." : searching ? "No matching chats" : "No chats yet. Start one with +.",
        });
    }
    // Nothing in a Chat title matched: search what was said in the Chats instead, at most three hits per Chat.
    if (needle && !result.some((row) => row.kind === "chat")) {
      const found: Row[] = [];
      for (const { path, messages, chats } of searchable) {
        const perChat = new Map<number, number>();
        for (const match of searchMessages(messages, needle, 200)) {
          const chat = chats.get(match.message.session_id);
          const count = perChat.get(match.message.session_id) ?? 0;
          if (!chat || count >= 3) continue;
          perChat.set(chat.id, count + 1);
          found.push({
            key: `${path}#${chat.id}:message:${match.message.id}`,
            path,
            kind: "message",
            chat,
            title: chat.title || chat.generatedTitle || "New Chat",
            snippet: match.snippet,
            highlight: match.highlight,
          });
        }
      }
      if (found.length) {
        result.push({ key: "section:Messages", path: "", kind: "section", name: "Messages" });
        result.push(...found.slice(0, 30));
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision invalidates rows after the session's preview cache changes.
  }, [revision, cachedProject, currentPath, expanded, failures, query, searching, show, listed, session.snapshot, session.client?.url, pendingChats]);

  const prTargets = useMemo(() => {
    const byPath = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.kind !== "chat" || !row.prPath) continue;
      const refs = byPath.get(row.prPath) || new Set<string>();
      for (const ref of row.prRefs || []) refs.add(ref);
      byPath.set(row.prPath, refs);
    }
    return [...byPath].map(([path, refs]) => ({ path, refs: [...refs] }));
  }, [rows]);
  const prStatus = useChatPullRequests(session.client, prTargets);
  const displayedRows = rows.map((row) => {
    if (row.kind !== "chat") return row;
    const status = row.prPath ? prStatus[row.prPath] : undefined;
    return { ...row, pullRequests: chatPullRequests(row.prRefs || [], status?.found || {}, status?.branch) };
  });

  // Choosing a Chat or a new Chat goes there at once; the Chat loads the Project behind the splash mark, so nothing
  // waits here.
  function select(projectPath: string, chatId?: number, pending?: MobilePendingChat) {
    if (busy || !session.client) return;
    const params = { projectPath, hostId: session.client.url };
    if (chatId === undefined) onNavigate({ pathname: "/chat", params });
    else if (projectPath === currentPath && chatId === activeChatId && onClose) onClose();
    else if (pending?.accepted && pending.preview.targetSessionId !== null)
      onNavigate({ pathname: "/chat", params: { ...params, id: String(pending.preview.targetSessionId) } });
    else if (pending)
      onNavigate({
        pathname: "/chat",
        params: { ...params, ...(pending.originSessionId !== null ? { id: String(pending.originSessionId) } : { worktreeId: String(pending.worktreeId) }) },
      });
    else onNavigate({ pathname: "/chat", params: { ...params, id: String(chatId) } });
  }
  // A Chat's ⋯ choice runs against its own Project's copy, which is reread afterwards. Archiving the Chat showing
  // behind the navigation leaves it for the project list.
  async function act(projectPath: string, chat: AgentSession, action: string) {
    const copy = projectPath === currentPath && session.snapshot ? session.snapshot : cachedProject(projectPath);
    if (!copy || !session.client) return;
    const archiveKey = `${projectPath}#${chat.id}`;
    if (archiveRequests.current.has(archiveKey)) return;
    if (action === "archive" && !chat.archived) archiveRequests.current.add(archiveKey);
    setError("");
    try {
      const result = await runChatAction({
        action,
        chat,
        running: !!copy.runs.runs[`${copy.project.path}#${chat.id}`],
        client: session.client,
        projectPath: copy.project.path,
        state: copy.project.state,
        link: copy.project.link,
        onConfirm: () => setArchiving((previous) => new Set(previous).add(archiveKey)),
        refresh: () => (projectPath === currentPath ? session.refresh() : load(projectPath)),
        expectActivity: session.expectActivity,
        notify: (message) => {
          if (alive.current) setError(message);
        },
      });
      if ((result === "hidden" || result === "removed") && projectPath === currentPath && chat.id === activeChatId) onNavigate("/projects");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      archiveRequests.current.delete(archiveKey);
      if (alive.current)
        setArchiving((previous) => {
          const next = new Set(previous);
          next.delete(archiveKey);
          return next;
        });
    }
  }
  // Removing a Project takes it off the recent list, as desktop does; its folder and Chats stay on the Mac.
  async function projectAction(projectPath: string, name: string, action: string) {
    if (action === "new") {
      select(projectPath);
      return;
    }
    if (isLinkScopeKey(projectPath)) {
      if (action === "copy") await Clipboard.setStringAsync(name);
      return;
    }
    if (action === "copy") {
      await Clipboard.setStringAsync(projectPath);
      return;
    }
    if (action !== "remove" || !session.client) return;
    const client = session.client;
    const confirmed = await confirm(
      `Remove ${name}?`,
      "It leaves this list on your phone and your Mac. The folder and its Chats stay on your computer; add it again to bring it back.",
      "Remove",
    );
    if (!confirmed) return;
    setError("");
    try {
      await client.call("project:forget", [projectPath]);
      await reloadProjects();
    } catch (e) {
      const message = (e as Error).message;
      if (alive.current) setError(/not available from mobile/i.test(message) ? "Update Milagre on your Mac to remove Projects from your phone." : message);
    }
  }
  // A typed path opens like any Project: the Chat loads it behind the splash mark and shows a wrong path with Retry.
  function addProject(projectPath: string) {
    if (busy || !session.client) return;
    setPage(null);
    onNavigate({ pathname: "/chat", params: { projectPath, hostId: session.client.url } });
  }
  async function switchComputer(id: string) {
    if (busy) return;
    if (id === "add") {
      onNavigate("/add-computer", true);
      return;
    }
    if (id === "manage") {
      session.cancelNavigation();
      onNavigate("/");
      return;
    }
    const host = session.hosts.find((item) => item.id === id);
    if (!host || host.address === session.client?.url) return;
    setBusy(true);
    setError("");
    try {
      if ((await session.connect(host)) && alive.current) onNavigate("/projects");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const footer = (
    <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add project"
        disabled={busy}
        onPress={() => setPage("add")}
        style={({ pressed }) => [s.footerAction, { opacity: pressed ? 0.55 : 1 }]}
      >
        <Icon icon={FolderAddIcon} tone="ink2" size={18} />
        <Text style={s.secondary}>Add project</Text>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <IconButton label="Link projects" icon={Link04Icon} size={44} disabled={busy} onPress={() => onNavigate("/link-projects", true)} />
        <IconButton label="Settings" icon={Settings01Icon} size={44} onPress={() => onNavigate("/settings", true)} />
      </View>
    </View>
  );
  if (page)
    return (
      <View style={styles.screen}>
        <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 4, flexDirection: "row", alignItems: "center", gap: 4 }}>
          <IconButton label="Back to Projects" icon={ArrowLeft01Icon} size={44} onPress={() => setPage(null)} />
          <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: colors.ink, fontSize: 17, fontWeight: "600" }}>
            Add project
          </Text>
          {onClose && <IconButton label="Close navigation" icon={Cancel01Icon} size={44} onPress={onClose} />}
        </View>
        <ProjectSearch onOpen={addProject} />
      </View>
    );
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, gap: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <PullDown
            label="Switch computer"
            title="Computers"
            style={{ flex: 1 }}
            sections={[
              {
                items: session.hosts.map((host) => ({
                  id: host.id,
                  title: host.name,
                  checked: host.address === session.client?.url,
                  systemImage: "laptopcomputer",
                  disabled: busy,
                })),
              },
              {
                items: [
                  { id: "add", title: "Add computer", systemImage: "plus", disabled: busy },
                  { id: "manage", title: "Manage computers", systemImage: "desktopcomputer", disabled: busy },
                ],
              },
            ]}
            onSelect={(id) => void switchComputer(id)}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}>
              <View style={s.computerIcon}>
                <Icon icon={LaptopIcon} tone="ink" size={21} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text numberOfLines={1} style={s.host}>
                  {session.hostName || "Computer"}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: session.error ? colors.orange : colors.green }} />
                  <Text style={s.detail}>{session.error ? "Connection interrupted" : "Connected"}</Text>
                </View>
              </View>
              <Icon icon={UnfoldMoreIcon} tone="ink3" size={15} />
            </View>
          </PullDown>
          {onClose && <IconButton label="Close navigation" icon={Cancel01Icon} size={44} onPress={onClose} />}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={[s.search, { flex: 1 }]}>
            <Icon icon={Search01Icon} tone="ink3" size={18} />
            <View style={{ flex: 1 }}>
              <Field
                label="Search chats"
                hideLabel
                placeholder="Search chats"
                value={query}
                onChangeText={setQuery}
                clearButtonMode="while-editing"
                style={{ backgroundColor: "transparent", paddingHorizontal: 0, paddingVertical: 8 }}
              />
            </View>
          </View>
          <PullDown
            label="Filter Chats"
            nativeTrigger={{ systemImage: show === "all" ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill" }}
            sections={[{ title: "Show", items: SHOW.map(([id, title, systemImage]) => ({ id, title, systemImage, checked: show === id })) }]}
            onSelect={(id) => setShow(id as Show)}
          >
            <View style={[s.filter, show !== "all" && { backgroundColor: colors.field }]}>
              <Icon icon={FilterHorizontalIcon} tone={show === "all" ? "ink2" : "ink"} size={19} />
            </View>
          </PullDown>
        </View>
        {busy && (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Opening..."
            accessibilityLiveRegion="polite"
            style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
          >
            <LoadingLogo size={22} />
            <Text style={s.secondary}>Opening...</Text>
          </View>
        )}
        {archiving.size > 0 && <ArchiveProgress />}
        {error ? <ErrorNotice message={error} /> : null}
      </View>
      <FlatList
        data={displayedRows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 20 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void reloadProjects()
                .then(() => Promise.all([...expanded].map(load)))
                .catch((e) => setError(e.message))
                .finally(() => setRefreshing(false));
            }}
          />
        }
        ListEmptyComponent={
          <Text style={[styles.muted, { padding: 20 }]}>
            {query.trim()
              ? "No chats match your search."
              : show !== "all"
                ? "No chats match this filter."
                : "Add a project from your computer to start a Chat."}
          </Text>
        }
        renderItem={({ item }) => {
          if (item.kind === "section")
            return <Text style={[s.detail, { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6, fontWeight: "500" }]}>{item.name}</Text>;
          if (item.kind === "project") {
            const linked = isLinkScopeKey(item.path);
            const menu = [
              {
                items: [
                  { id: "new", title: "New Chat", systemImage: "square.and.pencil" },
                  { id: "copy", title: linked ? "Copy Link name" : "Copy path", systemImage: "doc.on.doc" },
                ],
              },
              ...(!linked ? [{ items: [{ id: "remove", title: "Remove from list", systemImage: "minus.circle", destructive: true }] }] : []),
            ];
            const choose = (action: string) => void projectAction(item.path, item.name, action);
            // A tap folds the group; a long press opens the Project's menu.
            return (
              <View style={s.project}>
                <PullDown
                  label={`${item.expanded ? "Collapse" : "Expand"} ${item.name}`}
                  title={item.name}
                  sections={menu}
                  onSelect={choose}
                  onPress={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(item.path)) next.delete(item.path);
                      else next.add(item.path);
                      return next;
                    })
                  }
                  style={{ flex: 1 }}
                >
                  <View style={s.projectTitle}>
                    {item.members ? <ProjectIcons client={session.client} projects={item.members} /> : <ProjectIcon client={session.client} path={item.path} />}
                    <Text numberOfLines={1} style={[s.secondary, { flex: 1, fontWeight: "500", color: colors.ink }]}>
                      {item.name}
                    </Text>
                    {attention.some((key) => projectOfKey(key) === item.path) && <AttentionDot />}
                    <Icon icon={item.expanded ? ArrowDown01Icon : ArrowRight01Icon} tone="ink3" size={13} />
                  </View>
                </PullDown>
                <IconButton label={`New Chat in ${item.name}`} icon={Add01Icon} size={44} disabled={busy} onPress={() => select(item.path)} />
                <PullDown label={`Actions for ${item.name}`} title={item.name} sections={menu} onSelect={choose}>
                  <View style={{ width: 36, height: 44, alignItems: "center", justifyContent: "center" }}>
                    <Icon icon={MoreHorizontalIcon} tone="ink3" size={18} />
                  </View>
                </PullDown>
              </View>
            );
          }
          if (item.kind === "message") {
            const [start, end] = item.highlight;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.snippet}, in ${item.title}`}
                onPress={() => select(item.path, item.chat.id)}
                style={({ pressed }) => [s.chat, { backgroundColor: pressed ? colors.hover : "transparent" }]}
              >
                <View style={[s.chatBody, { flex: 1 }]}>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text numberOfLines={2} style={s.chatTitle}>
                      {item.snippet.slice(0, start)}
                      <Text style={{ fontWeight: "600" }}>{item.snippet.slice(start, end)}</Text>
                      {item.snippet.slice(end)}
                    </Text>
                    <Text numberOfLines={1} style={s.detail}>
                      {item.title}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          }
          if (item.kind === "notice")
            return (
              <Pressable accessibilityRole={item.failed ? "button" : "text"} disabled={!item.failed} onPress={() => void load(item.path)} style={s.notice}>
                <Text style={[s.detail, item.failed && { color: colors.red }]}>{item.message}</Text>
              </Pressable>
            );
          const title = item.chat.title || item.chat.generatedTitle || "New Chat";
          const selected = currentPath === item.path && activeChatId === item.chat.id;
          const tone = chatMarkTone(item.mark);
          const hasPullRequests = !!item.pullRequests?.length;
          const copy = item.path === currentPath && session.snapshot ? session.snapshot : cachedProject(item.path);
          const menu = chatMenu(
            item.chat,
            copy?.project.link ? { path: copy.project.state.worktrees[item.chat.worktree_id]?.path } : copy?.project.state.worktrees[item.chat.worktree_id],
          );
          // A tap opens the Chat and a long press opens its ⋯ menu, as on desktop's sidebar.
          return (
            <View style={[s.chat, { backgroundColor: selected ? colors.hover : "transparent" }]}>
              <View style={{ flex: 1 }}>
                <PullDown
                  label={`${title}${item.chat.pinned ? ", pinned" : ""}, ${item.worktree}${labels[item.mark] ? `, ${labels[item.mark]}` : ""}`}
                  title={title}
                  sections={item.pending ? [] : menu}
                  onSelect={(action) => {
                    if (!item.pending) void act(item.path, item.chat, action);
                  }}
                  onPress={() => select(item.path, item.chat.id, item.pending)}
                  style={{ flex: 1 }}
                >
                  <View style={[s.chatBody, hasPullRequests && { minHeight: 28, paddingTop: 6, paddingBottom: 0 }]}>
                    <ChatMarkIcon mark={item.mark} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text
                        numberOfLines={hasPullRequests ? 1 : 2}
                        style={[s.chatTitle, { color: item.chat.unread || selected ? colors.ink : colors.ink2, fontWeight: item.chat.unread ? "600" : "500" }]}
                      >
                        {title}
                      </Text>
                      {!hasPullRequests && (
                        <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
                          {item.chat.pinned && <Icon icon={PinIcon} tone="ink3" size={12} />}
                          {!copy?.project.link && <Icon icon={GitBranchIcon} tone="ink3" size={12} />}
                          <Text numberOfLines={1} style={[s.detail, { flexShrink: 1 }]}>
                            {copy?.project.link ? `Shared Chat · ${copy.project.link.projects.length} Projects` : item.worktree}
                          </Text>
                          {!!labels[item.mark] && (
                            <Text style={[s.detail, { color: tone === "accent" ? colors.accentInk : colors[tone] }]}>{labels[item.mark]}</Text>
                          )}
                        </View>
                      )}
                    </View>
                  </View>
                </PullDown>
                {hasPullRequests && (
                  <ChatPullRequestChips pullRequests={item.pullRequests || []}>
                    {item.chat.pinned && <Icon icon={PinIcon} tone="ink3" size={12} />}
                    {!!labels[item.mark] && (
                      <Text numberOfLines={1} style={[s.detail, { flexShrink: 1, color: tone === "accent" ? colors.accentInk : colors[tone] }]}>
                        {labels[item.mark]}
                      </Text>
                    )}
                  </ChatPullRequestChips>
                )}
              </View>
              {!item.pending && (
                <PullDown label={`Actions for ${title}`} title={title} sections={menu} onSelect={(action) => void act(item.path, item.chat, action)}>
                  <View style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}>
                    <Icon icon={MoreHorizontalIcon} tone="ink3" size={18} />
                  </View>
                </PullDown>
              )}
            </View>
          );
        }}
      />
      {footer}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  host: { color: colors.ink, fontSize: 17, fontWeight: "600" },
  secondary: { color: colors.ink2, fontSize: 15 },
  detail: { color: colors.ink2, fontSize: 12 },
  computerIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderCurve: "continuous",
    backgroundColor: colors.field,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderCurve: "continuous",
    backgroundColor: colors.field,
  },
  project: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  projectTitle: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8 },
  chat: { flexDirection: "row", alignItems: "center", marginVertical: 2, borderRadius: 8, borderCurve: "continuous" },
  chatBody: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingLeft: 12, paddingVertical: 8 },
  filter: { width: 44, height: 44, borderRadius: 10, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  chatTitle: { color: colors.ink, fontSize: 15, lineHeight: 20 },
  notice: { minHeight: 44, justifyContent: "center", paddingLeft: 42, paddingRight: 12 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  footerAction: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
});
