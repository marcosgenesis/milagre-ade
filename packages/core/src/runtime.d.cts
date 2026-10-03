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
}
export interface Runtime {
  readonly methods: readonly string[];
  invoke(method: string, args?: unknown[]): Promise<unknown>;
  openProject(projectPath: string): Promise<OpenProject>;
  resumeRecentProjects(): Promise<void>;
  environmentReady: Promise<unknown>;
  focused(): Promise<void>;
  close(): Promise<void>;
}
export function createRuntime(options: RuntimeOptions): Runtime;
