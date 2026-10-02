export {};

import type { AgentRuns } from "./lib/agent-runs";
import type { SessionPatch, WorktreeRename } from "../../electron/shared/project-edits.mjs";
import type { GitChanges, GitChatContext, GitCommitResult, GitPrResult, GitPushResult, GitTextResult } from "./lib/git-dialog";
import type { ModelProvider } from "./model";
import type { RecentProject } from "./lib/project-list";
import type { AgentCliStatus, AgentModels, AgentPorts, EditorInfo, AgentEvent, ChatHandoverRequest, ChatSendRequest, CoordinatorState, OpenProject, PermissionDecision, PermissionMode, QuestionAnswers, SkillCatalog, UsageSnapshot, WorktreeRequest } from "./model";

import type { WorktreeStatus } from "./lib/archive";
import type { PullRequest } from "./model";

/** Which patterns apply to new worktrees, and the files they match in the main checkout. */
export type FilesToCopy = { source: "worktreeinclude" | "setting" | "default"; worktreeInclude: string | null; matches: string[] };

/** Where the setup command new worktrees run comes from: the repo's .milagre/worktree.json, the project's setting, or nowhere. */
export type WorktreeSetupSource = "repo" | "setting" | "none";

/** The project's saved setup command, and the one that applies. `note` says why a repo file was ignored. */
export type WorktreeSetupSettings = { setupCommand: string; source: WorktreeSetupSource; command: string | null; note?: string };

export type UpdateState = { status: "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "error" | "unavailable"; version: string | null; progress: number };

export type DiffMode = "uncommitted" | "committed";

export type DiffFileEntry = {
  /** The new path, relative to the chat's folder. */
  path: string;
  /** Renames only. */
  oldPath?: string;
  status: "added" | "deleted" | "modified" | "renamed";
  added: number;
  removed: number;
  binary: boolean;
  untracked?: boolean;
};

/** `base` is the branch name `committed` compares with, null for `uncommitted` or when there is none. `message` explains an empty list (no shared history with the base). */
export type DiffFilesResult = { isRepo: false; message: string } | { isRepo: true; base: string | null; files: DiffFileEntry[]; message?: string };

/** `patch` is empty when the file is binary or `tooLarge` (over 1 MB). */
export type DiffFileResult = { patch: string; binary: boolean; tooLarge: boolean };

declare global {
  interface Window {
    milagre: {
      getPathForFile: (file: File) => string;
      searchProjectFiles: (root: string, query: string) => Promise<string[]>;
      listSkills: (projectPath: string) => Promise<SkillCatalog>;
      listBranches: (projectPath: string) => Promise<string[]>;
      getProjectImage: (projectPath: string) => Promise<string | null>;
      getAppVersion: () => Promise<string>;
      /** `setupNote`: why the repo's setup file was ignored. */
      createWorktree: (request: WorktreeRequest) => Promise<{ project: OpenProject & { state: CoordinatorState }; worktreeId: number; setupNote?: string }>;
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
      /** A new worktree's branch got the name picked for its chat, a few seconds after it was created. */
      onWorktreeRenamed: (callback: (rename: WorktreeRename) => void) => () => void;
      /** Re-reads the given worktrees' diff stats in the main process, e.g. after a commit from the "Commit and open PR" dialog. */
      refreshDiffs: (projectPath: string, worktreeIds: number[]) => Promise<void>;
      /** The current branch's open or merged PR, or null when none is available. */
      readPullRequest: (worktreePath: string) => Promise<PullRequest | null>;
      /** PRs a chat created or merged, by URL or number, looked up from its folder; null where one can't be read. */
      readPullRequests: (worktreePath: string, refs: string[]) => Promise<Array<PullRequest | null>>;
      /** Opens a project or worktree folder in the file manager; rejects for any other folder. */
      revealInFolder: (folder: string) => Promise<void>;
      /** Puts a generated image on the clipboard. */
      copyImage: (file: string) => Promise<void>;
      /** Saves a copy of a generated image where the user picks; the saved path, or null when cancelled. */
      saveImage: (file: string) => Promise<string | null>;
      /** The image's right-click menu: Copy Image and Save Image…. */
      showImageMenu: (file: string) => Promise<void>;
      /** The "Commit and open PR" dialog: git and gh run in the chat's folder (`cwd`). */
      git: {
        changes: (request: { cwd: string; base?: string }) => Promise<GitChanges>;
        /** Files a chat's folder changed: `uncommitted` against HEAD (untracked included), `committed` since the merge-base with the base branch. */
        diffFiles: (request: { cwd: string; base?: string; mode: DiffMode }) => Promise<DiffFilesResult>;
        /** One file's unified patch. Rejects for a path that is absolute or climbs out of the folder. */
        diffFile: (request: { cwd: string; base?: string; mode: DiffMode; path: string; oldPath?: string; untracked?: boolean }) => Promise<DiffFileResult>;
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
      /** A project's state changed in the main process, its only writer. Changes made by agent events come with the event instead. */
      onProjectState: (callback: (update: { path: string; state: CoordinatorState }) => void) => () => void;
      /** Saves a message in its chat (a new one when `sessionId` is null), then starts or steers the chat's turn. */
      sendMessage: (request: ChatSendRequest) => Promise<{ sessionId: number }>;
      /** Opens a chat on the other provider in this chat's worktree and sends it a brief of this chat. Resolves once the new chat exists. */
      handover: (request: ChatHandoverRequest) => Promise<{ sessionId: number }>;
      patchChat: (projectPath: string, sessionId: number, patch: SessionPatch) => Promise<void>;
      /** Archives one of a chat's subagents, or brings it back; the provider carries on either way. */
      archiveSubagent: (projectPath: string, sessionId: number, id: string, archived: boolean) => Promise<void>;
      archiveFinishedSubagents: (projectPath: string, sessionId: number) => Promise<void>;
      /** Records in a chat what the "Commit and open PR" dialog did; while the chat's turn runs, the line waits for it to end. */
      addGitNote: (chatId: string, body: string) => Promise<void>;
      /** The chat on screen, by chat key, which opening reads; a turn that ends in any other chat leaves it unread. */
      setOpenChat: (chatId: string | null) => Promise<void>;
      /** The turns streaming now, in every project, and the number of the last agent event they hold. */
      getRuns: () => Promise<{ runs: AgentRuns; seq: number }>;
      respondToPermission: (chatId: string, requestId: string, decision: PermissionDecision) => Promise<boolean>;
      /** Sends the answers to a question card, or dismisses it (null). False when the question is gone. */
      answerQuestion: (chatId: string, requestId: string, answers: QuestionAnswers | null, summary?: string) => Promise<boolean>;
      setAgentPermissionMode: (chatId: string, mode: PermissionMode) => Promise<void>;
      /** Each agent's model list as its CLI reports it, asked once per app run; null for an agent that couldn't be asked. */
      getModels: () => Promise<AgentModels>;
      /** How each agent's CLI stands (missing, outdated, broken, logged out, or ready); checked again on every call while it has a problem. */
      getCliStatus: () => Promise<AgentCliStatus>;
      /** Runs update for the specified CLI agent and refreshes status. */
      updateCli: (provider: ModelProvider) => Promise<{ ok: boolean; version?: string; error?: string; status?: CliStatus }>;
      interruptAgent: (chatId: string) => Promise<void>;
      /** An agent event, with its project's new state when the event changed it, and its number once it's folded into the main process's runs (see getRuns). */
      onAgentEvent: (callback: (payload: { chatId: string; event: AgentEvent; state?: CoordinatorState; seq?: number }) => void) => () => void;
      /** Every chat's listening ports now, by chat key. */
      getAgentPorts: () => Promise<AgentPorts>;
      /** Stops the command listening on one of a chat's ports; false when the chat's list doesn't show that pid. */
      stopAgentPort: (chatId: string, pid: number) => Promise<boolean>;
      /** Every chat's listening ports, each time any of them change. */
      onAgentPorts: (callback: (ports: AgentPorts) => void) => () => void;
      getUpdateState: () => Promise<UpdateState>;
      checkForUpdates: () => Promise<UpdateState>;
      installUpdate: () => Promise<void>;
      onUpdateState: (callback: (state: UpdateState) => void) => () => void;
      readUsage: () => Promise<UsageSnapshot>;
      /** Whether the Mac stays awake while an agent works (the screen can still sleep). */
      setKeepAwake: (enabled: boolean) => Promise<void>;
      getCachedUsage: () => Promise<UsageSnapshot>;
      /** Whether a chat that waits on the user while Milagre is in the background gets a system notification. */
      setNotifyWhenWaiting: (on: boolean) => Promise<void>;
      /** The open project's unread chats and the notification settings, for completion alerts and the Dock badge. */
      syncNotifications: (state: { projectPath: string; activeChatId: string | null; unread: string[]; notifyOnCompletion: boolean; showDockBadge: boolean }) => Promise<void>;
      notifyCompletion: (notice: { chatId: string; title: string; subtitle?: string }) => Promise<boolean>;
      /** A notification was clicked: the window is back, and the chat it was about should open. */
      onOpenChat: (callback: (chatId: string) => void) => () => void;
    };
  }
}
