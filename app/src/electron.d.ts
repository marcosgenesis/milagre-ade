export {};

import type { AttentionNotice } from "./lib/attention";
import type { GitChanges, GitChatContext, GitCommitResult, GitPrResult, GitPushResult, GitTextResult } from "./lib/git-dialog";
import type { ModelProvider } from "./model";
import type { DiffStat, ModelCapabilities, AgentEvent, AgentStartTurnRequest, CoordinatorState, OpenProject, PermissionDecision, PermissionMode, QuestionAnswers, SkillCatalog, UsageSnapshot, WorktreeRequest } from "./model";

export type UpdateState = { status: "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "error"; version: string | null; progress: number };

declare global {
  interface Window {
    milagre: {
      listSkills: (projectPath: string) => Promise<SkillCatalog>;
      listBranches: (projectPath: string) => Promise<string[]>;
      getProjectImage: (projectPath: string) => Promise<string | null>;
      getAppVersion: () => Promise<string>;
      createWorktree: (request: WorktreeRequest) => Promise<{ project: OpenProject & { state: CoordinatorState }; worktreeId: number }>;
      /** Lines the worktree adds and removes against its base, or null outside a repository. */
      readDiffStat: (worktreePath: string, base?: string) => Promise<DiffStat | null>;
      /** Opens the worktree's folder in Finder. */
      revealWorktree: (worktreePath: string) => Promise<void>;
      /** The "Commit and open PR" dialog: git and gh run in the chat's folder (`cwd`). */
      git: {
        changes: (request: { cwd: string; base?: string }) => Promise<GitChanges>;
        /** Never rejects for a model failure: `ok: false` carries the note the dialog shows. */
        generate: (request: { cwd: string; base?: string; provider?: ModelProvider; chat: GitChatContext }) => Promise<GitTextResult>;
        commit: (request: { cwd: string; message: string }) => Promise<GitCommitResult>;
        push: (request: { cwd: string }) => Promise<GitPushResult>;
        openPr: (request: { cwd: string; base?: string; title: string; body: string }) => Promise<GitPrResult>;
      };
      getCurrentProject: () => Promise<OpenProject>;
      openProject: () => Promise<OpenProject | null>;
      saveProject: (projectPath: string, state: CoordinatorState) => Promise<void>;
      startTurn: (request: AgentStartTurnRequest) => Promise<{ turnId: string | null; steered: boolean }>;
      respondToPermission: (chatId: string, requestId: string, decision: PermissionDecision) => Promise<boolean>;
      /** Sends the answers to a question card, or dismisses it (null). False when the question is gone. */
      answerQuestion: (chatId: string, requestId: string, answers: QuestionAnswers | null) => Promise<boolean>;
      setAgentPermissionMode: (chatId: string, mode: PermissionMode) => Promise<void>;
      getModelCapabilities: () => Promise<ModelCapabilities>;
      interruptAgent: (chatId: string) => Promise<void>;
      onAgentEvent: (callback: (payload: { chatId: string; event: AgentEvent }) => void) => () => void;
      getUpdateState: () => Promise<UpdateState>;
      installUpdate: () => Promise<void>;
      onUpdateState: (callback: (state: UpdateState) => void) => () => void;
      readUsage: () => Promise<UsageSnapshot>;
      /** Shows a system notification for a request a chat waits on, unless Milagre has focus. True when one showed. */
      notifyAttention: (notice: AttentionNotice & { chatId: string; requestId: string }) => Promise<boolean>;
      /** A notification was clicked: the window is back, and the chat it was about should open. */
      onOpenChat: (callback: (chatId: string) => void) => () => void;
    };
  }
}
