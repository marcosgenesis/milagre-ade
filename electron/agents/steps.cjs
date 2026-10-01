const path = require("node:path");
const { capText, claudeEditDiff, codexChangesDiff, unwrapShell } = require("./permissions.cjs");

// Tool steps: each command, edit, read, search or other tool call an agent makes, as the rows of
// its reply. A step starts as { id, kind, title, detail? } and ends as { id, status, title?, detail? }:
//   kind    "shell" | "edit" | "read" | "search" | "other"
//   title   what it did, past tense, with code between backticks: "Ran `npm test`", "Edited `App.tsx`"
//   status  "done" | "failed"
//   detail  a command and its output ("$ npm test\n…"), a unified diff, or the tool's result text.
//           The detail a step ends with replaces anything streamed into it. A read that worked keeps none.
// A title given at the end replaces the first one, for agents that only know it then.

const MAX_OUTPUT = 20_000;
const TRUNCATED = "… truncated";
const CLAUDE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "NotebookEdit"]);
const CLAUDE_AGENT_TOOLS = new Set(["Agent", "Task"]);

// Command output keeps its end, where results and errors are; diffs and other details keep their start.
function capOutput(text) {
  return text.length > MAX_OUTPUT ? `${TRUNCATED}\n${text.slice(-MAX_OUTPUT)}` : text;
}

// Text shown as code in a title: one line of at most 80 characters, with no backticks of its own.
function code(text, max = 80) {
  const flat = String(text ?? "").trim().replace(/`/g, "'").replace(/\s+/g, " ");
  return `\`${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat}\``;
}

const fileName = (file) => (file ? code(path.basename(String(file))) : "a file");

// Drops undefined fields so steps stay plain and compare cleanly.
function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

// A tool result's content is a string or a list of blocks.
function blocksText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block?.type === "text" ? block.text : block?.type ? `[${block.type}]` : "")).filter(Boolean).join("\n");
}

// --- Claude ---

function claudeStep(id, name, input = {}) {
  const step = (kind, title, detail) => compact({ id: String(id), kind, title, detail });
  if (name === "Bash") return step("shell", `Ran ${code(input.command)}`, `$ ${input.command ?? ""}\n`);
  if (name === "Read") return step("read", `Read ${fileName(input.file_path)}`);
  if (CLAUDE_EDIT_TOOLS.has(name)) return step("edit", `Edited ${fileName(input.file_path ?? input.notebook_path)}`);
  if (name === "Write") return step("edit", `Wrote ${fileName(input.file_path)}`);
  if (name === "Grep") return step("search", `Searched for ${code(input.pattern)}${input.path ? ` in ${code(input.path)}` : ""}`);
  if (name === "Glob") return step("search", `Found files matching ${code(input.pattern)}`);
  if (name === "WebSearch") return step("search", `Searched the web for ${code(input.query)}`);
  if (name === "WebFetch") return step("other", `Fetched ${code(input.url)}`);
  if (CLAUDE_AGENT_TOOLS.has(name)) return step("other", `Ran an agent: ${input.description || "a subtask"}`);
  if (name === "TodoWrite") return step("other", "Updated the to-do list");
  const mcp = /^mcp__(.+?)__(.+)$/.exec(String(name));
  if (mcp) return step("other", `Used ${code(mcp[2])} from ${mcp[1]}`);
  return step("other", `Used ${name}`);
}

// Claude's structured patch (Edit and Write results) as unified diff hunks.
function patchDiff(result) {
  const hunks = result?.structuredPatch;
  if (!Array.isArray(hunks) || !hunks.length) return undefined;
  return capText(hunks.map((hunk) => [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...(hunk.lines ?? [])].join("\n")).join("\n"));
}

const TODO_MARKS = { completed: "[x]", in_progress: "[~]", pending: "[ ]" };

// call: the tool_use block { id, name, input }; block: its tool_result; structured: the message's
// tool_use_result, the tool's own output object.
function claudeStepResult(call, block, structured) {
  const { name, input = {} } = call;
  const failed = block.is_error === true;
  const text = blocksText(block.content);
  const end = (extra = {}) => compact({ id: String(call.id), status: failed ? "failed" : "done", ...extra });
  if (name === "Bash") return end({ detail: capOutput(`$ ${input.command ?? ""}\n${text}`) });
  if (failed) return end({ detail: text ? capText(text) : undefined });
  if (name === "Read") return end();
  if (CLAUDE_EDIT_TOOLS.has(name) || name === "Write") return end({ detail: patchDiff(structured) ?? claudeEditDiff(name, input) });
  if (CLAUDE_AGENT_TOOLS.has(name) && structured?.status === "async_launched") return end({ title: `Started an agent: ${input.description || "a subtask"}` });
  if (CLAUDE_AGENT_TOOLS.has(name) && Array.isArray(structured?.content)) return end({ detail: capText(blocksText(structured.content)) || undefined });
  if (name === "TodoWrite" && Array.isArray(input.todos)) return end({ detail: input.todos.map((todo) => `${TODO_MARKS[todo.status] ?? "[ ]"} ${todo.content}`).join("\n") });
  return end({ detail: text ? capText(text) : undefined });
}

// --- Codex ---

// A command Codex recognised as one read, search or listing shows as that; anything else is a shell step.
function commandAction(item) {
  const actions = item.commandActions ?? [];
  return actions.length === 1 && actions[0]?.type !== "unknown" ? actions[0] : null;
}

function changeTitle(changes) {
  if (changes.length !== 1) return changes.length ? `Edited ${changes.length} files` : "Edited files";
  const type = changes[0].kind?.type;
  return `${type === "add" ? "Created" : type === "delete" ? "Deleted" : "Edited"} ${fileName(changes[0].path)}`;
}

function webSearchTitle(item) {
  const action = item.action ?? {};
  if (action.type === "openPage" && action.url) return `Opened ${code(action.url)}`;
  if (action.type === "findInPage" && action.url) return `Searched ${code(action.url)}${action.pattern ? ` for ${code(action.pattern)}` : ""}`;
  const query = item.query || action.query || action.queries?.[0];
  return query ? `Searched the web for ${code(query)}` : "Searched the web";
}

function webResults(results) {
  if (!Array.isArray(results)) return undefined;
  const lines = results.map((result) => [result?.title, result?.url].filter((part) => typeof part === "string" && part).join("\n")).filter(Boolean);
  return lines.length ? capText(lines.join("\n\n")) : undefined;
}

// item/started item -> step, or null for items that aren't tool calls (messages, reasoning, plans…).
function codexStep(item) {
  const step = (kind, title, detail) => compact({ id: String(item.id), kind, title, detail });
  switch (item.type) {
    case "commandExecution": {
      const command = unwrapShell(String(item.command ?? ""));
      const action = commandAction(item);
      const detail = `$ ${command}\n`;
      if (action?.type === "read") return step("read", `Read ${code(action.name || path.basename(String(action.path ?? command)))}`, detail);
      if (action?.type === "search") return step("search", action.query ? `Searched for ${code(action.query)}${action.path ? ` in ${code(action.path)}` : ""}` : `Searched ${code(action.path || command)}`, detail);
      if (action?.type === "listFiles") return step("search", action.path ? `Listed files in ${code(action.path)}` : "Listed files", detail);
      return step("shell", `Ran ${code(command)}`, detail);
    }
    case "fileChange":
      return step("edit", changeTitle(item.changes ?? []));
    case "mcpToolCall":
      return step("other", `Used ${code(item.tool)} from ${item.server}`);
    case "dynamicToolCall":
      return step("other", `Used ${code(item.tool)}`);
    case "webSearch":
      return step("search", webSearchTitle(item));
    case "imageView":
      return step("read", `Viewed ${fileName(item.path)}`);
    default:
      return null;
  }
}

// item/completed item -> the end of its step.
function codexStepResult(item) {
  const id = String(item.id);
  switch (item.type) {
    case "commandExecution": {
      const failed = item.status !== "completed" || (item.exitCode ?? 0) !== 0;
      const status = failed ? "failed" : "done";
      if (!failed && commandAction(item)?.type === "read") return { id, status };
      const output = item.status === "declined" ? "Declined." : item.aggregatedOutput ?? "";
      return { id, status, detail: capOutput(`$ ${unwrapShell(String(item.command ?? ""))}\n${output}`) };
    }
    case "fileChange": {
      const changes = item.changes ?? [];
      return compact({ id, status: item.status === "completed" ? "done" : "failed", title: changeTitle(changes), detail: changes.length ? codexChangesDiff(changes) : undefined });
    }
    case "mcpToolCall":
      return compact({ id, status: item.status === "completed" ? "done" : "failed", detail: capText(item.error?.message ?? blocksText(item.result?.content)) || undefined });
    case "dynamicToolCall": {
      const text = (item.contentItems ?? []).map((content) => (typeof content?.text === "string" ? content.text : "")).filter(Boolean).join("\n");
      return compact({ id, status: item.status === "completed" && item.success !== false ? "done" : "failed", detail: text ? capText(text) : undefined });
    }
    case "webSearch":
      return compact({ id, status: "done", title: webSearchTitle(item), detail: webResults(item.results) });
    default:
      return { id, status: item.status === "failed" ? "failed" : "done" };
  }
}

module.exports = { MAX_OUTPUT, capOutput, claudeStep, claudeStepResult, codexStep, codexStepResult };
