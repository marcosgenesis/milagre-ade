import type { AgentEvent, OpenProject } from '@milagre/shared/model';
import type { AttentionNotice } from '@milagre/shared/attention';
import type { KeepAwake } from './keep-awake.cjs';
/** Host-facing runtime boundary. Provider adapters remain internal to core. */
export interface RuntimeOptions {
  dataDir: string;
  version: string;
  cwd?: string;
  worktreeRoot?: string;
  environmentReady?: Promise<unknown>;
  keepAwake?: KeepAwake;
  isFocused?: () => boolean;
  emit?: (channel: string, payload: unknown) => void;
  observeAgentEvent?: (chatId: string, event: AgentEvent) => void;
  notifyWaiting?: (notice: AttentionNotice & { chatId: string; requestId: string }) => void;
  /** Replace the real readers, for a host that runs no real agent (the review demo). */
  readUsage?: () => Promise<{ providers: unknown[] }>;
  agentModels?: () => Promise<unknown>;
  agentCliStatus?: (() => Promise<unknown>) & { invalidate(provider: string): void };
  /** false: `/skill` in a prompt is sent as typed, without the skill's text. */
  expandSkills?: boolean;
  /** worktree:pull-request; the default asks `gh`. */
  readPullRequest?: (worktreePath: string) => Promise<unknown>;
}
export interface Runtime {
  readonly methods: readonly string[];
  invoke(method: string, args?: unknown[]): Promise<unknown>;
  /** `takeNotice` (default true): a desktop window's open, which takes the restored-chats notice. */
  openProject(projectPath: string, options?: { takeNotice?: boolean }): Promise<OpenProject>;
  resumeRecentProjects(): Promise<void>;
  environmentReady: Promise<unknown>;
  focused(): Promise<void>;
  close(): Promise<void>;
}
export function createRuntime(options: RuntimeOptions): Runtime;
