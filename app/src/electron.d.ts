export {};

import type { AttentionNotice } from "./lib/attention";
import type { DiffStat, ModelCapabilities, AgentEvent, AgentStartTurnRequest, CoordinatorState, OpenProject, PermissionDecision, PermissionMode, QuestionAnswers, SkillCatalog, UsageSnapshot, WorktreeRequest } from "./model";

import type { WorktreeStatus } from "./lib/archive";

/** Which patterns apply to new worktrees, and the files they match in the main checkout. */
export type FilesToCopy = { source: "worktreeinclude" | "setting" | "default"; worktreeInclude: string | null; matches: string[] };

export type UpdateState = { status: "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "error"; version: string | null; progress: number };

declare global {
  interface Window {
    milagre: {
      listSkills: (projectPath: string) => Promise<SkillCatalog>;
      listBranches: (projectPath: string) => Promise<string[]>;
      getProjectImage: (projectPath: string) => Promise<string | null>;
      getAppVersion: () => Promise<string>;
      createWorktree: (request: WorktreeRequest) => Promise<{ project: OpenProject & { state: CoordinatorState }; worktreeId: number }>;
      /** The folders Milagre keeps its worktrees in (the configured one and its real path). */
      getWorktreeRoots: () => Promise<string[]>;
      /** What archiving would lose from a worktree. Rejects when git can't tell. */
      getWorktreeStatus: (worktreePath: string, base: string) => Promise<WorktreeStatus>;
      /** Removes a worktree Milagre made and its branch; `force` discards what it holds. Rejects with git's message. */
      removeWorktree: (worktreePath: string, options: { force: boolean }) => Promise<{ removed: boolean; branch: string | null; branchDeleted: boolean }>;
      /** The project's saved "Files to copy" patterns, with what the effective patterns match now. */
      readFilesToCopy: (projectPath: string) => Promise<FilesToCopy & { filesToCopy: string[] }>;
      /** What patterns would match, without saving them. `.worktreeinclude` still wins. */
      previewFilesToCopy: (projectPath: string, patterns: string[]) => Promise<FilesToCopy>;
      saveFilesToCopy: (projectPath: string, patterns: string[]) => Promise<FilesToCopy & { filesToCopy: string[] }>;
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
