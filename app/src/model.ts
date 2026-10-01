export type SessionStatus = "Created" | "Running" | "Stopped";
export type ConnectionType = "Dependency" | "Information" | "Review" | "Blocking";
export type ConnectionLifetime = "Persistent" | "Temporary";
export type ModelProvider = "codex" | "claude";
export type PermissionMode = "ask" | "auto" | "full";
/** Where a new chat runs: the selected checkout, or a fresh git worktree. */
export type Isolation = "local" | "worktree";

export const PERMISSION_MODES: Array<{ id: PermissionMode; name: string; description: string }> = [
  { id: "ask", name: "Ask approval", description: "Approve edits and commands as the agent asks" },
  { id: "auto", name: "Auto mode", description: "Allow changes inside this worktree" },
  { id: "full", name: "Full permission", description: "Remove filesystem and network limits" },
];

/** Effort ids come from the agents themselves (Claude: low…max, Codex adds ultra). */
export type EffortLevel = string;

export interface ModelCapability {
  /** Effort levels the model accepts, lightest first. Empty when it has no effort control. */
  efforts: EffortLevel[];
  defaultEffort?: EffortLevel;
  /** Claude only: standing multi-agent orchestration on top of any effort level. */
  ultracode: boolean;
}

export type ModelCapabilities = Record<ModelProvider, Record<string, ModelCapability>>;

export const EFFORT_COPY: Record<string, { name: string; description: string }> = {
  minimal: { name: "Minimal", description: "Fastest replies with little reasoning" },
  low: { name: "Low", description: "Quick answers for small, clear tasks" },
  medium: { name: "Medium", description: "Balanced thinking for everyday work" },
  high: { name: "High", description: "Careful reasoning for harder changes" },
  xhigh: { name: "Extra high", description: "Deep reasoning for complex problems" },
  max: { name: "Max", description: "Thinks as long as it needs. Slowest" },
  ultra: { name: "Ultra", description: "Splits big work across parallel agents" },
};

export function effortCopy(level: EffortLevel) {
  return EFFORT_COPY[level] ?? { name: level, description: "" };
}

/** What the agent reported for this model, or a cautious guess while it hasn't answered. */
export function capabilityFor(model: ModelOption, capabilities: ModelCapabilities | null): ModelCapability {
  const reported = capabilities?.[model.provider][model.id];
  if (reported) return reported;
  if (model.provider === "codex") return { efforts: ["low", "medium", "high"], ultracode: false };
  if (model.id.includes("haiku")) return { efforts: [], ultracode: false };
  const modern = /claude-(opus|sonnet|fable)-5/.test(model.id);
  return { efforts: modern ? ["low", "medium", "high", "xhigh", "max"] : ["low", "medium", "high", "max"], ultracode: modern };
}

/** Keeps the chosen effort when the model takes it, else its default, else the nearest middle level. */
export function effortFor(capability: ModelCapability, effort: EffortLevel): EffortLevel | undefined {
  const { efforts } = capability;
  if (efforts.length === 0) return undefined;
  if (efforts.includes(effort)) return effort;
  if (capability.defaultEffort && efforts.includes(capability.defaultEffort)) return capability.defaultEffort;
  return efforts.includes("high") ? "high" : efforts[Math.floor(efforts.length / 2)];
}

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
  /** The agent this chat is bound to once it has messages. */
  provider?: ModelProvider;
  /** Claude session id or Codex thread id, used to resume the agent's memory. */
  native_session_id?: string;
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
  /** How the agent turn that produced this reply ended. */
  outcome?: "completed" | "failed" | "cancelled";
}

export interface ImageAttachment {
  id: string;
  name: string;
  dataUrl: string;
}

/** What an agent asks to do, as shown on the approval card. */
export interface PermissionRequest {
  requestId: string;
  kind: "command" | "edit" | "other";
  /** Short name of the tool, e.g. "Bash", "Shell" or "Edit files". */
  tool: string;
  title: string;
  description?: string;
  command?: string;
  cwd?: string;
  /** A unified diff (or the new content), capped at 20,000 characters. */
  diff?: string;
  files?: string[];
  /** The tool's raw input, for tools that are neither commands nor edits. */
  detail?: string;
  reason?: string;
  /** Whether "Always allow in this chat" can be offered. */
  allowForChat: boolean;
}

export type PermissionDecision = "allow" | "allow-for-chat" | "deny";


/** One option on a question card. */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** One question an agent asks, as shown on the question card. */
export interface AgentQuestion {
  /** Unique within its request; answers are keyed by it. */
  id: string;
  /** A short tag such as "Library"; may be empty. */
  header: string;
  question: string;
  options: QuestionOption[];
  /** The user may pick several options. */
  multiSelect: boolean;
  /** The user may type an answer of their own. */
  allowOther: boolean;
  /** The typed answer is a secret, so the field hides it. */
  secret: boolean;
}

/** Questions a turn waits on, asked together. */
export interface QuestionRequest {
  requestId: string;
  questions: AgentQuestion[];
}

/** The labels picked and any typed answer, per question id. */
export type QuestionAnswers = Record<string, string[]>;

export type QuestionOutcome = "answered" | "dismissed" | "cancelled";

export type AgentEvent =
  | { type: "session-started"; nativeId: string }
  | { type: "session-reset" }
  | { type: "turn-started"; turnId: string | null }
  | { type: "text-delta"; messageId: string | null; text: string }
  | ({ type: "permission-request" } & PermissionRequest)
  | { type: "permission-resolved"; requestId: string; decision: PermissionDecision | "cancelled" }
  | ({ type: "question-request" } & QuestionRequest)
  | { type: "question-resolved"; requestId: string; outcome: QuestionOutcome }
  | { type: "turn-completed" }
  | { type: "turn-cancelled" }
  | { type: "turn-failed"; message: string };

export interface AgentStartTurnRequest {
  /** The chat key, `${projectPath}#${sessionId}` (see `chatKey` in lib/agent-runs). */
  chatId: string;
  provider: ModelProvider;
  model: string;
  cwd: string;
  permissionMode: PermissionMode;
  effort?: EffortLevel;
  ultracode?: boolean;
  prompt: string;
  images: ImageAttachment[];
  resumeId?: string;
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
