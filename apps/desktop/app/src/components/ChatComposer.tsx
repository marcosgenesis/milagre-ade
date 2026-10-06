import { providerName } from "@milagre/shared/providers";
import { SubagentTrack } from "./agents/SubagentTrack";
import { SimulatorTrack } from "./agents/SimulatorTrack";
import { SubagentCanvas } from "./agents/SubagentCanvas";
import type { AgentPort, AgentTask, Subagent } from "../model";
import { PortTrack } from "./agents/PortTrack";
import { TaskTrack } from "./agents/TaskTrack";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, DragEvent, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AiBrowserIcon,
  AiChat01Icon,
  ArrowDown01Icon,
  Attachment01Icon,
  CommandIcon,
  GitBranchIcon,
  GitForkIcon,
  GitPullRequestIcon,
  LaptopIcon,
} from "@hugeicons/core-free-icons";
import type { AgentCliStatus, EffortLevel, ModelCapability, AgentSession, ChatMessage as AppChatMessage, ChatStep, Isolation, ModelOption, ModelProvider, PermissionMode } from "../model";
import { FindBar } from "./FindBar";
import { Notice } from "./Notice";
import { Attachments } from "./Attachments";
import type { ImageDraft } from "./usePastedImages";
import { PromptComposer } from "./PromptComposer";
import { PickerPanel, PickerRow } from "./primitives/Picker";
import Tooltip from "./primitives/Tooltip";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { HandoverBriefChip, HandoverFromLabel, HandoverLinkBar, HandoverNote } from "./Handover";
import { LinkedMessageHeader, linkedContext } from "./LinkedMessage";
import { otherProvider, type HandoverLinks } from "../lib/handover";
import { MessageScroller } from "./agents/message-scroller";
import { RecommendationCard } from "./agents/recommendation-card";
import { parseRecommendation } from "../lib/recommendation";
import { StepRow } from "./agents/StepRow";
import { ActivityBlock } from "./agents/ActivityBlock";
import { GeneratedImage } from "./agents/GeneratedImage";
import { Markdown, StreamingMarkdown } from "./markdown/Markdown";
import { replyActivity, unspokenThought } from "../lib/reply-parts";
import { extractOutdatedProvider } from "../lib/cli-status";
import { splitFences } from "../lib/message-fences";
import { CodeBlock } from "./markdown/CodeBlock";
import { useDismiss } from "../lib/use-dismiss";

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

function Icon({ icon, size = 16 }: { icon: IconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

/**
 * A reply: its activity (thinking, tool steps and the text between them) folded into one block, the images it generated, then its answer.
 * A reply with no answer that ended or stopped to ask shows its last thinking instead, dimmed.
 */
/** What the user typed, as typed; only closed ``` fences render as code (diff comments send their snippets in them). */
function UserBody({ body }: { body: string }) {
  const parts = useMemo(() => splitFences(body), [body]);
  return (
    <div className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
      {parts.map((part, index) => part.kind === "text"
        ? <Fragment key={index}>{part.text}</Fragment>
        : <div key={index} className="whitespace-normal"><CodeBlock code={part.code} fence={part.fence || undefined} diff /></div>)}
    </div>
  );
}

function ReplyContent({ body, steps, streaming, asking = false, waitingStepIds }: { body: string; steps: ChatStep[]; streaming: boolean; asking?: boolean; waitingStepIds: string[] }) {
  const { setup, activity, images, answer } = replyActivity(body, steps);
  const thought = !streaming || asking ? unspokenThought(activity, answer) : "";
  return (
    <>
      {setup.map((step) => <StepRow key={step.id} step={step} />)}
      <ActivityBlock entries={activity} streaming={streaming} waitingStepIds={waitingStepIds} />
      {images.map((step) => <GeneratedImage key={step.id} step={step} />)}
      {answer.trim() && <div data-slot="message-content">{streaming ? <StreamingMarkdown text={answer} /> : <Markdown text={answer} />}</div>}
      {thought && <div data-slot="message-thought" className="text-ink-2"><Markdown text={thought} /></div>}
    </>
  );
}

const MessageSection = memo(function MessageSection({
  message,
  isUser,
  onRecommendationSelect,
  onUpdateCli,
  updatingCli,
  cliStatus,
  streaming = false,
  asking = false,
  waitingStepIds = [],
  animate = false,
  onOpenChat,
}: {
  message: AppChatMessage;
  isUser: boolean;
  onRecommendationSelect: (option: string) => void;
  onUpdateCli?: (provider: ModelProvider) => void;
  updatingCli?: ModelProvider | null;
  cliStatus?: AgentCliStatus | null;
  streaming?: boolean;
  /** The running turn is waiting on the user's answer to a question. */
  asking?: boolean;
  /** Steps whose approval card is open. */
  waitingStepIds?: string[];
  /** Fade in on arrival; messages already there when the chat opened skip it, so a long chat doesn't animate all at once. */
  animate?: boolean;
  /** Opens another Chat by key, from a message it sent across a Link. */
  onOpenChat?: (chatKey: string) => void;
}) {
  const linked = linkedContext(message);
  // A message another Chat sent sits apart from the user's own: left-aligned, with its sender over it.
  const bubble = isUser && !linked;
  const recommendation = !isUser && !streaming ? parseRecommendation(message.body) : null;
  const outdatedProvider = !isUser && !streaming ? extractOutdatedProvider(message.body) : null;
  const isCurrentlyOutdated = outdatedProvider ? (cliStatus ? cliStatus[outdatedProvider]?.state === "outdated" : true) : false;
  const showUpdateButton = Boolean(
    outdatedProvider &&
    onUpdateCli &&
    (isCurrentlyOutdated || updatingCli === outdatedProvider)
  );
  const steps = message.steps ?? [];
  return (
    <article
      id={`message-${message.id}`}
      data-slot="message"
      data-from={isUser ? "user" : "assistant"}
      data-linked={linked?.kind}
      data-streaming={streaming || undefined}
      className={`flex min-w-0 w-full flex-col gap-1.5 transition-[opacity,transform] duration-300 ${bubble ? "items-end pl-12" : ""}`}
      style={animate ? { animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" } : undefined}
    >
      {linked && <LinkedMessageHeader context={linked} onOpenChat={onOpenChat} />}
      <div className={`min-w-0 max-w-full text-[13px] leading-[1.55] text-ink ${bubble ? "rounded-xl bg-field px-3 py-1.5" : isUser ? "rounded-xl border border-line px-3 py-2" : ""}`}>
        <Attachments images={isUser ? message.images : message.images?.filter(image => !image.sourcePath)} files={message.files} leading={isUser && message.handoverBrief !== undefined && <HandoverBriefChip brief={message.handoverBrief} />} />
        {isUser ? (
          message.body.trim() ? <UserBody body={message.body} /> : null
        ) : recommendation ? (
          <>
            <ReplyContent body={recommendation.intro} steps={steps} streaming={false} waitingStepIds={waitingStepIds} />
            <div className={recommendation.intro ? "mt-2" : undefined}>
              <RecommendationCard question={recommendation.question} options={recommendation.options} onSelect={(option) => onRecommendationSelect(option.label)} />
            </div>
          </>
        ) : (
          <ReplyContent body={message.body} steps={steps} streaming={streaming} asking={asking} waitingStepIds={waitingStepIds} />
        )}
        {showUpdateButton && outdatedProvider && onUpdateCli && (
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              disabled={updatingCli === outdatedProvider}
              onClick={() => onUpdateCli(outdatedProvider)}
              className="flex items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink shadow-xs transition-colors hover:bg-hover active:scale-[0.98] disabled:opacity-50"
            >
              {updatingCli === outdatedProvider ? (
                <>
                  <span className="size-3 animate-spin rounded-full border-2 border-ink border-t-transparent" />
                  <span>Updating {providerName(outdatedProvider)}…</span>
                </>
              ) : (
                <span>Update {providerName(outdatedProvider)} now</span>
              )}
            </button>
          </div>
        )}
      </div>
    </article>
  );
});

// Background turns and draft edits must not rebuild a long, unchanged transcript.
const MessageTranscript = memo(function MessageTranscript({
  messages, pendingMessageId, isSending, streamingText, streamingSteps, asking, waitingStepIds,
  onRecommendationSelect, onUpdateCli, updatingCli, cliStatus, onOpenLinkedChat, findOpen,
}: Pick<ChatComposerProps, "messages" | "pendingMessageId" | "isSending" | "streamingText" | "streamingSteps" | "asking" | "waitingStepIds" | "onRecommendationSelect" | "onUpdateCli" | "updatingCli" | "cliStatus" | "onOpenLinkedChat" | "findOpen">) {
  const chatId = messages[0]?.session_id ?? "new";
  // The messages a chat opens with don't animate in; later ones do. A new chat's first message counts as later.
  const openingMessages = useRef<{ chat: number | string; ids: Set<number> } | null>(null);
  if (!openingMessages.current) openingMessages.current = { chat: chatId, ids: new Set(messages.map(message => message.id)) };
  if (openingMessages.current.chat !== chatId) {
    openingMessages.current = { chat: chatId, ids: openingMessages.current.chat === "new" ? new Set() : new Set(messages.map((message) => message.id)) };
  }
  // Keep the same recent-history page size as mobile. New messages extend the page without dropping its first row.
  const [page, setPage] = useState(() => ({ chat: chatId, firstId: messages[Math.max(0, messages.length - 40)]?.id }));
  let firstId = page.chat === chatId ? page.firstId : messages[Math.max(0, messages.length - 40)]?.id;
  if (findOpen) firstId = messages[0]?.id;
  if (page.chat !== chatId || page.firstId !== firstId) setPage({ chat: chatId, firstId });
  const start = Math.max(0, messages.findIndex(message => message.id === firstId));
  const earlierButton = useRef<HTMLButtonElement>(null);
  const anchor = useRef<{ element: HTMLElement; top: number; viewport: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    const saved = anchor.current;
    if (!saved) return;
    anchor.current = null;
    let frame = 0;
    let remaining = 3;
    const restore = () => {
      if (!saved.element.isConnected) return;
      saved.viewport.scrollTop += saved.element.getBoundingClientRect().top - saved.top;
      // content-visibility replaces estimated heights as the newly exposed rows enter the viewport.
      if (remaining-- > 0) frame = requestAnimationFrame(restore);
    };
    restore();
    return () => cancelAnimationFrame(frame);
  }, [page]);
  function showEarlier() {
    const column = earlierButton.current?.parentElement;
    const element = column?.querySelector<HTMLElement>('[data-slot="message"]');
    const viewport = column?.closest<HTMLElement>('[aria-label="Conversation"]');
    if (element && viewport) anchor.current = { element, viewport, top: element.getBoundingClientRect().top };
    setPage({ chat: chatId, firstId: messages[Math.max(0, start - 40)]?.id });
  }
  const streamingMessage: AppChatMessage | undefined = isSending && (streamingText || streamingSteps?.length)
    ? { id: -1, session_id: messages.at(-1)?.session_id ?? -1, body: streamingText ?? "", context: null, role: "assistant", steps: streamingSteps }
    : undefined;
  const transcript = messages.slice(start);
  if (streamingMessage) {
    const pendingIndex = transcript.findIndex(message => message.id === pendingMessageId);
    transcript.splice(pendingIndex < 0 ? transcript.length : pendingIndex, 0, streamingMessage);
  }

  const openingIds = openingMessages.current.ids;
  return <>
    {start > 0 && <button ref={earlierButton} type="button" onClick={showEarlier} className="self-center rounded-control border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-hover">Show earlier messages ({start})</button>}
    {transcript.map((message) => (
      <MessageSection
        key={message.clientMessageId ?? message.id}
        message={message}
        isUser={message.role === "user"}
        onRecommendationSelect={onRecommendationSelect}
        onUpdateCli={onUpdateCli}
        updatingCli={updatingCli}
        cliStatus={cliStatus}
        streaming={message === streamingMessage}
        asking={message === streamingMessage && asking}
        waitingStepIds={message === streamingMessage ? waitingStepIds : undefined}
        animate={!message.clientMessageId && !openingIds.has(message.id)}
        onOpenChat={onOpenLinkedChat}
      />
          ))}
  </>;
});

interface ChatComposerProps {
  scopeKind?: 'project' | 'link';
  /** The find bar over the message list; the parent owns it so ⌘F and the command palette can open it. */
  findOpen?: boolean;
  findSignal?: number;
  onFindClose?: () => void;
  imageDraft: ImageDraft;
  projectPath: string;
  messages: AppChatMessage[];
  /** Unsaved input appears below the reply still streaming while the backend prepares the send. */
  pendingMessageId?: number;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onStop?: () => void;
  /** One-click fix for whatever blocks the chat's PR from merging (conflicts, an outdated branch, requested changes). */
  pullRequestAction?: { label: string; tone: "red" | "orange"; onRun: () => void };
  isSending: boolean;
  /** Sending is briefly blocked while a message is being prepared; a running turn doesn't block it. */
  sendBlocked: boolean;
  streamingText?: string;
  /** The running turn's tool steps, where they happened in `streamingText`. */
  streamingSteps?: ChatStep[];
  subagents?: Subagent[];
  onArchiveFinishedSubagents?: () => void;
  onArchiveSubagent?: (id: string, archived: boolean) => void;
  waitingForSubagents?: boolean;
  /** The running turn's to-do list, shown as a pill beside the subagents. */
  tasks?: AgentTask[];
  /** The ports the chat's commands listen on, shown as a pill beside the to-do list. */
  ports?: AgentPort[];
  /** Stops the command listening on one of the chat's ports. */
  onStopPort?: (pid: number) => Promise<unknown>;
  /** Steps of the running turn whose approval card is open. */
  waitingStepIds?: string[];
  /** The running turn is waiting on the user's answer to a question. */
  asking?: boolean;
  /** The model the open chat's running turn uses; the picker may already show another. */
  runModelName?: string;
  /** The active turn's start time, independent of the chat view. */
  runStartedAt?: number;
  lockedProvider?: ModelProvider;
  /** Hands this chat over to the other provider in a new chat. */
  onHandover?: (provider: ModelProvider) => void;
  /** The chat has messages, so it can be handed over. */
  canHandover?: boolean;
  /** A handed-over chat's brief while it waits for the first message; `chatId` is the chat's key. */
  handoverBrief?: { chatId: string; brief: string; onSave: (text: string) => Promise<void> };
  handover?: HandoverLinks & { onOpen: (sessionId: number) => void };
  /** Opens the Chat a Delegation, report or agreement came from, in whichever Project it is. */
  onOpenLinkedChat?: (chatKey: string) => void;
  /** A chat a quit stopped longer ago than Milagre resumes by itself: Continue starts its turn again. */
  resume?: { onContinue: () => void };
  /** The models the picker offers (see mergeModels). */
  models: ModelOption[];
  /** How each agent's CLI stands, flagged in the model picker; null until it's known. */
  cliStatus: AgentCliStatus | null;
  /** The model picker was opened; the status is checked again. */
  onModelPickerOpen: () => void;
  onUpdateCli?: (provider: ModelProvider) => void;
  updatingCli?: ModelProvider | null;
  selectedModel: ModelOption;
  onModelChange: (model: ModelOption) => void;
  capability: ModelCapability;
  effort?: EffortLevel;
  onEffortChange: (effort: EffortLevel) => void;
  ultracode: boolean;
  onUltracodeChange: (on: boolean) => void;
  fastMode: boolean;
  onFastModeChange: (on: boolean) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  onRecommendationSelect: (option: string) => void;
  approval?: ReactNode;
  worktrees: Array<{ id: number; name: string; path: string }>;
  selectedWorktreeId?: number;
  onWorktreeChange: (id: number) => void;
  isolation: Isolation;
  onIsolationChange: (isolation: Isolation) => void;
  branches: string[];
  baseBranch: string;
  onBaseBranchChange: (branch: string) => void;
  newChatError: string | null;
  notice?: string | null;
  onDismissNotice?: () => void;
}

const ISOLATIONS: Array<{ id: Isolation; name: string; description: string; icon: IconData }> = [
  { id: "local", name: "Local", description: "Work in the selected checkout", icon: LaptopIcon },
  { id: "worktree", name: "New worktree", description: "Start a new branch in its own worktree", icon: GitForkIcon },
];

function ChipButton({ icon, label, open, onClick }: { icon: IconData; label: string; open: boolean; onClick: (trigger: HTMLElement) => void }) {
  return (
    <button type="button" aria-expanded={open} onClick={(event) => onClick(event.currentTarget)} className={`flex h-7 items-center gap-1.5 rounded-[8px] px-1.5 text-[12px] font-medium transition-colors hover:bg-hover hover:text-ink ${open ? "bg-hover text-ink" : "text-ink-2"}`}>
      <Icon icon={icon} size={14} />
      {label}
      <span className="text-ink-3"><Icon icon={ArrowDown01Icon} size={12} /></span>
    </button>
  );
}

type NewChatHeaderProps = Pick<ChatComposerProps, "worktrees" | "selectedWorktreeId" | "onWorktreeChange" | "isolation" | "onIsolationChange" | "branches" | "baseBranch" | "onBaseBranchChange">;

function NewChatHeader({ worktrees, selectedWorktreeId, onWorktreeChange, isolation, onIsolationChange, branches, baseBranch, onBaseBranchChange }: NewChatHeaderProps) {
  const [menu, setMenu] = useState<"isolation" | "branch" | null>(null);
  const [query, setQuery] = useState("");
  const [popover, setPopover] = useState({ left: 0, maxHeight: 480 });
  const selected = worktrees.find((worktree) => worktree.id === selectedWorktreeId) ?? worktrees[0];
  const isolationOption = ISOLATIONS.find((option) => option.id === isolation) ?? ISOLATIONS[0];
  const search = query.trim().toLowerCase();
  // Local runs in an existing checkout; a new worktree branches from any local branch.
  const branchRows = isolation === "local"
    ? worktrees.filter((worktree) => worktree.name.toLowerCase().includes(search)).map((worktree) => ({ key: String(worktree.id), name: worktree.name, description: worktree.path.split("/").filter(Boolean).pop(), selected: worktree.id === selected?.id, choose: () => onWorktreeChange(worktree.id) }))
    : branches.filter((branch) => branch.toLowerCase().includes(search)).map((branch) => ({ key: branch, name: branch, description: undefined, selected: branch === baseBranch, choose: () => onBaseBranchChange(branch) }));

  const lastTrigger = useRef<HTMLElement | null>(null);
  function place(trigger: HTMLElement) {
    lastTrigger.current = trigger;
    const row = trigger.parentElement?.getBoundingClientRect();
    const button = trigger.getBoundingClientRect();
    setPopover({ left: button.left - (row?.left ?? button.left), maxHeight: window.innerHeight - button.bottom - 24 });
  }

  useDismiss(menu !== null, () => setMenu(null), (target) => !!target.closest("[data-picker-panel], [data-new-chat-pickers] button[aria-expanded]"), () => { if (lastTrigger.current) place(lastTrigger.current); });

  function toggle(next: "isolation" | "branch", trigger: HTMLElement) {
    place(trigger);
    setQuery("");
    setMenu((current) => (current === next ? null : next));
  }

  function close() {
    setMenu(null);
    setQuery("");
  }

  const popoverStyle = { left: popover.left, maxHeight: popover.maxHeight, transformOrigin: "top left" };

  return (
    // The entrance animation makes this a stacking context, so lift it above the composer while a popover is open.
    <div className={`px-1 ${menu ? "relative z-30" : ""}`} style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
      <h1 className="text-[17px] font-medium text-ink">New chat</h1>
      {selected && (
        <div data-new-chat-pickers className="relative mt-4 mb-2.5 -ml-1.5 flex items-center gap-1">
          <Tooltip label="Choose the isolation level">
            <ChipButton icon={isolationOption.icon} label={isolationOption.name} open={menu === "isolation"} onClick={(trigger) => toggle("isolation", trigger.parentElement ?? trigger)} />
          </Tooltip>
          <ChipButton icon={GitBranchIcon} label={isolation === "local" ? selected.name : baseBranch} open={menu === "branch"} onClick={(trigger) => toggle("branch", trigger)} />
          {menu === "isolation" && (
            <PickerPanel title="Isolation" className="absolute top-[calc(100%+0.375rem)] w-[320px]" style={popoverStyle}>
              {ISOLATIONS.map((option) => (
                <PickerRow key={option.id} icon={<Icon icon={option.icon} size={14} />} label={option.name} description={option.description} selected={option.id === isolation} onClick={() => { onIsolationChange(option.id); close(); }} />
              ))}
            </PickerPanel>
          )}
          {menu === "branch" && (
            <PickerPanel
              title={isolation === "local" ? "Choose a branch" : "Branch from"}
              query={query}
              onQueryChange={setQuery}
              placeholder="Search branches…"
              emptyLabel="No branches found."
              isEmpty={branchRows.length === 0}
              className="absolute top-[calc(100%+0.375rem)] w-[320px]"
              style={popoverStyle}
              onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); close(); }
              }}
            >
              {branchRows.map((row) => (
                <PickerRow key={row.key} icon={<Icon icon={GitBranchIcon} size={14} />} label={row.name} description={row.description} selected={row.selected} onClick={() => { row.choose(); close(); }} />
              ))}
            </PickerPanel>
          )}
        </div>
      )}
    </div>
  );
}

const EMPTY_SUBAGENTS: Subagent[] = [];

export function ChatComposer({
  scopeKind,
  imageDraft,
  projectPath,
  messages,
  pendingMessageId,
  draft,
  onDraftChange,
  onSend,
  onStop,
  pullRequestAction,
  isSending,
  sendBlocked,
  streamingText,
  streamingSteps,
  subagents = EMPTY_SUBAGENTS,
  onArchiveFinishedSubagents,
  onArchiveSubagent,
  waitingForSubagents = false,
  tasks,
  ports,
  onStopPort,
  waitingStepIds,
  asking = false,
  runModelName,
  runStartedAt,
  lockedProvider,
  onHandover,
  canHandover = false,
  handoverBrief,
  handover,
  onOpenLinkedChat,
  resume,
  models,
  cliStatus,
  onModelPickerOpen,
  onUpdateCli,
  updatingCli,
  selectedModel,
  onModelChange,
  capability,
  effort,
  onEffortChange,
  ultracode,
  onUltracodeChange,
  fastMode,
  onFastModeChange,
  permissionMode,
  onPermissionModeChange,
  onRecommendationSelect,
  approval,
  worktrees,
  selectedWorktreeId,
  onWorktreeChange,
  isolation,
  onIsolationChange,
  branches,
  baseBranch,
  onBaseBranchChange,
  newChatError,
  findOpen = false,
  findSignal = 0,
  onFindClose,
  notice,
  onDismissNotice,
}: ChatComposerProps) {
  const root = useRef<HTMLDivElement>(null);
  const chatId = messages[0]?.session_id ?? "new";
  const [canvasChat, setCanvasChat] = useState<number | string | null>(null);
  const canvasOpened = canvasChat === chatId;
  const closeCanvas = useCallback(() => {
    setCanvasChat(null);
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>("[data-slot=subagent-track] > button")?.focus());
  }, []);
  // A first message, including its preview while setup runs, opens the conversation layout.
  const isNewChat = messages.length === 0 && !handover?.live;
  // The note shows with the brief, until it is sent or the note is dismissed, by chat key.
  const [dismissedNotes, setDismissedNotes] = useState<string[]>([]);
  const noteKey = handoverBrief?.chatId;
  const showHandoverNote = noteKey !== undefined && lockedProvider !== undefined && !dismissedNotes.includes(noteKey);
  const workingModelName = runModelName ?? selectedModel.name;
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (isNewChat) setScrolled(false);
  }, [isNewChat]);

  function handleFileDrop(event: DragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    event.preventDefault();
    void imageDraft.attachFiles(files);
    event.currentTarget.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]')?.focus();
  }

  return (
    <div
      ref={root}
      className={`relative flex h-full min-h-0 w-full flex-col overflow-visible bg-transparent ${isNewChat ? "justify-center" : ""}`}
      onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDrop={handleFileDrop}
    >
      <SubagentCanvas key={`canvas-${chatId}`} opened={canvasOpened} agents={subagents} working={isSending} waiting={waitingForSubagents} onClose={closeCanvas} />
      <div className={canvasOpened ? "hidden" : "contents"} aria-hidden={canvasOpened || undefined}>
      {/* Messages scrolled past the top fade into a linear blur under the window-drag strip. */}
      {!isNewChat && <div aria-hidden data-busy={isSending || undefined} className={`chat-top-blur pointer-events-none absolute inset-x-0 top-0 z-10 h-16 transition-opacity duration-200 ${scrolled ? "opacity-100" : "opacity-0"}`} />}
      {!isNewChat && findOpen && onFindClose && <FindBar rootRef={root} focusSignal={findSignal} onClose={onFindClose} />}
      {!isNewChat && <div className="relative flex min-h-0 flex-1 flex-col">
      <MessageScroller
        key={messages[0]?.session_id ?? "new"}
        navigation="rail"
        followOutput
        smooth
        busy={isSending}
        className="min-h-0 flex-1"
        // The find bar floats over the top of the chat, so the first message moves below it while it is open.
        // The chip row floats over the bottom blur, so the last message can scroll clear of it.
        viewportClassName={`${findOpen ? "pt-12" : "pt-4"} pb-10`}
        contentClassName="min-h-full"
        // Streamed text isn't in the key: the scroller follows the content's growth itself, once per layout.
        autoScrollKey={`${messages.length}-${isSending}-${streamingSteps?.length ?? 0}`}
        viewportProps={{ onScroll: (event) => setScrolled(event.currentTarget.scrollTop > 4) }}
      >
        <div className="chat-column mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-3 pt-12 pb-4">
          {handover?.from && <HandoverFromLabel from={handover.from} onOpen={handover.onOpen} />}
          <MessageTranscript
            findOpen={findOpen} messages={messages} pendingMessageId={pendingMessageId} isSending={isSending}
            streamingText={streamingText} streamingSteps={streamingSteps} asking={asking} waitingStepIds={waitingStepIds}
            onRecommendationSelect={onRecommendationSelect} onUpdateCli={onUpdateCli} updatingCli={updatingCli}
            cliStatus={cliStatus} onOpenLinkedChat={onOpenLinkedChat}
          />

          {isSending && (
            <div className="w-full" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
              <ThinkingIndicator startedAt={runStartedAt} label={waitingForSubagents ? "Waiting on subagents" : `Working with ${workingModelName}`} />
            </div>
          )}
          {handover?.pending && (
            <div className="w-full" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
              <ThinkingIndicator showLabel label={`Preparing handover from ${handover.from?.title ?? "the previous chat"}…`} />
            </div>
          )}
          {handover?.to && !isSending && <HandoverLinkBar to={handover.to} onOpen={handover.onOpen} />}
          {resume && !isSending && (
            <div data-resume-bar className="flex w-full items-center gap-3 rounded-control border border-line px-3 py-2 text-[12px] text-ink-2">
              <span className="min-w-0 flex-1">Milagre closed while this chat was working.</span>
              <button type="button" onClick={resume.onContinue} disabled={sendBlocked} className="shrink-0 rounded-control bg-ink px-2.5 py-1 font-medium text-surface transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-40">Continue</button>
            </div>
          )}
        </div>
      </MessageScroller>
      {/* Messages passing under the chip row soften into a progressive blur that reaches the composer. */}
      <div aria-hidden data-busy={isSending || undefined} className="chat-bottom-blur pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20"><div /><div /></div>
      </div>}
      <div className={`mx-auto flex w-full max-w-3xl shrink-0 items-center justify-end gap-2 px-3 empty:hidden ${isNewChat ? "mb-2" : "pointer-events-none relative z-20 -mt-[38px] mb-3.5 [&>*]:pointer-events-auto"}`}>
        {/* The PR fix sits at the left of the composer's chip row; the chat's ports, to-dos and subagents at the right.
            Its tint is translucent, so a surface backing keeps the messages under the row from showing through. */}
        {!isNewChat && pullRequestAction && (
          <span className="mr-auto rounded-full bg-surface">
          <button
            type="button"
            onClick={pullRequestAction.onRun}
            disabled={sendBlocked || isSending || imageDraft.loading}
            className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50 ${pullRequestAction.tone === "orange"
              ? "border-orange/20 bg-orange/5 text-orange hover:bg-orange/10 focus-visible:outline-orange"
              : "border-red/20 bg-red/5 text-red hover:bg-red/10 focus-visible:outline-red"}`}
          >
            <Icon icon={GitPullRequestIcon} size={14} />
            {pullRequestAction.label}
          </button>
          </span>
        )}
        <PortTrack key={`ports-${messages[0]?.session_id ?? "new"}`} ports={ports} onStop={onStopPort} />
        <TaskTrack key={`tasks-${messages[0]?.session_id ?? "new"}`} tasks={tasks} />
        {!isNewChat && typeof chatId === "number" && chatId > 0 && projectPath && <SimulatorTrack key={`simulator-${projectPath}-${chatId}`} chatId={`${projectPath}#${chatId}`} />}
        <SubagentTrack key={chatId} agents={subagents} provider={lockedProvider ?? selectedModel.provider} onOpenCanvas={() => setCanvasChat(chatId)} onArchiveFinished={onArchiveFinishedSubagents} onArchive={onArchiveSubagent} />
      </div>

      <div className={`mx-auto w-full max-w-3xl shrink-0 p-1.5 ${isNewChat ? "" : "relative z-20 -mt-1.5"}`}>
        {isNewChat && scopeKind !== 'link' && <NewChatHeader worktrees={worktrees} selectedWorktreeId={selectedWorktreeId} onWorktreeChange={onWorktreeChange} isolation={isolation} onIsolationChange={onIsolationChange} branches={branches} baseBranch={baseBranch} onBaseBranchChange={onBaseBranchChange} />}
        {notice && <Notice onDismiss={onDismissNotice}>{notice}</Notice>}
        {showHandoverNote && lockedProvider && <HandoverNote from={otherProvider(lockedProvider)} to={lockedProvider} permissionMode={permissionMode} onDismiss={() => setDismissedNotes((ids) => [...ids, noteKey])} />}
        {approval && <div className="mb-2 w-full">{approval}</div>}
        <PromptComposer
          imageDraft={imageDraft}
          projectPath={projectPath}
          draft={draft}
          onDraftChange={onDraftChange}
          onSend={onSend}
          onStop={onStop}
          sendBlocked={sendBlocked}
          running={isSending}
          lockedProvider={lockedProvider}
          onHandover={onHandover}
          canHandover={canHandover}
          handoverBrief={handoverBrief}
          models={models}
          cliStatus={cliStatus}
          onModelPickerOpen={onModelPickerOpen}
          onUpdateCli={onUpdateCli}
          updatingCli={updatingCli}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          capability={capability}
          effort={effort}
          onEffortChange={onEffortChange}
          ultracode={ultracode}
          onUltracodeChange={onUltracodeChange}
          fastMode={fastMode}
          onFastModeChange={onFastModeChange}
          permissionMode={permissionMode}
          onPermissionModeChange={onPermissionModeChange}
          alwaysExpanded={isNewChat}
        />
        {newChatError && <p role="alert" className="mt-2 px-1 text-[12px] text-red">{newChatError}</p>}
      </div>
      </div>
    </div>
  );
}
