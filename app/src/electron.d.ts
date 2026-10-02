export {};

import type { AttentionNotice } from "./lib/attention";
import type { WorktreeRename } from "./lib/worktree-rename";
import type { AgentCliStatus, AgentModels, DiffStat, AgentEvent, AgentStartTurnRequest, CoordinatorState, OpenProject, PermissionDecision, PermissionMode, QuestionAnswers, SkillCatalog, UsageSnapshot, WorktreeRequest } from "./model";

export type UpdateState = { status: "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "error"; version: string | null; progress: number };

declare global {
  interface Window {
    milagre: {
      getPathForFile: (file: File) => string;
      listSkills: (projectPath: string) => Promise<SkillCatalog>;
      listBranches: (projectPath: string) => Promise<string[]>;
      getProjectImage: (projectPath: string) => Promise<string | null>;
      getAppVersion: () => Promise<string>;
      createWorktree: (request: WorktreeRequest) => Promise<{ project: OpenProject & { state: CoordinatorState }; worktreeId: number }>;
      /** A new worktree's branch got the name picked for its chat, a few seconds after it was created. */
      onWorktreeRenamed: (callback: (rename: WorktreeRename) => void) => () => void;
      /** Lines the worktree adds and removes against its base, or null outside a repository. */
      readDiffStat: (worktreePath: string, base?: string) => Promise<DiffStat | null>;
      /** Opens the worktree's folder in Finder. */
      revealWorktree: (worktreePath: string) => Promise<void>;
      getCurrentProject: () => Promise<OpenProject>;
      openProject: () => Promise<OpenProject | null>;
      saveProject: (projectPath: string, state: CoordinatorState) => Promise<void>;
      startTurn: (request: AgentStartTurnRequest) => Promise<{ turnId: string | null; steered: boolean }>;
      respondToPermission: (chatId: string, requestId: string, decision: PermissionDecision) => Promise<boolean>;
      /** Sends the answers to a question card, or dismisses it (null). False when the question is gone. */
      answerQuestion: (chatId: string, requestId: string, answers: QuestionAnswers | null) => Promise<boolean>;
      setAgentPermissionMode: (chatId: string, mode: PermissionMode) => Promise<void>;
      /** Each agent's model list as its CLI reports it, asked once per app run; null for an agent that couldn't be asked. */
      getModels: () => Promise<AgentModels>;
      /** How each agent's CLI stands (missing, outdated, broken, logged out, or ready); checked again on every call while it has a problem. */
      getCliStatus: () => Promise<AgentCliStatus>;
      interruptAgent: (chatId: string) => Promise<void>;
      onAgentEvent: (callback: (payload: { chatId: string; event: AgentEvent }) => void) => () => void;
      getUpdateState: () => Promise<UpdateState>;
      installUpdate: () => Promise<void>;
      onUpdateState: (callback: (state: UpdateState) => void) => () => void;
      readUsage: () => Promise<UsageSnapshot>;
      getCachedUsage: () => Promise<UsageSnapshot>;
      /** Shows a system notification for a request a chat waits on, unless Milagre has focus. True when one showed. */
      notifyAttention: (notice: AttentionNotice & { chatId: string; requestId: string }) => Promise<boolean>;
      /** A notification was clicked: the window is back, and the chat it was about should open. */
      onOpenChat: (callback: (chatId: string) => void) => () => void;
    };
  }
}
