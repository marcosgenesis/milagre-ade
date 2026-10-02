export {};

import type { AttentionNotice } from "./lib/attention";
import type { DiffStat, EditorInfo, ModelCapabilities, AgentEvent, AgentStartTurnRequest, CoordinatorState, OpenProject, PermissionDecision, PermissionMode, QuestionAnswers, SkillCatalog, UsageSnapshot, WorktreeRequest } from "./model";

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
      /** Code editors found on this Mac, in the order the first becomes the default. */
      listEditors: () => Promise<EditorInfo[]>;
      /** Opens a file (or, with no path, the folder) in an editor. `path` is relative to `root`. Resolves to null, or a short error message. */
      openInEditor: (request: { root: string; path?: string; line?: number; editor?: string }) => Promise<string | null>;
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
      /** Whether the Mac stays awake while an agent works (the screen can still sleep). */
      setKeepAwake: (enabled: boolean) => Promise<void>;
      /** Shows a system notification for a request a chat waits on, unless Milagre has focus. True when one showed. */
      notifyAttention: (notice: AttentionNotice & { chatId: string; requestId: string }) => Promise<boolean>;
      /** A notification was clicked: the window is back, and the chat it was about should open. */
      onOpenChat: (callback: (chatId: string) => void) => () => void;
    };
  }
}
