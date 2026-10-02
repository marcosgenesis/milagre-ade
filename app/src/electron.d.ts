export {};

import type { AttentionNotice } from "./lib/attention";
import type { GitChanges, GitChatContext, GitCommitResult, GitPrResult, GitPushResult, GitTextResult } from "./lib/git-dialog";
import type { ModelProvider } from "./model";
import type { WorktreeRename } from "./lib/worktree-rename";
import type { RecentProject } from "./lib/project-list";
import type { AgentCliStatus, AgentModels, DiffStat, EditorInfo, AgentEvent, AgentStartTurnRequest, CoordinatorState, OpenProject, PermissionDecision, PermissionMode, QuestionAnswers, SkillCatalog, UsageSnapshot, WorktreeRequest } from "./model";

import type { WorktreeStatus } from "./lib/archive";
import type { PullRequest } from "./model";

/** Which patterns apply to new worktrees, and the files they match in the main checkout. */
export type FilesToCopy = { source: "worktreeinclude" | "setting" | "default"; worktreeInclude: string | null; matches: string[] };

/** Where the setup command new worktrees run comes from: the repo's .milagre/worktree.json, the project's setting, or nowhere. */
export type WorktreeSetupSource = "repo" | "setting" | "none";

/** The project's saved setup command, and the one that applies. `note` says why a repo file was ignored. */
export type WorktreeSetupSettings = { setupCommand: string; source: WorktreeSetupSource; command: string | null; note?: string };

/** The setup command a new worktree will run before its first turn; a repo command needs the user's approval first. */
export type WorktreeSetupPlan = { command: string; source: "repo" | "setting"; approved: boolean };

export type UpdateState = { status: "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "error"; version: string | null; progress: number };

declare global {
  interface Window {
    milagre: {
      getPathForFile: (file: File) => string;
      searchProjectFiles: (root: string, query: string) => Promise<string[]>;
      listSkills: (projectPath: string) => Promise<SkillCatalog>;
      listBranches: (projectPath: string) => Promise<string[]>;
      getProjectImage: (projectPath: string) => Promise<string | null>;
      getAppVersion: () => Promise<string>;
      /** `setup`: the command the worktree runs before its first turn. `setupNote`: why the repo's setup file was ignored. */
      createWorktree: (request: WorktreeRequest) => Promise<{ project: OpenProject & { state: CoordinatorState }; worktreeId: number; setup?: WorktreeSetupPlan; setupNote?: string }>;
      /** The folders Milagre keeps its worktrees in (the configured one and its real path). */
      getWorktreeRoots: () => Promise<string[]>;
      /** What archiving would lose from a worktree. Rejects when git can't tell. */
      getWorktreeStatus: (worktreePath: string, base: string) => Promise<WorktreeStatus>;
      /**
       * Removes a worktree Milagre made and its branch; `force` discards what it holds. Main closes the chat's agent
       * and checks again against `seen`, the status the user saw. Rejects with git's message, or a message that
       * says the worktree changed after it was checked.
       */
      removeWorktree: (worktreePath: string, options: { force: boolean; base: string; projectPath: string; chatId: string; seen: WorktreeStatus }) => Promise<{ removed: boolean; branch: string | null; branchDeleted: boolean }>;
      /** The project's saved "Files to copy" patterns, with what the effective patterns match now. */
      readFilesToCopy: (projectPath: string) => Promise<FilesToCopy & { filesToCopy: string[] }>;
      /** What patterns would match, without saving them. `.worktreeinclude` still wins. */
      previewFilesToCopy: (projectPath: string, patterns: string[]) => Promise<FilesToCopy>;
      saveFilesToCopy: (projectPath: string, patterns: string[]) => Promise<FilesToCopy & { filesToCopy: string[] }>;
      readWorktreeSetup: (projectPath: string) => Promise<WorktreeSetupSettings>;
      /** Saves the project's setup command; an empty one removes it. `.milagre/worktree.json` still wins. */
      saveWorktreeSetup: (projectPath: string, command: string) => Promise<WorktreeSetupSettings>;
      /** The answer to the trust dialog for a new worktree: "run" remembers the command for the repo, "skip" drops it for this worktree. */
      decideWorktreeSetup: (worktreePath: string, decision: "run" | "skip") => Promise<boolean>;
      /** A new worktree's branch got the name picked for its chat, a few seconds after it was created. */
      onWorktreeRenamed: (callback: (rename: WorktreeRename) => void) => () => void;
      /** Lines the worktree adds and removes against its base, or null outside a repository. */
      readDiffStat: (worktreePath: string, base?: string) => Promise<DiffStat | null>;
      /** The current branch's open or merged PR, or null when none is available. */
      readPullRequest: (worktreePath: string) => Promise<PullRequest | null>;
      /** Opens a project or worktree folder in the file manager; rejects for any other folder. */
      revealInFolder: (folder: string) => Promise<void>;
      /** The "Commit and open PR" dialog: git and gh run in the chat's folder (`cwd`). */
      git: {
        changes: (request: { cwd: string; base?: string }) => Promise<GitChanges>;
        /** Never rejects for a model failure: `ok: false` carries the note the dialog shows. */
        generate: (request: { cwd: string; base?: string; provider?: ModelProvider; chat: GitChatContext }) => Promise<GitTextResult>;
        commit: (request: { cwd: string; message: string }) => Promise<GitCommitResult>;
        push: (request: { cwd: string }) => Promise<GitPushResult>;
        openPr: (request: { cwd: string; base?: string; title: string; body: string }) => Promise<GitPrResult>;
      };
      /** Code editors found on this Mac, in the order the first becomes the default. */
      listEditors: () => Promise<EditorInfo[]>;
      /** Opens a file (or, with no path, the folder) in an editor. `path` is relative to `root`. Resolves to null, or a short error message. */
      openInEditor: (request: { root: string; path?: string; line?: number; editor?: string }) => Promise<string | null>;
      getCurrentProject: () => Promise<OpenProject>;
      openProject: () => Promise<OpenProject | null>;
      /** Projects opened lately, most recent first; folders that are gone are left out. */
      listRecentProjects: () => Promise<RecentProject[]>;
      /** Opens a project from the recent list. Rejects for a path that isn't listed or isn't a checkout's top folder. */
      switchProject: (projectPath: string) => Promise<OpenProject>;
      /** Takes a project off the recent list (its folder is untouched) and resolves to the list. */
      forgetProject: (projectPath: string) => Promise<RecentProject[]>;
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
      /** Whether the Mac stays awake while an agent works (the screen can still sleep). */
      setKeepAwake: (enabled: boolean) => Promise<void>;
      getCachedUsage: () => Promise<UsageSnapshot>;
      /** Shows a system notification for a request a chat waits on, unless Milagre has focus. True when one showed. */
      syncNotifications: (state: { projectPath: string; activeChatId: string | null; unread: string[]; notifyOnCompletion: boolean; showDockBadge: boolean }) => Promise<void>;
      notifyCompletion: (notice: { chatId: string; title: string; subtitle?: string }) => Promise<boolean>;
      notifyAttention: (notice: AttentionNotice & { chatId: string; requestId: string }) => Promise<boolean>;
      /** A notification was clicked: the window is back, and the chat it was about should open. */
      onOpenChat: (callback: (chatId: string) => void) => () => void;
    };
  }
}
