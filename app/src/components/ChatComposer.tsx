import { useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  AiBrowserIcon,
  AiChat01Icon,
  Attachment01Icon,
  CommandIcon,
  Link01Icon,
  Message01Icon,
} from "@hugeicons/core-free-icons";
import type { AgentSession, ChatMessage as AppChatMessage, ModelOption, PermissionMode } from "../model";
import type { ImageDraft } from "./usePastedImages";
import { PromptComposer } from "./PromptComposer";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { MessageScroller } from "./agents/message-scroller";
import { parseRecommendation, RecommendationCard } from "./agents/recommendation-card";

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

function Icon({ icon, size = 16 }: { icon: IconData; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} color="currentColor" />;
}

function MessageSection({
  message,
  session,
  isUser,
  modelName,
  onRecommendationSelect,
}: {
  message: AppChatMessage;
  session?: AgentSession;
  isUser: boolean;
  modelName: string;
  onRecommendationSelect: (option: string) => void;
}) {
  const recommendation = !isUser ? parseRecommendation(message.body) : null;
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
        {recommendation ? (
          <RecommendationCard question={recommendation.question} options={recommendation.options} onSelect={(option) => onRecommendationSelect(option.label)} />
        ) : (
          <p className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body}</p>
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
  selectedModel: ModelOption;
  onModelChange: (model: ModelOption) => void;
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
  selectedModel,
  onModelChange,
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
}: ChatComposerProps) {
  const [tab, setTab] = useState("Worktrees");
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-visible bg-transparent">
      <MessageScroller
        navigation="rail"
        followOutput
        smooth
        busy={isSending}
        className="min-h-0 flex-1"
        viewportClassName="pt-4 pb-2"
        contentClassName="min-h-full"
        autoScrollKey={`${messages.length}-${isSending}`}
      >
        {tab === "Worktrees" ? (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-3 py-4">
            {messages.length === 0 ? (
              <div className="flex min-h-40 flex-col justify-center gap-2 px-1 py-5 text-center">
                <div className="mx-auto flex size-8 items-center justify-center rounded-control bg-inset text-ink-2"><Icon icon={Message01Icon} size={17} /></div>
                <p className="text-[13px] text-ink">Ask about your agents, worktrees, or next steps.</p>
                <p className="text-[12px] text-ink-3">The conversation will keep the shared context between worktrees.</p>
              </div>
            ) : (
              messages.map((message) => (
                <MessageSection
                  key={message.id}
                  message={message}
                  session={sessions[String(message.session_id)]}
                  isUser={message.role === "user"}
                  modelName={message.model ?? selectedModel.name}
                  onRecommendationSelect={onRecommendationSelect}
                />
              ))
            )}

            {isSending && (
              <div className="w-full" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
                <ThinkingIndicator label={`Working with ${selectedModel.name}`} />
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-3 py-4">
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
      </MessageScroller>

      <div className="mx-auto mt-auto w-full max-w-3xl shrink-0 p-1.5">
        {approval && <div className="mb-2 w-full">{approval}</div>}
        <PromptComposer
          imageDraft={imageDraft}
          projectPath={projectPath}
          draft={draft}
          onDraftChange={onDraftChange}
          onSend={onSend}
          isSending={isSending}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          permissionMode={permissionMode}
          onPermissionModeChange={onPermissionModeChange}
        />
      </div>
    </div>
  );
}
