export {};

import type { AgentRequest, CoordinatorState, OpenProject, SkillCatalog, WorktreeRequest } from "./model";

export type UpdateState = { status: "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "error"; version: string | null; progress: number };

declare global {
  interface Window {
    milagre: {
      listSkills: (projectPath: string) => Promise<SkillCatalog>;
      listBranches: (projectPath: string) => Promise<string[]>;
      getAppVersion: () => Promise<string>;
      createWorktree: (request: WorktreeRequest) => Promise<{ project: OpenProject & { state: CoordinatorState }; worktreeId: number }>;
      getCurrentProject: () => Promise<OpenProject>;
      openProject: () => Promise<OpenProject | null>;
      saveProject: (projectPath: string, state: CoordinatorState) => Promise<void>;
      sendToAgent: (request: AgentRequest) => Promise<string>;
      cancelAgent: () => Promise<boolean>;
      getUpdateState: () => Promise<UpdateState>;
      installUpdate: () => Promise<void>;
      onUpdateState: (callback: (state: UpdateState) => void) => () => void;
    };
  }
}
