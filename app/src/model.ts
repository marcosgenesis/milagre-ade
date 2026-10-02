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

/** Claude's faster inference is offered only on these Opus models. */
export function supportsFastMode(model: Pick<ModelOption, "provider" | "id">): boolean {
  return model.provider === "claude" && ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"].includes(model.id);
}

/**
 * The maintained list: what codex-cli 0.158.0 and Claude Code 2.1.287 report, recommended model first.
 * The picker shows it until the agents report their own lists (agent:models), and for an agent whose
 * CLI is missing, too old or couldn't be asked.
 */
export const MODEL_CATALOG: ModelOption[] = [
  { id: "gpt-6-astra", name: "GPT-6-Astra", provider: "codex", description: "Frontier intelligence for the most demanding work", recommended: true },
  { id: "gpt-6-sol", name: "GPT-6-Sol", provider: "codex", description: "Previous generation workhorse model" },
  { id: "gpt-6-luna", name: "GPT-6-Luna", provider: "codex", description: "Fast and affordable model for easier tasks" },
  { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", provider: "codex", description: "Older generation workhorse model" },
  { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", provider: "codex", description: "Older balanced model for straightforward work" },
  { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", provider: "codex", description: "Older fast and efficient model" },
  { id: "gpt-5.5", name: "GPT-5.5", provider: "codex", description: "Legacy coding model" },
  { id: "claude-opus-5-5", name: "Opus 5.5", provider: "claude", description: "For complex work and everyday tasks", recommended: true },
  { id: "claude-fable-5-1", name: "Fable 5.1", provider: "claude", description: "For your toughest challenges" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", provider: "claude", description: "Most efficient for simpler tasks" },
  { id: "claude-haiku-4-5", name: "Haiku 4.5", provider: "claude", description: "Fastest for quick answers" },
  { id: "claude-sonnet-5", name: "Sonnet 5", provider: "claude", description: "Efficient for routine tasks" },
  { id: "claude-opus-5", name: "Opus 5", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-fable-5", name: "Fable 5", provider: "claude", description: "Most capable for your hardest and longest-running tasks" },
  { id: "claude-opus-4-8", name: "Opus 4.8", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-opus-4-7", name: "Opus 4.7", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-opus-4-6", name: "Opus 4.6", provider: "claude", description: "Best for everyday, complex tasks" },
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6", provider: "claude", description: "Efficient for routine tasks" },
];

/** A model as its agent's CLI reports it (agent:models), with what it accepts. */
export interface ReportedModel extends ModelCapability {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
}

/** Each agent's reported models; null when its CLI is missing, too old, or couldn't be asked. */
export type AgentModels = Record<ModelProvider, ReportedModel[] | null>;

/** How an agent's CLI stands, for the model picker (agent:cli-status). `message` is what a turn would fail with. */
export type CliState = "ready" | "missing" | "outdated" | "logged-out" | "broken";
export interface CliStatus {
  state: CliState;
  message?: string;
}
export type AgentCliStatus = Record<ModelProvider, CliStatus>;

export interface Project {
  id: number;
  name: string;
}

export interface DiffStat {
  added: number;
  removed: number;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED";
  readyToMerge: boolean;
  hasConflicts: boolean;
  conflictStatusKnown?: boolean;
}

export interface Worktree {
  id: number;
  project_id: number;
  path: string;
  /** The checked-out branch, or the folder name when HEAD is detached. */
  name: string;
  /** The ref a worktree Milagre created started from; its changes are measured against it. */
  base?: string;
  /** Lines changed against the base, refreshed in the background so the hover card shows it at once. */
  diff?: DiffStat;
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
  subagents?: Subagent[];
  /** A name the user gave the chat; otherwise it's named after its first message. */
  title?: string;
  /** A turn ended while the chat wasn't open, or the user marked it unread. */
  unread?: boolean;
  /** Hidden from the chat list. */
  archived?: boolean;
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
  files?: string[];
  /** How the agent turn that produced this reply ended. */
  outcome?: "completed" | "failed" | "cancelled";
  /** The tool calls the agent made in this reply, and its thinking, in the order they started. */
  steps?: ChatStep[];
}

export type StepKind = "shell" | "edit" | "read" | "search" | "other" | "thinking";

/** One tool call in an agent's reply (a command, an edit, a read, a search or another tool), or a stretch of its thinking. */
export interface ChatStep {
  id: string;
  kind: StepKind;
  /** What it did, e.g. "Ran `npm test`"; text between backticks is code. */
  title: string;
  /** Saved steps are done or failed; only a reply still streaming has running ones. */
  status: "running" | "done" | "failed";
  /** The command and its output, a unified diff, or the thinking summary, capped at 20,000 characters. */
  detail?: string;
  /** The file a read or edit worked on, as the tool named it; the title shows only its name. */
  file?: string;
  /** How long a thinking step took. */
  durationMs?: number;
  /** Where the step sits in the reply: the length of the reply's text when it started. */
  offset?: number;
}

export interface ImageAttachment {
  path?: string;
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
  /** The tool step this request is about. */
  stepId?: string;
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

export interface Subagent {
  id: string;
  archived?: boolean;
  parentId?: string;
  title: string;
  prompt?: string;
  status: "initializing" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "unknown";
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  latestActivity?: string;
  transcript: Array<{ id: string; kind: "tool" | "message"; text: string }>;
}

/** One item of the agent's to-do list. */
export interface AgentTask {
  id: string;
  content: string;
  /** Present-continuous wording for while the task is in progress ("Running tests"). */
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
}

export type AgentEvent =
  | { type: "subagent-update"; agent: Subagent }
  | { type: "subagents-waiting"; waiting: boolean }
  | { type: "tasks-updated"; tasks: AgentTask[] }
  | { type: "session-started"; nativeId: string }
  | { type: "session-reset" }
  | { type: "turn-started"; turnId: string | null }
  | { type: "text-delta"; messageId: string | null; text: string }
  | { type: "step-started"; step: Pick<ChatStep, "id" | "kind" | "title" | "detail" | "file"> }
  | { type: "step-output"; id: string; text: string }
  | { type: "step-completed"; id: string; status: "done" | "failed"; title?: string; detail?: string; durationMs?: number }
  | ({ type: "permission-request" } & PermissionRequest)
  | { type: "permission-resolved"; requestId: string; decision: PermissionDecision | "cancelled" }
  | ({ type: "question-request" } & QuestionRequest)
  | { type: "question-resolved"; requestId: string; outcome: QuestionOutcome }
  | { type: "turn-completed" }
  | { type: "turn-cancelled" }
  /** `notice`: a message Milagre wrote (it names the CLI and the fix), shown as it is; otherwise it is the agent's own error. */
  | { type: "turn-failed"; message: string; notice?: boolean; login?: boolean };

export interface AgentStartTurnRequest {
  /** The chat key, `${projectPath}#${sessionId}` (see `chatKey` in lib/agent-runs). */
  chatId: string;
  provider: ModelProvider;
  model: string;
  cwd: string;
  permissionMode: PermissionMode;
  effort?: EffortLevel;
  ultracode?: boolean;
  /** Claude only: faster Opus output at premium usage rates. */
  fastMode?: boolean;
  /** How long Claude's replies run; Claude only, Codex ignores it. */
  replies?: "concise" | "normal";
  /** Apply bundled TLDR writing rules to both providers. Defaults to true. */
  tldrEnabled?: boolean;
  prompt: string;
  images: ImageAttachment[];
  resumeId?: string;
}

/** A code editor found on this Mac. */
export interface EditorInfo {
  id: string;
  name: string;
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
  scope: "workspace" | "user" | "bundled";
  provider: string;
}

export interface SkillCatalog {
  skills: SkillOption[];
  warnings: string[];
}

export interface UsageWindow {
  id: string;
  label: string;
  shortLabel: string;
  usedPercent: number;
  resetsAt: string | null;
}

export interface ProviderUsage {
  provider: ModelProvider;
  status: "ok" | "unavailable" | "error";
  windows: UsageWindow[];
  updatedAt: string;
  message?: string;
}

export interface UsageSnapshot {
  providers: ProviderUsage[];
}
