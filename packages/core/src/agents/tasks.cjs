// The agent's to-do list, as tasks: { id, content, activeForm?, status } with status "pending" | "in_progress" | "completed".
// Claude keeps the list in TodoWrite (the whole list each call) or in the newer TaskCreate / TaskUpdate / TaskList tools
// (one change per call), so those are folded into a per-session Map, in creation order. Codex sends the whole plan.
// Every helper returns the full list to emit, or null when the call changes nothing.

const STATUSES = new Set(["pending", "in_progress", "completed"]);

const text = (value) => (typeof value === "string" ? value.trim() : "");
const status = (value) => (STATUSES.has(value) ? value : "pending");

function task(id, content, state, activeForm) {
  const form = text(activeForm);
  return { id: String(id), content, ...(form ? { activeForm: form } : {}), status: status(state) };
}

// Replaces the map's tasks with `list`, and returns them.
function replace(map, list) {
  map.clear();
  for (const item of list) map.set(item.id, item);
  return [...map.values()];
}

// TodoWrite input { todos: [{ content, status, activeForm }] } is the whole list; ids are positions.
function todoWriteTasks(input) {
  if (!Array.isArray(input?.todos)) return null;
  return input.todos.flatMap((todo, index) => (text(todo?.content) ? [task(index, text(todo.content), todo.status, todo.activeForm)] : []));
}

// Codex turn/plan/updated plan [{ step, status: "pending" | "inProgress" | "completed" }].
function codexPlanTasks(plan) {
  if (!Array.isArray(plan)) return null;
  return plan.flatMap((item, index) => (text(item?.step) ? [task(index, text(item.step), item.status === "inProgress" ? "in_progress" : item.status)] : []));
}

// ACP plan entries [{ content, status: "pending" | "in_progress" | "completed", priority }]: the whole plan each time.
function acpPlanTasks(entries) {
  if (!Array.isArray(entries)) return null;
  return entries.flatMap((entry, index) => (text(entry?.content) ? [task(index, text(entry.content), entry.status)] : []));
}

// The id TaskCreate gave a task: from its structured result, else from "Task #3 created successfully".
function createdId(structured, block) {
  if (structured?.task?.id !== undefined) return String(structured.task.id);
  const body = typeof block?.content === "string" ? block.content : (block?.content ?? []).map((part) => part?.text ?? "").join("\n");
  return /#(\w+)/.exec(body)?.[1];
}

// A tool call in a top-level assistant message. TaskCreate waits for its result, which holds the id.
function applyToolUse(map, name, input) {
  if (name === "TodoWrite") {
    const list = todoWriteTasks(input);
    return list ? replace(map, list) : null;
  }
  if (name !== "TaskUpdate") return null;
  const id = String(input?.taskId ?? "");
  const current = map.get(id);
  if (!current) return null;
  if (input.status === "deleted") {
    map.delete(id);
    return [...map.values()];
  }
  const content = text(input.subject) || current.content;
  const form = text(input.activeForm) || current.activeForm;
  map.set(id, task(id, content, input.status ?? current.status, form));
  return [...map.values()];
}

// The result of TaskCreate or TaskList. `structured` is the message's tool_use_result when it is for this result alone.
function applyToolResult(map, call, block, structured) {
  if (block?.is_error) return null;
  if (call.name === "TaskList") {
    if (!Array.isArray(structured?.tasks)) return null;
    // The list doesn't carry activeForm, so keep what we know of a task that is still there.
    return replace(
      map,
      structured.tasks.flatMap((item) => (text(item?.subject) ? [task(item.id, text(item.subject), item.status, map.get(String(item.id))?.activeForm)] : [])),
    );
  }
  if (call.name !== "TaskCreate") return null;
  const subject = text(call.input?.subject);
  if (!subject) return null;
  const id = createdId(structured, block) ?? `task-${map.size + 1}`;
  map.set(id, task(id, subject, "pending", call.input.activeForm));
  return [...map.values()];
}

module.exports = { acpPlanTasks, applyToolResult, applyToolUse, codexPlanTasks, todoWriteTasks };
