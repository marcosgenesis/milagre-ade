export type SessionStatus = "Created" | "Running" | "Stopped";
export type ConnectionType = "Dependency" | "Information" | "Review" | "Blocking";
export type ConnectionLifetime = "Persistent" | "Temporary";
export type ModelProvider = "codex" | "claude";
export type PermissionMode = "ask" | "auto" | "full";
/** Where a new chat runs: the selected checkout, or a fresh git worktree. */
export type Isolation = "local" | "worktree";

export const PERMISSION_MODES: Array<{ id: PermissionMode; name: string; description: string }> = [
  { id: "ask", name: "Ask approval", description: "Approve each run before the agent starts" },
  { id: "auto", name: "Auto mode", description: "Allow changes inside this worktree" },
  { id: "full", name: "Full permission", description: "Remove filesystem and network limits" },
];

export interface ModelOption {
  id: string;
  name: string;
  provider: ModelProvider;
  description: string;
  recommended?: boolean;
}

export const MODEL_CATALOG: ModelOption[] = [
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "codex", description: "Latest workhorse model for coding and everyday work", recommended: true },
  { id: "gpt-6-astra", name: "GPT-6 Astra", provider: "codex", description: "Frontier intelligence for the most demanding work" },
  { id: "gpt-6-sol", name: "GPT-6 Sol", provider: "codex", description: "Previous generation workhorse model" },
  { id: "gpt-6-luna", name: "GPT-6 Luna", provider: "codex", description: "Fast and affordable model for easier tasks" },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "codex", description: "Older generation workhorse model" },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", provider: "codex", description: "Balanced intelligence and cost" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", provider: "codex", description: "Fast, cost-sensitive model" },
  { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", provider: "codex", description: "Optimized for agentic coding" },
  { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", provider: "codex", description: "Long-horizon coding and agent work" },
  { id: "gpt-5-codex", name: "GPT-5 Codex", provider: "codex", description: "Coding-focused reasoning model" },
  { id: "gpt-5-codex-mini", name: "GPT-5 Codex Mini", provider: "codex", description: "Smaller and faster coding model" },
  { id: "gpt-5", name: "GPT-5", provider: "codex", description: "General-purpose reasoning model" },
  { id: "gpt-5-mini", name: "GPT-5 mini", provider: "codex", description: "Fast model for well-defined tasks" },
  { id: "gpt-4.1", name: "GPT-4.1", provider: "codex", description: "Strong non-reasoning model" },
  { id: "claude-fable-5", name: "Claude Fable 5", provider: "claude", description: "High-capability general and agentic work", recommended: true },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "claude", description: "Advanced reasoning and agentic coding" },
  { id: "claude-opus-5", name: "Claude Opus 5", provider: "claude", description: "Most capable Claude model" },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "claude", description: "Advanced reasoning and coding" },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", provider: "claude", description: "Deep analysis and agentic coding" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "claude", description: "Complex professional work" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "claude", description: "Balanced reasoning, coding, and speed" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", provider: "claude", description: "High-performance reasoning and efficiency" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "claude", description: "Balanced quality and speed" },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "claude", description: "Reliable coding and analysis" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "claude", description: "Fast and efficient" },
];

export interface Project {
  id: number;
  name: string;
}

export interface Worktree {
  id: number;
  project_id: number;
  path: string;
  name: string;
}

export interface AgentSession {
  id: number;
  worktree_id: number;
  agent_name: string;
  status: SessionStatus;
}

export interface Connection {
  id: number;
  left_worktree_id: number;
  right_worktree_id: number;
  kind: ConnectionType;
  lifetime: ConnectionLifetime;
}

export interface Event {
  id: number;
  worktree_id: number;
  kind: "Decision" | "Change" | "Blocker";
  summary: string;
  details: string;
}

export interface ChatMessage {
  id: number;
  session_id: number;
  body: string;
  context: unknown;
  role?: "user" | "assistant";
  model?: string;
  images?: ImageAttachment[];
}

export interface ImageAttachment {
  id: string;
  name: string;
  dataUrl: string;
}

export interface AgentRequest {
  provider: ModelProvider;
  model: string;
  projectPath: string;
  prompt: string;
  permissionMode: PermissionMode;
  images?: ImageAttachment[];
}

export interface WorktreeRequest {
  projectPath: string;
  baseBranch: string;
  prompt: string;
}

export interface CoordinatorState {
  next_id: number;
  projects: Record<string, Project>;
  worktrees: Record<string, Worktree>;
  sessions: Record<string, AgentSession>;
  connections: Record<string, Connection>;
  events: Event[];
  messages: ChatMessage[];
  approvals: unknown[];
  tasks: Record<string, { id: number; worktree_id: number; title: string; status: string }>;
  artifacts: Record<string, { id: number; worktree_id: number; label: string; path: string }>;
  outputs: unknown[];
  conflicts: unknown[];
}

export interface OpenProject {
  path: string;
  name: string;
  state: CoordinatorState | null;
}

export function createInitialState(projectName: string, projectPath: string): CoordinatorState {
  const projectId = 1;
  return {
    next_id: 1,
    projects: { [projectId]: { id: projectId, name: projectName } },
    worktrees: {},
    sessions: {},
    connections: {},
    events: [],
    messages: [],
    approvals: [],
    tasks: {},
    artifacts: {},
    outputs: [],
    conflicts: [],
  };
}

export function sortedWorktrees(state: CoordinatorState) {
  return Object.values(state.worktrees).sort((a, b) => a.id - b.id);
}

export function sessionForWorktree(state: CoordinatorState, worktreeId: number) {
  return Object.values(state.sessions).find((session) => session.worktree_id === worktreeId);
}

export interface SkillOption {
  name: string;
  description: string;
  path: string;
  scope: "workspace" | "user";
  provider: string;
}

export interface SkillCatalog {
  skills: SkillOption[];
  warnings: string[];
}
