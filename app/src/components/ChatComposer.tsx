import { SubagentTrack } from "./agents/SubagentTrack";
import type { AgentTask, Subagent } from "../model";
import { TaskTrack } from "./agents/TaskTrack";
import { memo, useEffect, useRef, useState } from "react";
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
  Link01Icon,
} from "@hugeicons/core-free-icons";
import type { AgentCliStatus, EffortLevel, ModelCapability, AgentSession, ChatMessage as AppChatMessage, ChatStep, Isolation, ModelOption, ModelProvider, PermissionMode } from "../model";
import { FindBar } from "./FindBar";
import { Attachments } from "./Attachments";
import type { ImageDraft } from "./usePastedImages";
import { PromptComposer } from "./PromptComposer";
import { PickerPanel, PickerRow } from "./primitives/Picker";
import Tooltip from "./primitives/Tooltip";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { MessageScroller } from "./agents/message-scroller";
import { RecommendationCard } from "./agents/recommendation-card";
import { parseRecommendation } from "../lib/recommendation";
import { ActivityBlock } from "./agents/ActivityBlock";
import { Markdown } from "./markdown/Markdown";
import { closeOpenMarkdown } from "../lib/streaming-markdown";
import { replyActivity, unspokenThought } from "../lib/reply-parts";

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

function Icon({ icon, size = 16 }: { icon: IconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

/**
 * A reply: its activity (thinking, tool steps and the text between them) folded into one block, then its answer.
 * A reply with no answer that ended or stopped to ask shows its last thinking instead, dimmed.
 */
function ReplyContent({ body, steps, streaming, asking = false, waitingStepIds }: { body: string; steps: ChatStep[]; streaming: boolean; asking?: boolean; waitingStepIds: string[] }) {
  const { activity, answer } = replyActivity(body, steps);
  const thought = !streaming || asking ? unspokenThought(activity, answer) : "";
  return (
    <>
      <ActivityBlock entries={activity} streaming={streaming} waitingStepIds={waitingStepIds} />
      {answer.trim() && <div data-slot="message-content"><Markdown text={streaming ? closeOpenMarkdown(answer) : answer} /></div>}
      {thought && <div data-slot="message-thought" className="text-ink-2"><Markdown text={thought} /></div>}
    </>
  );
}

const MessageSection = memo(function MessageSection({
  message,
  isUser,
  onRecommendationSelect,
  streaming = false,
  asking = false,
  waitingStepIds = [],
}: {
  message: AppChatMessage;
  isUser: boolean;
  onRecommendationSelect: (option: string) => void;
  streaming?: boolean;
  /** The running turn is waiting on the user's answer to a question. */
  asking?: boolean;
  /** Steps whose approval card is open. */
  waitingStepIds?: string[];
}) {
  const recommendation = !isUser && !streaming ? parseRecommendation(message.body) : null;
  const steps = message.steps ?? [];
  return (
    <article
      id={`message-${message.id}`}
      data-slot="message"
      data-from={isUser ? "user" : "assistant"}
      className={`flex min-w-0 w-full flex-col gap-1.5 transition-[opacity,filter,transform] duration-300 ${isUser ? "items-end pl-12" : ""}`}
      style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <div className={`min-w-0 max-w-full text-[13px] leading-[1.55] text-ink ${isUser ? "rounded-xl bg-field px-3 py-1.5" : ""}`}>
        <Attachments images={message.images} files={message.files} />
        {isUser ? (
          <p className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body}</p>
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
      </div>
    </article>
  );
});

interface ChatComposerProps {
  /** The find bar over the message list; the parent owns it so ⌘F and the command palette can open it. */
  findOpen?: boolean;
  findSignal?: number;
  onFindClose?: () => void;
  imageDraft: ImageDraft;
  projectPath: string;
  messages: AppChatMessage[];
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onResolveConflicts?: () => void;
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
  /** Steps of the running turn whose approval card is open. */
  waitingStepIds?: string[];
  /** The running turn is waiting on the user's answer to a question. */
  asking?: boolean;
  /** The model the open chat's running turn uses; the picker may already show another. */
  runModelName?: string;
  lockedProvider?: ModelProvider;
  /** The models the picker offers (see mergeModels). */
  models: ModelOption[];
  /** How each agent's CLI stands, flagged in the model picker; null until it's known. */
  cliStatus: AgentCliStatus | null;
  /** The model picker was opened; the status is checked again. */
  onModelPickerOpen: () => void;
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
  worktreeSummary: string;
  connectionSummary: string;
  eventsCount: number;
  firstWorktreeName: string;
  secondWorktreeName?: string;
  firstAgentRunning: boolean;
  secondAgentRunning: boolean;
  onToggleFirst: () => void;
  onToggleSecond: () => void;
  onCycleConnection: () => void;
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

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-new-chat-pickers]")) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  function toggle(next: "isolation" | "branch", trigger: HTMLElement) {
    const row = trigger.parentElement?.getBoundingClientRect();
    const button = trigger.getBoundingClientRect();
    setPopover({ left: button.left - (row?.left ?? button.left), maxHeight: window.innerHeight - button.bottom - 24 });
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

export function ChatComposer({
  imageDraft,
  projectPath,
  messages,
  draft,
  onDraftChange,
  onSend,
  onResolveConflicts,
  isSending,
  sendBlocked,
  streamingText,
  streamingSteps,
  subagents = [],
  onArchiveFinishedSubagents,
  onArchiveSubagent,
  waitingForSubagents = false,
  tasks,
  waitingStepIds,
  asking = false,
  runModelName,
  lockedProvider,
  models,
  cliStatus,
  onModelPickerOpen,
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
  worktreeSummary,
  connectionSummary,
  eventsCount,
  firstWorktreeName,
  secondWorktreeName,
  firstAgentRunning,
  secondAgentRunning,
  onToggleFirst,
  onToggleSecond,
  onCycleConnection,
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
}: ChatComposerProps) {
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState("Worktrees");
  // Preparing a worktree is not a conversation yet. Move the composer only
  // when the first message is committed and its draft is cleared together.
  const isNewChat = tab === "Worktrees" && messages.length === 0;
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
      {/* Messages scrolled past the top fade into a linear blur under the window-drag strip. */}
      {!isNewChat && <div aria-hidden className={`chat-top-blur pointer-events-none absolute inset-x-0 top-0 z-10 h-16 transition-opacity duration-200 ${scrolled ? "opacity-100" : "opacity-0"}`} />}
      {!isNewChat && findOpen && onFindClose && <FindBar rootRef={root} focusSignal={findSignal} onClose={onFindClose} />}
      {!isNewChat && <MessageScroller
        navigation="rail"
        followOutput
        smooth
        busy={isSending}
        className="min-h-0 flex-1"
        // The find bar floats over the top of the chat, so the first message moves below it while it is open.
        viewportClassName={`${findOpen ? "pt-12" : "pt-4"} pb-2`}
        contentClassName="min-h-full"
        autoScrollKey={`${messages.length}-${isSending}-${streamingText?.length ?? 0}-${streamingSteps?.length ?? 0}`}
        viewportProps={{ onScroll: (event) => setScrolled(event.currentTarget.scrollTop > 4) }}
      >
        {tab === "Worktrees" ? (
          <div className="chat-column mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-3 pt-12 pb-4">
            {messages.map((message) => (
              <MessageSection
                key={message.id}
                message={message}
                isUser={message.role === "user"}
                onRecommendationSelect={onRecommendationSelect}
              />
            ))}

            {isSending && (streamingText || streamingSteps?.length) ? (
              <MessageSection
                message={{ id: -1, session_id: messages.at(-1)?.session_id ?? -1, body: streamingText ?? "", context: null, role: "assistant", steps: streamingSteps }}
                isUser={false}
                onRecommendationSelect={onRecommendationSelect}
                streaming
                asking={asking}
                waitingStepIds={waitingStepIds}
              />
            ) : null}
            {isSending && (
              <div className="w-full" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
                <ThinkingIndicator label={waitingForSubagents ? "Waiting on subagents" : `Working with ${workingModelName}`} />
              </div>
            )}
          </div>
        ) : (
          <div className="chat-column mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-3 pt-12 pb-4">
            <div className="flex items-center gap-2 text-[13px] text-ink"><Icon icon={Link01Icon} size={15} /><span className="font-medium">Shared context</span><span className="ml-auto text-[12px] text-ink-3">{eventsCount} events</span></div>
            <div className="rounded-control bg-inset p-3 text-[13px] leading-6 text-ink-2">
              <p>{worktreeSummary}</p>
              <p className="mt-2">Connection: {connectionSummary}</p>
            </div>
            <p className="text-[12px] text-ink-3">Messages sent from this chat can use the context shared by both worktrees.</p>
            <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
              {firstWorktreeName !== "No worktree" && <button type="button" className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-hover" onClick={onToggleFirst}>{firstAgentRunning ? "Stop" : "Start"} {firstWorktreeName}</button>}
              {secondWorktreeName && <button type="button" className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-hover" onClick={onToggleSecond}>{secondAgentRunning ? "Stop" : "Start"} {secondWorktreeName}</button>}
              <button type="button" className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-hover" onClick={onCycleConnection}>Link as {connectionSummary.toLowerCase()}</button>
            </div>
          </div>
        )}
      </MessageScroller>}
      <div className="mx-auto mb-2 flex w-full max-w-3xl shrink-0 justify-end gap-2 px-3 empty:hidden">
        <TaskTrack key={`tasks-${messages[0]?.session_id ?? "new"}`} tasks={tasks} />
        <SubagentTrack key={messages[0]?.session_id ?? "new"} agents={subagents} provider={lockedProvider ?? selectedModel.provider} onArchiveFinished={onArchiveFinishedSubagents} onArchive={onArchiveSubagent} />
      </div>

      <div className={`mx-auto w-full max-w-3xl shrink-0 p-1.5 ${isNewChat ? "" : "mt-auto"}`}>
        {isNewChat && <NewChatHeader worktrees={worktrees} selectedWorktreeId={selectedWorktreeId} onWorktreeChange={onWorktreeChange} isolation={isolation} onIsolationChange={onIsolationChange} branches={branches} baseBranch={baseBranch} onBaseBranchChange={onBaseBranchChange} />}
        {approval && <div className="mb-2 w-full">{approval}</div>}
        {!isNewChat && onResolveConflicts && (
          <div className="mb-2 flex px-1">
            <button
              type="button"
              onClick={onResolveConflicts}
              disabled={sendBlocked || isSending || imageDraft.loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-red/20 bg-red/5 px-2.5 py-0.5 text-[12px] font-medium text-red transition-colors hover:bg-red/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon icon={GitPullRequestIcon} size={14} />
              Resolve conflicts
            </button>
          </div>
        )}
        <PromptComposer
          imageDraft={imageDraft}
          projectPath={projectPath}
          draft={draft}
          onDraftChange={onDraftChange}
          onSend={onSend}
          sendBlocked={sendBlocked}
          running={isSending}
          lockedProvider={lockedProvider}
          models={models}
          cliStatus={cliStatus}
          onModelPickerOpen={onModelPickerOpen}
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
        {isNewChat && newChatError && <p role="alert" className="mt-2 px-1 text-[12px] text-red">{newChatError}</p>}
      </div>
    </div>
  );
}
