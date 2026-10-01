import { useEffect, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
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
  LaptopIcon,
  Link01Icon,
  Message01Icon,
} from "@hugeicons/core-free-icons";
import type { EffortLevel, ModelCapability, AgentSession, ChatMessage as AppChatMessage, ChatStep, Isolation, ModelOption, ModelProvider, PermissionMode } from "../model";
import type { ImageDraft } from "./usePastedImages";
import { PromptComposer } from "./PromptComposer";
import { PickerPanel, PickerRow } from "./primitives/Picker";
import Tooltip from "./primitives/Tooltip";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { MessageScroller } from "./agents/message-scroller";
import { parseRecommendation, RecommendationCard } from "./agents/recommendation-card";
import { StepRow } from "./agents/StepRow";
import { Markdown } from "./markdown/Markdown";
import { closeOpenMarkdown } from "../lib/streaming-markdown";
import { replyParts } from "../lib/reply-parts";

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

function Icon({ icon, size = 16 }: { icon: IconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

function StepGroup({ steps, waitingStepIds }: { steps: ChatStep[]; waitingStepIds: string[] }) {
  return <div className="-mx-1.5 my-1 flex flex-col">{steps.map((step) => <StepRow key={step.id} step={step} waiting={waitingStepIds.includes(step.id)} />)}</div>;
}

/** A reply's text with its tool steps where they happened. */
function ReplyContent({ body, steps, streaming, waitingStepIds }: { body: string; steps: ChatStep[]; streaming: boolean; waitingStepIds: string[] }) {
  return (
    <>
      {replyParts(body, steps).map((part, index) => (part.type === "text"
        ? <Markdown key={index} text={streaming ? closeOpenMarkdown(part.text) : part.text} />
        : <StepGroup key={index} steps={part.steps} waitingStepIds={waitingStepIds} />))}
    </>
  );
}

function MessageSection({
  message,
  session,
  isUser,
  modelName,
  onRecommendationSelect,
  streaming = false,
  waitingStepIds = [],
}: {
  message: AppChatMessage;
  session?: AgentSession;
  isUser: boolean;
  modelName: string;
  onRecommendationSelect: (option: string) => void;
  streaming?: boolean;
  /** Steps whose approval card is open. */
  waitingStepIds?: string[];
}) {
  const recommendation = !isUser ? parseRecommendation(message.body) : null;
  const steps = message.steps ?? [];
  return (
    <article
      id={`message-${message.id}`}
      data-slot="message"
      data-from={isUser ? "user" : "assistant"}
      className={`flex min-w-0 w-full flex-col gap-1.5 transition-[opacity,filter,transform] duration-300 ${isUser ? "items-end pl-12" : ""}`}
      style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <div className={`flex items-center gap-1 text-[12px] leading-[1.3] ${isUser ? "justify-end" : ""}`}>
        {!isUser && <span className="flex size-5 items-center justify-center rounded-chip bg-inset text-ink-2"><Icon icon={Message01Icon} size={12} /></span>}
        <span className="font-medium text-ink">{isUser ? "You" : session?.agent_name ?? "Agent"}</span>
        <span className="text-ink-2">{isUser ? modelName : "Context aware"}</span>
      </div>
      <div className={`min-w-0 max-w-full text-[13px] leading-[1.55] text-ink ${isUser ? "rounded-xl bg-field px-3 py-1.5" : ""}`}>
        {message.images && message.images.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{message.images.map((image) => <a key={image.id} href={image.dataUrl} target="_blank" rel="noreferrer" title={image.name}><img src={image.dataUrl} alt={image.name} className="max-h-60 max-w-full rounded-lg object-contain" /></a>)}</div>}
        {isUser ? (
          <p className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body}</p>
        ) : recommendation ? (
          <>
            {steps.length > 0 && <StepGroup steps={steps} waitingStepIds={waitingStepIds} />}
            <RecommendationCard question={recommendation.question} options={recommendation.options} onSelect={(option) => onRecommendationSelect(option.label)} />
          </>
        ) : (
          <ReplyContent body={message.body} steps={steps} streaming={streaming} waitingStepIds={waitingStepIds} />
        )}
      </div>
    </article>
  );
}

interface ChatComposerProps {
  imageDraft: ImageDraft;
  projectPath: string;
  messages: AppChatMessage[];
  sessions: Record<string, AgentSession>;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  isSending: boolean;
  /** Sending is briefly blocked while a message is being prepared; a running turn doesn't block it. */
  sendBlocked: boolean;
  streamingText?: string;
  /** The running turn's tool steps, where they happened in `streamingText`. */
  streamingSteps?: ChatStep[];
  /** Steps of the running turn whose approval card is open. */
  waitingStepIds?: string[];
  /** The model the open chat's running turn uses; the picker may already show another. */
  runModelName?: string;
  lockedProvider?: ModelProvider;
  selectedModel: ModelOption;
  onModelChange: (model: ModelOption) => void;
  capability: ModelCapability;
  effort?: EffortLevel;
  onEffortChange: (effort: EffortLevel) => void;
  ultracode: boolean;
  onUltracodeChange: (on: boolean) => void;
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
                if (event.key === "Enter" && branchRows[0]) { branchRows[0].choose(); close(); }
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
  sessions,
  draft,
  onDraftChange,
  onSend,
  isSending,
  sendBlocked,
  streamingText,
  streamingSteps,
  waitingStepIds,
  runModelName,
  lockedProvider,
  selectedModel,
  onModelChange,
  capability,
  effort,
  onEffortChange,
  ultracode,
  onUltracodeChange,
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
}: ChatComposerProps) {
  const [tab, setTab] = useState("Worktrees");
  const isNewChat = tab === "Worktrees" && messages.length === 0 && !isSending;
  const workingModelName = runModelName ?? selectedModel.name;
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (isNewChat) setScrolled(false);
  }, [isNewChat]);
  return (
    <div className={`relative flex h-full min-h-0 w-full flex-col overflow-visible bg-transparent ${isNewChat ? "justify-center" : ""}`}>
      {/* Messages scrolled past the top fade into a linear blur under the window-drag strip. */}
      {!isNewChat && <div aria-hidden className={`chat-top-blur pointer-events-none absolute inset-x-0 top-0 z-10 h-16 transition-opacity duration-200 ${scrolled ? "opacity-100" : "opacity-0"}`} />}
      {!isNewChat && <MessageScroller
        navigation="rail"
        followOutput
        smooth
        busy={isSending}
        className="min-h-0 flex-1"
        viewportClassName="pt-4 pb-2"
        contentClassName="min-h-full"
        autoScrollKey={`${messages.length}-${isSending}-${streamingText?.length ?? 0}-${streamingSteps?.length ?? 0}`}
        viewportProps={{ onScroll: (event) => setScrolled(event.currentTarget.scrollTop > 4) }}
      >
        {tab === "Worktrees" ? (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-3 pt-12 pb-4">
            {messages.map((message) => (
              <MessageSection
                key={message.id}
                message={message}
                session={sessions[String(message.session_id)]}
                isUser={message.role === "user"}
                modelName={message.model ?? selectedModel.name}
                onRecommendationSelect={onRecommendationSelect}
              />
            ))}

            {isSending && (streamingText || streamingSteps?.length) ? (
              <MessageSection
                message={{ id: -1, session_id: messages.at(-1)?.session_id ?? -1, body: streamingText ?? "", context: null, role: "assistant", steps: streamingSteps }}
                session={sessions[String(messages.at(-1)?.session_id)]}
                isUser={false}
                modelName={workingModelName}
                onRecommendationSelect={onRecommendationSelect}
                streaming
                waitingStepIds={waitingStepIds}
              />
            ) : null}
            {isSending && (
              <div className="w-full" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
                <ThinkingIndicator label={`Working with ${workingModelName}`} />
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-3 pt-12 pb-4">
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

      <div className={`mx-auto w-full max-w-3xl shrink-0 p-1.5 ${isNewChat ? "" : "mt-auto"}`}>
        {isNewChat && <NewChatHeader worktrees={worktrees} selectedWorktreeId={selectedWorktreeId} onWorktreeChange={onWorktreeChange} isolation={isolation} onIsolationChange={onIsolationChange} branches={branches} baseBranch={baseBranch} onBaseBranchChange={onBaseBranchChange} />}
        {approval && <div className="mb-2 w-full">{approval}</div>}
        <PromptComposer
          imageDraft={imageDraft}
          projectPath={projectPath}
          draft={draft}
          onDraftChange={onDraftChange}
          onSend={onSend}
          sendBlocked={sendBlocked}
          running={isSending}
          lockedProvider={lockedProvider}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          capability={capability}
          effort={effort}
          onEffortChange={onEffortChange}
          ultracode={ultracode}
          onUltracodeChange={onUltracodeChange}
          permissionMode={permissionMode}
          onPermissionModeChange={onPermissionModeChange}
          alwaysExpanded={isNewChat}
        />
        {isNewChat && newChatError && <p role="alert" className="mt-2 px-1 text-[12px] text-red">{newChatError}</p>}
      </div>
    </div>
  );
}
